"use client";

import { CATEGORY, label } from "@/lib/labels";
import { venueTitle } from "@/lib/format";
import type { VenuePin } from "@/lib/sites";
import type { RecentItem } from "@/lib/recent";

export function SearchInput({
  value,
  onChange,
  onFocus,
  onSubmit,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  onFocus?: () => void;
  /** 엔터(검색) */
  onSubmit?: () => void;
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
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) onSubmit?.();
        }}
        placeholder="예식장 검색"
        className="h-11 w-full rounded-xl border border-slate-200 bg-white pr-10 pl-10 text-[15px] shadow-sm outline-none placeholder:text-slate-400 focus:border-slate-400 [&::-webkit-search-cancel-button]:hidden"
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
  empty,
}: {
  items: VenuePin[];
  onSelect: (v: VenuePin) => void;
  emptyText?: string;
  /** 결과가 없을 때 보여줄 내용 (emptyText 대신) */
  empty?: React.ReactNode;
}) {
  if (!items.length && empty) return <>{empty}</>;
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

/** 검색창을 눌렀을 때: 최근 연 예식장(핀) · 최근 검색어(돋보기) */
export function RecentList({
  items,
  onPick,
  onRemove,
  onClear,
}: {
  items: RecentItem[];
  onPick: (item: RecentItem) => void;
  onRemove: (item: RecentItem) => void;
  onClear: () => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between px-4 pt-3 pb-1 text-xs text-slate-400">
        <span className="font-semibold">최근 검색</span>
        <button onMouseDown={(e) => e.preventDefault()} onClick={onClear} className="rounded px-1.5 py-0.5 hover:bg-slate-100 hover:text-slate-600">
          전체 삭제
        </button>
      </div>
      <ul>
        {items.map((it) => (
          <li key={it.type === "venue" ? "v" + it.id : "q" + it.q} className="flex items-center">
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(it)}
              className="flex min-w-0 flex-1 items-center gap-3 px-4 py-2.5 text-left text-[15px] hover:bg-slate-50 active:bg-slate-100"
            >
              {it.type === "venue" ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="shrink-0 text-slate-400" aria-hidden>
                  <path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0 text-slate-400" aria-hidden>
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
              )}
              <span className="truncate">{it.type === "venue" ? it.name : it.q}</span>
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onRemove(it)}
              aria-label="기록 지우기"
              className="mr-2 shrink-0 rounded-full p-2 text-slate-300 hover:bg-slate-100 hover:text-slate-500"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
