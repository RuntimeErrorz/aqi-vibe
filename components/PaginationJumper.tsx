'use client';

import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export interface PaginationJumperProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  compact?: boolean;
  labelPrefix?: string;
}

export const PaginationJumper: React.FC<PaginationJumperProps> = ({
  currentPage,
  totalPages,
  onPageChange,
  compact = false,
  labelPrefix = '',
}) => {
  const [inputVal, setInputVal] = useState(String(currentPage));

  useEffect(() => {
    setInputVal(String(currentPage));
  }, [currentPage]);

  const handleCommit = () => {
    const val = parseInt(inputVal, 10);
    if (!isNaN(val) && val >= 1 && val <= totalPages) {
      onPageChange(val);
    } else {
      setInputVal(String(currentPage));
    }
  };

  const safeTotal = Math.max(1, totalPages);

  return (
    <div
      className={`inline-flex items-center space-x-1.5 text-xs select-none ${
        compact ? 'text-slate-500' : 'text-slate-600'
      }`}
      role="navigation"
      aria-label="分页导航"
    >
      <button
        type="button"
        onClick={() => onPageChange(Math.max(1, currentPage - 1))}
        disabled={currentPage <= 1}
        className={
          compact
            ? 'h-6 w-6 flex items-center justify-center p-0 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-slate-600 transition-colors shadow-2xs cursor-pointer shrink-0'
            : 'h-7 flex items-center space-x-1 px-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed font-medium text-slate-700 transition-colors shadow-2xs cursor-pointer shrink-0'
        }
        title="上一页"
        aria-label="上一页"
      >
        <ChevronLeft className="w-3.5 h-3.5" />
        {!compact && <span className="hidden sm:inline text-xs leading-none">上一页</span>}
      </button>

      <div className="inline-flex items-center space-x-1 px-0.5">
        <span className={`text-slate-400 leading-none flex items-center ${compact ? 'text-[11px]' : 'text-xs'}`}>
          {labelPrefix}第
        </span>
        <input
          type="number"
          min={1}
          max={safeTotal}
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleCommit();
          }}
          onBlur={handleCommit}
          aria-label="跳转页码"
          className={`${
            compact ? 'h-6 w-10' : 'h-7 w-12'
          } px-1 text-center text-xs leading-none bg-white border border-slate-200 rounded-lg font-bold text-slate-800 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500/20 shadow-2xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none tabular-nums`}
        />
        <span className={`text-slate-400 leading-none flex items-center ${compact ? 'text-[11px]' : 'text-xs'}`}>
          / {safeTotal} 页
        </span>
      </div>

      <button
        type="button"
        onClick={() => onPageChange(Math.min(safeTotal, currentPage + 1))}
        disabled={currentPage >= safeTotal}
        className={
          compact
            ? 'h-6 w-6 flex items-center justify-center p-0 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-slate-600 transition-colors shadow-2xs cursor-pointer shrink-0'
            : 'h-7 flex items-center space-x-1 px-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed font-medium text-slate-700 transition-colors shadow-2xs cursor-pointer shrink-0'
        }
        title="下一页"
        aria-label="下一页"
      >
        {!compact && <span className="hidden sm:inline text-xs leading-none">下一页</span>}
        <ChevronRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
