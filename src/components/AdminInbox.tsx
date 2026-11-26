"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { removePhotoFiles, venuePhotoFiles } from "@/lib/venuePhotos";
import { isValidMemberCode } from "@/lib/members";
import { suggestCode, teamLabel } from "@/lib/teams";
import { useAuth } from "./AuthProvider";

type Pending = { id: string; name: string; email: string | null; team: string | null; created_at: string };
type Req = { id: string; name: string; kind: string; venue_id: string | null; created_at: string; requester: { nickname: string } | null };

/**
 * 관리자 전용: 맵 위에 '가입 신청 · 등록/삭제 요청' 알림.
 * 누르면 창이 열리고 거기서 바로 승인·거절, 요청 완료·반려.
 */
export default function AdminInbox({
  onOpenVenue,
  onVenueDeleted,
  className = "",
}: {
  onOpenVenue: (venueId: string) => void;
  /** 예식장을 지운 뒤 지도 핀 다시 불러오기 */
  onVenueDeleted?: () => void;
  className?: string;
}) {
  const { member } = useAuth();
  const isAdmin = member?.role === "admin";
  const [signups, setSignups] = useState<Pending[]>([]);
  const [requests, setRequests] = useState<Req[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    const [m, r] = await Promise.all([
      supabase.from("members").select("id,name,email,team,created_at").is("approved_at", null).order("created_at"),
      supabase
        .from("venue_requests")
        .select("id,name,kind,venue_id,created_at, requester:profiles!venue_requests_requested_by_fkey(nickname)")
        .eq("status", "pending")
        .order("created_at"),
    ]);
    if (!m.error) setSignups((m.data ?? []) as Pending[]);
    if (!r.error) setRequests((r.data ?? []) as unknown as Req[]);
  }, []);

  // 처음, 1분마다, 앱으로 돌아올 때 새로고침
  useEffect(() => {
    if (!isAdmin) return;
    load();
    const t = setInterval(load, 60_000);
    const onFocus = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [isAdmin, load]);

  if (!isAdmin) return null;
  const total = signups.length + requests.length;
  if (!total && !open) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`flex h-9 items-center gap-2 rounded-full bg-slate-900 px-3.5 text-xs font-semibold text-white shadow-lg ${className}`}
      >
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500" />
        </span>
        {signups.length > 0 && <span>가입 신청 {signups.length}</span>}
        {signups.length > 0 && requests.length > 0 && <span className="text-white/40">·</span>}
        {requests.length > 0 && <span>등록·삭제 요청 {requests.length}</span>}
      </button>
      {open && (
        <Panel
          signups={signups}
          requests={requests}
          onClose={() => setOpen(false)}
          onChanged={load}
          onVenueDeleted={() => onVenueDeleted?.()}
          onOpenVenue={(id) => {
            setOpen(false);
            onOpenVenue(id);
          }}
        />
      )}
    </>
  );
}

