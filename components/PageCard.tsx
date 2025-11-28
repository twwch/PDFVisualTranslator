import React from 'react';
import { PageData, PageStatus } from '../types';
import { Loader2, AlertCircle, ArrowRight, Zap, Coins, RotateCcw } from 'lucide-react';

interface PageCardProps {
  page: PageData;
  onRetry?: () => void;
}

const PageCard: React.FC<PageCardProps> = ({ page, onRetry }) => {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-full">
      <div className="p-3 border-b border-slate-100 flex justify-between items-center bg-slate-50">
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

      <div className="relative flex-grow p-4 bg-slate-100">
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
      
      {/* Mobile-only stats footer (since it's hidden in header on small screens) */}
      {page.usage && (
          <div className="sm:hidden px-3 py-2 bg-slate-50 border-t border-slate-200 flex justify-between text-xs text-slate-500">
               <span>Tokens: {page.usage.totalTokens.toLocaleString()}</span>
               <span>Cost: ${page.usage.estimatedCost.toFixed(4)}</span>
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