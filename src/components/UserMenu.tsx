"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "./AuthProvider";

const KAKAO_ENABLED = process.env.NEXT_PUBLIC_KAKAO_LOGIN === "on";

export default function UserMenu({ compact = false }: { compact?: boolean }) {
  const { status, member, signOut, kakaoLinked, linkKakao } = useAuth();
  const [open, setOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  // 관리자: 승인 대기 중인 가입 신청 수
  useEffect(() => {
    if (member?.role !== "admin") return;
    supabase
      .from("members")
      .select("id", { count: "exact", head: true })
      .is("approved_at", null)
      .then(({ count }) => setPendingCount(count ?? 0));
  }, [member?.role, open]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (status === "loading") return <div className={compact ? "h-11 w-11" : "h-9 w-16"} />;

  // 모바일: 세 줄(≡) 메뉴 버튼
  if (compact) return <CompactMenu />;

  if (status !== "member" || !member) {
    return (
      <Link
        href="/login"
        className={
          compact
            ? "flex h-12 shrink-0 items-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold shadow-sm"
            : "rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white"
        }
      >
        로그인
      </Link>
    );
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={
          compact
            ? "relative flex h-12 w-12 items-center justify-center rounded-xl border border-slate-200 bg-white text-base font-bold shadow-sm"
            : "relative flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-semibold hover:bg-slate-100"
        }
        title={member.nickname}
      >
        {pendingCount > 0 && <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full border-2 border-white bg-rose-600" aria-label="승인 대기 있음" />}
        {compact ? (
          member.nickname.slice(0, 1)
        ) : (
          <>
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-xs text-white">{member.nickname.slice(0, 1)}</span>
            {member.nickname}
          </>
        )}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-2 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-sm shadow-lg">
          <div className="border-b border-slate-100 px-4 py-2.5">
            <p className="font-semibold">{member.nickname}</p>
            <p className="text-xs text-slate-500">{member.name}{member.role === "admin" ? " · 관리자" : ""}</p>
          </div>
          {!KAKAO_ENABLED ? null : kakaoLinked ? (
            <p className="px-4 py-2.5 text-slate-400">카카오 연결됨 ✓</p>
          ) : (
            <button role="menuitem" onClick={linkKakao} className="block w-full px-4 py-2.5 text-left hover:bg-slate-50">
              카카오 계정 연결
              <span className="block text-xs text-slate-400">다음부터 문자 없이 로그인</span>
            </button>
          )}
          {member.role === "admin" && (
            <Link role="menuitem" href="/admin" className="flex items-center justify-between px-4 py-2.5 hover:bg-slate-50">
              관리자 페이지
              {pendingCount > 0 && <span className="rounded-full bg-rose-600 px-2 py-0.5 text-xs font-semibold text-white">신청 {pendingCount}</span>}
            </Link>
          )}
          <button role="menuitem" onClick={() => signOut()} className="block w-full px-4 py-2.5 text-left text-rose-600 hover:bg-slate-50">
            로그아웃
          </button>
        </div>
      )}
    </div>
  );
}

/** 모바일 오른쪽 위 ≡ 메뉴: 비회원은 로그인, 회원은 아이디·관리자·로그아웃 */
function CompactMenu() {
  const { status, member, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (member?.role !== "admin") return;
    supabase
      .from("members")
      .select("id", { count: "exact", head: true })
      .is("approved_at", null)
      .then(({ count }) => setPendingCount(count ?? 0));
  }, [member?.role, open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | TouchEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
    };
  }, [open]);

  const isMember = status === "member" && member;
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="메뉴"
        className="relative flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-900 shadow-sm"
      >
        {pendingCount > 0 && <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full border-2 border-white bg-rose-600" aria-label="승인 대기 있음" />}
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-2 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-sm shadow-lg">
          {isMember ? (
            <>
              <div className="border-b border-slate-100 px-4 py-2.5">
                <p className="font-semibold">{member.nickname}</p>
                <p className="text-xs text-slate-500">
                  {member.name}
                  {member.role === "admin" ? " · 관리자" : ""}
                </p>
              </div>
              {member.role === "admin" && (
                <Link role="menuitem" href="/admin" className="flex items-center justify-between px-4 py-2.5 hover:bg-slate-50">
                  관리자 페이지
                  {pendingCount > 0 && <span className="rounded-full bg-rose-600 px-2 py-0.5 text-xs font-semibold text-white">신청 {pendingCount}</span>}
                </Link>
              )}
              <button role="menuitem" onClick={() => signOut()} className="block w-full px-4 py-2.5 text-left text-rose-600 hover:bg-slate-50">
                로그아웃
              </button>
            </>
          ) : (
            <Link role="menuitem" href="/login" className="block px-4 py-2.5 font-semibold hover:bg-slate-50">
              로그인
              <span className="block text-xs font-normal text-slate-400">승인된 회원은 정보를 수정할 수 있어요</span>
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
