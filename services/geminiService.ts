
import { GoogleGenAI, Schema, Type } from "@google/genai";
import { TokenUsage, EvaluationResult, TranslationMode, UsageStats } from "../types";

const MODEL_NAME = 'gemini-3-pro-image-preview';
const REASONING_MODEL_NAME = 'gemini-3-pro-preview'; 

const PRICE_PER_1M_INPUT = 3.50;
const PRICE_PER_1M_OUTPUT = 10.50;

const calculateCost = (input: number, output: number): number => {
    return ((input / 1_000_000) * PRICE_PER_1M_INPUT) + ((output / 1_000_000) * PRICE_PER_1M_OUTPUT);
};

const getBestAspectRatio = (width: number, height: number): string => {
  const targetRatio = width / height;
  const ratios = [
    { label: "1:1", value: 1.0 }, { label: "3:4", value: 0.75 }, { label: "4:3", value: 1.33 },
    { label: "9:16", value: 0.56 }, { label: "16:9", value: 1.77 }
  ];
  let best = ratios[0];
  let minDiff = Math.abs(targetRatio - best.value);
  for (const r of ratios) {
    const d = Math.abs(targetRatio - r.value);
    if (d < minDiff) { minDiff = d; best = r; }
  }
  return best.label;
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
                original: { type: Type.STRING },
                translated: { type: Type.STRING },
                isTrademark: { type: Type.BOOLEAN }
            },
            required: ["original", "translated", "isTrademark"]
        }
    };

    let prompt = `
    Role: Elite Localization Expert.
    Goal: Extract and translate text for: ${targetLanguage}.
    
    STRICT COMMANDS:
    1. TRADEMARK NON-TRANSLATION: Brand names (proper nouns like "支盘地工") MUST remain in original script. 
       - NEVER translate brand components (like translating "地工" to "Geotechnical") if they are part of a proprietary name. 
       - DO NOT use Transliteration/Pinyin.
    2. REDUNDANCY REMOVAL: Consolidate bilingual content into ${targetLanguage} ONLY.
    3. GLOSSARY: ${glossary || "Use standard professional terms."}
    `;

    const response = await ai.models.generateContent({
        model: REASONING_MODEL_NAME,
        contents: { parts: [{ text: prompt }, { inlineData: { mimeType: 'image/jpeg', data: base64Data } }] },
        config: { responseMimeType: "application/json", responseSchema, temperature: 0.1 }
    });

    const meta = response.usageMetadata;
    const usage = {
        inputTokens: meta?.promptTokenCount || 0,
        outputTokens: meta?.candidatesTokenCount || 0,
        totalTokens: (meta?.promptTokenCount || 0) + (meta?.candidatesTokenCount || 0),
        cost: calculateCost(meta?.promptTokenCount || 0, meta?.candidatesTokenCount || 0)
    };

    const segments = JSON.parse(response.text || "[]");
    const mapping = segments.map((s: any) => `${s.isTrademark ? '[BRAND]' : ''} "${s.original}" -> "${s.translated}"`).join('\n');
    return { mapping, usage };
};

