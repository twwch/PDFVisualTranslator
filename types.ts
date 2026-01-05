
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
  TWO_STEP = 'TWO_STEP'
}

export interface UsageStats {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  modelName: string;
  type?: 'extraction' | 'translation' | 'evaluation';
  prompt?: string;
  timestamp?: number;
}

export interface TokenUsage {
  extraction?: UsageStats[];
  translation: UsageStats[];
  evaluation?: UsageStats[];
  total: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cost: number;
  };
}

export interface EvaluationScores {
  accuracy: number;
  fluency: number;
  consistency: number;
  terminology: number;
  completeness: number;
  formatPreservation: number;
  spelling: number;
  trademarkProtection: number;
  redundancyRemoval: number;
}

export interface EvaluationResult {
  scores: EvaluationScores;
  averageScore: number;
  reason: string;
  suggestions: string;
}

export interface PageData {
  pageNumber: number;
  originalImage: string;
  translatedImage?: string;
  status: PageStatus;
  errorMessage?: string;
  usage?: TokenUsage;
  evaluation?: EvaluationResult;
  isEvaluating?: boolean;
  promptUsed?: string;
  extractedSegments?: string;
}

// Full session state for saving/loading
export interface TranslationProject {
  version: string;
  timestamp: number;
  originalFileName: string;
  pages: PageData[];
  glossary: string;
  targetLanguage: string;
  sourceLanguage: string;
  translationMode: TranslationMode;
}

export const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English (英语)' },
  { code: 'zh', name: 'Chinese (简体中文)' },
  { code: 'zh-HK', name: 'Traditional Chinese (香港繁体)' },
  { code: 'es', name: 'Spanish (西班牙语)' },
  { code: 'fr', name: 'French (法语)' },
  { code: 'de', name: 'German (德语)' },
  { code: 'ja', name: 'Japanese (日语)' },
  { code: 'ko', name: 'Korean (韩语)' },
  { code: 'it', name: 'Italian (意大利语)' },
  { code: 'pt', name: 'Portuguese (葡萄牙语)' },
  { code: 'ru', name: 'Russian (俄语)' },
  { code: 'hi', name: 'Hindi (印地语)' },
  { code: 'ar', name: 'Arabic (阿拉伯语)' },
  { code: 'vi', name: 'Vietnamese (越南语)' }
];

export const SOURCE_LANGUAGES = [
  { code: 'auto', name: 'Auto (自动检测)' },
  ...SUPPORTED_LANGUAGES
];
