"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export type MemberInfo = { role: "admin" | "member"; name: string; nickname: string };

type AuthState = {
  /** loading: 확인 중 / guest: 비로그인 / member: 정상 회원(이 기기가 현재 로그인) */
  status: "loading" | "guest" | "member";
  session: Session | null;
  member: MemberInfo | null;
  /** 관리자 설정: 로그인한 회원만 보기 */
  requireLogin: boolean | null;
  /** 자동 로그아웃 등 사용자에게 알릴 메시지 */
  notice: string | null;
  clearNotice: () => void;
  /** 로그인 직후 호출: 이 기기를 현재 로그인으로 등록 */
  claim: () => Promise<string>;
  refresh: () => Promise<void>;
  signOut: (notice?: string) => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

const CHECK_INTERVAL_MS = 60_000;

const NOTICE: Record<string, string> = {
  replaced: "다른 기기에서 로그인되어 이 기기에서는 로그아웃됐어요.",
  suspended: "이용이 정지된 계정이에요. 관리자에게 문의해주세요.",
  not_member: "회원 명단에 없는 번호예요. 관리자에게 문의해주세요.",
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthState["status"]>("loading");
  const [member, setMember] = useState<MemberInfo | null>(null);
  const [requireLogin, setRequireLogin] = useState<boolean | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const checking = useRef(false);

  const signOut = useCallback(async (msg?: string) => {
    // scope: local → 이 기기만 로그아웃 (다른 기기의 새 로그인은 유지)
    await supabase.auth.signOut({ scope: "local" });
    setMember(null);
    setStatus("guest");
    if (msg) setNotice(msg);
  }, []);

  const claim = useCallback(async () => {
    const { data, error } = await supabase.rpc("claim_session");
    if (error) throw error;
    return data;
  }, []);

  const check = useCallback(async () => {
    if (checking.current) return;
    checking.current = true;
    try {
      const { data: s } = await supabase.auth.getSession();
      setSession(s.session);
      if (!s.session) {
        setMember(null);
        setStatus("guest");
        return;
      }
      type Status = { status: string; role?: MemberInfo["role"]; name?: string; nickname?: string };
      const fetchStatus = async () => {
        const { data, error } = await supabase.rpc("session_status");
        return error ? null : (data as Status);
      };
      let r = await fetchStatus();
      if (!r) return; // 네트워크 오류 등은 다음 확인 때 재시도
      if (r.status === "unclaimed") {
        // 로그인은 됐는데 기기 등록 전 (첫 로그인 직후 등) → 등록 후 다시 확인
        const c = await claim();
        if (c !== "ok") return void (await signOut(NOTICE[c]));
        r = await fetchStatus();
        if (!r) return;
      }
      if (r.status === "ok") {
        setMember({ role: r.role!, name: r.name!, nickname: r.nickname! });
        setStatus("member");
        return;
      }
      await signOut(NOTICE[r.status]);
    } finally {
      checking.current = false;
    }
  }, [claim, signOut]);

  const loadSettings = useCallback(async () => {
    const { data } = await supabase.from("app_settings").select("require_login_to_view").single();
    setRequireLogin(data?.require_login_to_view ?? false);
  }, []);

  useEffect(() => {
    check();
    loadSettings();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        // 콜백 안에서 바로 supabase 호출하면 교착될 수 있어 다음 틱으로 미룸
        setTimeout(check, 0);
      }
    });
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(check, CHECK_INTERVAL_MS);
    return () => {
      sub.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [check, loadSettings]);

  return (
    <AuthContext.Provider
      value={{
        status,
        session,
        member,
        requireLogin,
        notice,
        clearNotice: () => setNotice(null),
        claim,
        refresh: async () => {
          await Promise.all([check(), loadSettings()]);
        },
        signOut,
      }}
    >
      {children}
      {notice && (
        <div className="fixed inset-x-0 top-3 z-50 flex justify-center px-3" role="alert">
          <div className="flex max-w-md items-start gap-3 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-lg">
            <p className="flex-1">{notice}</p>
            <button onClick={() => setNotice(null)} className="shrink-0 font-semibold text-slate-300 hover:text-white">
              닫기
            </button>
          </div>
        </div>
      )}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
