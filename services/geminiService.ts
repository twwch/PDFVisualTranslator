import { GoogleGenAI } from "@google/genai";
import { TokenUsage } from "../types";

// We strictly use the model name requested for "Nano Banana Pro" functionality which is mapped to gemini-3-pro-image-preview
// as per the instructions for "High-Quality Image Generation and Editing Tasks".
const MODEL_NAME = 'gemini-3-pro-image-preview';

// Estimated Pricing for Pro Tier (Preview rates or standard Pro rates)
// Input: $1.25 / 1 million tokens
// Output: $5.00 / 1 million tokens
const PRICE_PER_1M_INPUT = 1.25;
const PRICE_PER_1M_OUTPUT = 5.00;

const SUPPORTED_ASPECT_RATIOS = [
  { label: "1:1", value: 1.0 },
  { label: "3:4", value: 3/4 },
  { label: "4:3", value: 4/3 },
  { label: "9:16", value: 9/16 },
  { label: "16:9", value: 16/9 },
];

const getBestAspectRatio = (width: number, height: number): string => {
  const targetRatio = width / height;
  let bestMatch = SUPPORTED_ASPECT_RATIOS[0];
  let minDiff = Math.abs(targetRatio - bestMatch.value);

  for (const ratio of SUPPORTED_ASPECT_RATIOS) {
    const diff = Math.abs(targetRatio - ratio.value);
    if (diff < minDiff) {
      minDiff = diff;
      bestMatch = ratio;
    }
  }
  return bestMatch.label;
};

const getImageDimensions = (base64: string): Promise<{ width: number; height: number }> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.width, height: img.height });
    img.onerror = reject;
    img.src = base64;
  });
};

// Utility for delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const translateImage = async (
  base64Image: string,
  targetLanguage: string
): Promise<{ image: string; usage: TokenUsage }> => {
  return translateImageWithRetry(base64Image, targetLanguage);
};

const translateImageWithRetry = async (
  base64Image: string,
  targetLanguage: string,
  retries = 3
): Promise<{ image: string; usage: TokenUsage }> => {
  // Ensure API key is selected via the window.aistudio flow before calling this
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API Key not found in environment.");
  }

  const ai = new GoogleGenAI({ apiKey });

  // Clean the base64 string to just get the data
  const base64Data = base64Image.split(',')[1];

  // Calculate best aspect ratio to prevent distortion
  const { width, height } = await getImageDimensions(base64Image);
  const aspectRatio = getBestAspectRatio(width, height);

  // Optimized Prompt with Specific Handling for Mixed Language Sources and Script Similarity
  const prompt = `
    Act as an expert professional translator and layout engineer.
    Your goal is to create a pixel-perfect translated clone of the original image in ${targetLanguage}.

    CRITICAL EXECUTION PILLARS:

    1. PRESERVE VISUAL IDENTITY (IMAGES & DIAGRAMS):
       - DO NOT ALTER NON-TEXT ELEMENTS. Photos, diagrams, logos, lines, and textures must look EXACTLY like the original.
       - Do NOT "redraw" or "simplify" charts or images. They must be preserved pixel-for-pixel unless they contain text labels that need translation.
       - If a part of the image contains no text, IT MUST REMAIN UNCHANGED.

    2. EXACT STRUCTURE & WHITESPACE:
       - PRESERVE MARGINS AND GAPS: If the original page has large empty spaces (e.g., is only half-full), the output MUST have the exact same empty spaces.
       - DO NOT REFLOW OR CENTER: Do not move text blocks to the center if they were top-aligned. Keep them anchored to their original coordinates.
       - SHORT SECTIONS: Short paragraphs or lists must maintain their original line breaks and visual density. Do not stretch them.

    3. FULL & FLUENT TRANSLATION:
       - Translate ALL text into ${targetLanguage}. This includes Headers, Footers, Tables, Charts, and tiny Index numbers.
       - MULTI-LANGUAGE HANDLING: If the source contains multiple languages (e.g., Japanese + English), translate EVERYTHING into ${targetLanguage}.
       - NATIVE FLUENCY: The result must sound natural to a native speaker. Avoid robotic literal translations.

    4. CRITICAL: SCRIPT CONVERSION (ESPECIALLY JAPANESE TO CHINESE):
       - IF translating from Japanese to Chinese, you MUST convert vocabulary.
       - DO NOT COPY KANJI just because it looks like Chinese.
       - Example: '入力' MUST become '输入', '手紙' MUST become '信', '切手' MUST become '邮票', '削除' MUST become '删除'.
       - Transliteration is FORBIDDEN. Meaning-based translation is MANDATORY.

    5. VISUAL CLONING:
       - Match Font Family, Size, Weight, and Color EXACTLY.
       - Match Background Color EXACTLY.
       - The result should look like the original document was printed in ${targetLanguage} from the start.

    SUMMARY:
    - Text: Translated to ${targetLanguage} (No Copying Kanji), Native Fluency, Exact Position.
    - Images/Diagrams: UNCHANGED.
    - Layout/Whitespace: UNCHANGED.
  `;

  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: {
        parts: [
          {
            text: prompt,
          },
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: base64Data,
            },
          },
        ],
      },
      config: {
        // Nano Banana Pro / Gemini 3 Pro Image specific configs
        imageConfig: {
            imageSize: "4K", // Requesting 4K resolution for maximum detail and dimensional accuracy
            aspectRatio: aspectRatio // Dynamic aspect ratio to match input
        }
      }
    });

    // Parse usage
    const usageMetadata = response.usageMetadata;
    const inputTokens = usageMetadata?.promptTokenCount || 0;
    const outputTokens = usageMetadata?.candidatesTokenCount || 0;
    const totalTokens = usageMetadata?.totalTokenCount || 0;
    
    // Calculate estimated cost
    const inputCost = (inputTokens / 1_000_000) * PRICE_PER_1M_INPUT;
    const outputCost = (outputTokens / 1_000_000) * PRICE_PER_1M_OUTPUT;
    const estimatedCost = inputCost + outputCost;

    const usage: TokenUsage = {
        inputTokens,
        outputTokens,
        totalTokens,
        estimatedCost
    };

    // Parse response for image
    const parts = response.candidates?.[0]?.content?.parts;
    if (parts) {
      for (const part of parts) {
        if (part.inlineData && part.inlineData.data) {
          return {
              image: `data:image/png;base64,${part.inlineData.data}`,
              usage
          };
        }
      }
    }

    throw new Error("No image data returned from Gemini.");

  } catch (error: any) {
    console.error("Translation error:", error);

    // Check for Resource Exhausted or Quota limits
    const errorMessage = error.message || JSON.stringify(error);
    const isQuotaError = errorMessage.includes("429") || 
                         errorMessage.includes("403") || 
                         errorMessage.includes("quota") || 
                         errorMessage.includes("RESOURCE_EXHAUSTED");

    if (isQuotaError && retries > 0) {
      console.warn(`Quota error detected. Retrying in 10s... (${retries} attempts left)`);
      await delay(10000); // Wait 10 seconds
      return translateImageWithRetry(base64Image, targetLanguage, retries - 1);
    }

    throw error;
  }
};
