import React, { useState } from 'react';
import { PageData, PageStatus } from '../types';
import { Loader2, AlertCircle, Eye, EyeOff } from 'lucide-react';

interface PageCardProps {
  page: PageData;
}

const PageCard: React.FC<PageCardProps> = ({ page }) => {
  const [showOriginal, setShowOriginal] = useState(false);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-full">
      <div className="p-3 border-b border-slate-100 flex justify-between items-center bg-slate-50">
        <span className="font-semibold text-slate-700">Page {page.pageNumber}</span>
        <div className="flex items-center space-x-2">
          {page.status === PageStatus.DONE && (
            <button
              onClick={() => setShowOriginal(!showOriginal)}
              className="text-xs flex items-center gap-1 text-indigo-600 hover:text-indigo-800 transition-colors font-medium"
            >
              {showOriginal ? (
                <><EyeOff size={14} /> Hide Original</>
              ) : (
                <><Eye size={14} /> Compare Original</>
              )}
            </button>
          )}
          <StatusBadge status={page.status} />
        </div>
      </div>

      <div className="relative flex-grow min-h-[400px] bg-slate-100 flex items-center justify-center p-4">
        {/* Comparison Logic */}
        <div className="relative w-full h-full flex items-center justify-center">
            
            {/* If translation is done, allow toggling or side-by-side depending on space, 
                but for simplicity we layer them with the toggle button above */}
            
            {page.status === PageStatus.DONE && page.translatedImage ? (
                <div className="relative w-full max-w-full">
                     <img
                        src={showOriginal ? page.originalImage : page.translatedImage}
                        alt={`Page ${page.pageNumber}`}
                        className="w-full h-auto rounded shadow-md object-contain max-h-[600px]"
                    />
                    {showOriginal && (
                        <div className="absolute top-2 left-2 bg-black/70 text-white text-xs px-2 py-1 rounded pointer-events-none">
                            Original
                        </div>
                    )}
                    {!showOriginal && (
                        <div className="absolute top-2 left-2 bg-indigo-600/90 text-white text-xs px-2 py-1 rounded pointer-events-none">
                            Translated
                        </div>
                    )}
                </div>
            ) : (
               // Still processing or error or just uploaded
               <div className="relative w-full max-w-full">
                   <img
                        src={page.originalImage}
                        alt={`Original Page ${page.pageNumber}`}
                        className={`w-full h-auto rounded shadow-md object-contain max-h-[600px] ${page.status === PageStatus.TRANSLATING ? 'opacity-50 blur-[2px]' : ''}`}
                    />
                    {page.status === PageStatus.TRANSLATING && (
                        <div className="absolute inset-0 flex items-center justify-center">
                             <div className="bg-white/90 p-4 rounded-full shadow-lg flex items-center gap-2">
                                <Loader2 className="animate-spin text-indigo-600" size={24} />
                                <span className="font-medium text-slate-700">Translating...</span>
                             </div>
                        </div>
                    )}
               </div>
            )}

            {page.status === PageStatus.ERROR && (
                <div className="absolute inset-0 bg-red-50/90 flex flex-col items-center justify-center p-4 text-center">
                    <AlertCircle className="text-red-500 mb-2" size={32} />
                    <p className="text-red-700 font-medium">Translation Failed</p>
                    <p className="text-red-500 text-sm">{page.errorMessage}</p>
                </div>
            )}
        </div>
      </div>
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