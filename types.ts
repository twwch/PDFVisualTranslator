export enum ProcessingStatus {
  IDLE = 'IDLE',
  CONVERTING_PDF = 'CONVERTING_PDF',
  TRANSLATING = 'TRANSLATING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}

export enum PageStatus {
  PENDING = 'PENDING',
  TRANSLATING = 'TRANSLATING',
  DONE = 'DONE',
  ERROR = 'ERROR'
}

export enum TranslationMode {
  DIRECT = 'DIRECT', // Existing: One-shot image to image
  TWO_STEP = 'TWO_STEP' // New: Text Extraction -> Replacement
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

export interface EvaluationScores {
  accuracy: number;
  fluency: number;
  consistency: number;
  terminology: number;
  completeness: number;
  formatPreservation: number; // New dimension
}

export interface EvaluationResult {
  scores: EvaluationScores;
  averageScore: number;
  reason: string;
  suggestions: string;
}

export interface PageData {
  pageNumber: number;
  originalImage: string; // Base64 data URL
  translatedImage?: string; // Base64 data URL
  status: PageStatus;
  errorMessage?: string;
  usage?: TokenUsage;
  evaluation?: EvaluationResult;
  isEvaluating?: boolean;
  promptUsed?: string; // The specific prompt used for this translation
  extractedSegments?: string; // The raw text segments extracted in Step 1 of Two-Step mode
}

export const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English (English)' },
  { code: 'zh', name: 'Chinese (简体中文)' },
  { code: 'es', name: 'Spanish (Español)' },
  { code: 'fr', name: 'French (Français)' },
  { code: 'de', name: 'German (Deutsch)' },
  { code: 'ja', name: 'Japanese (日本語)' },
  { code: 'ko', name: 'Korean (한국어)' },
  { code: 'it', name: 'Italian (Italiano)' },
  { code: 'pt', name: 'Portuguese (Português)' },
  { code: 'ru', name: 'Russian (Русский)' },
  { code: 'hi', name: 'Hindi (हिन्दी)' },
  { code: 'ar', name: 'Arabic (العربية)' }
];

export const SOURCE_LANGUAGES = [
  { code: 'auto', name: 'Auto (Detect)' },
  ...SUPPORTED_LANGUAGES
];