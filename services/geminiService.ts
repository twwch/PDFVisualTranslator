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
    Role: You are an expert translator and professional graphic designer specializing in document localization.
    Task: Translate the text in the provided image into ${targetLanguage}, replacing the original text while preserving the visual layout and background exactly.

    *** PRIMARY DIRECTIVE: TRANSLATE EVERYTHING ***
    You must translate **ALL** text found in the image. This specifically includes:
    - Main headings and body text.
    - **Small text, fine print, and footnotes** (CRITICAL: Do not ignore tiny fonts).
    - Labels inside charts, graphs, and diagrams.
    - Floating UI elements, page numbers, or captions.
    - Text inside logos (unless it is a brand name).

    *** EXCEPTION: PROPER NOUNS ***
    Do NOT translate specific proper nouns (Brand names, Company names, Model numbers, Personal Names) unless they have widely accepted localized names. Keep these in the original language.

    *** VISUAL PRESERVATION RULES (CRITICAL) ***
    1. **BACKGROUND INTEGRITY**: 
       - When replacing text, you MUST reconstruct the background behind the letters.
       - **NEVER** place translated text inside a white box, solid colored block, or overlay unless it exists in the original.
       - The background must appear seamless and original.
    2. **FONT MATCHING**: 
       - Match the original font color EXACTLY.
       - Match the font size, weight (boldness), and style (serif/sans-serif).
       - For small text, ensure the translated text remains legible but keeps the original scale.
    3. **LAYOUT**: 
       - Keep strict alignment. The translated text must occupy the exact same spatial area.
       - Do not stretch or distort the image dimensions.

    *** OUTPUT FORMAT ***
    Return ONLY the single high-quality image of the translated page. 
    DO NOT output any text, Markdown, JSON, or explanations. 
    Just the image.
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
            imageSize: "2K", // Requesting higher resolution for document readability
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
