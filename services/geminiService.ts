import { GoogleGenAI, Schema, Type } from "@google/genai";
import { TokenUsage, EvaluationResult, TranslationMode } from "../types";

// We strictly use the model name requested for "Nano Banana Pro" functionality which is mapped to gemini-3-pro-image-preview
// as per the instructions for "High-Quality Image Generation and Editing Tasks".
const MODEL_NAME = 'gemini-3-pro-image-preview';
const REASONING_MODEL_NAME = 'gemini-3-pro-preview'; // For extraction and evaluation

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

// --- Step 1 of Engine 2: Extract and Translate Text ---
const extractAndTranslateText = async (
    base64Data: string, 
    sourceLanguage: string, 
    targetLanguage: string,
    apiKey: string,
    previousFeedback?: string // Support for retry loop in Step 1
): Promise<{ mapping: string, usage: TokenUsage }> => {
    const ai = new GoogleGenAI({ apiKey });
    
    // Schema for structured extraction
    const responseSchema: Schema = {
        type: Type.ARRAY,
        items: {
            type: Type.OBJECT,
            properties: {
                original: { type: Type.STRING, description: "Original text segment found in image" },
                translated: { type: Type.STRING, description: "Translation in target language" },
                location: { type: Type.STRING, description: "Brief description of location (e.g., Header, Table Row 1, Footer)" }
            },
            required: ["original", "translated"]
        }
    };

    let prompt = `
    Role: Senior Optical Character Recognition (OCR) and Translation Expert.
    Task: Analyze the image and extract EVERY single piece of text.
    
    1. Identify text in: ${sourceLanguage}.
    2. Translate it to: ${targetLanguage}.
    3. Return a comprehensive list mapping original text to translated text.
    
    QUALITY STANDARDS (5 DIMENSIONS):
    1. **Accuracy:** Preserve the exact meaning of the source text.
    2. **Fluency:** Use natural, native-level phrasing in ${targetLanguage}. Avoid robotic literal translations.
    3. **Consistency:** Maintain consistent terminology for repeated terms.
    4. **Terminology:** Use professional, domain-specific vocabulary (e.g., Engineering, Medical, Legal) appropriate for the document.
    5. **Completeness:** Extract and translate EVERYTHING, including small footnotes, diagram labels, and page numbers.

    CRITICAL RULES:
    - If Source is Japanese/Chinese mixed, identify the Kanji correctly.
    - If Target is Chinese, enforce strict vocabulary localization (e.g., 入力 -> 输入).
    - Do NOT summarize. We need segment-by-segment mapping for replacement.
    `;

    if (previousFeedback) {
        prompt += `
    
    --------------------------------------------------
    CRITICAL RETRY INSTRUCTIONS (FEEDBACK LOOP):
    This is a re-run because the previous translation had issues.
    User/Auditor Feedback: "${previousFeedback}"
    
    YOU MUST FIX THE TRANSLATION MAPPING BASED ON THIS FEEDBACK.
    If the feedback mentions missing text, find it.
    If the feedback mentions wrong terminology, correct the 'translated' field.
    --------------------------------------------------
        `;
    }

    const response = await ai.models.generateContent({
        model: REASONING_MODEL_NAME,
        contents: {
            parts: [
                { text: prompt },
                { inlineData: { mimeType: 'image/jpeg', data: base64Data } }
            ]
        },
        config: {
            responseMimeType: "application/json",
            responseSchema: responseSchema,
            temperature: 0.1 // Low temperature for precision
        }
    });

    const usageMetadata = response.usageMetadata;
    const usage: TokenUsage = {
        inputTokens: usageMetadata?.promptTokenCount || 0,
        outputTokens: usageMetadata?.candidatesTokenCount || 0,
        totalTokens: usageMetadata?.totalTokenCount || 0,
        estimatedCost: 0 // Calculated later
    };

    const jsonText = response.text || "[]";
    let segments = [];
    try {
        segments = JSON.parse(jsonText);
    } catch (e) {
        console.warn("Failed to parse extraction JSON", e);
    }

    // Convert JSON to a robust prompt string for the next step
    const mappingString = segments.map((s: any, i: number) => 
        `Segment ${i+1} [${s.location || 'Text'}]: "${s.original}" => "${s.translated}"`
    ).join('\n');

    return { mapping: mappingString, usage };
};


export const translateImage = async (
  base64Image: string,
  targetLanguage: string,
  sourceLanguage: string = 'Auto (Detect)',
  mode: TranslationMode = TranslationMode.DIRECT,
  previousSuggestions?: string // Optional feedback from previous attempt
): Promise<{ image: string; usage: TokenUsage; promptUsed: string; extractedSegments?: string }> => {
  return translateImageWithRetry(base64Image, targetLanguage, sourceLanguage, mode, 3, previousSuggestions);
};

