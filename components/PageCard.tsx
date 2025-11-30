import React, { useState } from 'react';
import { PageData, PageStatus } from '../types';
import { Loader2, AlertCircle, ArrowRight, Zap, Coins, RotateCcw, Star, X, MessageSquareText, Copy, FileText } from 'lucide-react';

interface PageCardProps {
  page: PageData;
  onRetry?: () => void;
}

const PageCard: React.FC<PageCardProps> = ({ page, onRetry }) => {
  const [showScoreModal, setShowScoreModal] = useState(false);
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [showSegmentsModal, setShowSegmentsModal] = useState(false);

  // Helper to get color based on score
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
      if (page.promptUsed) {
          navigator.clipboard.writeText(page.promptUsed);
      }
  };

  const handleCopySegments = () => {
      if (page.extractedSegments) {
          navigator.clipboard.writeText(page.extractedSegments);
      }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-visible flex flex-col h-full relative z-0">
      <div className="p-3 border-b border-slate-100 flex justify-between items-center bg-slate-50 rounded-t-xl">
        <span className="font-semibold text-slate-700">Page {page.pageNumber}</span>
        <div className="flex items-center gap-3">
            {page.usage && (
                <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500 bg-white px-2 py-1 rounded border border-slate-200">
                    <span className="flex items-center gap-1" title="Total Tokens">
                        <Zap size={12} className="text-amber-500" />
                        {page.usage.totalTokens.toLocaleString()}
                    </span>
                    <span className="w-px h-3 bg-slate-200"></span>
                    <span className="flex items-center gap-1" title="Estimated Cost">
                        <Coins size={12} className="text-green-600" />
                        ${page.usage.estimatedCost.toFixed(4)}
                    </span>
                </div>
            )}

            {/* View Segments Button (Only for Two-Step Mode results) */}
            {page.extractedSegments && (
                <button
                    onClick={() => setShowSegmentsModal(true)}
                    className="p-1 hover:bg-slate-200 rounded text-slate-500 hover:text-indigo-600 transition-colors"
                    title="View Extracted Translation Segments"
                >
                    <FileText size={16} />
                </button>
            )}

            {/* Show Prompt Button */}
            {page.promptUsed && (
                <button
                    onClick={() => setShowPromptModal(true)}
                    className="p-1 hover:bg-slate-200 rounded text-slate-500 hover:text-indigo-600 transition-colors"
                    title="View Prompt"
                >
                    <MessageSquareText size={16} />
                </button>
            )}

            {/* Evaluation Score Badge */}
            {page.evaluation && (
                <button 
                    onClick={() => setShowScoreModal(true)}
                    className={`relative cursor-pointer flex items-center gap-1 px-2 py-1 rounded border text-xs font-bold transition-transform hover:scale-105 ${getScoreColor(page.evaluation.averageScore)}`}
                    title="Click to view evaluation details"
                >
                    <Star size={12} className="fill-current" />
                    <span>{page.evaluation.averageScore}</span>
                </button>
            )}

            {page.isEvaluating && (
                <div className="flex items-center gap-1 px-2 py-1 rounded bg-indigo-50 text-indigo-600 border border-indigo-100 text-xs">
                    <Loader2 size={10} className="animate-spin" />
                    <span>Scoring...</span>
                </div>
            )}
            
            {/* Retry Button */}
            {(page.status === PageStatus.DONE || page.status === PageStatus.ERROR) && onRetry && (
                <button 
                    onClick={onRetry}
                    className="p-1 hover:bg-slate-200 rounded text-slate-500 hover:text-indigo-600 transition-colors"
                    title="Retry Translation"
                >
                    <RotateCcw size={16} />
                </button>
            )}

            <StatusBadge status={page.status} />
        </div>
      </div>

      <div className="relative flex-grow p-4 bg-slate-100 rounded-b-xl z-0">
        <div className="grid grid-cols-2 gap-4 h-full">
            
            {/* Left Column: Original */}
            <div className="flex flex-col h-full">
                <div className="mb-2 text-xs font-bold text-slate-500 uppercase tracking-wider text-center">Original</div>
                <div className="flex-grow bg-white rounded border border-slate-200 p-2 flex items-center justify-center overflow-hidden relative group">
                    <img 
                        src={page.originalImage} 
                        alt="Original" 
                        className="max-w-full max-h-[600px] object-contain"
                    />
                </div>
            </div>

            {/* Middle Separator (Visual only, on large screens) */}
            <div className="absolute left-1/2 top-10 bottom-4 w-px bg-slate-200 hidden md:block transform -translate-x-1/2"></div>

            {/* Right Column: Translated */}
            <div className="flex flex-col h-full relative">
                <div className="mb-2 text-xs font-bold text-slate-500 uppercase tracking-wider text-center flex items-center justify-center gap-2">
                    Translated
                </div>
                
                <div className={`flex-grow bg-white rounded border border-slate-200 p-2 flex items-center justify-center overflow-hidden relative
                    ${page.status === PageStatus.PENDING ? 'bg-slate-50 border-dashed' : ''}
                    ${page.status === PageStatus.ERROR ? 'bg-red-50 border-red-200' : ''}
                `}>
                    
                    {/* State: Pending */}
                    {page.status === PageStatus.PENDING && (
                        <div className="text-center text-slate-400 flex flex-col items-center">
                            <ArrowRight className="mb-2 opacity-50" />
                            <span className="text-sm">Ready to translate</span>
                        </div>
                    )}

                    {/* State: Translating */}
                    {page.status === PageStatus.TRANSLATING && (
                        <div className="flex flex-col items-center justify-center text-indigo-600">
                             <Loader2 className="animate-spin mb-3" size={32} />
                             <span className="font-medium text-sm animate-pulse">Translating...</span>
                        </div>
                    )}

                    {/* State: Done */}
                    {page.status === PageStatus.DONE && page.translatedImage && (
                         <img 
                            src={page.translatedImage} 
                            alt="Translated" 
                            className="max-w-full max-h-[600px] object-contain"
                        />
                    )}

                    {/* State: Error */}
                    {page.status === PageStatus.ERROR && (
                        <div className="text-center p-4">
                            <AlertCircle className="text-red-500 mx-auto mb-2" size={32} />
                            <p className="text-red-700 font-medium mb-1">Failed</p>
                            <p className="text-red-500 text-xs">{page.errorMessage}</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
      </div>
      
      {/* Mobile-only stats footer */}
      {page.usage && (
          <div className="sm:hidden px-3 py-2 bg-slate-50 border-t border-slate-200 flex justify-between text-xs text-slate-500">
               <span>Tokens: {page.usage.totalTokens.toLocaleString()}</span>
               <span>Cost: ${page.usage.estimatedCost.toFixed(4)}</span>
          </div>
      )}

      {/* Segments Modal */}
      {showSegmentsModal && page.extractedSegments && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-200">
                   <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                        <div className="flex items-center gap-2">
                             <FileText size={18} className="text-slate-600"/>
                             <h3 className="font-bold text-slate-800">Extracted Text Segments (Step 1)</h3>
                        </div>
                        <div className="flex gap-2">
                             <button onClick={handleCopySegments} className="text-slate-500 hover:text-indigo-600 transition-colors p-1" title="Copy">
                                 <Copy size={18} />
                             </button>
                             <button onClick={() => setShowSegmentsModal(false)} className="text-slate-400 hover:text-slate-600 transition-colors p-1">
                                 <X size={20} />
                             </button>
                        </div>
                   </div>
                   <div className="p-0 overflow-hidden flex-grow bg-slate-50">
                       <pre className="w-full h-full p-4 text-xs sm:text-sm text-slate-700 font-mono overflow-auto whitespace-pre-wrap">
                           {page.extractedSegments}
                       </pre>
                   </div>
                   <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex justify-end">
                      <button 
                          onClick={() => setShowSegmentsModal(false)}
                          className="px-4 py-2 bg-white border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                      >
                          Close
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* Prompt Modal */}
      {showPromptModal && page.promptUsed && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-200">
                   <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                        <div className="flex items-center gap-2">
                             <MessageSquareText size={18} className="text-slate-600"/>
                             <h3 className="font-bold text-slate-800">Translation Prompt</h3>
                        </div>
                        <div className="flex gap-2">
                             <button onClick={handleCopyPrompt} className="text-slate-500 hover:text-indigo-600 transition-colors p-1" title="Copy">
                                 <Copy size={18} />
                             </button>
                             <button onClick={() => setShowPromptModal(false)} className="text-slate-400 hover:text-slate-600 transition-colors p-1">
                                 <X size={20} />
                             </button>
                        </div>
                   </div>
                   <div className="p-0 overflow-hidden flex-grow bg-slate-900">
                       <pre className="w-full h-full p-4 text-xs sm:text-sm text-slate-300 font-mono overflow-auto whitespace-pre-wrap">
                           {page.promptUsed}
                       </pre>
                   </div>
                   <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex justify-end">
                      <button 
                          onClick={() => setShowPromptModal(false)}
                          className="px-4 py-2 bg-white border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                      >
                          Close
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* Evaluation Modal Overlay */}
      {showScoreModal && page.evaluation && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg border border-slate-200 overflow-hidden animate-in zoom-in-95 duration-200">
                  <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-slate-800">评估报告 (Evaluation Report)</h3>
                        <span className={`px-2 py-0.5 rounded text-xs font-bold ${getScoreColor(page.evaluation.averageScore)}`}>
                            {page.evaluation.averageScore} / 10
                        </span>
                      </div>
                      <button onClick={() => setShowScoreModal(false)} className="text-slate-400 hover:text-slate-600 transition-colors">
                          <X size={20} />
                      </button>
                  </div>
                  
                  <div className="p-6 overflow-y-auto max-h-[70vh]">
                      {/* Score Bars */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 mb-6">
                          {[
                              { label: 'Accuracy (准确性)', val: page.evaluation.scores.accuracy },
                              { label: 'Fluency (流畅度)', val: page.evaluation.scores.fluency },
                              { label: 'Consistency (一致性)', val: page.evaluation.scores.consistency },
                              { label: 'Terminology (术语)', val: page.evaluation.scores.terminology },
                              { label: 'Completeness (完整性)', val: page.evaluation.scores.completeness },
                              { label: 'Format Preservation (格式)', val: page.evaluation.scores.formatPreservation }
                          ].map((item) => (
                              <div key={item.label} className="flex flex-col">
                                  <div className="flex justify-between text-xs mb-1">
                                      <span className="text-slate-500 font-medium">{item.label}</span>
                                      <span className="font-bold text-slate-700">{item.val}</span>
                                  </div>
                                  <div className="w-full bg-slate-100 rounded-full h-2">
                                      <div className={`h-2 rounded-full ${getScoreBarColor(item.val)}`} style={{ width: `${item.val * 10}%` }}></div>
                                  </div>
                              </div>
                          ))}
                      </div>

                      {/* Text Feedback */}
                      <div className="space-y-4">
                          <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                              <p className="text-xs font-bold text-slate-500 uppercase mb-1">评估原因 (Reason)</p>
                              <p className="text-sm text-slate-700 leading-relaxed">{page.evaluation.reason}</p>
                          </div>
                          
                          <div className="bg-indigo-50 p-3 rounded-lg border border-indigo-100">
                              <p className="text-xs font-bold text-indigo-500 uppercase mb-1">优化建议 (Suggestion)</p>
                              <p className="text-sm text-indigo-800 leading-relaxed">{page.evaluation.suggestions}</p>
                          </div>
                      </div>
                  </div>
                  
                  <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex justify-end">
                      <button 
                          onClick={() => setShowScoreModal(false)}
                          className="px-4 py-2 bg-white border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                      >
                          Close
                      </button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

const StatusBadge: React.FC<{ status: PageStatus }> = ({ status }) => {
  switch (status) {
    case PageStatus.PENDING:
      return <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-200 text-slate-600">Pending</span>;
    case PageStatus.TRANSLATING:
      return <span className="px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-700 animate-pulse">Processing</span>;
    case PageStatus.DONE:
      return <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">Done</span>;
    case PageStatus.ERROR:
      return <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">Error</span>;
    default:
      return null;
  }
};

export default PageCard;