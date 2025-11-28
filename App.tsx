import React, { useState, useEffect, useCallback } from 'react';
import { Upload, FileText, Download, Play, AlertTriangle, Key, Columns } from 'lucide-react';
import { PageData, PageStatus, ProcessingStatus } from './types';
import { convertPdfToImages, generatePdfFromImages, generateComparisonPdf } from './services/pdfService';
import { translateImage } from './services/geminiService';
import PageCard from './components/PageCard';
import ProgressBar from './components/ProgressBar';
import LanguageSelector from './components/LanguageSelector';

const App: React.FC = () => {
  const [pages, setPages] = useState<PageData[]>([]);
  const [appStatus, setAppStatus] = useState<ProcessingStatus>(ProcessingStatus.IDLE);
  const [targetLanguage, setTargetLanguage] = useState<string>('');
  const [apiKeyReady, setApiKeyReady] = useState<boolean>(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // Check for API key on mount
  useEffect(() => {
    checkApiKey();
  }, []);

  const checkApiKey = async () => {
    // Priority 1: Check if environment variable is already set (Local Dev)
    if (process.env.API_KEY) {
      setApiKeyReady(true);
      return;
    }

    // Priority 2: Check AI Studio specific flow
    try {
      const aistudio = (window as any).aistudio;
      if (aistudio && await aistudio.hasSelectedApiKey()) {
        setApiKeyReady(true);
      }
    } catch (e) {
      console.error("Error checking API key status", e);
    }
  };

  const handleSelectKey = async () => {
    try {
      const aistudio = (window as any).aistudio;
      if (aistudio) {
        await aistudio.openSelectKey();
        setApiKeyReady(true);
      } else {
        setGlobalError("AI Studio environment not detected.");
      }
    } catch (e) {
      console.error("Failed to select key", e);
      // Reset logic per instructions if "Requested entity was not found"
      // But mainly just let them try again.
      setApiKeyReady(false);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.type !== 'application/pdf') {
      setGlobalError('Please upload a valid PDF file.');
      return;
    }

    setAppStatus(ProcessingStatus.CONVERTING_PDF);
    setPages([]);
    setGlobalError(null);

    try {
      const images = await convertPdfToImages(file);
      const newPages: PageData[] = images.map((img, index) => ({
        pageNumber: index + 1,
        originalImage: img,
        status: PageStatus.PENDING,
      }));
      setPages(newPages);
      setAppStatus(ProcessingStatus.IDLE);
    } catch (err) {
      console.error(err);
      setGlobalError('Failed to process PDF. Please try a different file.');
      setAppStatus(ProcessingStatus.ERROR);
    }
  };

  const startTranslation = useCallback(async () => {
    if (!targetLanguage) {
      setGlobalError("Please select a target language.");
      return;
    }
    if (!apiKeyReady) {
      setGlobalError("Please select an API Key first.");
      return;
    }

    setAppStatus(ProcessingStatus.TRANSLATING);
    setGlobalError(null);

    const pagesToTranslate = pages.filter(p => p.status !== PageStatus.DONE);
    
    // Process strictly sequentially to avoid hitting rate limits too hard or confusing the model context
    // and to allow easy progress tracking.
    for (const page of pagesToTranslate) {
        // Update status to translating
        setPages(prev => prev.map(p => 
            p.pageNumber === page.pageNumber ? { ...p, status: PageStatus.TRANSLATING } : p
        ));

        try {
            const translatedImg = await translateImage(page.originalImage, targetLanguage);
            
            setPages(prev => prev.map(p => 
                p.pageNumber === page.pageNumber ? { 
                    ...p, 
                    translatedImage: translatedImg, 
                    status: PageStatus.DONE 
                } : p
            ));
        } catch (error: any) {
            setPages(prev => prev.map(p => 
                p.pageNumber === page.pageNumber ? { 
                    ...p, 
                    status: PageStatus.ERROR, 
                    errorMessage: error.message || "Translation failed" 
                } : p
            ));
            // We continue to the next page even if one fails
        }
    }

    setAppStatus(ProcessingStatus.COMPLETED);
  }, [pages, targetLanguage, apiKeyReady]);

  const handleDownload = (type: 'translated' | 'comparison') => {
    try {
        const finishedPages = pages.filter(p => p.status === PageStatus.DONE && p.translatedImage);
        if (finishedPages.length === 0) {
            alert("No translated pages to download.");
            return;
        }
        
        let blob: Blob;
        let filename: string;

        if (type === 'comparison') {
             // Side-by-side comparison
             const comparisonData = finishedPages.map(p => ({
                 original: p.originalImage,
                 translated: p.translatedImage as string
             }));
             blob = generateComparisonPdf(comparisonData);
             filename = `translated_comparison_${targetLanguage}.pdf`;
        } else {
             // Translated only
             const images = finishedPages.map(p => p.translatedImage as string);
             blob = generatePdfFromImages(images);
             filename = `translated_${targetLanguage}.pdf`;
        }
        
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (e) {
        console.error(e);
        setGlobalError("Failed to generate PDF.");
    }
  };

  if (!apiKeyReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8 text-center">
            <div className="bg-indigo-100 p-4 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-6">
                <Key className="text-indigo-600" size={32} />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 mb-2">API Key Required</h1>
            <p className="text-slate-600 mb-6">
                To use the visual PDF translator (powered by Gemini 3 Pro), you need to select a paid API key from a Google Cloud Project.
            </p>
            <button 
                onClick={handleSelectKey}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
                Select API Key
            </button>
            <div className="mt-4 text-xs text-slate-400">
                <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noreferrer" className="underline hover:text-indigo-500">
                    Read about Gemini API Billing
                </a>
            </div>
        </div>
      </div>
    );
  }

  const completedCount = pages.filter(p => p.status === PageStatus.DONE).length;
  const isTranslating = appStatus === ProcessingStatus.TRANSLATING;
  const hasPages = pages.length > 0;

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="text-indigo-600" size={24} />
            <h1 className="text-xl font-bold text-slate-900">PDF Visual Translator</h1>
            <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">Gemini 3 Pro</span>
          </div>
          
          <div className="flex items-center gap-4">
            {hasPages && (
                <LanguageSelector 
                    selectedLanguage={targetLanguage} 
                    onSelect={setTargetLanguage}
                    disabled={isTranslating} 
                />
            )}
            
            {hasPages && !isTranslating && appStatus !== ProcessingStatus.COMPLETED && (
                 <button
                    onClick={startTranslation}
                    disabled={!targetLanguage}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-white transition-colors ${
                        !targetLanguage ? 'bg-slate-300 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'
                    }`}
                >
                    <Play size={18} />
                    Start Translation
                </button>
            )}

            {isTranslating && (
                <button disabled className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200">
                     <Play size={18} className="animate-spin" />
                     Translating...
                </button>
            )}

            {(appStatus === ProcessingStatus.COMPLETED || completedCount > 0) && (
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => handleDownload('translated')}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg font-medium bg-green-600 text-white hover:bg-green-700 transition-colors shadow-sm text-sm"
                        title="Download translated pages only"
                    >
                        <Download size={16} />
                        <span className="hidden sm:inline">Translated</span>
                        <span className="sm:hidden">Only</span>
                    </button>
                    <button
                        onClick={() => handleDownload('comparison')}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg font-medium bg-slate-700 text-white hover:bg-slate-800 transition-colors shadow-sm text-sm"
                        title="Download side-by-side comparison"
                    >
                        <Columns size={16} />
                        <span className="hidden sm:inline">Comparison</span>
                        <span className="sm:hidden">Compare</span>
                    </button>
                </div>
            )}
          </div>
        </div>
        
        {/* Progress Bar (Sticky just below header) */}
        {hasPages && (
            <div className="bg-slate-50 border-b border-slate-200 px-4 py-2">
                <div className="max-w-3xl mx-auto">
                    <ProgressBar current={completedCount} total={pages.length} label={isTranslating ? "Translating Pages..." : "Pages Ready"} />
                </div>
            </div>
        )}
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {globalError && (
            <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3 text-red-700">
                <AlertTriangle size={20} />
                <p>{globalError}</p>
                <button onClick={() => setGlobalError(null)} className="ml-auto text-sm underline">Dismiss</button>
            </div>
        )}

        {!hasPages && appStatus !== ProcessingStatus.CONVERTING_PDF && (
            <div className="mt-10 flex flex-col items-center justify-center p-12 border-2 border-dashed border-slate-300 rounded-2xl bg-white text-center hover:border-indigo-400 transition-colors cursor-pointer group relative">
                <input 
                    type="file" 
                    accept="application/pdf" 
                    onChange={handleFileUpload}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                    <Upload className="text-indigo-600" size={32} />
                </div>
                <h2 className="text-xl font-semibold text-slate-800 mb-2">Upload your PDF</h2>
                <p className="text-slate-500 max-w-sm">
                    Drag and drop or click to select a PDF file. We will convert it to images and translate it visually.
                </p>
                <div className="mt-6 text-xs text-slate-400">
                    Supports text and complex layouts. Powered by Gemini 3 Pro (Nano Banana Pro).
                </div>
            </div>
        )}

        {appStatus === ProcessingStatus.CONVERTING_PDF && (
            <div className="mt-20 flex flex-col items-center justify-center">
                 <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
                 <p className="text-lg font-medium text-slate-700">Converting PDF pages to images...</p>
            </div>
        )}

        {/* Page Grid */}
        {hasPages && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                {pages.map((page) => (
                    <div key={page.pageNumber} className="h-[600px]"> {/* Fixed height for uniformity */}
                        <PageCard page={page} />
                    </div>
                ))}
            </div>
        )}
      </main>
    </div>
  );
};

export default App;