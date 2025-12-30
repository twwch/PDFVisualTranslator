
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { PageData, PageStatus } from '../types';
import { Loader2, AlertCircle, ArrowRight, Zap, Coins, RotateCcw, Star, X, MessageSquareText, Copy, FileText, ClipboardCheck, Search, ShieldCheck } from 'lucide-react';

interface PageCardProps {
  page: PageData;
  onRetry?: () => void;
  onRetryEvaluation?: () => void;
}

const PageCard: React.FC<PageCardProps> = ({ page, onRetry, onRetryEvaluation }) => {
  const [showScoreModal, setShowScoreModal] = useState(false);
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [showSegmentsModal, setShowSegmentsModal] = useState(false);

  const getScoreColor = (score: number) => {
    if (score >= 8) return "bg-green-100 text-green-700 border-green-200";
    if (score >= 5) return "bg-yellow-100 text-yellow-700 border-yellow-200";
    return "bg-red-100 text-red-700 border-red-200";
  };

  const getScoreBarColor = (score: number) => {
    if (score >= 8) return "bg-green-500";
    if (score >= 5) return "bg-yellow-500";
    return "bg-red-500";
  }

  const handleCopyPrompt = () => {
      if (page.promptUsed) navigator.clipboard.writeText(page.promptUsed);
  };

  const handleCopySegments = () => {
      if (page.extractedSegments) navigator.clipboard.writeText(page.extractedSegments);
  }

  useEffect(() => {
    if (showScoreModal || showPromptModal || showSegmentsModal) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [showScoreModal, showPromptModal, showSegmentsModal]);

  const scoreLabels: Record<string, string> = {
    accuracy: "Accuracy (准确性)",
    fluency: "Fluency (流畅性)",
    consistency: "Consistency (一致性)",
    terminology: "Terminology (术语库对齐)",
    completeness: "Completeness (完整性)",
    formatPreservation: "Format (格式保持)",
    spelling: "Spelling (拼写/Hanzi检查)",
    trademarkProtection: "Trademarks (商标保护)",
    redundancyRemoval: "Redundancy (冗余消除)"
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-visible flex flex-col h-full relative z-0">
      <div className="p-3 border-b border-slate-100 flex justify-between items-center bg-slate-50 rounded-t-xl">
        <span className="font-semibold text-slate-700">Page {page.pageNumber}</span>
        <div className="flex items-center gap-3">
            {page.usage && (
                <div className="group relative hidden sm:flex items-center gap-2 text-xs text-slate-500 bg-white px-2 py-1 rounded border border-slate-200 cursor-help">
                    <span className="flex items-center gap-1"><Zap size={12} className="text-amber-500" />{page.usage.total.totalTokens?.toLocaleString()}</span>
                    <span className="w-px h-3 bg-slate-200"></span>
                    <span className="flex items-center gap-1"><Coins size={12} className="text-green-600" />${page.usage.total.cost.toFixed(4)}</span>
                </div>
            )}

            {page.extractedSegments && (
                <button onClick={() => setShowSegmentsModal(true)} className="p-1 hover:bg-slate-200 rounded text-slate-500 transition-colors" title="提取段落"><FileText size={16} /></button>
            )}

            {page.promptUsed && (
                <button onClick={() => setShowPromptModal(true)} className="p-1 hover:bg-slate-200 rounded text-slate-500 transition-colors" title="查看 Prompt"><MessageSquareText size={16} /></button>
            )}

            {page.status === PageStatus.DONE && page.isEvaluating && (
                <div className="flex items-center gap-2 px-3 py-1 rounded-full border border-indigo-200 bg-indigo-50 text-indigo-700 text-xs font-bold shadow-sm animate-pulse">
                    <ShieldCheck size={14} className="animate-bounce" />
                    <span>质检评估中...</span>
                </div>
            )}

            {page.evaluation && !page.isEvaluating && (
                <button onClick={() => setShowScoreModal(true)} className={`flex items-center gap-1 px-2 py-1 rounded border text-xs font-bold transition-transform hover:scale-105 ${getScoreColor(page.evaluation.averageScore)}`}>
                    <Star size={12} className="fill-current" /><span>{page.evaluation.averageScore}</span>
                </button>
            )}

            {(page.status === PageStatus.DONE || page.status === PageStatus.ERROR) && onRetry && (
                <button onClick={onRetry} className="p-1 hover:bg-slate-200 rounded text-slate-500 transition-colors" title="重试翻译 (可自定义 Prompt)"><RotateCcw size={16} /></button>
            )}

            <StatusBadge status={page.status} />
        </div>
      </div>

      <div className="relative flex-grow p-4 bg-slate-100 rounded-b-xl z-0">
        <div className="grid grid-cols-2 gap-4 h-full">
            <div className="flex flex-col h-full">
                <div className="mb-2 text-xs font-bold text-slate-500 uppercase tracking-wider text-center">原文</div>
                <div className="flex-grow bg-white rounded border border-slate-200 p-2 flex items-center justify-center overflow-hidden shadow-inner">
                    <img src={page.originalImage} alt="Original" className="max-w-full max-h-[600px] object-contain" />
                </div>
            </div>
            <div className="flex flex-col h-full relative">
                <div className="mb-2 text-xs font-bold text-slate-500 uppercase tracking-wider text-center">翻译后</div>
                <div className={`flex-grow bg-white rounded border border-slate-200 p-2 flex items-center justify-center overflow-hidden shadow-inner ${page.status === PageStatus.ERROR ? 'bg-red-50' : ''}`}>
                    {page.status === PageStatus.TRANSLATING ? <Loader2 className="animate-spin text-indigo-600" size={32} /> : page.translatedImage && <img src={page.translatedImage} alt="Translated" className="max-w-full max-h-[600px] object-contain" />}
                    {page.status === PageStatus.ERROR && <div className="text-center"><AlertCircle className="text-red-500 mx-auto mb-2" size={32} /><p className="text-red-500 text-xs font-medium">{page.errorMessage}</p></div>}
                </div>
            </div>
        </div>
      </div>

      {showSegmentsModal && page.extractedSegments && createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[85vh] overflow-hidden">
                   <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                        <h3 className="font-bold text-slate-800">提取段落与对照</h3>
                        <div className="flex gap-2">
                             <button onClick={handleCopySegments} className="text-slate-500 hover:text-indigo-600 p-1 transition-colors"><Copy size={18} /></button>
                             <button onClick={() => setShowSegmentsModal(false)} className="text-slate-400 hover:text-slate-600 p-1 transition-colors"><X size={20} /></button>
                        </div>
                   </div>
                   <div className="p-4 flex-grow bg-slate-50 overflow-hidden flex flex-col min-h-0">
                       <pre className="flex-grow w-full text-sm text-slate-700 font-mono overflow-y-auto whitespace-pre-wrap pr-2 scrollbar-thin scrollbar-thumb-slate-300">
                           {page.extractedSegments}
                       </pre>
                   </div>
                   <div className="px-5 py-3 border-t border-slate-100 flex justify-end bg-slate-50">
                       <button onClick={() => setShowSegmentsModal(false)} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors">关闭</button>
                   </div>
              </div>
          </div>, document.body
      )}

      {showPromptModal && page.promptUsed && createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[85vh] overflow-hidden">
                   <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                        <h3 className="font-bold text-slate-800">任务 Prompt</h3>
                        <div className="flex gap-2">
                             <button onClick={handleCopyPrompt} className="text-slate-500 hover:text-indigo-600 p-1 transition-colors"><Copy size={18} /></button>
                             <button onClick={() => setShowPromptModal(false)} className="text-slate-400 hover:text-slate-600 p-1 transition-colors"><X size={20} /></button>
                        </div>
                   </div>
                   <div className="p-4 flex-grow bg-slate-900 overflow-hidden flex flex-col min-h-0">
                       <pre className="flex-grow w-full text-xs sm:text-sm text-slate-300 font-mono overflow-y-auto whitespace-pre-wrap pr-2 scrollbar-thin scrollbar-thumb-slate-700">
                           {page.promptUsed}
                       </pre>
                   </div>
                   <div className="px-5 py-3 border-t border-slate-800 flex justify-end bg-slate-900">
                       <button onClick={() => setShowPromptModal(false)} className="px-4 py-2 bg-slate-700 text-white rounded-lg text-sm font-medium hover:bg-slate-600 transition-colors">关闭</button>
                   </div>
              </div>
          </div>, document.body
      )}

      {showScoreModal && page.evaluation && createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[85vh] overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-slate-800">评估报告</h3>
                        <span className={`px-2 py-0.5 rounded text-xs font-bold ${getScoreColor(page.evaluation.averageScore)}`}>{page.evaluation.averageScore}/10</span>
                      </div>
                      <button onClick={() => setShowScoreModal(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
                  </div>
                  <div className="p-6 overflow-y-auto flex-grow min-h-0 scrollbar-thin scrollbar-thumb-slate-200">
                      <div className="grid grid-cols-2 gap-x-6 gap-y-4 mb-6">
                          {Object.entries(page.evaluation.scores).map(([k, v]) => (
                              <div key={k}>
                                  <div className="flex justify-between text-xs mb-1 uppercase text-slate-500 font-bold">
                                      <span className="truncate pr-1">{scoreLabels[k] || k}</span>
                                      <span>{v}</span>
                                  </div>
                                  <div className="w-full bg-slate-100 rounded-full h-1.5">
                                      <div className={`h-1.5 rounded-full transition-all duration-500 ${getScoreBarColor(v as number)}`} style={{ width: `${(v as number) * 10}%` }}></div>
                                  </div>
                              </div>
                          ))}
                      </div>
                      <div className="space-y-4">
                          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                              <p className="text-xs font-bold text-slate-500 mb-2 uppercase tracking-wide">评估原因</p>
                              <p className="text-sm text-slate-700 leading-relaxed">{page.evaluation.reason}</p>
                          </div>
                          <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100">
                              <p className="text-xs font-bold text-indigo-500 mb-2 uppercase tracking-wide">优化建议</p>
                              <p className="text-sm text-indigo-800 italic leading-relaxed">"{page.evaluation.suggestions}"</p>
                          </div>
                      </div>
                  </div>
                  <div className="px-5 py-4 border-t border-slate-100 flex justify-end bg-slate-50">
                       <button onClick={() => setShowScoreModal(false)} className="px-6 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg text-sm font-semibold hover:bg-slate-50 shadow-sm transition-colors">关闭</button>
                   </div>
              </div>
          </div>, document.body
      )}
    </div>
  );
};

const StatusBadge: React.FC<{ status: PageStatus }> = ({ status }) => {
  switch (status) {
    case PageStatus.PENDING: return <span className="px-2 py-0.5 rounded text-xs bg-slate-200 text-slate-600 font-medium">待翻译</span>;
    case PageStatus.TRANSLATING: return <span className="px-2 py-0.5 rounded text-xs bg-indigo-100 text-indigo-700 font-bold animate-pulse">渲染中...</span>;
    case PageStatus.DONE: return <span className="px-2 py-0.5 rounded text-xs bg-green-100 text-green-700 font-bold">已完成</span>;
    case PageStatus.ERROR: return <span className="px-2 py-0.5 rounded text-xs bg-red-100 text-red-700 font-bold">失败</span>;
    default: return null;
  }
};

export default PageCard;
