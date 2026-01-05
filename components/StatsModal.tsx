
import React from 'react';
import { X, Clock, MessageSquareText, FileText, BarChart3, TrendingUp } from 'lucide-react';
import { PageData, UsageStats } from '../types';

interface StatsModalProps {
    isOpen: boolean;
    onClose: () => void;
    pages: PageData[];
}

export const StatsModal: React.FC<StatsModalProps> = ({ isOpen, onClose, pages }) => {
    if (!isOpen) return null;

    const allStats: (UsageStats & { pageNumber: number, runIndex: number })[] = [];
    pages.forEach(p => {
        if (p.usage) {
            if (p.usage.extraction) p.usage.extraction.forEach((u, i) => allStats.push({ ...u, pageNumber: p.pageNumber, runIndex: i + 1 }));
            if (p.usage.translation) p.usage.translation.forEach((u, i) => allStats.push({ ...u, pageNumber: p.pageNumber, runIndex: i + 1 }));
            if (p.usage.evaluation) p.usage.evaluation.forEach((u, i) => allStats.push({ ...u, pageNumber: p.pageNumber, runIndex: i + 1 }));
        }
    });

    // Sort by timestamp if available, else by page and then type
    allStats.sort((a, b) => {
        if (a.timestamp && b.timestamp) return b.timestamp - a.timestamp;
        if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber;
        return 0;
    });

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose}></div>
            <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="flex items-center justify-between p-6 border-b border-slate-100 bg-slate-50/50">
                    <div className="flex items-center gap-3">
                        <div className="bg-indigo-100 p-2 rounded-lg text-indigo-600">
                            <TrendingUp size={24} />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-slate-900">详细消耗统计</h2>
                            <p className="text-xs text-slate-500">记录每一次 AI 交互的 Token 消耗及价格明细</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400">
                        <X size={24} />
                    </button>
                </div>

                <div className="flex-1 overflow-auto p-6">
                    <div className="overflow-x-auto border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-slate-50 border-b border-slate-200">
                                    <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase">时间 / 页码</th>
                                    <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase">类型</th>
                                    <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase">模型</th>
                                    <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase">Input</th>
                                    <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase">Output</th>
                                    <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase">Total</th>
                                    <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase text-right">费用 ($)</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {allStats.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="px-4 py-12 text-center text-slate-400 italic">暂无交互统计数据</td>
                                    </tr>
                                ) : (
                                    allStats.map((u, idx) => (
                                        <React.Fragment key={idx}>
                                            <tr className="hover:bg-slate-50/50 transition-colors group">
                                                <td className="px-4 py-4">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-sm font-bold text-slate-700">P{u.pageNumber}</span>
                                                        <span className="text-[10px] font-black bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded uppercase font-mono">Run #{u.runIndex}</span>
                                                        {u.timestamp && (
                                                            <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-500 flex items-center gap-1 font-medium">
                                                                <Clock size={10} /> {new Date(u.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-4">
                                                    <span className={`text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wider ${u.type === 'extraction' ? 'bg-amber-100 text-amber-600' :
                                                        u.type === 'translation' ? 'bg-indigo-100 text-indigo-600' :
                                                            'bg-green-100 text-green-600'
                                                        }`}>
                                                        {u.type === 'extraction' ? '识别提取' : u.type === 'translation' ? '视觉重绘' : '质量审核'}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-4">
                                                    <span className="text-xs text-slate-600 font-mono" title={u.modelName}>{u.modelName.split('/').pop()}</span>
                                                </td>
                                                <td className="px-4 py-4 text-sm text-slate-600">{u.inputTokens.toLocaleString()}</td>
                                                <td className="px-4 py-4 text-sm text-slate-600">{u.outputTokens.toLocaleString()}</td>
                                                <td className="px-4 py-4 text-sm font-bold text-slate-700">{u.totalTokens.toLocaleString()}</td>
                                                <td className="px-4 py-4 text-sm font-bold text-indigo-600 text-right font-mono">${u.cost.toFixed(5)}</td>
                                            </tr>
                                            {u.prompt && (
                                                <tr className="bg-slate-50/30">
                                                    <td colSpan={7} className="px-4 py-3 text-[11px] border-t border-slate-50">
                                                        <div className="flex gap-2 text-slate-400">
                                                            <MessageSquareText size={14} className="shrink-0 mt-0.5" />
                                                            <div className="max-w-4xl line-clamp-2 italic" title={u.prompt}>
                                                                Prompt: {u.prompt}
                                                            </div>
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg shadow-sm transition-colors"
                    >
                        关闭详情
                    </button>
                </div>
            </div>
        </div>
    );
};
