
import { GoogleGenAI, Schema, Type } from "@google/genai";
import { TokenUsage, EvaluationResult, TranslationMode, UsageStats } from "../types";

// Nano Banana Pro maps to gemini-3-pro-image-preview
const MODEL_NAME = 'gemini-3-pro-image-preview';
const REASONING_MODEL_NAME = 'gemini-3-pro-preview'; 

const PRICE_PER_1M_INPUT = 3.50;
const PRICE_PER_1M_OUTPUT = 10.50;

const SUPPORTED_ASPECT_RATIOS = [
  { label: "1:1", value: 1.0 },
  { label: "3:4", value: 3/4 },
  { label: "4:3", value: 4/3 },
  { label: "9:16", value: 9/16 },
  { label: "16:9", value: 16/9 },
];

const calculateCost = (input: number, output: number): number => {
    return ((input / 1_000_000) * PRICE_PER_1M_INPUT) + ((output / 1_000_000) * PRICE_PER_1M_OUTPUT);
};

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

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// --- Step 1: Extract and Translate Text ---
const extractAndTranslateText = async (
    base64Data: string, 
    sourceLanguage: string, 
    targetLanguage: string,
    apiKey: string,
    glossary?: string,
    previousFeedback?: string 
): Promise<{ mapping: string, usage: UsageStats }> => {
    const ai = new GoogleGenAI({ apiKey });
    
    const responseSchema: Schema = {
        type: Type.ARRAY,
        items: {
            type: Type.OBJECT,
            properties: {
                original: { type: Type.STRING, description: "Original text segment found in image" },
                translated: { type: Type.STRING, description: "Translation in target language" },
                isTrademark: { type: Type.BOOLEAN, description: "Whether this is a brand name or trademark" }
            },
            required: ["original", "translated", "isTrademark"]
        }
    };

    let prompt = `
    Role: Elite Document Localization Expert.
    Task: Extract and translate ALL text for the target language: ${targetLanguage}.
    
    CRITICAL RULES:
    1. ZERO SPELLING ERRORS: Every word in the translation must be spelled correctly. No typos allowed.
    2. TRADEMARK & BRAND PROTECTION (STRICT): 
       - DO NOT translate brand names, trademarks, or corporate logos.
       - DO NOT TRANSLITERATE (音译) brand names. (e.g., If the brand is "支盘地工", DO NOT use Pinyin or partial translations). Keep them exactly as they appear in the source or follow official brand identity.
       - IF A TERM IS A TRADEMARK, IGNORE GLOSSARY DEFINITIONS that try to translate its meaning. Preserve the brand name as a proper noun.
    3. REDUNDANCY REMOVAL: 
       - If the original text is bilingual (e.g., Chinese and English side-by-side) and the target is ${targetLanguage}, consolidate the content into a single version in ${targetLanguage} ONLY. Remove redundant parts of the source language.
    4. THE SIX PILLARS: Accuracy, Fluency, Consistency, Terminology, Completeness, Glossary Adherence.

    GLOSSARY (Use only for technical terms, IGNORE for trademarks):
    ${glossary ? glossary : "Use industry standards."}
    `;

    if (previousFeedback) {
        prompt += `\nREFINEMENT FEEDBACK: "${previousFeedback}"`;
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
            temperature: 0.1 
        }
    });

    const usageMetadata = response.usageMetadata;
    const inputTokens = usageMetadata?.promptTokenCount || 0;
    const outputTokens = usageMetadata?.candidatesTokenCount || 0;
    
    const usage: UsageStats = {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        cost: calculateCost(inputTokens, outputTokens)
    };

    const jsonText = response.text || "[]";
    let segments = [];
    try {
        segments = JSON.parse(jsonText);
    } catch (e) {
        console.warn("Parse error", e);
    }

    const mappingString = segments.map((s: any, i: number) => 
        `Segment ${i+1}${s.isTrademark ? ' [TRADEMARK - KEEP ORIGINAL]' : ''}: "${s.original}" => "${s.translated}"`
    ).join('\n');

    return { mapping: mappingString, usage };
};


