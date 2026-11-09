"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "./AuthProvider";

export default function UserMenu({ compact = false }: { compact?: boolean }) {
  const { status, member, session, signOut, refresh } = useAuth();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (status === "loading") return <div className={compact ? "h-12 w-12" : "h-9 w-16"} />;

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
            ? "flex h-12 w-12 items-center justify-center rounded-xl border border-slate-200 bg-white text-base font-bold shadow-sm"
            : "flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-semibold hover:bg-slate-100"
        }
        title={member.nickname}
      >
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
          <button role="menuitem" onClick={() => (setEditing(true), setOpen(false))} className="block w-full px-4 py-2.5 text-left hover:bg-slate-50">
            닉네임 변경
          </button>
          {member.role === "admin" && (
            <Link role="menuitem" href="/admin" className="block px-4 py-2.5 hover:bg-slate-50">
              관리자 페이지
            </Link>
          )}
          <button role="menuitem" onClick={() => signOut()} className="block w-full px-4 py-2.5 text-left text-rose-600 hover:bg-slate-50">
            로그아웃
          </button>
        </div>
      )}
      {editing && session && (
        <NicknameDialog
          userId={session.user.id}
          current={member.nickname}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function NicknameDialog({
  userId,
  current,
  onClose,
  onSaved,
}: {
  userId: string;
  current: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const v = value.trim();
    if (v.length < 2 || v.length > 20) return setError("2~20자로 입력해주세요.");
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.from("profiles").update({ nickname: v }).eq("id", userId);
    setBusy(false);
    if (e) return setError(e.code === "23505" ? "이미 사용 중인 닉네임이에요." : "저장하지 못했어요. 다시 시도해주세요.");
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="w-full max-w-xs rounded-2xl bg-white p-5 shadow-xl"
      >
        <h2 className="font-bold">닉네임 변경</h2>
        <p className="mt-1 text-xs text-slate-500">정보를 수정하면 다른 회원에게 이 닉네임이 보여요.</p>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={20}
          className="mt-3 h-11 w-full rounded-xl border border-slate-200 px-3 outline-none focus:border-slate-500"
        />
        {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
            취소
          </button>
          <button disabled={busy} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            저장
          </button>
        </div>
      </form>
    </div>
  );
}
