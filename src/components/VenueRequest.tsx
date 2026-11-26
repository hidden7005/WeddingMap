"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "./AuthProvider";

/** 검색 결과가 없을 때: 안내 + 식장 등록 요청 버튼 */
export default function VenueRequestPrompt({ query }: { query: string }) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  return (
    <div className="px-5 py-6 text-center">
      <p className="text-sm text-slate-500">
        ‘<span className="font-semibold text-slate-800">{query.trim()}</span>’ 검색 결과가 없어요
      </p>
      {sent ? (
        <p className="mt-3 text-sm font-semibold text-emerald-600">등록 요청을 보냈어요. 확인 후 지도에 추가할게요.</p>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="mt-3 inline-flex h-11 items-center gap-1.5 rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white active:scale-[0.98]"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
            <path d="M12 5v14M5 12h14" />
          </svg>
          식장 등록 요청
        </button>
      )}
      {open && (
        <RequestDialog
          initialName={query.trim()}
          onClose={() => setOpen(false)}
          onSent={() => {
            setOpen(false);
            setSent(true);
          }}
        />
      )}
    </div>
  );
}

function RequestDialog({ initialName, onClose, onSent }: { initialName: string; onClose: () => void; onSent: () => void }) {
  const auth = useAuth();
  const [name, setName] = useState(initialName);
  const [location, setLocation] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("예식장 이름을 적어주세요");
    setBusy(true);
    setError(null);
    const { error } = await supabase.from("venue_requests").insert({ name: name.trim(), location: location.trim() || null, memo: memo.trim() || null });
    setBusy(false);
    if (error) {
      if (error.code === "PGRST205" || error.code === "42P01") return setError("등록 요청 기능을 준비 중이에요. 잠시 후 다시 시도해주세요.");
      return setError("요청을 보내지 못했어요. 다시 시도해주세요.");
    }
    onSent();
  }

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose} role="dialog" aria-modal aria-label="식장 등록 요청">
      <div
        className="w-full max-w-md rounded-t-3xl bg-white p-6 shadow-xl sm:rounded-3xl"
        style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold">식장 등록 요청</h2>
            <p className="mt-1 text-sm text-slate-500">관리자가 확인한 뒤 지도에 추가해요.</p>
          </div>
          <button onClick={onClose} aria-label="닫기" className="-mt-1 -mr-2 rounded-full p-2 text-slate-400 hover:bg-slate-100">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {auth.status !== "member" ? (
          <div className="mt-6 text-center">
            <p className="text-sm text-slate-600">회원만 등록 요청을 할 수 있어요.</p>
            <Link href="/login" className="mt-4 inline-flex h-11 items-center rounded-xl bg-slate-900 px-6 text-sm font-semibold text-white">
              로그인
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-5 space-y-4">
            <Field label="예식장 이름" required>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} className={inputCls} placeholder="예: 더세인트" autoFocus />
            </Field>
            <Field label="주소 또는 위치" hint="도로명 주소, 지도 앱의 플러스코드(예: GV5Q+9F 서울) 등">
              <input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={300} className={inputCls} placeholder="예: 서울 구로구 경인로 662" />
            </Field>
            <Field label="메모">
              <textarea value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={500} rows={3} className={`${inputCls} h-auto py-2.5`} placeholder="지점명, 홀 이름 등 알고 있는 내용" />
            </Field>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button disabled={busy} className="h-12 w-full rounded-xl bg-slate-900 font-semibold text-white disabled:opacity-50">
              {busy ? "보내는 중…" : "요청 보내기"}
            </button>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}

const inputCls = "h-11 w-full rounded-xl border border-slate-200 px-3.5 text-[15px] outline-none focus:border-slate-500";

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-slate-700">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      <div className="mt-1.5">{children}</div>
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}