const translateImageWithRetry = async (
  base64Image: string,
  targetLanguage: string,
  sourceLanguage: string,
  mode: TranslationMode,
  retries = 3,
  previousSuggestions?: string
): Promise<{ image: string; usage: TokenUsage; promptUsed: string; extractedSegments?: string }> => {
  // Ensure API key is selected via the window.aistudio flow before calling this
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API Key not found in environment.");
  }

  const ai = new GoogleGenAI({ apiKey });
  const base64Data = base64Image.split(',')[1];
  const { width, height } = await getImageDimensions(base64Image);
  const aspectRatio = getBestAspectRatio(width, height);
  const isChineseTarget = targetLanguage.toLowerCase().includes('chinese') || targetLanguage.includes('中文') || targetLanguage.includes('zh');

  let accumulatedCost = 0;
  let accumulatedInputTokens = 0;
  let accumulatedOutputTokens = 0;

  // --- TWO-STEP MODE: PRE-CALCULATION ---
  let extractedTextMapping = "";
  if (mode === TranslationMode.TWO_STEP) {
      try {
          // Pass previousSuggestions to Step 1 to fix linguistic errors at the source
          const extraction = await extractAndTranslateText(base64Data, sourceLanguage, targetLanguage, apiKey, previousSuggestions);
          extractedTextMapping = extraction.mapping;
          
          // Accumulate costs from Step 1
          accumulatedInputTokens += extraction.usage.inputTokens;
          accumulatedOutputTokens += extraction.usage.outputTokens;
          accumulatedCost += (extraction.usage.inputTokens / 1_000_000) * PRICE_PER_1M_INPUT;
          accumulatedCost += (extraction.usage.outputTokens / 1_000_000) * PRICE_PER_1M_OUTPUT;
      } catch (e) {
          console.warn("Step 1 (Extraction) failed, falling back to direct mode implicitly", e);
          extractedTextMapping = "Extraction failed. Proceed with direct translation.";
      }
  }

  // --- CONSTRUCT PROMPT (Shared Logic but branched instructions) ---
  let prompt = `**Role:** Elite Localization Engine (Visual Replacement Specialist)
**Task:** Completely ERASE source text and RE-RENDER it in: "${targetLanguage}".

**PRIMARY DIRECTIVE: SEMANTIC RECONSTRUCTION (NOT COPYING)**
You are NOT copying pixels. You are reading the meaning and generating BRAND NEW TEXT in the target language.
The output must look like a document originally created in "${targetLanguage}".
`;

    if (mode === TranslationMode.TWO_STEP) {
        prompt += `
**ENGINE MODE: PURE VISUAL REPLACEMENT (STRICT)**
I have already performed the OCR and Translation in a separate reasoning step.
Your ONLY job is to apply this text to the image.

**MANDATORY INSTRUCTIONS:**
1. **TRUST THE MAPPING:** The text below has already been corrected based on user feedback. Do not re-translate. Use the "Translated" string exactly.
2. **REPLACE ONLY:** Identify the "Original" text in the image, erase it (matching background), and print the "Translated" text.
3. **PRESERVE LAYOUT:** The new text must fit in the exact same bounding box. Adjust font size if necessary, but do not shift the layout.

**TEXT MAPPING TO APPLY:**
${extractedTextMapping}
------------------------------------------------
`;
    } else {
        // DIRECT MODE
        prompt += `
**1. STRICT LANGUAGE ENFORCEMENT (ZERO TOLERANCE):**
   - **Source Language:** ${sourceLanguage}
   - **Target Language:** The output text must be 100% "${targetLanguage}".
   - **Foreign Script Ban:** DO NOT output a single character that does not belong to the target language script.
   - **Mixed Source Handling:** Even if the source has English, Japanese, and Korean, *everything* must become "${targetLanguage}".

**PROFESSIONAL QUALITY STANDARDS (5 DIMENSIONS):**
You are strictly required to adhere to these 5 dimensions of quality:
1. **Accuracy:** The translation must convey the exact meaning of the source. No hallucinations.
2. **Fluency:** The text must read naturally to a native speaker. Fix awkward phrasings.
3. **Consistency:** Maintain consistent terminology and style across the page.
4. **Terminology:** Use high-level, domain-specific professional vocabulary (e.g., Engineering, Medical, Legal).
5. **Completeness:** Translate every single text element, including footnotes and labels.
`;
    }

    // SHARED RULES (Applies to both modes to ensure quality)
    if (isChineseTarget) {
        prompt += `
**CRITICAL: JAPANESE TO CHINESE CORRECTION PROTOCOL**
   - **THE PROBLEM:** The source image contains Japanese Kanji/Kana which look similar to Chinese but are WRONG.
   - **THE FIX:** You must REPLACE them with Standard Simplified Chinese Hanzi.
   - **DO NOT MIMIC THE SHAPE:** The original font uses Japanese glyph variants. You MUST use Standard Simplified Chinese glyphs.
   - **FORBIDDEN CHARACTERS (FATAL ERROR):** 
     - No Hiragana (あ, い, う...) -> Must be translated (e.g., の -> 的).
     - No Katakana (ア, イ, ウ...) -> Must be translated (e.g., コンクリート -> 混凝土).
     - No Japanese-only Kanji (込, 畑, 峠...).
     - No "Lazy Copying" of Kanji like 入力 (Input). It MUST become 输入.
     - No 手紙 (Letter). It MUST become 信件.
`;
    }

    prompt += `
**VISUAL FIDELITY & FORMAT:**
   - **Positioning:** The new text must occupy the *exact* same coordinate space as the old text.
   - **Vertical Spacing (CRITICAL):** If the original content ends halfway down the page (e.g., a half-page document), the output MUST END at the exact same vertical position. DO NOT STRETCH the content to fill the bottom of the page. Leave the bottom half blank if the original is blank.
   - **Style:** Match the font weight (Bold/Regular), size, and color exactly.
   - **Background:** Do not paint white boxes. The text must look printed on the original background.
   - **Non-Text Elements:** Do NOT touch diagrams, photos, or lines. They must be pixel-perfect.

**COMPLETENESS:**
   - Translate small labels on diagrams.
   - Translate headers and footers.
   - Translate table contents row by row.
   - **Proper Nouns:** Only keep Model Numbers (e.g., "RX-78") or Global Brand Names (e.g., "Sony") in original alphanumeric text. Everything else gets translated.

**Output:**
- A single image.
- Resolution: 4K (Pixel-Perfect).
- Aspect Ratio: Match Original.
`;

  // Inject feedback loop if suggestions exist.
  // In TWO_STEP mode, the linguistic feedback is already handled in Step 1, 
  // but we include it here primarily for visual/formatting feedback (e.g., "Text is too small", "Background damaged").
  if (previousSuggestions) {
    prompt += `
    
    IMPORTANT - VISUAL CORRECTION FROM PREVIOUS ATTEMPT:
    The previous attempt had visual/layout issues. 
    Feedback: "${previousSuggestions}"
    
    Ensure you strictly address any LAYOUT or FORMATTING issues mentioned above.
    `;
  }

  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: {
        parts: [
          { text: prompt },
          { inlineData: { mimeType: 'image/jpeg', data: base64Data } },
        ],
      },
      config: {
        imageConfig: {
            imageSize: "4K", 
            aspectRatio: aspectRatio 
        }
      }
    });

    // Parse usage for Step 2
    const step2Meta = response.usageMetadata;
    const s2Input = step2Meta?.promptTokenCount || 0;
    const s2Output = step2Meta?.candidatesTokenCount || 0;
    
    accumulatedInputTokens += s2Input;
    accumulatedOutputTokens += s2Output;
    accumulatedCost += (s2Input / 1_000_000) * PRICE_PER_1M_INPUT;
    accumulatedCost += (s2Output / 1_000_000) * PRICE_PER_1M_OUTPUT;

    const totalUsage: TokenUsage = {
        inputTokens: accumulatedInputTokens,
        outputTokens: accumulatedOutputTokens,
        totalTokens: accumulatedInputTokens + accumulatedOutputTokens,
        estimatedCost: accumulatedCost
    };

    // Parse response for image
    const parts = response.candidates?.[0]?.content?.parts;
    if (parts) {
      for (const part of parts) {
        if (part.inlineData && part.inlineData.data) {
          return {
              image: `data:image/png;base64,${part.inlineData.data}`,
              usage: totalUsage,
              promptUsed: prompt,
              extractedSegments: extractedTextMapping || undefined
          };
        }
      }
    }

    throw new Error("No image data returned from Gemini.");

  } catch (error: any) {
    console.error("Translation error:", error);

    const errorMessage = error.message || JSON.stringify(error);
    const isQuotaError = errorMessage.includes("429") || 
                         errorMessage.includes("403") || 
                         errorMessage.includes("quota") || 
                         errorMessage.includes("RESOURCE_EXHAUSTED");
    const isInternalError = errorMessage.includes("500") || errorMessage.includes("INTERNAL");

    if ((isQuotaError || isInternalError) && retries > 0) {
      console.warn(`API Error. Retrying in 10s... (${retries} attempts left)`);
      await delay(10000); // Wait 10 seconds
      // Pass the same accumulated Step 1 data implicitly by checking mode? 
      // Actually, if we retry, we might want to re-run step 1 if step 1 wasn't the cause.
      // But for simplicity, we treat the whole block as the retry unit.
      return translateImageWithRetry(base64Image, targetLanguage, sourceLanguage, mode, retries - 1, previousSuggestions);
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
      model: REASONING_MODEL_NAME, // Use the reasoning model for evaluation
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