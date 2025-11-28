import { GoogleGenAI } from "@google/genai";

// We strictly use the model name requested for "Nano Banana Pro" functionality which is mapped to gemini-3-pro-image-preview
// as per the instructions for "High-Quality Image Generation and Editing Tasks".
const MODEL_NAME = 'gemini-3-pro-image-preview';

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
): Promise<string> => {
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
    Task: Translate the text in the provided image into ${targetLanguage}.

    *** TRANSLATION QUALITY STANDARDS ***
    1. **Professional & Native**: Use formal, high-quality, native-level phrasing suitable for professional documents.
    2. **Context Aware**: Accurately handle technical terminology, idioms, and nuances. 
    3. **Natural Flow**: Avoid literal word-for-word translation; prioritize the natural flow and readability of the target language.

    *** CRITICAL VISUAL INSTRUCTIONS ***
    1. **EXACT COLOR MATCHING**: You MUST strictly replicate the font colors of the original text. 
       - If the original header is Red, the translated header MUST be Red.
       - If text is White on a Dark Blue background, keep it White on Dark Blue.
       - Do NOT default to black text unless the original is black.
    2. **LAYOUT INTEGRITY**: 
       - Maintain the exact position, font size, alignment, and font weight (bold/italic) of the original elements.
       - The translated document structure must be indistinguishable from the original.
    3. **SEAMLESS INTEGRATION**: The translated text should look like it was originally printed on the document.

    Output: A single high-quality image of the translated page. Do not add any text or explanations.
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

    // Parse response for image
    const parts = response.candidates?.[0]?.content?.parts;
    if (parts) {
      for (const part of parts) {
        if (part.inlineData && part.inlineData.data) {
          return `data:image/png;base64,${part.inlineData.data}`;
        }
      }
    }

    throw new Error("No image data returned from Gemini.");

  } catch (error) {
    console.error("Translation error:", error);
    throw error;
  }
};
