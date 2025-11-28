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
    I have an image of a document page.
    Please visually translate this document into ${targetLanguage}.
    
    CRITICAL INSTRUCTION ON COLORS:
    - You MUST preserve the exact font colors from the original image. 
    - If the original text is red, the translated text MUST be red.
    - If the original text is black, the translated text MUST be black.
    - Do not change the text color to gray or any other shade. 
    - Maintain the original background color and all other visual elements exactly.

    General Requirements:
    - Maintain the original layout, font styles (bold, italic, etc.), and formatting EXACTLY.
    - Do not change the composition or the visual structure.
    - The output must be a high-quality image of the translated document.
    - Do not add any commentary, just the translated image.
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