function Panel({
  signups,
  requests,
  onClose,
  onChanged,
  onVenueDeleted,
  onOpenVenue,
}: {
  signups: Pending[];
  requests: Req[];
  onClose: () => void;
  onChanged: () => void;
  onVenueDeleted: () => void;
  onOpenVenue: (id: string) => void;
}) {
  async function deleteVenue(r: Req) {
    if (!confirm(`‘${r.name}’ 을(를) 지도에서 삭제할까요?\n홀·시간표·특이사항도 함께 지워져요.`)) return;
    const photos = await venuePhotoFiles(r.venue_id);
    const { data, error } = await supabase.rpc("admin_delete_venue", { p_request_id: r.id });
    if (error) return alert("삭제하지 못했어요: " + error.message);
    if (data === "deleted") await removePhotoFiles(photos);
    if (data === "not_pending") alert("이미 처리된 요청이에요.");
    if (data === "already_gone") alert("이미 지도에서 지워진 예식장이에요. 요청만 완료로 바꿨어요.");
    onChanged();
    onVenueDeleted();
  }
  async function setStatus(r: Req, status: "done" | "rejected") {
    const { error } = await supabase.from("venue_requests").update({ status }).eq("id", r.id);
    if (error) return alert("처리하지 못했어요: " + error.message);
    onChanged();
  }

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose} role="dialog" aria-modal aria-label="관리자 알림">
      <div
        className="flex max-h-[85dvh] w-full max-w-md flex-col rounded-t-3xl bg-white shadow-xl sm:rounded-3xl"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-bold">관리자 알림</h2>
          <button onClick={onClose} aria-label="닫기" className="-mr-2 rounded-full p-2 text-slate-400 hover:bg-slate-100">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4">
          <section>
            <h3 className="text-sm font-bold">가입 신청 {signups.length}</h3>
            {signups.length === 0 ? (
              <p className="mt-2 text-sm text-slate-400">새 가입 신청이 없어요</p>
            ) : (
              <ul className="mt-1 divide-y divide-slate-100">
                {signups.map((m) => (
                  <SignupRow key={m.id} m={m} onChanged={onChanged} />
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="text-sm font-bold">등록·삭제 요청 {requests.length}</h3>
            {requests.length === 0 ? (
              <p className="mt-2 text-sm text-slate-400">처리할 요청이 없어요</p>
            ) : (
              <ul className="mt-1 divide-y divide-slate-100">
                {requests.map((r) => (
                  <li key={r.id} className="py-3 text-sm">
                    <p className="font-semibold">
                      <span
                        className={`mr-1.5 rounded px-1.5 py-0.5 text-[11px] font-semibold ${r.kind === "delete" ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-700"}`}
                      >
                        {r.kind === "delete" ? "삭제" : "등록"}
                      </span>
                      {r.name}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {r.requester?.nickname ?? "회원"} · {new Date(r.created_at).toLocaleDateString("ko-KR")}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {r.kind === "delete" && r.venue_id && (
                        <button onClick={() => onOpenVenue(r.venue_id!)} className="h-9 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700">
                          지도에서 보기
                        </button>
                      )}
                      {r.kind === "delete" ? (
                        <button onClick={() => deleteVenue(r)} className="h-9 rounded-lg bg-rose-600 px-3 text-xs font-semibold text-white">
                          삭제
                        </button>
                      ) : (
                        <button onClick={() => setStatus(r, "done")} className="h-9 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white">
                          등록 완료
                        </button>
                      )}
                      <button onClick={() => setStatus(r, "rejected")} className="h-9 rounded-lg px-3 text-xs text-slate-500 hover:bg-slate-100">
                        반려
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1 text-xs text-slate-400">등록 요청은 예식장 정보를 Claude에게 주면 지도에 추가해요. ‘등록 완료’는 표시만 바꿔요.</p>
          </section>

          <Link href="/admin" className="block text-center text-xs text-slate-400 underline underline-offset-2">
            관리자 페이지에서 자세히 보기
          </Link>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function SignupRow({ m, onChanged }: { m: Pending; onChanged: () => void }) {
  const [code, setCode] = useState(() => suggestCode(m.team, m.name));
  const [busy, setBusy] = useState(false);
  const ok = isValidMemberCode(code);

  async function approve() {
    setBusy(true);
    const { error } = await supabase.from("members").update({ approved_at: new Date().toISOString(), member_code: code.trim() }).eq("id", m.id);
    setBusy(false);
    if (error) return alert(error.code === "23505" ? "같은 아이디가 이미 있어요. 아이디를 고쳐 주세요." : "승인하지 못했어요: " + error.message);
    onChanged();
  }
  async function reject() {
    if (!confirm(`${m.name} 님의 가입 신청을 거절(삭제)할까요?`)) return;
    const { error } = await supabase.from("members").delete().eq("id", m.id);
    if (error) return alert("거절하지 못했어요: " + error.message);
    onChanged();
  }

  return (
    <li className="py-3 text-sm">
      <p className="font-semibold">
        {m.name}
        {m.team && <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-normal text-slate-600">{teamLabel(m.team)}</span>}
      </p>
      <p className="break-all text-xs text-slate-500">{m.email}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="h-9 w-40 rounded-lg border border-slate-300 bg-white px-2.5 text-sm outline-none focus:border-slate-600"
          aria-label={`${m.name} 아이디`}
        />
        <button disabled={!ok || busy} onClick={approve} className="h-9 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white disabled:opacity-40">
          승인
        </button>
        <button onClick={reject} className="h-9 rounded-lg px-3 text-xs text-rose-600 hover:bg-rose-50">
          거절
        </button>
      </div>
    </li>
  );
}
