import React, { useState, useEffect, useCallback } from 'react';
import { Upload, FileText, Download, Play, AlertTriangle, Key, Columns, ImageIcon, Trash2, Zap, Coins, X, FileSpreadsheet } from 'lucide-react';
import { PageData, PageStatus, ProcessingStatus } from './types';
import { convertPdfToImages, convertFileToBase64, generatePdfFromImages, generateComparisonPdf, getPdfPageCount } from './services/pdfService';
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
  
  // Import Configuration State
  const [importConfig, setImportConfig] = useState<{ file: File, totalPages: number } | null>(null);
  const [importRange, setImportRange] = useState<{ start: number, end: number }>({ start: 1, end: 1 });

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
      // Defensive check to ensure SDK is fully loaded
      if (aistudio && typeof aistudio.hasSelectedApiKey === 'function') {
        if (await aistudio.hasSelectedApiKey()) {
          setApiKeyReady(true);
        }
      }
    } catch (e) {
      console.error("Error checking API key status", e);
    }
  };

  const handleSelectKey = async () => {
    try {
      const aistudio = (window as any).aistudio;
      if (aistudio && typeof aistudio.openSelectKey === 'function') {
        await aistudio.openSelectKey();
        setApiKeyReady(true);
      } else {
        setGlobalError("AI Studio environment not detected or SDK not loaded.");
      }
    } catch (e) {
      console.error("Failed to select key", e);
      setApiKeyReady(false);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setGlobalError(null);
    setAppStatus(ProcessingStatus.CONVERTING_PDF); 

    try {
        const fileList = Array.from(files);
        // Prioritize PDF if multiple files are selected alongside a PDF (edge case)
        const pdfFile = fileList.find(f => f.type === 'application/pdf');

        if (pdfFile) {
             // Step 1: Get Page Count and Open Modal
             const totalPages = await getPdfPageCount(pdfFile);
             setImportConfig({ file: pdfFile, totalPages });
             setImportRange({ start: 1, end: totalPages });
             setAppStatus(ProcessingStatus.IDLE); // Pause generic spinner
        } else {
            // Assume Images
            const imageFiles = fileList.filter(f => f.type.startsWith('image/'));
            if (imageFiles.length === 0) {
                 setGlobalError('Please upload valid PDF or Image files.');
                 setAppStatus(ProcessingStatus.IDLE);
                 return;
            }
            
            // Process all images immediately
            const base64Images = await Promise.all(imageFiles.map(f => convertFileToBase64(f)));
            const newPages = base64Images.map((img, index) => ({
                pageNumber: pages.length + index + 1,
                originalImage: img,
                status: PageStatus.PENDING,
            }));

            setPages(newPages);
            setAppStatus(ProcessingStatus.IDLE);
        }

    } catch (err) {
      console.error(err);
      setGlobalError('Failed to process files. Please try again.');
      setAppStatus(ProcessingStatus.ERROR);
    }
    
    // Reset input
    event.target.value = '';
  };

  const handleConfirmImport = async () => {
      if (!importConfig) return;

      setAppStatus(ProcessingStatus.CONVERTING_PDF);
      try {
          const { file } = importConfig;
          const { start, end } = importRange;
          
          const images = await convertPdfToImages(file, start, end);
          
          const newPages: PageData[] = images.map((img, index) => ({
              pageNumber: start + index, // Correctly map logical page number
              originalImage: img,
              status: PageStatus.PENDING,
          }));

          setPages(newPages);
          setImportConfig(null);
          setAppStatus(ProcessingStatus.IDLE);
      } catch (e) {
          console.error(e);
          setGlobalError("Failed to import PDF pages.");
          setAppStatus(ProcessingStatus.ERROR);
          setImportConfig(null);
      }
  };

  const handleCancelImport = () => {
      setImportConfig(null);
      setAppStatus(ProcessingStatus.IDLE);
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

    // Process all pending pages (filter done is optional if we want to retry errors)
    const pagesToTranslate = pages.filter(p => p.status !== PageStatus.DONE);
    
    for (const page of pagesToTranslate) {
        setPages(prev => prev.map(p => 
            p.pageNumber === page.pageNumber ? { ...p, status: PageStatus.TRANSLATING } : p
        ));

        try {
            const result = await translateImage(page.originalImage, targetLanguage);
            
            setPages(prev => prev.map(p => 
                p.pageNumber === page.pageNumber ? { 
                    ...p, 
                    translatedImage: result.image, 
                    usage: result.usage,
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
        }
    }

    setAppStatus(ProcessingStatus.COMPLETED);
  }, [pages, targetLanguage, apiKeyReady]);

  const handleRetryPage = async (pageNumber: number) => {
    if (!targetLanguage) {
        setGlobalError("Please select a target language.");
        return;
    }
    if (!apiKeyReady) {
        setGlobalError("Please select an API Key first.");
        return;
    }

    // Set specific page to translating
    setPages(prev => prev.map(p => 
        p.pageNumber === pageNumber ? { ...p, status: PageStatus.TRANSLATING, errorMessage: undefined } : p
    ));

    // Find the page data
    const pageToRetry = pages.find(p => p.pageNumber === pageNumber);
    if (!pageToRetry) return;

    try {
        const result = await translateImage(pageToRetry.originalImage, targetLanguage);
        
        setPages(prev => prev.map(p => 
            p.pageNumber === pageNumber ? { 
                ...p, 
                translatedImage: result.image, 
                usage: result.usage,
                status: PageStatus.DONE 
            } : p
        ));
    } catch (error: any) {
        setPages(prev => prev.map(p => 
            p.pageNumber === pageNumber ? { 
                ...p, 
                status: PageStatus.ERROR, 
                errorMessage: error.message || "Retry failed" 
            } : p
        ));
    }
  };

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
             const comparisonData = finishedPages.map(p => ({
                 original: p.originalImage,
                 translated: p.translatedImage as string
             }));
             blob = generateComparisonPdf(comparisonData);
             filename = `translated_comparison_${targetLanguage}.pdf`;
        } else {
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

  const handleDownloadCostReport = () => {
    try {
        const finishedPages = pages.filter(p => p.status === PageStatus.DONE && p.usage);
        if (finishedPages.length === 0) {
            alert("No usage data available to download.");
            return;
        }

        const headers = ["Page Number", "Input Tokens", "Output Tokens", "Total Tokens", "Estimated Cost ($)"];
        const rows = finishedPages.map(p => [
            p.pageNumber,
            p.usage?.inputTokens || 0,
            p.usage?.outputTokens || 0,
            p.usage?.totalTokens || 0,
            (p.usage?.estimatedCost || 0).toFixed(6)
        ]);

        // Calculate Totals
        const totalInput = rows.reduce((acc, row) => acc + (row[1] as number), 0);
        const totalOutput = rows.reduce((acc, row) => acc + (row[2] as number), 0);
        const totalTokens = rows.reduce((acc, row) => acc + (row[3] as number), 0);
        const totalCost = rows.reduce((acc, row) => acc + parseFloat(row[4] as string), 0);

        rows.push(["TOTAL", totalInput, totalOutput, totalTokens, totalCost.toFixed(6)]);

        const csvContent = "data:text/csv;charset=utf-8," 
            + headers.join(",") + "\n" 
            + rows.map(e => e.join(",")).join("\n");

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `translation_cost_report.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

    } catch (e) {
        console.error(e);
        setGlobalError("Failed to generate Cost Report.");
    }
  };

  const handleReset = () => {
      if (window.confirm("Are you sure you want to clear all pages and start over?")) {
          setPages([]);
          setAppStatus(ProcessingStatus.IDLE);
          setTargetLanguage('');
          setGlobalError(null);
      }
  }

  // Calculate Aggregated Stats
  const totalTokens = pages.reduce((acc, p) => acc + (p.usage?.totalTokens || 0), 0);
  const totalCost = pages.reduce((acc, p) => acc + (p.usage?.estimatedCost || 0), 0);

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
    <div className="min-h-screen bg-slate-50 pb-20 relative">
      
      {/* Import Configuration Modal */}
      {importConfig && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
              <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 animate-in fade-in zoom-in duration-200">
                  <div className="flex justify-between items-start mb-4">
                      <div>
                          <h3 className="text-xl font-bold text-slate-900">Import PDF</h3>
                          <p className="text-sm text-slate-500">{importConfig.file.name}</p>
                      </div>
                      <button onClick={handleCancelImport} className="text-slate-400 hover:text-slate-600">
                          <X size={24} />
                      </button>
                  </div>
                  
                  <div className="bg-slate-50 rounded-lg p-4 mb-6 border border-slate-100">
                      <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium text-slate-700">Total Pages:</span>
                          <span className="text-sm font-bold text-indigo-600">{importConfig.totalPages}</span>
                      </div>
                      <div className="h-px bg-slate-200 my-3"></div>
                      <p className="text-xs text-slate-500 mb-3">Select range to import:</p>
                      <div className="flex items-center gap-3">
                          <div className="flex-1">
                              <label className="block text-xs font-medium text-slate-700 mb-1">From Page</label>
                              <input 
                                  type="number" 
                                  min={1} 
                                  max={importRange.end}
                                  value={importRange.start}
                                  onChange={(e) => {
                                      const val = parseInt(e.target.value);
                                      if (!isNaN(val)) setImportRange(prev => ({ ...prev, start: Math.max(1, Math.min(val, prev.end)) }));
                                  }}
                                  className="block w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border"
                              />
                          </div>
                          <span className="text-slate-400 pt-5">-</span>
                          <div className="flex-1">
                              <label className="block text-xs font-medium text-slate-700 mb-1">To Page</label>
                              <input 
                                  type="number" 
                                  min={importRange.start} 
                                  max={importConfig.totalPages}
                                  value={importRange.end}
                                  onChange={(e) => {
                                      const val = parseInt(e.target.value);
                                      if (!isNaN(val)) setImportRange(prev => ({ ...prev, end: Math.max(prev.start, Math.min(val, importConfig.totalPages)) }));
                                  }}
                                  className="block w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border"
                              />
                          </div>
                      </div>
                  </div>

                  <div className="flex gap-3">
                      <button 
                          onClick={handleCancelImport}
                          className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg font-medium hover:bg-slate-50 transition-colors"
                      >
                          Cancel
                      </button>
                      <button 
                          onClick={handleConfirmImport}
                          className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors shadow-sm"
                      >
                          Import Pages
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => hasPages ? handleReset() : null}>
            <FileText className="text-indigo-600" size={24} />
            <h1 className="text-xl font-bold text-slate-900 hidden sm:block">PDF Visual Translator</h1>
            <h1 className="text-xl font-bold text-slate-900 sm:hidden">Translator</h1>
            <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium whitespace-nowrap">Gemini 3 Pro</span>
          </div>
          
          <div className="flex items-center gap-2 sm:gap-4">
            {hasPages && (
                <div className="w-32 sm:w-auto">
                    <LanguageSelector 
                        selectedLanguage={targetLanguage} 
                        onSelect={setTargetLanguage}
                        disabled={isTranslating} 
                    />
                </div>
            )}
            
            {hasPages && !isTranslating && appStatus !== ProcessingStatus.COMPLETED && (
                 <button
                    onClick={startTranslation}
                    disabled={!targetLanguage}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-white transition-colors shadow-sm ${
                        !targetLanguage ? 'bg-slate-300 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'
                    }`}
                >
                    <Play size={18} />
                    <span className="hidden sm:inline">Start</span>
                </button>
            )}

            {isTranslating && (
                <button disabled className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200">
                     <Play size={18} className="animate-spin" />
                     <span className="hidden sm:inline">Translating...</span>
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
                        <span className="hidden lg:inline">Translated</span>
                    </button>
                    <button
                        onClick={() => handleDownload('comparison')}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg font-medium bg-slate-700 text-white hover:bg-slate-800 transition-colors shadow-sm text-sm"
                        title="Download side-by-side comparison"
                    >
                        <Columns size={16} />
                        <span className="hidden lg:inline">Compare</span>
                    </button>
                    <button
                        onClick={handleDownloadCostReport}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg font-medium bg-amber-600 text-white hover:bg-amber-700 transition-colors shadow-sm text-sm"
                        title="Download Cost Report (CSV)"
                    >
                        <FileSpreadsheet size={16} />
                        <span className="hidden lg:inline">Cost Report</span>
                    </button>
                </div>
            )}

            {hasPages && !isTranslating && (
                <button 
                    onClick={handleReset}
                    className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors"
                    title="Clear all"
                >
                    <Trash2 size={20} />
                </button>
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
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 mb-12">
        
        {globalError && (
            <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3 text-red-700">
                <AlertTriangle size={20} />
                <p>{globalError}</p>
                <button onClick={() => setGlobalError(null)} className="ml-auto text-sm underline">Dismiss</button>
            </div>
        )}

        {!hasPages && appStatus !== ProcessingStatus.CONVERTING_PDF && !importConfig && (
            <div className="mt-10 flex flex-col items-center justify-center p-12 border-2 border-dashed border-slate-300 rounded-2xl bg-white text-center hover:border-indigo-400 transition-colors cursor-pointer group relative shadow-sm">
                <input 
                    type="file" 
                    accept="application/pdf, image/png, image/jpeg, image/webp" 
                    multiple
                    onChange={handleFileUpload}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <div className="flex gap-4 mb-4">
                    <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform shadow-sm">
                        <FileText className="text-indigo-600" size={32} />
                    </div>
                    <div className="w-16 h-16 bg-purple-50 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform shadow-sm">
                        <ImageIcon className="text-purple-600" size={32} />
                    </div>
                </div>
                
                <h2 className="text-2xl font-bold text-slate-800 mb-2">Upload PDF or Images</h2>
                <p className="text-slate-500 max-w-md text-lg">
                    Drag and drop your files here. We support PDF documents and multiple image files (JPG, PNG).
                </p>
                <div className="mt-8 flex gap-3 text-sm text-slate-400 bg-slate-50 px-4 py-2 rounded-full">
                    <span>High Fidelity</span>
                    <span>•</span>
                    <span>Layout Preservation</span>
                    <span>•</span>
                    <span>Gemini 3 Pro</span>
                </div>
            </div>
        )}

        {appStatus === ProcessingStatus.CONVERTING_PDF && (
            <div className="mt-20 flex flex-col items-center justify-center">
                 <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
                 <p className="text-lg font-medium text-slate-700">Processing files...</p>
            </div>
        )}

        {/* Page List - Single Column for Side-by-Side View */}
        {hasPages && (
            <div className="flex flex-col gap-8">
                {pages.map((page) => (
                    <div key={page.pageNumber} className="w-full">
                        <PageCard page={page} onRetry={() => handleRetryPage(page.pageNumber)} />
                    </div>
                ))}
            </div>
        )}
      </main>

      {/* Sticky Bottom Stats Summary */}
      {hasPages && completedCount > 0 && (
          <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] p-4 z-30">
              <div className="max-w-6xl mx-auto flex items-center justify-between">
                  <div className="flex items-center gap-6">
                      <div className="flex items-center gap-2">
                          <div className="bg-amber-100 p-2 rounded-full text-amber-600">
                              <Zap size={20} />
                          </div>
                          <div>
                              <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Total Tokens</p>
                              <p className="text-lg font-bold text-slate-800 leading-none">{totalTokens.toLocaleString()}</p>
                          </div>
                      </div>
                      <div className="w-px h-8 bg-slate-200"></div>
                      <div className="flex items-center gap-2">
                          <div className="bg-green-100 p-2 rounded-full text-green-600">
                              <Coins size={20} />
                          </div>
                          <div>
                              <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Estimated Cost</p>
                              <p className="text-lg font-bold text-slate-800 leading-none">${totalCost.toFixed(4)}</p>
                          </div>
                      </div>
                  </div>
                  
                  {appStatus === ProcessingStatus.COMPLETED && (
                    <div className="text-xs text-slate-400 hidden sm:block">
                        Based on Pro tier estimation
                    </div>
                  )}
              </div>
          </div>
      )}
    </div>
  );
};

export default App;