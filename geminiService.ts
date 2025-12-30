
import { GoogleGenAI, Schema, Type } from "@google/genai";
import { TokenUsage, EvaluationResult, TranslationMode, UsageStats } from "../types";

// We strictly use the model name requested for "Nano Banana Pro" functionality which is mapped to gemini-3-pro-image-preview
// as per the instructions for "High-Quality Image Generation and Editing Tasks".
const MODEL_NAME = 'gemini-3-pro-image-preview';
const REASONING_MODEL_NAME = 'gemini-3-pro-preview'; // For extraction and evaluation

// Updated Pricing for Gemini 1.5 Pro / 3.0 Pro (Estimation)
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

// Utility for delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// --- Step 1 of Engine 2: Extract and Translate Text ---
const extractAndTranslateText = async (
    base64Data: string, 
    sourceLanguage: string, 
    targetLanguage: string,
    apiKey: string,
    glossary?: string,
    previousFeedback?: string 
): Promise<{ mapping: string, usage: UsageStats }> => {
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
    Task: Analyze the image and extract text segments for translation.
    
    1. Identify text in: ${sourceLanguage}.
    2. Translate it to: ${targetLanguage}.
    
    GLOSSARY PROTOCOL (CRITICAL):
    ${glossary ? `You MUST strictly follow this glossary mapping for specific terms:\n${glossary}` : "No specific glossary provided. Use standard professional terminology."}
    
    IMAGE PRESERVATION RULE (STRICT):
    - Do NOT extract or translate text that is embedded inside graphical images, photographs, illustrations, or complex technical diagrams.
    - ONLY extract body text, headings, footers, and text inside data tables.
    - If a segment of text is part of a "picture", skip it entirely.
    
    COMPLETENESS PROTOCOL:
    - Extract all document-level text (headers, body, footnotes).
    - Directive: If it is part of the document structure (and not a nested image), EXTRACT IT.
    
    QUALITY STANDARDS:
    1. **Accuracy:** Preserve exact meaning.
    2. **Fluency:** Native-level phrasing.
    3. **Consistency:** Terminology must be uniform.
    `;

    if (previousFeedback) {
        prompt += `
    
    --------------------------------------------------
    CRITICAL RETRY INSTRUCTIONS:
    User Feedback: "${previousFeedback}"
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
        console.warn("Failed to parse extraction JSON", e);
    }

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
  glossary?: string,
  previousSuggestions?: string 
): Promise<{ image: string; usage: TokenUsage; promptUsed: string; extractedSegments?: string }> => {
  return translateImageWithRetry(base64Image, targetLanguage, sourceLanguage, mode, glossary, 3, previousSuggestions);
};