export const translateImage = async (
  base64Image: string,
  targetLanguage: string,
  sourceLanguage: string = 'Auto (Detect)',
  mode: TranslationMode = TranslationMode.DIRECT,
  glossary?: string,
  refinementFeedback?: string 
): Promise<{ image: string; usage: TokenUsage; promptUsed: string; extractedSegments?: string }> => {
  return translateImageWithRetry(base64Image, targetLanguage, sourceLanguage, mode, glossary, 3, refinementFeedback);
};

const translateImageWithRetry = async (
  base64Image: string,
  targetLanguage: string,
  sourceLanguage: string,
  mode: TranslationMode,
  glossary?: string,
  retries = 3,
  refinementFeedback?: string
): Promise<{ image: string; usage: TokenUsage; promptUsed: string; extractedSegments?: string }> => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("API Key missing");

  const ai = new GoogleGenAI({ apiKey });
  const base64Data = base64Image.split(',')[1];
  const { width, height } = await getImageDimensions(base64Image);
  const aspectRatio = getBestAspectRatio(width, height);
  const isChineseTarget = targetLanguage.toLowerCase().includes('chinese') || targetLanguage.includes('中文');

  let extractionUsage: UsageStats | undefined;
  let translationUsage: UsageStats = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 };

  let extractedTextMapping = "";
  if (mode === TranslationMode.TWO_STEP) {
      const extraction = await extractAndTranslateText(base64Data, sourceLanguage, targetLanguage, apiKey, glossary, refinementFeedback);
      extractedTextMapping = extraction.mapping;
      extractionUsage = extraction.usage;
  }

  let prompt = `**Role:** Elite Localization Visual Engine (Gemini 3 Pro).
**Goal:** Pixel-perfect visual document localization for: "${targetLanguage}".

**ABSOLUTE CONSTRAINTS (MANDATORY):**
1. **ZERO SPELLING ERRORS:** Verify spelling of every word. No typos.
2. **TRADEMARK PROTECTION:** DO NOT translate or transliterate brand names. Keep original script. Trademarks override any generic glossary entries.
3. **REDUNDANCY REMOVAL:** Consolidate bilingual content (e.g., CN/EN) into a single, clean version in ${targetLanguage} only.
4. **SIX PILLARS:** Accuracy, Fluency, Consistency, Terminology, Completeness, and Glossary Adherence.

**VISUAL SPECS:**
- Erase original text and overlay translated text.
- Match original font style, color, weight, and size.
`;

    if (refinementFeedback) {
        prompt += `\n**REFINE WITH FEEDBACK:** "${refinementFeedback}"`;
    }

    if (mode === TranslationMode.TWO_STEP) {
        prompt += `\n**APPLY THIS MAPPING (MANDATORY):**\n${extractedTextMapping}`;
    } else {
        prompt += `\n**TASK:** Detect all text (excluding trademarks), consolidate bilingual redundancy if present, translate accurately using the glossary, and replace visually.`;
    }

    if (isChineseTarget) {
        prompt += `\n**LOCALIZATION:** Use Standard Simplified Chinese. Ensure Hanzi characters are correct.`;
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
        imageConfig: { imageSize: "4K", aspectRatio: aspectRatio }
      }
    });

    const meta = response.usageMetadata;
    translationUsage = {
        inputTokens: meta?.promptTokenCount || 0,
        outputTokens: meta?.candidatesTokenCount || 0,
        totalTokens: (meta?.promptTokenCount || 0) + (meta?.candidatesTokenCount || 0),
        cost: calculateCost(meta?.promptTokenCount || 0, meta?.candidatesTokenCount || 0)
    };

    const totalUsage: TokenUsage = {
        extraction: extractionUsage,
        translation: translationUsage,
        total: {
            inputTokens: (extractionUsage?.inputTokens || 0) + translationUsage.inputTokens,
            outputTokens: (extractionUsage?.outputTokens || 0) + translationUsage.outputTokens,
            totalTokens: (extractionUsage?.totalTokens || 0) + translationUsage.totalTokens,
            cost: (extractionUsage?.cost || 0) + translationUsage.cost
        }
    };

    const part = response.candidates?.[0]?.content?.parts.find(p => p.inlineData);
    if (part?.inlineData?.data) {
        return {
            image: `data:image/png;base64,${part.inlineData.data}`,
            usage: totalUsage,
            promptUsed: prompt,
            extractedSegments: extractedTextMapping || undefined
        };
    }
    throw new Error("No image data.");
  } catch (error: any) {
    if (retries > 0) {
      await delay(10000);
      return translateImageWithRetry(base64Image, targetLanguage, sourceLanguage, mode, glossary, retries - 1, refinementFeedback);
    }
    throw error;
  }
};

