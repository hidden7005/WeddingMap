"use client";

import { CATEGORY, label } from "@/lib/labels";
import { venueTitle } from "@/lib/format";
import type { VenuePin } from "@/lib/sites";

export function SearchInput({
  value,
  onChange,
  onFocus,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  onFocus?: () => void;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <svg className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-slate-400" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        type="search"
        inputMode="search"
        enterKeyHint="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        placeholder="예식장명, 지역 검색 (예: 강남 웨딩)"
        className="h-12 w-full rounded-xl border border-slate-200 bg-white pr-10 pl-10 text-[15px] shadow-sm outline-none placeholder:text-slate-400 focus:border-slate-400 [&::-webkit-search-cancel-button]:hidden"
        aria-label="예식장 검색"
      />
      {value && (
        <button onClick={() => onChange("")} aria-label="검색어 지우기" className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full p-1.5 text-slate-400 hover:bg-slate-100">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

export function VenueList({
  items,
  onSelect,
  emptyText,
}: {
  items: VenuePin[];
  onSelect: (v: VenuePin) => void;
  emptyText?: string;
}) {
  if (!items.length) return <p className="p-5 text-center text-sm text-slate-400">{emptyText ?? "결과가 없어요"}</p>;
  return (
    <ul className="divide-y divide-slate-100">
      {items.map((v) => (
        <li key={v.id}>
          <button onClick={() => onSelect(v)} className="block w-full px-4 py-3 text-left hover:bg-slate-50 active:bg-slate-100">
            <p className="text-[15px] font-semibold">
              {venueTitle(v)}
              <span className="ml-1.5 text-xs font-normal text-slate-400">{label(CATEGORY, v.category)}</span>
            </p>
            <p className="mt-0.5 truncate text-sm text-slate-500">{v.road_address}</p>
          </button>
        </li>
      ))}
    </ul>
  );
}
