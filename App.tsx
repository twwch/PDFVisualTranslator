
import React, { useState, useEffect, useCallback } from 'react';
import { Upload, FileText, Download, Play, AlertTriangle, Key, Columns, ImageIcon, Trash2, Zap, Coins, X, FileSpreadsheet, RotateCcw, ClipboardList, Loader2, ArrowRightLeft, Settings2, ClipboardCheck, BookText, ChevronDown, ChevronUp, MessageSquarePlus, Sparkles, Save, FolderOpen } from 'lucide-react';
import { PageData, PageStatus, ProcessingStatus, SUPPORTED_LANGUAGES, SOURCE_LANGUAGES, TranslationMode, TranslationProject } from './types';
import { convertPdfToImages, convertFileToBase64, generatePdfFromImages, generateComparisonPdf, getPdfPageCount, generateEvaluationPdf } from './services/pdfService';
import { translateImage, evaluateTranslation } from './services/geminiService';
import PageCard from './components/PageCard';
import ProgressBar from './components/ProgressBar';
import LanguageSelector from './components/LanguageSelector';

const App: React.FC = () => {
  const [pages, setPages] = useState<PageData[]>([]);
  const [appStatus, setAppStatus] = useState<ProcessingStatus>(ProcessingStatus.IDLE);
  const [downloadingType, setDownloadingType] = useState<'translated' | 'comparison' | 'cost' | 'evaluation' | 'project' | null>(null);
  const [targetLanguage, setTargetLanguage] = useState<string>('');
  const [sourceLanguage, setSourceLanguage] = useState<string>('Auto (自动检测)');
  const [translationMode, setTranslationMode] = useState<TranslationMode>(TranslationMode.DIRECT);
  const [apiKeyReady, setApiKeyReady] = useState<boolean>(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [originalFileName, setOriginalFileName] = useState<string>('document');
  const [glossary, setGlossary] = useState<string>('');
  const [showGlossary, setShowGlossary] = useState<boolean>(false);
  
  // Refinement States
  const [refiningPage, setRefiningPage] = useState<PageData | null>(null);
  const [userPrompt, setUserPrompt] = useState<string>('');

  const [importConfig, setImportConfig] = useState<{ file: File, totalPages: number } | null>(null);
  const [importRange, setImportRange] = useState<{ start: number, end: number }>({ start: 1, end: 1 });

  useEffect(() => {
    checkApiKey();
  }, []);

  const checkApiKey = async () => {
    if (process.env.API_KEY) {
      setApiKeyReady(true);
      return;
    }
    try {
      const aistudio = (window as any).aistudio;
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
        setGlobalError("AI Studio environment not detected.");
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
    
    try {
        const fileList: File[] = Array.from(files);
        
        // Check for Project JSON first
        const projectFile = fileList.find(f => f.name.endsWith('.json'));
        if (projectFile) {
            setAppStatus(ProcessingStatus.CONVERTING_PDF);
            const content = await projectFile.text();
            try {
                const project: TranslationProject = JSON.parse(content);
                if (project.version && project.pages) {
                    setPages(project.pages);
                    setOriginalFileName(project.originalFileName || 'document');
                    setGlossary(project.glossary || '');
                    setTargetLanguage(project.targetLanguage || '');
                    setSourceLanguage(project.sourceLanguage || 'Auto (自动检测)');
                    setTranslationMode(project.translationMode || TranslationMode.DIRECT);
                    setAppStatus(ProcessingStatus.IDLE);
                    return;
                }
            } catch (e) {
                setGlobalError('无法解析项目文件，请确保文件格式正确。');
            }
            setAppStatus(ProcessingStatus.IDLE);
            return;
        }

        const pdfFile = fileList.find(f => f.type === 'application/pdf');
        if (pdfFile) {
             setAppStatus(ProcessingStatus.CONVERTING_PDF);
             const name = pdfFile.name.replace(/\.[^/.]+$/, "");
             setOriginalFileName(name);
             const totalPages = await getPdfPageCount(pdfFile);
             setImportConfig({ file: pdfFile, totalPages });
             setImportRange({ start: 1, end: totalPages });
             setAppStatus(ProcessingStatus.IDLE);
        } else {
            const imageFiles = fileList.filter(f => f.type.startsWith('image/'));
            if (imageFiles.length === 0) {
                 setGlobalError('请上传有效的 PDF、图片或项目 JSON 文件。');
                 return;
            }
            setAppStatus(ProcessingStatus.CONVERTING_PDF);
            const firstName = imageFiles[0].name.replace(/\.[^/.]+$/, "");
            setOriginalFileName(imageFiles.length > 1 ? `${firstName}_batch` : firstName);
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
      setGlobalError('处理文件失败。');
      setAppStatus(ProcessingStatus.ERROR);
    }
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
              pageNumber: start + index,
              originalImage: img,
              status: PageStatus.PENDING,
          }));
          setPages(newPages);
          setImportConfig(null);
          setAppStatus(ProcessingStatus.IDLE);
      } catch (e) {
          setGlobalError("导入 PDF 页面失败。");
          setAppStatus(ProcessingStatus.ERROR);
          setImportConfig(null);
      }
  };

  const startTranslation = useCallback(async () => {
    if (!targetLanguage) {
      setGlobalError("请选择目标语言。");
      return;
    }
    if (!apiKeyReady) {
      setGlobalError("请先选择 API Key。");
      return;
    }

    setAppStatus(ProcessingStatus.TRANSLATING);
    setGlobalError(null);

    const pagesToTranslate = pages.filter(p => p.status !== PageStatus.DONE);
    
    for (const page of pagesToTranslate) {
        setPages(prev => prev.map(p => 
            p.pageNumber === page.pageNumber ? { ...p, status: PageStatus.TRANSLATING } : p
        ));

        try {
            const result = await translateImage(page.originalImage, targetLanguage, sourceLanguage, translationMode, glossary);
            
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

            evaluateTranslation(page.originalImage, result.image, targetLanguage, sourceLanguage, glossary)
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
                p.pageNumber === page.pageNumber ? { ...p, status: PageStatus.ERROR, errorMessage: error.message || "翻译失败" } : p
            ));
        }
    }
    setAppStatus(ProcessingStatus.COMPLETED);
  }, [pages, targetLanguage, sourceLanguage, translationMode, apiKeyReady, glossary]);

  const handleRetryPageClick = (pageNumber: number) => {
    const page = pages.find(p => p.pageNumber === pageNumber);
    if (page) {
      setRefiningPage(page);
      setUserPrompt('');
    }
  };

  const handleConfirmRefinement = async () => {
    if (!refiningPage || !targetLanguage || !apiKeyReady) return;
    
    const pageNumber = refiningPage.pageNumber;
    const previousSuggestions = refiningPage.evaluation?.suggestions || '';
    const combinedFeedback = `Automated Suggestions: ${previousSuggestions}. User Input: ${userPrompt}`;

    setRefiningPage(null);
    setPages(prev => prev.map(p => p.pageNumber === pageNumber ? { ...p, status: PageStatus.TRANSLATING, errorMessage: undefined } : p));
    
    try {
        const result = await translateImage(refiningPage.originalImage, targetLanguage, sourceLanguage, translationMode, glossary, combinedFeedback);
        
        setPages(prev => prev.map(p => p.pageNumber === pageNumber ? { 
            ...p, 
            translatedImage: result.image, 
            usage: result.usage, 
            promptUsed: result.promptUsed, 
            extractedSegments: result.extractedSegments, 
            status: PageStatus.DONE, 
            isEvaluating: true 
        } : p));

        evaluateTranslation(refiningPage.originalImage, result.image, targetLanguage, sourceLanguage, glossary)
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
        setPages(prev => prev.map(p => p.pageNumber === pageNumber ? { ...p, status: PageStatus.ERROR, errorMessage: error.message || "优化失败" } : p));
    }
  };

  const saveProject = () => {
    try {
        setDownloadingType('project');
        const project: TranslationProject = {
            version: "1.0",
            timestamp: Date.now(),
            originalFileName,
            pages,
            glossary,
            targetLanguage,
            sourceLanguage,
            translationMode
        };
        const blob = new Blob([JSON.stringify(project)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${originalFileName}_Project.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (e) {
        setGlobalError("保存项目失败。");
    } finally {
        setDownloadingType(null);
    }
  };

  const handleDownload = async (type: 'translated' | 'comparison' | 'evaluation') => {
    try {
        const finishedPages = pages.filter(p => p.status === PageStatus.DONE && p.translatedImage);
        if (finishedPages.length === 0) return;
        
        setDownloadingType(type);
        setAppStatus(ProcessingStatus.CONVERTING_PDF); 
        
        let blob: Blob;
        let filename: string;
        
        if (type === 'comparison') {
             blob = await generateComparisonPdf(finishedPages.map(p => ({ original: p.originalImage, translated: p.translatedImage as string })));
             filename = `${originalFileName}_Comparison.pdf`;
        } else if (type === 'evaluation') {
             const evaluatedPages = pages.filter(p => p.evaluation);
             if (evaluatedPages.length === 0) throw new Error("尚未生成评估数据。");
             blob = await generateEvaluationPdf(evaluatedPages);
             filename = `${originalFileName}_Evaluation_Report.pdf`;
        } else {
             blob = await generatePdfFromImages(finishedPages.map(p => p.translatedImage as string));
             filename = `${originalFileName}_Translated.pdf`;
        }
        
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (e: any) {
        setGlobalError(e.message || "生成 PDF 失败。");
    } finally {
        setAppStatus(ProcessingStatus.IDLE);
        setDownloadingType(null);
    }
  };

  const handleReset = () => {
      if (window.confirm("确定要清空所有页面并重新开始吗？")) {
          setPages([]);
          setAppStatus(ProcessingStatus.IDLE);
          setTargetLanguage('');
          setGlobalError(null);
          setOriginalFileName('document');
      }
  }

  const totalTokens = pages.reduce((acc, p) => acc + (p.usage?.total.totalTokens || 0), 0);
  const totalCost = pages.reduce((acc, p) => acc + (p.usage?.total.cost || 0), 0);
  const completedCount = pages.filter(p => p.status === PageStatus.DONE).length;
  const evaluatedCount = pages.filter(p => p.evaluation).length;
  const isTranslating = appStatus === ProcessingStatus.TRANSLATING;
  const hasPages = pages.length > 0;

  if (!apiKeyReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8 text-center">
            <div className="bg-indigo-100 p-4 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-6">
                <Key className="text-indigo-600" size={32} />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 mb-2">需要 API Key</h1>
            <p className="text-slate-600 mb-6">为了使用 PDF 视觉翻译（由 Gemini 3 Pro 驱动），您需要从付费 Google Cloud 项目中选择一个 API key。</p>
            <button onClick={handleSelectKey} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2">选择 API Key</button>
            <div className="mt-4 text-xs text-slate-400">
                <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noreferrer" className="underline hover:text-indigo-500">了解 Gemini API 计费详情</a>
            </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-20 relative">
      {/* Refinement Modal */}
      {refiningPage && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
              <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 animate-in fade-in zoom-in duration-200">
                  <div className="flex justify-between items-start mb-4 border-b border-slate-100 pb-3">
                      <div className="flex items-center gap-2">
                        <Sparkles className="text-indigo-600" size={20} />
                        <h3 className="text-xl font-bold text-slate-900">重新优化翻译 (第 {refiningPage.pageNumber} 页)</h3>
                      </div>
                      <button onClick={() => setRefiningPage(null)} className="text-slate-400 hover:text-slate-600"><X size={24} /></button>
                  </div>
                  
                  {refiningPage.evaluation && (
                      <div className="mb-4 bg-indigo-50 p-3 rounded-lg border border-indigo-100">
                          <p className="text-xs font-bold text-indigo-600 uppercase mb-1 flex items-center gap-1">
                            <ClipboardCheck size={12}/> 系统优化建议
                          </p>
                          <p className="text-sm text-indigo-900 italic">"{refiningPage.evaluation.suggestions}"</p>
                      </div>
                  )}

                  <div className="mb-6">
                      <label className="block text-sm font-semibold text-slate-700 mb-2">补充您的修改要求 (Prompt)</label>
                      <textarea 
                          value={userPrompt}
                          onChange={(e) => setUserPrompt(e.target.value)}
                          placeholder="例如：'让语气更正式'，'修正图表中的专有名词'..."
                          className="w-full h-32 p-3 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-none bg-slate-50"
                      />
                  </div>

                  <div className="flex gap-3">
                      <button onClick={() => setRefiningPage(null)} className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg font-medium hover:bg-slate-50">取消</button>
                      <button onClick={handleConfirmRefinement} className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 flex items-center justify-center gap-2 shadow-md">
                          <MessageSquarePlus size={18} />确认并重试
                      </button>
                  </div>
              </div>
          </div>
      )}

      {importConfig && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
              <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 animate-in fade-in zoom-in duration-200">
                  <div className="flex justify-between items-start mb-4">
                      <div><h3 className="text-xl font-bold text-slate-900">导入 PDF</h3><p className="text-sm text-slate-500">{importConfig.file.name}</p></div>
                      <button onClick={() => setImportConfig(null)} className="text-slate-400 hover:text-slate-600"><X size={24} /></button>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-4 mb-6 border border-slate-100">
                      <div className="flex items-center justify-between mb-2"><span className="text-sm font-medium text-slate-700">总页数:</span><span className="text-sm font-bold text-indigo-600">{importConfig.totalPages}</span></div>
                      <div className="h-px bg-slate-200 my-3"></div>
                      <div className="flex items-center gap-3">
                          <div className="flex-1">
                              <label className="block text-xs font-medium text-slate-700 mb-1">开始页</label>
                              <input type="number" min={1} max={importRange.end} value={importRange.start} onChange={(e) => setImportRange(prev => ({ ...prev, start: Math.max(1, parseInt(e.target.value) || 1) }))} className="block w-full rounded-md border-slate-300 shadow-sm sm:text-sm px-3 py-2 border" />
                          </div>
                          <span className="text-slate-400 pt-5">-</span>
                          <div className="flex-1">
                              <label className="block text-xs font-medium text-slate-700 mb-1">结束页</label>
                              <input type="number" min={importRange.start} max={importConfig.totalPages} value={importRange.end} onChange={(e) => setImportRange(prev => ({ ...prev, end: Math.min(importConfig.totalPages, parseInt(e.target.value) || prev.start) }))} className="block w-full rounded-md border-slate-300 shadow-sm sm:text-sm px-3 py-2 border" />
                          </div>
                      </div>
                  </div>
                  <div className="flex gap-3">
                      <button onClick={() => setImportConfig(null)} className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg font-medium hover:bg-slate-50">取消</button>
                      <button onClick={handleConfirmImport} disabled={appStatus === ProcessingStatus.CONVERTING_PDF} className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 flex items-center justify-center gap-2">
                          {appStatus === ProcessingStatus.CONVERTING_PDF && <Loader2 size={16} className="animate-spin" />}确认导入
                      </button>
                  </div>
              </div>
          </div>
      )}

      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => hasPages && handleReset()}>
            <FileText className="text-indigo-600" size={24} />
            <h1 className="text-xl font-bold text-slate-900 hidden sm:block">PDF 视觉翻译器</h1>
            <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">Gemini 3 Pro</span>
          </div>
          
          <div className="flex items-center gap-2">
            {hasPages && (
                <>
                    <LanguageSelector label="源:" selectedLanguage={sourceLanguage} languages={SOURCE_LANGUAGES} onSelect={setSourceLanguage} disabled={isTranslating} />
                    <LanguageSelector label="目标:" selectedLanguage={targetLanguage} languages={SUPPORTED_LANGUAGES} onSelect={setTargetLanguage} disabled={isTranslating} />
                    <div className="hidden lg:flex items-center space-x-2 border-l border-slate-200 pl-4">
                        <select value={translationMode} onChange={(e) => setTranslationMode(e.target.value as TranslationMode)} disabled={isTranslating} className="block rounded-md border-slate-300 bg-white py-2 pl-2 pr-8 text-sm border">
                            <option value={TranslationMode.DIRECT}>直接翻译 (快)</option>
                            <option value={TranslationMode.TWO_STEP}>精密模式 (慢)</option>
                        </select>
                    </div>
                </>
            )}
            
            {hasPages && !isTranslating && appStatus !== ProcessingStatus.COMPLETED && (
                 <button onClick={startTranslation} disabled={!targetLanguage} className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-white transition-colors ${!targetLanguage ? 'bg-slate-300' : 'bg-indigo-600 hover:bg-indigo-700'}`}>
                    <Play size={18} /><span>开始</span>
                </button>
            )}

            {hasPages && (
                <button onClick={saveProject} title="保存当前项目进度" className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors border border-transparent hover:border-indigo-100">
                    {downloadingType === 'project' ? <Loader2 size={20} className="animate-spin" /> : <Save size={20} />}
                </button>
            )}

            {(appStatus === ProcessingStatus.COMPLETED || completedCount > 0) && (
                <div className="flex items-center gap-2">
                    <button onClick={() => handleDownload('translated')} className="flex items-center gap-2 px-3 py-2 rounded-lg font-medium bg-green-600 text-white text-sm">
                        {downloadingType === 'translated' ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}下载翻译版
                    </button>
                    <button onClick={() => handleDownload('comparison')} className="flex items-center gap-2 px-3 py-2 rounded-lg font-medium bg-slate-700 text-white text-sm">
                        {downloadingType === 'comparison' ? <Loader2 size={16} className="animate-spin" /> : <Columns size={16} />}双语对照
                    </button>
                    {evaluatedCount > 0 && (
                        <button onClick={() => handleDownload('evaluation')} className="flex items-center gap-2 px-3 py-2 rounded-lg font-medium bg-indigo-600 text-white text-sm">
                            {downloadingType === 'evaluation' ? <Loader2 size={16} className="animate-spin" /> : <ClipboardCheck size={16} />}评估报告
                        </button>
                    )}
                </div>
            )}
          </div>
        </div>
        {hasPages && (
            <div className="bg-slate-50 border-b border-slate-200 px-4 py-2">
                <div className="max-w-3xl mx-auto"><ProgressBar current={completedCount} total={pages.length} label={isTranslating ? "翻译中..." : "页面准备就绪"} /></div>
            </div>
        )}
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 mb-12">
        {globalError && (
            <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3 text-red-700">
                <AlertTriangle size={20} /><p>{globalError}</p>
                <button onClick={() => setGlobalError(null)} className="ml-auto text-sm underline">关闭</button>
            </div>
        )}

        {/* Glossary Input Section */}
        {hasPages && (
            <div className="mb-8 bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                <button 
                    onClick={() => setShowGlossary(!showGlossary)}
                    className="w-full px-5 py-3 flex items-center justify-between bg-slate-50 hover:bg-slate-100 transition-colors border-b border-slate-200"
                >
                    <div className="flex items-center gap-2 text-slate-700 font-semibold">
                        <BookText size={18} className="text-indigo-600" />
                        <span>术语库 & 翻译规则 (Markdown 表格)</span>
                    </div>
                    {showGlossary ? <ChevronUp size={20} className="text-slate-400" /> : <ChevronDown size={20} className="text-slate-400" />}
                </button>
                
                {showGlossary && (
                    <div className="p-5 animate-in slide-in-from-top-2 duration-200">
                        <div className="mb-3 flex items-center justify-between">
                            <p className="text-sm text-slate-500">请输入 Markdown 格式的术语表。Gemini 将严格按照该表进行翻译，并确保 Accuracy, Fluency, Consistency, Terminology, Completeness。</p>
                        </div>
                        <textarea
                            value={glossary}
                            onChange={(e) => setGlossary(e.target.value)}
                            placeholder="| 原文 | 译文 |\n| --- | --- |\n| AI | 人工智能 |\n| LLM | 大语言模型 |"
                            className="w-full h-32 p-3 text-sm font-mono border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-none bg-slate-50"
                        />
                        <div className="mt-3 flex gap-4 text-xs text-slate-400 italic">
                            <span className="flex items-center gap-1"><Zap size={12}/> 术语库强制匹配</span>
                            <span className="flex items-center gap-1"><Settings2 size={12}/> 全方位翻译引擎 (含图片内文字)</span>
                        </div>
                    </div>
                )}
            </div>
        )}

        {!hasPages && appStatus !== ProcessingStatus.CONVERTING_PDF && !importConfig && (
            <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="relative flex flex-col items-center justify-center p-12 border-2 border-dashed border-slate-300 rounded-2xl bg-white text-center hover:border-indigo-400 transition-colors cursor-pointer group shadow-sm">
                    <input type="file" accept="application/pdf, image/*" multiple onChange={handleFileUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                    <div className="flex gap-4 mb-4">
                        <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform"><FileText className="text-indigo-600" size={32} /></div>
                        <div className="w-16 h-16 bg-purple-50 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform"><ImageIcon className="text-purple-600" size={32} /></div>
                    </div>
                    <h2 className="text-xl font-bold text-slate-800 mb-2">上传 PDF 或 图片</h2>
                    <p className="text-slate-500 max-w-xs text-sm">开始新的翻译任务。支持 PDF 文档和各类图片文件。</p>
                </div>

                <div className="relative flex flex-col items-center justify-center p-12 border-2 border-dashed border-slate-300 rounded-2xl bg-slate-50 text-center hover:border-indigo-400 transition-colors cursor-pointer group shadow-sm">
                    <input type="file" accept=".json" onChange={handleFileUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                    <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform shadow-sm border border-slate-200"><FolderOpen className="text-indigo-500" size={32} /></div>
                    <h2 className="text-xl font-bold text-slate-800 mb-2 mt-4">恢复项目进度</h2>
                    <p className="text-slate-500 max-w-xs text-sm">导入之前保存的 .json 项目文件，继续翻译或查看结果。</p>
                </div>
            </div>
        )}

        {appStatus === ProcessingStatus.CONVERTING_PDF && !importConfig && (
            <div className="mt-20 flex flex-col items-center justify-center">
                 <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
                 <p className="text-lg font-medium text-slate-700">正在解析文件...</p>
            </div>
        )}

        {hasPages && (
            <div className="flex flex-col gap-8">
                {pages.map((page) => (
                    <div key={page.pageNumber} className="w-full">
                        <PageCard page={page} onRetry={() => handleRetryPageClick(page.pageNumber)} />
                    </div>
                ))}
            </div>
        )}
      </main>

      {hasPages && completedCount > 0 && (
          <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 shadow-lg p-4 z-30">
              <div className="max-w-6xl mx-auto flex items-center justify-between">
                  <div className="flex items-center gap-6">
                      <div className="flex items-center gap-2"><div className="bg-amber-100 p-2 rounded-full text-amber-600"><Zap size={20} /></div><div><p className="text-xs text-slate-500 font-medium">总消耗 Token</p><p className="text-lg font-bold text-slate-800">{totalTokens.toLocaleString()}</p></div></div>
                      <div className="w-px h-8 bg-slate-200"></div>
                      <div className="flex items-center gap-2"><div className="bg-green-100 p-2 rounded-full text-green-600"><Coins size={20} /></div><div><p className="text-xs text-slate-500 font-medium">预估费用</p><p className="text-lg font-bold text-slate-800">${totalCost.toFixed(4)}</p></div></div>
                  </div>
                  <button onClick={saveProject} className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600 font-medium transition-colors">
                      <Save size={18} />保存项目
                  </button>
              </div>
          </div>
      )}
    </div>
  );
};

export default App;
