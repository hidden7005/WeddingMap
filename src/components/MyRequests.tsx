"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabase";
import { formatDate } from "@/lib/format";
import { useAuth } from "./AuthProvider";

/** 내 요청(등록·삭제 요청 + 수정 건의) 한 줄 */
type Item = {
  id: string;
  kind: "add" | "delete" | "feedback";
  title: string;
  status: string;
  reply: string | null;
  created_at: string;
  handled_at: string | null;
};

const SEEN_KEY = "wm_requests_seen_v1";
const readSeen = () => {
  try {
    return localStorage.getItem(SEEN_KEY) ?? "";
  } catch {
    return "";
  }
};
const writeSeen = (v: string) => {
  try {
    localStorage.setItem(SEEN_KEY, v);
  } catch {
    /* 저장 불가: 무시 */
  }
};

async function fetchMine(uid: string): Promise<Item[]> {
  const [r, f] = await Promise.all([
    supabase.from("venue_requests").select("id,kind,name,status,reply,created_at,handled_at").eq("requested_by", uid).order("created_at", { ascending: false }).limit(100),
    supabase.from("feedback").select("id,body,status,reply,created_at,handled_at").eq("user_id", uid).order("created_at", { ascending: false }).limit(100),
  ]);
  const items: Item[] = [
    ...(r.data ?? []).map((x) => ({ id: x.id, kind: (x.kind === "delete" ? "delete" : "add") as Item["kind"], title: x.name, status: x.status, reply: x.reply, created_at: x.created_at, handled_at: x.handled_at })),
    ...(f.data ?? []).map((x) => ({ id: x.id, kind: "feedback" as const, title: x.body, status: x.status, reply: x.reply, created_at: x.created_at, handled_at: x.handled_at })),
  ];
  return items.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** 마지막으로 '내 요청'을 연 뒤에 처리 결과가 나온 개수 (메뉴 빨간 점) */
export function useNewResults(refreshKey?: unknown) {
  const { session, status } = useAuth();
  const uid = session?.user.id;
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (status !== "member" || !uid) return;
    let alive = true;
    fetchMine(uid).then((items) => {
      if (!alive) return;
      const seen = readSeen();
      setCount(items.filter((i) => i.handled_at && i.handled_at > seen).length);
    });
    return () => {
      alive = false;
    };
  }, [uid, status, refreshKey]);
  return [count, () => setCount(0)] as const;
}

const KIND = { add: "등록 요청", delete: "삭제 요청", feedback: "수정 건의" } as const;

function StatusBadge({ s }: { s: string }) {
  const [text, cls] =
    s === "done" ? ["완료", "bg-emerald-50 text-emerald-700"] : s === "rejected" ? ["반려", "bg-rose-50 text-rose-700"] : ["대기 중", "bg-slate-100 text-slate-600"];
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{text}</span>;
}

export default function MyRequests({ onClose }: { onClose: () => void }) {
  const { session } = useAuth();
  const uid = session?.user.id;
  const [items, setItems] = useState<Item[] | null>(null);
  const [seenBefore] = useState(readSeen);

  const load = useCallback(async () => {
    if (!uid) return;
    const list = await fetchMine(uid);
    setItems(list);
    writeSeen(new Date().toISOString()); // 열어 봤으니 알림 끄기
  }, [uid]);
  useEffect(() => {
    load();
  }, [load]);

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose} role="dialog" aria-modal aria-label="내 요청">
      <div
        className="flex max-h-[85dvh] w-full max-w-md flex-col rounded-t-3xl bg-white shadow-xl sm:rounded-3xl"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-base font-bold">내 요청</h2>
            <p className="text-xs text-slate-500">등록·삭제 요청과 수정 건의의 처리 결과예요</p>
          </div>
          <button onClick={onClose} aria-label="닫기" className="-mr-2 rounded-full p-2 text-slate-400 hover:bg-slate-100">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2">
          {!items ? (
            <div className="my-4 h-16 animate-pulse rounded-xl bg-slate-100" />
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">아직 보낸 요청이 없어요</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {items.map((i) => {
                const isNew = !!i.handled_at && i.handled_at > seenBefore;
                return (
                  <li key={i.kind + i.id} className="py-3 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold text-slate-400">
                          {KIND[i.kind]} · {formatDate(i.created_at)}
                          {isNew && <span className="ml-1.5 text-rose-600">새 결과</span>}
                        </p>
                        <p className="mt-0.5 line-clamp-3 break-words whitespace-pre-line text-slate-800">{i.title}</p>
                      </div>
                      <StatusBadge s={i.status} />
                    </div>
                    {i.reply && (
                      <p className="mt-1.5 rounded-lg bg-slate-50 px-3 py-2 text-xs break-words whitespace-pre-line text-slate-600">
                        <span className="font-semibold text-slate-700">관리자 답변</span> {i.reply}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
