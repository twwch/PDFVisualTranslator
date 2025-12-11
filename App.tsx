import React, { useState, useEffect, useCallback } from 'react';
import { Upload, FileText, Download, Play, AlertTriangle, Key, Columns, ImageIcon, Trash2, Zap, Coins, X, FileSpreadsheet, RotateCcw, ClipboardList, Loader2, ArrowRightLeft, Settings2, ClipboardCheck } from 'lucide-react';
import { PageData, PageStatus, ProcessingStatus, SUPPORTED_LANGUAGES, SOURCE_LANGUAGES, TranslationMode } from './types';
import { convertPdfToImages, convertFileToBase64, generatePdfFromImages, generateComparisonPdf, getPdfPageCount, generateEvaluationPdf } from './services/pdfService';
import { translateImage, evaluateTranslation } from './services/geminiService';
import PageCard from './components/PageCard';
import ProgressBar from './components/ProgressBar';
import LanguageSelector from './components/LanguageSelector';

const App: React.FC = () => {
  const [pages, setPages] = useState<PageData[]>([]);
  const [appStatus, setAppStatus] = useState<ProcessingStatus>(ProcessingStatus.IDLE);
  const [downloadingType, setDownloadingType] = useState<'translated' | 'comparison' | 'cost' | 'evaluation' | null>(null);
  const [targetLanguage, setTargetLanguage] = useState<string>('');
  const [sourceLanguage, setSourceLanguage] = useState<string>('Auto (Detect)');
  const [translationMode, setTranslationMode] = useState<TranslationMode>(TranslationMode.DIRECT);
  const [apiKeyReady, setApiKeyReady] = useState<boolean>(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [originalFileName, setOriginalFileName] = useState<string>('document');
  
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
        const fileList: File[] = Array.from(files);
        // Prioritize PDF if multiple files are selected alongside a PDF (edge case)
        const pdfFile = fileList.find(f => f.type === 'application/pdf');

        if (pdfFile) {
             // Capture original filename without extension
             const name = pdfFile.name.replace(/\.[^/.]+$/, "");
             setOriginalFileName(name);

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
            
            // Set name based on first image
            const firstName = imageFiles[0].name.replace(/\.[^/.]+$/, "");
            setOriginalFileName(imageFiles.length > 1 ? `${firstName}_batch` : firstName);

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
            // Step 1 & 2: Translate (Direct or Two-Step)
            const result = await translateImage(page.originalImage, targetLanguage, sourceLanguage, translationMode);
            
            // Temporary State Update before Evaluation
            setPages(prev => prev.map(p => 
                p.pageNumber === page.pageNumber ? { 
                    ...p, 
                    translatedImage: result.image, 
                    usage: result.usage,
                    promptUsed: result.promptUsed, 
                    extractedSegments: result.extractedSegments, 
                    status: PageStatus.DONE,
                    isEvaluating: true 
                } : p
            ));

            // Step 3: Evaluation
            evaluateTranslation(page.originalImage, result.image, targetLanguage, sourceLanguage)
                .then(({ result: evalResult, usage: evalUsage }) => {
                    setPages(prev => prev.map(p => {
                        if (p.pageNumber !== page.pageNumber || !p.usage) return p;

                        // Merge evaluation usage into total usage
                        const updatedUsage = {
                            ...p.usage,
                            evaluation: evalUsage,
                            total: {
                                inputTokens: p.usage.total.inputTokens + evalUsage.inputTokens,
                                outputTokens: p.usage.total.outputTokens + evalUsage.outputTokens,
                                totalTokens: p.usage.total.totalTokens + evalUsage.totalTokens,
                                cost: p.usage.total.cost + evalUsage.cost
                            }
                        };

                        return {
                            ...p,
                            evaluation: evalResult,
                            usage: updatedUsage,
                            isEvaluating: false
                        };
                    }));
                })
                .catch(e => {
                    console.error("Evaluation error", e);
                    setPages(prev => prev.map(p => 
                        p.pageNumber === page.pageNumber ? { ...p, isEvaluating: false } : p
                    ));
                });

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
  }, [pages, targetLanguage, sourceLanguage, translationMode, apiKeyReady]);

  const handleRetryFailed = async () => {
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

    // Filter only failed pages
    const failedPages = pages.filter(p => p.status === PageStatus.ERROR);
    
    for (const page of failedPages) {
        
        // Retrieve suggestions from previous attempt if available
        const previousSuggestions = page.evaluation?.suggestions;

        setPages(prev => prev.map(p => 
            p.pageNumber === page.pageNumber ? { ...p, status: PageStatus.TRANSLATING, errorMessage: undefined } : p
        ));

        try {
            const result = await translateImage(page.originalImage, targetLanguage, sourceLanguage, translationMode, previousSuggestions);
            
            setPages(prev => prev.map(p => 
                p.pageNumber === page.pageNumber ? { 
                    ...p, 
                    translatedImage: result.image, 
                    usage: result.usage,
                    promptUsed: result.promptUsed, 
                    extractedSegments: result.extractedSegments, 
                    status: PageStatus.DONE,
                    isEvaluating: true
                } : p
            ));

            evaluateTranslation(page.originalImage, result.image, targetLanguage, sourceLanguage)
                .then(({ result: evalResult, usage: evalUsage }) => {
                    setPages(prev => prev.map(p => {
                        if (p.pageNumber !== page.pageNumber || !p.usage) return p;
                        const updatedUsage = {
                            ...p.usage,
                            evaluation: evalUsage,
                            total: {
                                inputTokens: p.usage.total.inputTokens + evalUsage.inputTokens,
                                outputTokens: p.usage.total.outputTokens + evalUsage.outputTokens,
                                totalTokens: p.usage.total.totalTokens + evalUsage.totalTokens,
                                cost: p.usage.total.cost + evalUsage.cost
                            }
                        };
                        return { ...p, evaluation: evalResult, usage: updatedUsage, isEvaluating: false };
                    }));
                });

        } catch (error: any) {
            setPages(prev => prev.map(p => 
                p.pageNumber === page.pageNumber ? { 
                    ...p, 
                    status: PageStatus.ERROR, 
                    errorMessage: error.message || "Retry failed" 
                } : p
            ));
        }
    }

    setAppStatus(ProcessingStatus.COMPLETED);
  };

  const handleRetryPage = async (pageNumber: number) => {
    if (!targetLanguage) {
        setGlobalError("Please select a target language.");
        return;
    }
    if (!apiKeyReady) {
        setGlobalError("Please select an API Key first.");
        return;
    }

    // Find the page data to get previous suggestions
    const pageToRetry = pages.find(p => p.pageNumber === pageNumber);
    if (!pageToRetry) return;
    
    const previousSuggestions = pageToRetry.evaluation?.suggestions;

    setPages(prev => prev.map(p => 
        p.pageNumber === pageNumber ? { ...p, status: PageStatus.TRANSLATING, errorMessage: undefined } : p
    ));

    try {
        const result = await translateImage(pageToRetry.originalImage, targetLanguage, sourceLanguage, translationMode, previousSuggestions);
        
        setPages(prev => prev.map(p => 
            p.pageNumber === pageNumber ? { 
                ...p, 
                translatedImage: result.image, 
                usage: result.usage,
                promptUsed: result.promptUsed,
                extractedSegments: result.extractedSegments,
                status: PageStatus.DONE,
                isEvaluating: true
            } : p
        ));

        evaluateTranslation(pageToRetry.originalImage, result.image, targetLanguage, sourceLanguage)
            .then(({ result: evalResult, usage: evalUsage }) => {
                setPages(prev => prev.map(p => {
                    if (p.pageNumber !== pageNumber || !p.usage) return p;
                    const updatedUsage = {
                        ...p.usage,
                        evaluation: evalUsage,
                        total: {
                            inputTokens: p.usage.total.inputTokens + evalUsage.inputTokens,
                            outputTokens: p.usage.total.outputTokens + evalUsage.outputTokens,
                            totalTokens: p.usage.total.totalTokens + evalUsage.totalTokens,
                            cost: p.usage.total.cost + evalUsage.cost
                        }
                    };
                    return { ...p, evaluation: evalResult, usage: updatedUsage, isEvaluating: false };
                }));
            });

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

  // Re-run evaluation for a specific page
  const handleRetryEvaluation = async (pageNumber: number) => {
      if (!apiKeyReady) {
          setGlobalError("Please select an API Key first.");
          return;
      }
      
      const page = pages.find(p => p.pageNumber === pageNumber);
      if (!page || !page.translatedImage) return;

      setPages(prev => prev.map(p => 
          p.pageNumber === pageNumber ? { ...p, isEvaluating: true } : p
      ));

      try {
          const { result: evalResult, usage: evalUsage } = await evaluateTranslation(page.originalImage, page.translatedImage, targetLanguage, sourceLanguage);
          
          setPages(prev => prev.map(p => {
              if (p.pageNumber !== pageNumber) return p;
              
              // If we already have usage, merge this new evaluation cost into it
              // Note: This adds to the total, effectively charging for the re-eval
              let updatedUsage = p.usage;
              if (p.usage) {
                  updatedUsage = {
                      ...p.usage,
                      evaluation: evalUsage, // Replace last eval usage detail
                      total: {
                          inputTokens: p.usage.total.inputTokens + evalUsage.inputTokens,
                          outputTokens: p.usage.total.outputTokens + evalUsage.outputTokens,
                          totalTokens: p.usage.total.totalTokens + evalUsage.totalTokens,
                          cost: p.usage.total.cost + evalUsage.cost
                      }
                  };
              }

              return { 
                  ...p, 
                  evaluation: evalResult,
                  usage: updatedUsage,
                  isEvaluating: false
              };
          }));
      } catch (e) {
          console.error("Manual evaluation retry failed", e);
          setPages(prev => prev.map(p => 
              p.pageNumber === pageNumber ? { ...p, isEvaluating: false } : p
          ));
      }
  };

  const handleRetryFailedEvaluations = async () => {
       if (!apiKeyReady) {
          setGlobalError("Please select an API Key first.");
          return;
      }

      const failedEvalPages = pages.filter(p => 
          p.status === PageStatus.DONE && 
          p.translatedImage && 
          (!p.evaluation || p.evaluation.averageScore === 0)
      );

      if (failedEvalPages.length === 0) return;

      setPages(prev => prev.map(p => 
          failedEvalPages.some(fp => fp.pageNumber === p.pageNumber) ? { ...p, isEvaluating: true } : p
      ));

      for (const page of failedEvalPages) {
          if (!page.translatedImage) continue;
          
          try {
              const { result: evalResult, usage: evalUsage } = await evaluateTranslation(page.originalImage, page.translatedImage, targetLanguage, sourceLanguage);
               setPages(prev => prev.map(p => {
                  if (p.pageNumber !== page.pageNumber) return p;
                  let updatedUsage = p.usage;
                  if (p.usage) {
                      updatedUsage = {
                          ...p.usage,
                          evaluation: evalUsage,
                          total: {
                              inputTokens: p.usage.total.inputTokens + evalUsage.inputTokens,
                              outputTokens: p.usage.total.outputTokens + evalUsage.outputTokens,
                              totalTokens: p.usage.total.totalTokens + evalUsage.totalTokens,
                              cost: p.usage.total.cost + evalUsage.cost
                          }
                      };
                  }
                  return { ...p, evaluation: evalResult, usage: updatedUsage, isEvaluating: false };
              }));
          } catch (e) {
              console.error(`Batch evaluation retry failed for page ${page.pageNumber}`, e);
               setPages(prev => prev.map(p => 
                  p.pageNumber === page.pageNumber ? { ...p, isEvaluating: false } : p
              ));
          }
      }
  };

  const generateFilename = (category: string, extension: string) => {
    const now = new Date();
    const timestamp = now.getFullYear().toString() +
      (now.getMonth() + 1).toString().padStart(2, '0') +
      now.getDate().toString().padStart(2, '0') + '_' +
      now.getHours().toString().padStart(2, '0') +
      now.getMinutes().toString().padStart(2, '0');
    const safeOriginalName = originalFileName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5-_]/g, '_');
    return `${safeOriginalName}_${timestamp}_${category}.${extension}`;
  };

  const handleDownload = async (type: 'translated' | 'comparison') => {
    try {
        const finishedPages = pages.filter(p => p.status === PageStatus.DONE && p.translatedImage);
        if (finishedPages.length === 0) {
            alert("No translated pages to download.");
            return;
        }
        
        setDownloadingType(type);
        let blob: Blob;
        let filename: string;

        setAppStatus(ProcessingStatus.CONVERTING_PDF); 

        if (type === 'comparison') {
             const comparisonData = finishedPages.map(p => ({
                 original: p.originalImage,
                 translated: p.translatedImage as string
             }));
             blob = await generateComparisonPdf(comparisonData);
             filename = generateFilename('Comparison_Report', 'pdf');
        } else {
             const images = finishedPages.map(p => p.translatedImage as string);
             blob = await generatePdfFromImages(images);
             filename = generateFilename('Translated', 'pdf');
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
    } finally {
        setAppStatus(ProcessingStatus.COMPLETED);
        setDownloadingType(null);
    }
  };

  const handleDownloadCostReport = () => {
    try {
        const finishedPages = pages.filter(p => p.status === PageStatus.DONE && p.usage);
        if (finishedPages.length === 0) {
            alert("No usage data available to download.");
            return;
        }

        setDownloadingType('cost');
        
        // Expanded Headers
        const headers = [
            "Page Number", 
            "EXT Input", "EXT Output", "EXT Cost", 
            "TRANS Input", "TRANS Output", "TRANS Cost",
            "EVAL Input", "EVAL Output", "EVAL Cost",
            "TOTAL Cost ($)"
        ];

        const rows = finishedPages.map(p => {
            const u = p.usage!;
            return [
                p.pageNumber,
                u.extraction?.inputTokens || 0,
                u.extraction?.outputTokens || 0,
                (u.extraction?.cost || 0).toFixed(6),
                u.translation.inputTokens || 0,
                u.translation.outputTokens || 0,
                u.translation.cost.toFixed(6),
                u.evaluation?.inputTokens || 0,
                u.evaluation?.outputTokens || 0,
                (u.evaluation?.cost || 0).toFixed(6),
                u.total.cost.toFixed(6)
            ];
        });

        // Calculate Totals
        const sums = Array(headers.length - 1).fill(0);
        rows.forEach(row => {
            for (let i = 1; i < row.length; i++) {
                sums[i-1] += parseFloat(row[i] as string);
            }
        });

        rows.push(["TOTAL", ...sums.map(s => s.toFixed(6))]);

        const csvContent = "data:text/csv;charset=utf-8," 
            + headers.join(",") + "\n" 
            + rows.map(e => e.join(",")).join("\n");

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", generateFilename('Cost_Report', 'csv'));
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

    } catch (e) {
        console.error(e);
        setGlobalError("Failed to generate Cost Report.");
    } finally {
        setDownloadingType(null);
    }
  };

  const handleDownloadEvaluationReport = async () => {
    try {
        const evaluatedPages = pages.filter(p => p.status === PageStatus.DONE && p.evaluation);
        if (evaluatedPages.length === 0) {
            alert("No evaluation data available yet.");
            return;
        }

        setDownloadingType('evaluation');
        setAppStatus(ProcessingStatus.CONVERTING_PDF); 

        const blob = await generateEvaluationPdf(evaluatedPages);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = generateFilename('Evaluation_Report', 'pdf');
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (e) {
        console.error(e);
        setGlobalError("Failed to generate Evaluation Report PDF.");
    } finally {
        setAppStatus(ProcessingStatus.COMPLETED);
        setDownloadingType(null);
    }
  };

  const handleReset = () => {
      if (window.confirm("Are you sure you want to clear all pages and start over?")) {
          setPages([]);
          setAppStatus(ProcessingStatus.IDLE);
          setTargetLanguage('');
          setGlobalError(null);
          setOriginalFileName('document');
      }
  }

  // Calculate Aggregated Stats
  const totalTokens = pages.reduce((acc, p) => acc + (p.usage?.total.totalTokens || 0), 0);
  const totalCost = pages.reduce((acc, p) => acc + (p.usage?.total.cost || 0), 0);
  const failedCount = pages.filter(p => p.status === PageStatus.ERROR).length;
  const completedCount = pages.filter(p => p.status === PageStatus.DONE).length;
  const failedEvalCount = pages.filter(p => p.status === PageStatus.DONE && (!p.evaluation || p.evaluation.averageScore === 0)).length;
  const isTranslating = appStatus === ProcessingStatus.TRANSLATING;
  const hasPages = pages.length > 0;

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
                      <button onClick={handleCancelImport} disabled={appStatus === ProcessingStatus.CONVERTING_PDF} className="text-slate-400 hover:text-slate-600 disabled:opacity-50">
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
                                  disabled={appStatus === ProcessingStatus.CONVERTING_PDF}
                                  onChange={(e) => {
                                      const val = parseInt(e.target.value);
                                      if (!isNaN(val)) setImportRange(prev => ({ ...prev, start: Math.max(1, Math.min(val, prev.end)) }));
                                  }}
                                  className="block w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border disabled:bg-slate-200"
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
                                  disabled={appStatus === ProcessingStatus.CONVERTING_PDF}
                                  onChange={(e) => {
                                      const val = parseInt(e.target.value);
                                      if (!isNaN(val)) setImportRange(prev => ({ ...prev, end: Math.max(prev.start, Math.min(val, importConfig.totalPages)) }));
                                  }}
                                  className="block w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border disabled:bg-slate-200"
                              />
                          </div>
                      </div>
                  </div>

                  <div className="flex gap-3">
                      <button 
                          onClick={handleCancelImport}
                          disabled={appStatus === ProcessingStatus.CONVERTING_PDF}
                          className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg font-medium hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                          Cancel
                      </button>
                      <button 
                          onClick={handleConfirmImport}
                          disabled={appStatus === ProcessingStatus.CONVERTING_PDF}
                          className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                      >
                          {appStatus === ProcessingStatus.CONVERTING_PDF && <Loader2 size={16} className="animate-spin" />}
                          {appStatus === ProcessingStatus.CONVERTING_PDF ? "Importing..." : "Import Pages"}
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
                <>
                    <div className="w-auto">
                        <LanguageSelector 
                            label="From:"
                            selectedLanguage={sourceLanguage} 
                            languages={SOURCE_LANGUAGES}
                            onSelect={setSourceLanguage}
                            disabled={isTranslating} 
                        />
                    </div>
                    <div className="text-slate-400 hidden lg:block">
                        <ArrowRightLeft size={16} />
                    </div>
                    <div className="w-auto">
                        <LanguageSelector 
                            label="To:"
                            selectedLanguage={targetLanguage} 
                            languages={SUPPORTED_LANGUAGES}
                            onSelect={setTargetLanguage}
                            disabled={isTranslating} 
                        />
                    </div>
                    {/* Translation Engine Selector */}
                    <div className="hidden lg:flex items-center space-x-2 border-l border-slate-200 pl-4 ml-2">
                        <label className="text-sm font-medium text-slate-700">Engine:</label>
                        <select
                            value={translationMode}
                            onChange={(e) => setTranslationMode(e.target.value as TranslationMode)}
                            disabled={isTranslating}
                            className="block rounded-md border-slate-300 bg-white py-2 pl-2 pr-8 text-sm focus:border-indigo-500 focus:ring-indigo-500 shadow-sm border max-w-[150px]"
                        >
                            <option value={TranslationMode.DIRECT}>Direct (Fast)</option>
                            <option value={TranslationMode.TWO_STEP}>Precision (Slow)</option>
                        </select>
                    </div>
                </>
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
            
            {/* Retry Failed Button */}
            {hasPages && !isTranslating && failedCount > 0 && (
                 <button
                    onClick={handleRetryFailed}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium bg-red-600 text-white hover:bg-red-700 transition-colors shadow-sm"
                    title="Retry all failed pages"
                >
                    <RotateCcw size={18} />
                    <span className="hidden sm:inline">Retry Failed ({failedCount})</span>
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
                    {/* Retry Failed Evaluations Button */}
                    {failedEvalCount > 0 && !isTranslating && (
                        <button
                            onClick={handleRetryFailedEvaluations}
                            className="flex items-center gap-2 px-3 py-2 rounded-lg font-medium bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors shadow-sm text-sm border border-amber-200"
                            title="Retry failed evaluations"
                        >
                            <ClipboardCheck size={16} />
                            <span className="hidden lg:inline">Retry Eval ({failedEvalCount})</span>
                        </button>
                    )}

                    <button
                        onClick={() => handleDownload('translated')}
                        disabled={!!downloadingType}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg font-medium bg-green-600 text-white hover:bg-green-700 transition-colors shadow-sm text-sm disabled:opacity-70 disabled:cursor-not-allowed"
                        title="Download translated pages only"
                    >
                        {downloadingType === 'translated' ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                        <span className="hidden lg:inline">Translated</span>
                    </button>
                    <button
                        onClick={() => handleDownload('comparison')}
                        disabled={!!downloadingType}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg font-medium bg-slate-700 text-white hover:bg-slate-800 transition-colors shadow-sm text-sm disabled:opacity-70 disabled:cursor-not-allowed"
                        title="Download side-by-side comparison"
                    >
                        {downloadingType === 'comparison' ? <Loader2 size={16} className="animate-spin" /> : <Columns size={16} />}
                        <span className="hidden lg:inline">Compare</span>
                    </button>
                    <button
                        onClick={handleDownloadCostReport}
                        disabled={!!downloadingType}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg font-medium bg-amber-600 text-white hover:bg-amber-700 transition-colors shadow-sm text-sm disabled:opacity-70 disabled:cursor-not-allowed"
                        title="Download Cost Report (CSV)"
                    >
                        {downloadingType === 'cost' ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />}
                        <span className="hidden lg:inline">Cost Report</span>
                    </button>
                    <button
                        onClick={handleDownloadEvaluationReport}
                        disabled={!!downloadingType}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg font-medium bg-purple-600 text-white hover:bg-purple-700 transition-colors shadow-sm text-sm disabled:opacity-70 disabled:cursor-not-allowed"
                        title="Download Evaluation Report (PDF)"
                    >
                        {downloadingType === 'evaluation' ? <Loader2 size={16} className="animate-spin" /> : <ClipboardList size={16} />}
                        <span className="hidden lg:inline">QA Report</span>
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

        {appStatus === ProcessingStatus.CONVERTING_PDF && !importConfig && !downloadingType && (
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
                        <PageCard 
                            page={page} 
                            onRetry={() => handleRetryPage(page.pageNumber)} 
                            onRetryEvaluation={() => handleRetryEvaluation(page.pageNumber)}
                        />
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
                              <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Total Cost (Est.)</p>
                              <p className="text-lg font-bold text-slate-800 leading-none">${totalCost.toFixed(4)}</p>
                          </div>
                      </div>
                  </div>
                  
                  {appStatus === ProcessingStatus.COMPLETED && (
                    <div className="text-xs text-slate-400 hidden sm:block">
                        Based on Pro Tier: $3.50/$10.50
                    </div>
                  )}
              </div>
          </div>
      )}
    </div>
  );
};

export default App;