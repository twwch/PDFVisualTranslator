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

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

export interface PageData {
  pageNumber: number;
  originalImage: string; // Base64 data URL
  translatedImage?: string; // Base64 data URL
  status: PageStatus;
  errorMessage?: string;
  usage?: TokenUsage;
}

export const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'zh', name: 'Chinese (Simplified)' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ru', name: 'Russian' },
  { code: 'hi', name: 'Hindi' },
  { code: 'ar', name: 'Arabic' }
];