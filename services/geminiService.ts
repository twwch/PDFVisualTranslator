import { GoogleGenAI, Schema, Type } from "@google/genai";
import { TokenUsage, EvaluationResult } from "../types";

// We strictly use the model name requested for "Nano Banana Pro" functionality which is mapped to gemini-3-pro-image-preview
// as per the instructions for "High-Quality Image Generation and Editing Tasks".
const MODEL_NAME = 'gemini-3-pro-image-preview';
const EVAL_MODEL_NAME = 'gemini-3-pro-preview'; // For multimodal evaluation

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
  targetLanguage: string,
  sourceLanguage: string = 'Auto (Detect)',
  previousSuggestions?: string // Optional feedback from previous attempt
): Promise<{ image: string; usage: TokenUsage; promptUsed: string }> => {
  return translateImageWithRetry(base64Image, targetLanguage, sourceLanguage, 3, previousSuggestions);
};

const translateImageWithRetry = async (
  base64Image: string,
  targetLanguage: string,
  sourceLanguage: string,
  retries = 3,
  previousSuggestions?: string
): Promise<{ image: string; usage: TokenUsage; promptUsed: string }> => {
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

  // Detect if target is Chinese to enable Aggressive Kanji Replacement mode
  const isChineseTarget = targetLanguage.toLowerCase().includes('chinese') || 
                          targetLanguage.includes('中文') || 
                          targetLanguage.includes('zh');

  // Optimized Prompt for Visual Translation
  let prompt = `**Role:** Elite Localization Engine (Visual Replacement Specialist)
**Task:** Completely ERASE source text and RE-RENDER it in: "${targetLanguage}".

**PRIMARY DIRECTIVE: SEMANTIC RECONSTRUCTION (NOT COPYING)**
You are NOT copying pixels. You are reading the meaning and generating BRAND NEW TEXT in the target language.
The output must look like a document originally created in "${targetLanguage}".

**1. STRICT LANGUAGE ENFORCEMENT (ZERO TOLERANCE):**
   - **Source Language:** ${sourceLanguage}
   - **Target Language:** The output text must be 100% "${targetLanguage}".
   - **Foreign Script Ban:** DO NOT output a single character that does not belong to the target language script.
   - **Mixed Source Handling:** Even if the source has English, Japanese, and Korean, *everything* must become "${targetLanguage}".

${isChineseTarget ? `
**2. CRITICAL: JAPANESE TO CHINESE CORRECTION PROTOCOL (OVERRIDE VISUALS)**
   - **THE PROBLEM:** The source image contains Japanese Kanji/Kana which look similar to Chinese but are WRONG.
   - **THE FIX:** You must REPLACE them with Standard Simplified Chinese Hanzi.
   - **DO NOT MIMIC THE SHAPE:** The original font uses Japanese glyph variants. You MUST use Standard Simplified Chinese glyphs.
   - **FORBIDDEN CHARACTERS (FATAL ERROR):** 
     - No Hiragana (あ, い, う...) -> Must be translated (e.g., の -> 的).
     - No Katakana (ア, イ, ウ...) -> Must be translated (e.g., コンクリート -> 混凝土).
     - No Japanese-only Kanji (込, 畑, 峠...).
     - If you draw a 'の' (no) instead of '的' (de), the task is FAILED.
   - **GRAMMAR & VOCABULARY:** 
     - Source: "分析を行った" -> Target: "进行了分析" (Rephrase naturally).
     - Source: "〜について" -> Target: "关于〜".
     - Source: "無料" -> Target: "免费".
     - Source: "手紙" -> Target: "信件".
` : ''}

**3. VISUAL FIDELITY & FORMAT:**
   - **Positioning:** The new text must occupy the *exact* same coordinate space as the old text.
   - **Vertical Spacing (CRITICAL):** If the original content ends halfway down the page (e.g., a half-page document), the output MUST END at the exact same vertical position. DO NOT STRETCH the content to fill the bottom of the page. Leave the bottom half blank if the original is blank.
   - **Style:** Match the font weight (Bold/Regular), size, and color exactly.
   - **Background:** Do not paint white boxes. The text must look printed on the original background.
   - **Non-Text Elements:** Do NOT touch diagrams, photos, or lines. They must be pixel-perfect.

**4. COMPLETENESS:**
   - Translate small labels on diagrams.
   - Translate headers and footers.
   - Translate table contents row by row.
   - **Proper Nouns:** Only keep Model Numbers (e.g., "RX-78") or Global Brand Names (e.g., "Sony") in original alphanumeric text. Everything else gets translated.

**Output:**
- A single image.
- Resolution: 4K (Pixel-Perfect).
- Aspect Ratio: Match Original.
  `;

  // Inject feedback loop if suggestions exist
  if (previousSuggestions) {
    prompt += `
    
    IMPORTANT - CORRECTION FROM PREVIOUS ATTEMPT:
    The previous translation had the following issues which MUST be fixed in this attempt:
    "${previousSuggestions}"
    
    Ensure you strictly address the feedback above.
    `;
  }

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
              usage,
              promptUsed: prompt
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
    
    // Check for 500 Internal Server Error (sometimes happens with complex image gen requests)
    const isInternalError = errorMessage.includes("500") || errorMessage.includes("INTERNAL");

    if ((isQuotaError || isInternalError) && retries > 0) {
      console.warn(`API Error (${isQuotaError ? 'Quota' : 'Internal'}). Retrying in 10s... (${retries} attempts left)`);
      await delay(10000); // Wait 10 seconds
      return translateImageWithRetry(base64Image, targetLanguage, sourceLanguage, retries - 1, previousSuggestions);
    }

    throw error;
  }
};