export const translateImage = async (
  base64Image: string,
  targetLanguage: string,
  sourceLanguage: string = 'Auto (Detect)',
  mode: TranslationMode = TranslationMode.DIRECT,
  glossary?: string,
  refinementFeedback?: string 
): Promise<{ image: string; usage: TokenUsage; promptUsed: string; extractedSegments?: string }> => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("API Key missing");
  const ai = new GoogleGenAI({ apiKey });
  const base64Data = base64Image.split(',')[1];
  const { width, height } = await getImageDimensions(base64Image);
  const aspectRatio = getBestAspectRatio(width, height);

  let extractionUsage: UsageStats | undefined;
  let mapping = "";
  if (mode === TranslationMode.TWO_STEP) {
      const ext = await extractAndTranslateText(base64Data, sourceLanguage, targetLanguage, apiKey, glossary, refinementFeedback);
      mapping = ext.mapping;
      extractionUsage = ext.usage;
  }

  const prompt = `**Role:** Elite Localization Visual Engine. Target: ${targetLanguage}.
**Constraints:**
1. **TRADEMARK PROTECTION:** Keep Brand names (e.g. 支盘地工) original. DO NOT translate or transliterate.
2. **REDUNDANCY REMOVAL:** Consolidate bilingual content.
3. **STYLE:** Match font and layout.

${mode === TranslationMode.TWO_STEP ? `**MAPPING:**\n${mapping}` : `**GLOSSARY:**\n${glossary || "None"}`}
${refinementFeedback ? `**REFINEMENT FEEDBACK:** ${refinementFeedback}` : ""}
`;

  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: { parts: [{ text: prompt }, { inlineData: { mimeType: 'image/jpeg', data: base64Data } }] },
    config: { imageConfig: { imageSize: "4K", aspectRatio: aspectRatio } }
  });

  const meta = response.usageMetadata;
  const translationUsage = {
      inputTokens: meta?.promptTokenCount || 0, outputTokens: meta?.candidatesTokenCount || 0,
      totalTokens: (meta?.promptTokenCount || 0) + (meta?.candidatesTokenCount || 0), cost: calculateCost(meta?.promptTokenCount || 0, meta?.candidatesTokenCount || 0)
  };

  const part = response.candidates?.[0]?.content?.parts.find(p => p.inlineData);
  return {
      image: `data:image/png;base64,${part?.inlineData?.data}`,
      usage: { extraction: extractionUsage, translation: translationUsage, total: { inputTokens: (extractionUsage?.inputTokens || 0) + translationUsage.inputTokens, outputTokens: (extractionUsage?.outputTokens || 0) + translationUsage.outputTokens, totalTokens: (extractionUsage?.totalTokens || 0) + translationUsage.totalTokens, cost: (extractionUsage?.cost || 0) + translationUsage.cost } },
      promptUsed: prompt,
      extractedSegments: mapping || undefined
  };
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
  
  const prompt = `
    Quality Audit Task.
    GLOSSARY (Truth): ${glossary || "None"}
    
    AUDIT PROTOCOL (ANTI-MISJUDGMENT):
    1. **TRADEMARK PROTECTED**: If a Brand name (e.g. "支盘地工") is kept original and NOT translated (even if it contains translatable words like "Technology" or "Development"), this is the HIGHEST standard. DO NOT penalize for "literal omission". Brands are proper nouns.
    2. **REDUNDANCY REMOVAL**: Consolidating bilingual source (CN+EN) into single target is the CORRECT goal. DO NOT penalize for "missing text".
    3. **ENGINE PREFERENCE**: Objective evaluation based on professional localization standards.
    
    Evaluate 1-10: Accuracy, Fluency, Consistency, Terminology, Completeness, Format, Spelling, Trademark Protection, Redundancy Removal.
    Output JSON. Reason/Suggestions in Simplified Chinese.
  `;

  const responseSchema: Schema = {
    type: Type.OBJECT,
    properties: {
      scores: {
        type: Type.OBJECT,
        properties: {
          accuracy: { type: Type.NUMBER }, fluency: { type: Type.NUMBER }, consistency: { type: Type.NUMBER },
          terminology: { type: Type.NUMBER }, completeness: { type: Type.NUMBER }, formatPreservation: { type: Type.NUMBER },
          spelling: { type: Type.NUMBER }, trademarkProtection: { type: Type.NUMBER }, redundancyRemoval: { type: Type.NUMBER }
        },
        required: ["accuracy", "fluency", "consistency", "terminology", "completeness", "formatPreservation", "spelling", "trademarkProtection", "redundancyRemoval"]
      },
      reason: { type: Type.STRING },
      suggestions: { type: Type.STRING }
    },
    required: ["scores", "reason", "suggestions"]
  };

  try {
    const response = await ai.models.generateContent({
      model: REASONING_MODEL_NAME,
      contents: { parts: [{ text: prompt }, { inlineData: { mimeType: 'image/jpeg', data: originalImage.split(',')[1] } }, { inlineData: { mimeType: 'image/jpeg', data: translatedImage.split(',')[1] } }] },
      config: { responseMimeType: "application/json", responseSchema }
    });

    const meta = response.usageMetadata;
    const usage = { inputTokens: meta?.promptTokenCount || 0, outputTokens: meta?.candidatesTokenCount || 0, totalTokens: (meta?.promptTokenCount || 0) + (meta?.candidatesTokenCount || 0), cost: calculateCost(meta?.promptTokenCount || 0, meta?.candidatesTokenCount || 0) };
    const res = JSON.parse(response.text || "{}");
    const s = res.scores;
    const avg = (s.accuracy + s.fluency + s.consistency + s.terminology + s.completeness + s.formatPreservation + s.spelling + s.trademarkProtection + s.redundancyRemoval) / 9;
    return { result: { ...res, averageScore: parseFloat(avg.toFixed(1)) }, usage };
  } catch (e: any) {
    if (retries > 0) { await delay(10000); return evaluateTranslation(originalImage, translatedImage, targetLanguage, sourceLanguage, glossary, retries - 1); }
    throw e;
  }
};
