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

export const translateImage = async (
  base64Image: string,
  targetLanguage: string
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

  const prompt = `
    Role: You are an expert translator and professional graphic designer.
    Task: Translate the document image into ${targetLanguage} while maintaining absolute visual fidelity.

    *** VISUAL & SPATIAL DIMENSIONS (PRIORITY 1) ***
    1. **NO CROP / NO RESIZE**: The output image must represent the full page exactly as the original. **DO NOT CROP** headers, footers, page numbers, or margins.
    2. **STRICT ALIGNMENT**: Text blocks must replace the original text at the **EXACT SAME COORDINATES**. Do not shift paragraphs up or down.
    3. **FONT SCALING**: Do not change the font size relative to the page width. If the original text is small, the translated text must be small. Match the visual weight.
    4. **NO STRETCHING**: Do not distort the aspect ratio of the text or images.

    *** TRANSLATION CONTENT (PRIORITY 2) ***
    1. **TRANSLATE ALL TEXT**: Includes main body, sidebars, footnotes, tiny diagram labels, and page numbers.
    2. **PROPER NOUNS**: Keep specific brand names (e.g., 'Sony', 'iPad') and model codes in original language.

    *** DESIGN INTEGRITY (PRIORITY 3) ***
    1. **BACKGROUND**: Reconstruct the background behind text perfectly. No white boxes or color blocks.
    2. **COLOR**: Match font colors exactly.

    Output ONLY the translated image.
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

  } catch (error) {
    console.error("Translation error:", error);
    throw error;
  }
};