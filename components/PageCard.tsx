
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { PageData, PageStatus } from '../types';
import { Loader2, AlertCircle, Zap, Coins, RotateCcw, Star, X, MessageSquareText, Copy, FileText, Search, ShieldCheck } from 'lucide-react';

interface PageCardProps {
  page: PageData;
  onRetry?: () => void;
  onRetryEvaluation?: () => void;
}

const PageCard: React.FC<PageCardProps> = ({ page, onRetry, onRetryEvaluation }) => {
  const [showScoreModal, setShowScoreModal] = useState(false);
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [showSegmentsModal, setShowSegmentsModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  const getScoreColor = (score: number) => {
    if (score >= 8) return "bg-green-100 text-green-700 border-green-200";
    if (score >= 5) return "bg-yellow-100 text-yellow-700 border-yellow-200";
    return "bg-red-100 text-red-700 border-red-200";
  };

  const scoreLabels: Record<string, string> = {
    accuracy: "准确性 (Accuracy)",
    fluency: "流畅性 (Fluency)",
    consistency: "一致性 (Consistency)",
    terminology: "术语库 (Terminology)",
    completeness: "完整性 (Completeness)",
    formatPreservation: "格式保持 (Format)",
    spelling: "拼写检查 (Spelling)",
    trademarkProtection: "商标保护 (Trademarks)",
    redundancyRemoval: "冗余消除 (Redundancy)"
  };

  useEffect(() => {
    if (showScoreModal || showPromptModal || showSegmentsModal || showHistoryModal) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
  }, [showScoreModal, showPromptModal, showSegmentsModal, showHistoryModal]);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-full">
      <div className="p-3 border-b border-slate-100 flex justify-between items-center bg-slate-50">
        <span className="font-semibold text-slate-700">第 {page.pageNumber} 页</span>
        <div className="flex items-center gap-2">
          {page.usage && (
            <div
              className="hidden sm:flex items-center gap-3 text-[10px] text-slate-500 bg-white px-2 py-1 rounded border border-slate-200 cursor-help hover:border-indigo-300 transition-colors"
              onClick={() => setShowHistoryModal(true)}
              title="查看消耗历史明细"
            >
              <div className="flex flex-col">
                <span className="flex items-center gap-0.5 font-bold tracking-tight">
                  <Zap size={10} className="text-amber-500" />
                  {(page.usage?.total?.totalTokens || 0).toLocaleString()}
                </span>
                <span className="flex items-center gap-0.5 font-bold tracking-tight text-indigo-600">
                  <Coins size={10} className="text-green-600" />
                  ${(page.usage?.total?.cost || 0).toFixed(4)}
                </span>
              </div>
              <div className="w-px h-6 bg-slate-100"></div>
              <div className="flex flex-col opacity-60">
                <span>In: {(page.usage?.total?.inputTokens || 0).toLocaleString()}</span>
                <span>Out: {(page.usage?.total?.outputTokens || 0).toLocaleString()}</span>
              </div>
            </div>
          )}

          {/* 核心修复：质检状态显示 */}
          {page.status === PageStatus.DONE && page.isEvaluating && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded border border-indigo-200 bg-indigo-50 text-indigo-600 text-[10px] font-bold animate-pulse">
              <Search size={12} className="animate-bounce" />
              <span>质检评估中...</span>
            </div>
          )}

          {page.evaluation && !page.isEvaluating && (
            <button onClick={() => setShowScoreModal(true)} className={`flex items-center gap-1 px-2 py-1 rounded border text-[10px] font-bold transition-transform hover:scale-105 ${getScoreColor(page.evaluation.averageScore)}`}>
              <Star size={10} className="fill-current" /><span>{page.evaluation.averageScore}</span>
            </button>
          )}

          <div className="flex items-center gap-1">
            {page.extractedSegments && <button onClick={() => setShowSegmentsModal(true)} className="p-1.5 hover:bg-slate-200 rounded text-slate-500" title="提取对照"><FileText size={14} /></button>}
            {page.promptUsed && <button onClick={() => setShowPromptModal(true)} className="p-1.5 hover:bg-slate-200 rounded text-slate-500" title="查看 Prompt"><MessageSquareText size={14} /></button>}
            {(page.status === PageStatus.DONE || page.status === PageStatus.ERROR) && onRetry && <button onClick={onRetry} className="p-1.5 hover:bg-slate-200 rounded text-slate-500" title="重试"><RotateCcw size={14} /></button>}
          </div>

          <StatusBadge status={page.status} />
        </div>
      </div>

      <div className="p-4 bg-slate-50 flex-grow">
        <div className="grid grid-cols-2 gap-4 h-full">
          <div className="flex flex-col h-full min-h-[300px]">
            <div className="mb-1 text-[10px] font-bold text-slate-400 uppercase text-center">原文</div>
            <div className="flex-grow bg-white rounded border border-slate-200 p-1 flex items-center justify-center overflow-hidden">
              <img src={page.originalImage} alt="Original" className="max-w-full max-h-full object-contain" />
            </div>
          </div>
          <div className="flex flex-col h-full min-h-[300px]">
            <div className="mb-1 text-[10px] font-bold text-slate-400 uppercase text-center">翻译后</div>
            <div className={`flex-grow bg-white rounded border border-slate-200 p-1 flex items-center justify-center overflow-hidden ${page.status === PageStatus.ERROR ? 'bg-red-50' : ''}`}>
              {page.status === PageStatus.TRANSLATING ? <Loader2 className="animate-spin text-indigo-600" size={24} /> : page.translatedImage && <img src={page.translatedImage} alt="Translated" className="max-w-full max-h-full object-contain" />}
              {page.status === PageStatus.ERROR && <div className="text-center text-red-500 text-[10px] px-2"><AlertCircle className="mx-auto mb-1" size={16} />{page.errorMessage}</div>}
            </div>
          </div>
        </div>
      </div>

      {/* 评估弹窗 - 修复布局样式 */}
      {showScoreModal && page.evaluation && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl flex flex-col max-h-[90vh] overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl font-bold ${getScoreColor(page.evaluation.averageScore)}`}>
                  {page.evaluation.averageScore}
                </div>
                <div>
                  <h3 className="font-bold text-slate-800">质量评估报告</h3>
                  <p className="text-xs text-slate-500">Page {page.pageNumber} • AI 自动化质检</p>
                </div>
              </div>
              <button onClick={() => setShowScoreModal(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
            </div>

            <div className="p-6 overflow-y-auto flex-grow space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
                {Object.entries(page.evaluation.scores).map(([k, v]) => (
                  <div key={k} className="group">
                    <div className="flex justify-between text-[11px] mb-1.5">
                      <span className="text-slate-500 font-medium">{scoreLabels[k] || k}</span>
                      <span className="font-bold text-slate-800">{(v as number) || 0}/10</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                      <div className={`h-full transition-all duration-700 rounded-full ${Number(v || 0) >= 8 ? 'bg-green-500' : Number(v || 0) >= 5 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${Number(v || 0) * 10}%` }}></div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-4 pt-4 border-t border-slate-100">
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <h4 className="text-xs font-bold text-slate-400 uppercase mb-2 flex items-center gap-1.5">
                    <Search size={12} /> 评估详情 (Reasoning)
                  </h4>
                  <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{page.evaluation.reason}</p>
                </div>
                <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100">
                  <h4 className="text-xs font-bold text-indigo-400 uppercase mb-2 flex items-center gap-1.5">
                    <ShieldCheck size={12} /> 优化建议 (Suggestions)
                  </h4>
                  <p className="text-sm text-indigo-800 italic leading-relaxed">"{page.evaluation.suggestions}"</p>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-100 flex justify-end bg-slate-50">
              <button onClick={() => setShowScoreModal(false)} className="px-6 py-2 bg-white border border-slate-200 text-slate-600 rounded-lg text-sm font-semibold hover:bg-slate-50 transition-colors">关闭</button>
            </div>
          </div>
        </div>, document.body
      )}

      {/* 其它弹窗省略（提取段落、Prompt）... */}
      {showSegmentsModal && page.extractedSegments && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[80vh]">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 rounded-t-2xl">
              <h3 className="font-bold text-slate-800">提取对照数据</h3>
              <button onClick={() => setShowSegmentsModal(false)} className="text-slate-400"><X size={20} /></button>
            </div>
            <div className="p-6 overflow-y-auto flex-grow bg-slate-50 font-mono text-xs text-slate-600 whitespace-pre-wrap leading-relaxed">
              {page.extractedSegments}
            </div>
            <div className="px-6 py-4 border-t border-slate-100 flex justify-end bg-white rounded-b-2xl">
              <button onClick={() => { navigator.clipboard.writeText(page.extractedSegments || ''); alert('已复制') }} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium mr-2">复制</button>
              <button onClick={() => setShowSegmentsModal(false)} className="px-4 py-2 bg-slate-100 text-slate-600 rounded-lg text-sm font-medium">关闭</button>
            </div>
          </div>
        </div>, document.body
      )}

      {showPromptModal && page.promptUsed && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[80vh]">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 rounded-t-2xl">
              <h3 className="font-bold text-slate-800">使用的翻译 Prompt</h3>
              <button onClick={() => setShowPromptModal(false)} className="text-slate-400"><X size={20} /></button>
            </div>
            <div className="p-6 overflow-y-auto flex-grow bg-slate-50 font-mono text-[10px] text-slate-500 whitespace-pre-wrap leading-relaxed">
              {page.promptUsed}
            </div>
            <div className="px-6 py-4 border-t border-slate-100 flex justify-end bg-white rounded-b-2xl">
              <button onClick={() => { navigator.clipboard.writeText(page.promptUsed || ''); alert('已复制') }} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium mr-2">复制</button>
              <button onClick={() => setShowPromptModal(false)} className="px-4 py-2 bg-slate-100 text-slate-600 rounded-lg text-sm font-medium">关闭</button>
            </div>
          </div>
        </div>, document.body
      )}

      {showHistoryModal && page.usage && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl flex flex-col max-h-[85vh] overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <div>
                <h3 className="font-bold text-slate-800">第 {page.pageNumber} 页消耗历史记录</h3>
                <p className="text-xs text-slate-400 mt-0.5">记录当前页面的每一次 API 互动，含识别、重绘与质检</p>
              </div>
              <button onClick={() => setShowHistoryModal(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
            </div>
            <div className="p-6 overflow-y-auto flex-grow bg-white">
              <div className="space-y-6">
                {(['extraction', 'translation', 'evaluation'] as const).map(type => {
                  const stats = page.usage?.[type];
                  if (!stats || stats.length === 0) return null;
                  return (
                    <div key={type} className="space-y-3">
                      <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>
                        {type === 'extraction' ? '识别提取阶段' : type === 'translation' ? '视觉翻译阶段' : '质量审核阶段'}
                      </h4>
                      <div className="grid gap-4">
                        {stats.map((u, i) => (
                          <div key={i} className="bg-slate-50 rounded-xl border border-slate-100 overflow-hidden">
                            <div className="px-4 py-3 flex items-center justify-between border-b border-slate-100 bg-white/50">
                              <div className="flex items-center gap-4">
                                <span className="text-[10px] font-black bg-slate-200 text-slate-500 px-2 py-0.5 rounded uppercase font-mono">Run #{i + 1}</span>
                                <span className="text-[10px] text-slate-400 font-mono">{(u?.modelName || 'unknown').split('/').pop()}</span>
                                {u?.timestamp && <span className="text-[10px] text-slate-400 font-medium">@{new Date(u.timestamp).toLocaleTimeString()}</span>}
                              </div>
                              <div className="flex items-center gap-4 text-xs">
                                <span className="text-slate-500">In: <b>{(u?.inputTokens || 0).toLocaleString()}</b></span>
                                <span className="text-slate-500">Out: <b>{(u?.outputTokens || 0).toLocaleString()}</b></span>
                                <span className="text-indigo-600 font-black">${(u?.cost || 0).toFixed(5)}</span>
                              </div>
                            </div>
                            {u.prompt && (
                              <div className="p-4">
                                <div className="flex items-center gap-2 mb-2">
                                  <MessageSquareText size={12} className="text-slate-300" />
                                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">AI 指令 (Prompt)</span>
                                </div>
                                <div className="bg-white border border-slate-100 rounded-lg p-3 text-[10px] text-slate-500 whitespace-pre-wrap font-mono max-h-[200px] overflow-y-auto leading-relaxed shadow-inner">
                                  {u.prompt}
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 flex justify-end bg-slate-50">
              <button onClick={() => setShowHistoryModal(false)} className="px-6 py-2 bg-indigo-600 text-white rounded-xl text-sm font-bold shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-colors">关闭明细</button>
            </div>
          </div>
        </div>, document.body
      )}
    </div>
  );
};

const StatusBadge: React.FC<{ status: PageStatus }> = ({ status }) => {
  switch (status) {
    case PageStatus.PENDING: return <span className="px-2 py-0.5 rounded text-[10px] bg-slate-200 text-slate-500 font-medium">待处理</span>;
    case PageStatus.TRANSLATING: return <span className="px-2 py-0.5 rounded text-[10px] bg-indigo-100 text-indigo-600 font-bold animate-pulse">处理中...</span>;
    case PageStatus.DONE: return <span className="px-2 py-0.5 rounded text-[10px] bg-green-100 text-green-700 font-bold">已完成</span>;
    case PageStatus.ERROR: return <span className="px-2 py-0.5 rounded text-[10px] bg-red-100 text-red-700 font-bold">失败</span>;
    default: return null;
  }
};

export default PageCard;