export const evaluateTranslation = async (
  originalImage: string,
  translatedImage: string,
  targetLanguage: string,
  sourceLanguage: string = 'Auto (Detect)',
  glossary?: string,
  retries = 3
): Promise<{ result: EvaluationResult, usage: UsageStats }> => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("API Key missing");
  const ai = new GoogleGenAI({ apiKey });
  
  const originalData = originalImage.split(',')[1];
  const translatedData = translatedImage.split(',')[1];

  const prompt = `
    Task: Professional Quality Audit for translation into: ${targetLanguage}.
    
    GLOSSARY TO CHECK AGAINST:
    ${glossary || "None provided."}

    CRITICAL AUDIT INSTRUCTIONS:
    1. **TRADEMARK PROTECTION**: DO NOT penalize brand names (e.g., "支盘地工") for missing literal words (like "Development") if they were kept as original trademarks. Brands should NOT be translated or transliterated. A literal translation error in a BRAND is actually a correctness mark.
    2. **REDUNDANCY REMOVAL**: If the original was bilingual (e.g., CN+EN) and the translated result is only ${targetLanguage}, this is a POSITIVE result for 'Redundancy Removal'. DO NOT penalize as 'Incomplete' or 'Missing Text'.
    3. **GLOSSARY COMPLIANCE**: Verify technical terms match the glossary provided above.

    Evaluate (1-10):
    - Accuracy: Semantic fidelity.
    - Fluency: Natural native tone.
    - Consistency: Uniform terminology.
    - Terminology: Alignment with provided GLOSSARY.
    - Completeness: All document text translated (but ignore intentional redundancy removal).
    - Format: Layout integrity.
    - Spelling: Typos (Zero tolerance).
    - Trademark Protection: Brands untouched?
    - Redundancy Removal: Consolidate successful?
    
    Output JSON. Reason/Suggestions in Simplified Chinese. Be objective; ignore "too short" if it was consolidation.
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
          spelling: { type: Type.NUMBER },
          trademarkProtection: { type: Type.NUMBER },
          redundancyRemoval: { type: Type.NUMBER },
        },
        required: ["accuracy", "fluency", "consistency", "terminology", "completeness", "formatPreservation", "spelling", "trademarkProtection", "redundancyRemoval"],
      },
      reason: { type: Type.STRING },
      suggestions: { type: Type.STRING },
    },
    required: ["scores", "reason", "suggestions"],
  };

  try {
    const response = await ai.models.generateContent({
      model: REASONING_MODEL_NAME,
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

    const meta = response.usageMetadata;
    const usage = {
        inputTokens: meta?.promptTokenCount || 0,
        outputTokens: meta?.candidatesTokenCount || 0,
        totalTokens: (meta?.promptTokenCount || 0) + (meta?.candidatesTokenCount || 0),
        cost: calculateCost(meta?.promptTokenCount || 0, meta?.candidatesTokenCount || 0)
    };

    const res = JSON.parse(response.text || "{}");
    const s = res.scores;
    const avg = (s.accuracy + s.fluency + s.consistency + s.terminology + s.completeness + s.formatPreservation + s.spelling + s.trademarkProtection + s.redundancyRemoval) / 9;

    return { result: { ...res, averageScore: parseFloat(avg.toFixed(1)) }, usage };
  } catch (e: any) {
    if (retries > 0) {
        await delay(10000);
        return evaluateTranslation(originalImage, translatedImage, targetLanguage, sourceLanguage, glossary, retries - 1);
    }
    throw e;
  }
};