export const evaluateTranslation = async (
  originalImage: string,
  translatedImage: string,
  targetLanguage: string,
  sourceLanguage: string = 'Auto (Detect)'
): Promise<EvaluationResult> => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("API Key missing");

  const ai = new GoogleGenAI({ apiKey });
  
  const originalData = originalImage.split(',')[1];
  const translatedData = translatedImage.split(',')[1];

  const prompt = `
    You are a professional Translation Quality Auditor. 
    Compare the Original Image and the Translated Image.
    
    Context:
    - Source Language: ${sourceLanguage}
    - Target Language: ${targetLanguage}
    
    Evaluate the translation on a scale of 1 to 10 for the following 6 dimensions:
    1. Accuracy: How accurately is the meaning preserved?
    2. Fluency: Does the text sound natural and native-like in ${targetLanguage}?
    3. Consistency: Are styles, fonts, and layouts consistent with the original?
    4. Terminology: Is the technical or domain-specific terminology correct?
    5. Completeness: Is ALL text translated? Are any parts missed? 
       - CRITICAL: If target is Chinese (简体中文) but you see Japanese Hiragana/Katakana or untranslated Kanji, this score MUST be below 5.
    6. Format Preservation: How well are the image dimensions, non-text elements, and layout preserved? 
       - Check specifically if half-page content was incorrectly stretched to fill the full page.

    OUTPUT REQUIREMENTS:
    - The 'reason' and 'suggestions' MUST be written in SIMPLIFIED CHINESE (简体中文).
    - If you detect untranslated foreign script (e.g., Japanese left in a Chinese translation), point it out explicitly in the suggestions.
    - Provide concrete suggestions for improvement if the score is low.
  `;

  const responseSchema: Schema = {
    type: Type.OBJECT,
    properties: {
      scores: {
        type: Type.OBJECT,
        properties: {
          accuracy: { type: Type.NUMBER },
          fluency: { type: Type.NUMBER },
          consistency: { type: Type.NUMBER },
          terminology: { type: Type.NUMBER },
          completeness: { type: Type.NUMBER },
          formatPreservation: { type: Type.NUMBER },
        },
        required: ["accuracy", "fluency", "consistency", "terminology", "completeness", "formatPreservation"],
      },
      reason: { type: Type.STRING },
      suggestions: { type: Type.STRING },
    },
    required: ["scores", "reason", "suggestions"],
  };

  try {
    const response = await ai.models.generateContent({
      model: EVAL_MODEL_NAME,
      contents: {
        parts: [
          { text: prompt },
          { inlineData: { mimeType: 'image/jpeg', data: originalData } },
          { inlineData: { mimeType: 'image/jpeg', data: translatedData } },
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: responseSchema,
      }
    });

    const jsonText = response.text || "{}";
    const result = JSON.parse(jsonText);
    
    // Calculate average of 6 dimensions
    const scores = result.scores;
    const avg = (
        scores.accuracy + 
        scores.fluency + 
        scores.consistency + 
        scores.terminology + 
        scores.completeness + 
        scores.formatPreservation
    ) / 6;

    return {
      scores: scores,
      averageScore: parseFloat(avg.toFixed(1)),
      reason: result.reason,
      suggestions: result.suggestions
    };

  } catch (error) {
    console.error("Evaluation failed", error);
    // Return a fallback so we don't crash the app
    return {
      scores: { accuracy: 0, fluency: 0, consistency: 0, terminology: 0, completeness: 0, formatPreservation: 0 },
      averageScore: 0,
      reason: "评估服务暂时不可用。",
      suggestions: "请稍后重试。"
    };
  }
};