const translateImageWithRetry = async (
  base64Image: string,
  targetLanguage: string,
  sourceLanguage: string,
  mode: TranslationMode,
  glossary?: string,
  retries = 3,
  previousSuggestions?: string
): Promise<{ image: string; usage: TokenUsage; promptUsed: string; extractedSegments?: string }> => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API Key not found in environment.");
  }

  const ai = new GoogleGenAI({ apiKey });
  const base64Data = base64Image.split(',')[1];
  const { width, height } = await getImageDimensions(base64Image);
  const aspectRatio = getBestAspectRatio(width, height);
  const isChineseTarget = targetLanguage.toLowerCase().includes('chinese') || targetLanguage.includes('中文') || targetLanguage.includes('zh');

  let extractionUsage: UsageStats | undefined;
  let translationUsage: UsageStats = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 };

  let extractedTextMapping = "";
  if (mode === TranslationMode.TWO_STEP) {
      try {
          const extraction = await extractAndTranslateText(base64Data, sourceLanguage, targetLanguage, apiKey, glossary, previousSuggestions);
          extractedTextMapping = extraction.mapping;
          extractionUsage = extraction.usage;
      } catch (e) {
          console.warn("Step 1 (Extraction) failed, falling back to direct mode implicitly", e);
          extractedTextMapping = "Extraction failed. Proceed with direct translation.";
      }
  }

  let prompt = `**Role:** Elite Localization Engine (Visual Replacement Specialist)
**Task:** Replace source text with: "${targetLanguage}".

**IMAGE PRESERVATION RULE (MANDATORY):**
- **DO NOT TRANSLATE PICTURES:** If the page contains photographs, graphical logos, or complex diagrams/illustrations, leave them EXACTLY as they are. 
- Do NOT overlay translated text on top of images or graphics. 
- ONLY translate text that is part of the document's body, headings, tables, or structural layout.

**GLOSSARY ENFORCEMENT:**
${glossary ? `You MUST strictly use the following translations for specified terms:\n${glossary}` : "No glossary provided."}
`;

    if (mode === TranslationMode.TWO_STEP) {
        prompt += `
**ENGINE MODE: PURE VISUAL REPLACEMENT**
Use the provided mapping. 
1. **TRUST THE MAPPING:** The text below already incorporates the glossary.
2. **REPLACE ONLY:** Erase original text (matching background) and print translated text.
3. **STYLE CLONING:** Match font, weight, color, and size exactly.

**TEXT MAPPING TO APPLY:**
${extractedTextMapping}
`;
    } else {
        prompt += `
**DIRECT TRANSLATION INSTRUCTIONS:**
1. **STRICT TARGET:** Target must be 100% "${targetLanguage}".
2. **STYLE MATCHING:** The output must maintain the exact visual appearance (font, color, layout) of the original document.
3. **ACCURACY:** High precision translation following the glossary provided above.
`;
    }

    if (isChineseTarget) {
        prompt += `
**CRITICAL: CHINESE LOCALIZATION**
- Replace all Japanese Kanji/Kana or foreign script with Standard Simplified Chinese.
- Do NOT use Japanese glyph variants. Use mainland China standard Hanzi.
`;
    }

    prompt += `
**Output:**
- A single image.
- Resolution: 4K (Pixel-Perfect).
- Aspect Ratio: Match Original.
`;

  if (previousSuggestions) {
    prompt += `\n**FEEDBACK FROM PREVIOUS ATTEMPT:** "${previousSuggestions}"\n`;
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

    const step2Meta = response.usageMetadata;
    const s2Input = step2Meta?.promptTokenCount || 0;
    const s2Output = step2Meta?.candidatesTokenCount || 0;
    
    translationUsage = {
        inputTokens: s2Input,
        outputTokens: s2Output,
        totalTokens: s2Input + s2Output,
        cost: calculateCost(s2Input, s2Output)
    };

    const totalInput = (extractionUsage?.inputTokens || 0) + translationUsage.inputTokens;
    const totalOutput = (extractionUsage?.outputTokens || 0) + translationUsage.outputTokens;
    const totalCost = (extractionUsage?.cost || 0) + translationUsage.cost;
    const totalTokens = totalInput + totalOutput;

    const totalUsage: TokenUsage = {
        extraction: extractionUsage,
        translation: translationUsage,
        total: {
            inputTokens: totalInput,
            outputTokens: totalOutput,
            totalTokens: totalTokens,
            cost: totalCost
        }
    };

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
    const errorMessage = error.message || JSON.stringify(error);
    const isQuotaError = errorMessage.includes("429") || errorMessage.includes("403") || errorMessage.includes("quota");
    const isInternalError = errorMessage.includes("500") || errorMessage.includes("INTERNAL");

    if ((isQuotaError || isInternalError) && retries > 0) {
      await delay(10000); 
      return translateImageWithRetry(base64Image, targetLanguage, sourceLanguage, mode, glossary, retries - 1, previousSuggestions);
    }
    throw error;
  }
};

// Fixed signature: added glossary parameter before retries
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

  // Updated prompt to include all 9 evaluation criteria required by EvaluationScores
  const prompt = `
    Professional Translation Quality Audit.
    Compare Original and Translated.
    
    - Target Language: ${targetLanguage}
    ${glossary ? `- Glossary protocol: ${glossary}` : ''}
    
    Evaluate (1-10):
    1. Accuracy
    2. Fluency
    3. Consistency
    4. Terminology
    5. Completeness (Penalty if pictures were translated or if target script is mixed)
    6. Format Preservation (Penalty if layout is stretched)
    7. Spelling: Check for typos.
    8. Trademark Protection: Verify brand names are untouched.
    9. Redundancy Removal: Consolidate bilingual content.

    IMAGE PRESERVATION CHECK:
    - If you see that text inside an embedded photograph or a graphical illustration WAS translated, decrease the 'completeness' and 'formatPreservation' scores. We expect images to be UNTOUCHED.

    Output in JSON. 'reason' and 'suggestions' in Simplified Chinese.
  `;

  // Updated schema to include all 9 properties of EvaluationScores
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

    const usageMetadata = response.usageMetadata;
    const inputTokens = usageMetadata?.promptTokenCount || 0;
    const outputTokens = usageMetadata?.candidatesTokenCount || 0;
    
    const usage: UsageStats = {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        cost: calculateCost(inputTokens, outputTokens)
    };

    const jsonText = response.text || "{}";
    const resultJson = JSON.parse(jsonText);
    const scores = resultJson.scores;
    // Updated calculation to divide by 9 criteria
    const avg = (scores.accuracy + scores.fluency + scores.consistency + scores.terminology + scores.completeness + scores.formatPreservation + scores.spelling + scores.trademarkProtection + scores.redundancyRemoval) / 9;

    return { 
        result: { scores, averageScore: parseFloat(avg.toFixed(1)), reason: resultJson.reason, suggestions: resultJson.suggestions }, 
        usage 
    };
  } catch (error: any) {
    if (retries > 0) {
         await delay(10000);
         // Fixed: Ensure glossary is passed to retry call
         return evaluateTranslation(originalImage, translatedImage, targetLanguage, sourceLanguage, glossary, retries - 1);
    }
    return { result: { scores: { accuracy: 0, fluency: 0, consistency: 0, terminology: 0, completeness: 0, formatPreservation: 0, spelling: 0, trademarkProtection: 0, redundancyRemoval: 0 }, averageScore: 0, reason: "评估服务故障", suggestions: "" }, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 } };
  }
};
