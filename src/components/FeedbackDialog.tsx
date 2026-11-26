"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabase";

const MAX = 1000;

/** 회원 메뉴 → '수정 건의사항 보내기': 관리자에게만 보이는 글 */
export default function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!body.trim()) return setError("내용을 적어주세요.");
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.from("feedback").insert({ body: body.trim() });
    setBusy(false);
    if (e) return setError("보내지 못했어요. 잠시 후 다시 시도해주세요.");
    setDone(true);
  }

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose} role="dialog" aria-modal aria-label="수정 건의사항 보내기">
      <div
        className="w-full max-w-md rounded-t-3xl bg-white p-6 shadow-xl sm:rounded-3xl"
        style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold">수정 건의사항 보내기</h2>
            <p className="mt-1 text-sm text-slate-500">관리자만 볼 수 있어요.</p>
          </div>
          <button onClick={onClose} aria-label="닫기" className="-mt-1 -mr-2 rounded-full p-2 text-slate-400 hover:bg-slate-100">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        {done ? (
          <div className="mt-6 text-center">
            <p className="text-sm font-semibold text-emerald-600">건의사항을 보냈어요. 고맙습니다!</p>
            <button onClick={onClose} className="mt-4 h-11 rounded-xl bg-slate-900 px-6 text-sm font-semibold text-white">
              닫기
            </button>
          </div>
        ) : (
          <>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value.slice(0, MAX))}
              rows={5}
              autoFocus
              placeholder="예: ○○웨딩홀 3층 홀 이름이 바뀌었어요 / 이런 기능이 있으면 좋겠어요"
              className="mt-4 w-full resize-none rounded-xl border border-slate-200 p-3 text-[15px] outline-none focus:border-slate-500"
            />
            <div className="mt-1 text-right text-[11px] text-slate-400">
              {body.length}/{MAX}
            </div>
            {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
            <button onClick={send} disabled={busy} className="mt-3 h-12 w-full rounded-xl bg-slate-900 font-semibold text-white disabled:opacity-50">
              {busy ? "보내는 중…" : "보내기"}
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
