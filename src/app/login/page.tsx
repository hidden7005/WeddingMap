"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { isValidEmail, normalizeEmail } from "@/lib/members";
import { TEAMS, suggestCode } from "@/lib/teams";
import { useAuth } from "@/components/AuthProvider";

const RESEND_SECONDS = 60;
const KAKAO_ENABLED = process.env.NEXT_PUBLIC_KAKAO_LOGIN === "on";

type Step = "email" | "code" | "request" | "requested" | "pending" | "suspended" | "link";

function friendlyError(message: string): string {
  if (/email_login_status|request_access|schema cache|could not find the function/i.test(message)) return "로그인 기능은 준비 중이에요. 조금만 기다려주세요.";
  if (/승인된 이메일만/.test(message)) return "승인된 이메일만 로그인할 수 있어요. 가입 신청 후 관리자 승인을 기다려주세요.";
  if (/expired|invalid/i.test(message) && /token|otp|code/i.test(message)) return "코드가 틀렸거나 만료됐어요. 메일을 다시 확인해주세요.";
  if (/rate|too many|security purposes|seconds/i.test(message)) return "요청이 너무 많아요. 잠시 후 다시 시도해주세요.";
  if (/sending|smtp|email/i.test(message) && /error|fail/i.test(message)) return "메일을 보내지 못했어요. 잠시 후 다시 시도하거나 관리자에게 문의해주세요.";
  return message;
}

export default function LoginPage() {
  const router = useRouter();
  const { status, claim, refresh, signInWithKakao, linkKakao } = useAuth();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [team, setTeam] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (status === "member" && step !== "link") router.replace("/");
  }, [status, step, router]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  /** 1) 이메일 확인 → 승인됐으면 로그인 코드 메일 발송 */
  async function submitEmail() {
    setError(null);
    if (!isValidEmail(email)) return setError("이메일 주소를 정확히 입력해주세요.");
    setBusy(true);
    try {
      const { data: st, error: e1 } = await supabase.rpc("email_login_status", { p_email: normalizeEmail(email) });
      if (e1) throw e1;
      if (st === "pending") return setStep("pending");
      if (st === "suspended") return setStep("suspended");
      if (st !== "approved") return setStep("request");
      await sendCode();
    } catch (e) {
      setError(friendlyError((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  async function sendCode() {
    const { error: e } = await supabase.auth.signInWithOtp({
      email: normalizeEmail(email),
      options: { shouldCreateUser: true, emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (e) throw e;
    setStep("code");
    setCode("");
    setResendIn(RESEND_SECONDS);
    setTimeout(() => codeRef.current?.focus(), 50);
  }

  /** 2) 메일로 받은 코드 확인 → 이 기기를 현재 로그인으로 등록 */
  async function verify() {
    setError(null);
    if (!/^\d{6,10}$/.test(code)) return setError("메일로 받은 숫자 코드를 입력해주세요.");
    setBusy(true);
    try {
      const { error: e } = await supabase.auth.verifyOtp({ email: normalizeEmail(email), token: code, type: "email" });
      if (e) throw e;
      const r = await claim();
      if (r !== "ok") {
        await supabase.auth.signOut({ scope: "local" });
        throw new Error(r === "suspended" ? "이용이 정지된 계정이에요." : "승인된 회원 정보와 연결되지 않았어요. 관리자에게 문의해주세요.");
      }
      await refresh();
      if (KAKAO_ENABLED) {
        const { data } = await supabase.auth.getUser();
        if (!data.user?.identities?.some((i) => i.provider === "kakao")) return setStep("link");
      }
      router.replace("/");
    } catch (e) {
      setError(friendlyError((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  /** 가입 신청 */
  async function requestAccess() {
    setError(null);
    if (!name.trim()) return setError("이름을 입력해주세요.");
    if (!team) return setError("소속을 선택해주세요.");
    if (!isValidEmail(email)) return setError("이메일 주소를 정확히 입력해주세요.");
    setBusy(true);
    try {
      const { data: r, error: e } = await supabase.rpc("request_access", {
        p_name: name.trim(),
        p_email: normalizeEmail(email),
        p_team: team,
      });
      if (e) throw e;
      if (r === "requested" || r === "already_pending") return setStep("requested");
      if (r === "already_approved") return await sendCode();
      if (r === "suspended") return setStep("suspended");
      if (r === "too_many") return setError("신청이 많이 밀려 있어요. 잠시 후 다시 시도하거나 관리자에게 직접 연락해주세요.");
      setError("입력한 내용을 다시 확인해주세요.");
    } catch (e) {
      setError(friendlyError((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  const inputCls = "mt-1 h-12 w-full rounded-xl border border-slate-200 px-3 text-[15px] outline-none focus:border-slate-500";
  const primaryBtn = "h-12 w-full rounded-xl bg-slate-900 font-semibold text-white disabled:opacity-50";
  const backToEmail = (
    <button type="button" onClick={() => (setStep("email"), setError(null))} className="text-sm text-slate-500 hover:text-slate-900">
      ‹ 다른 이메일로
    </button>
  );

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-sm">
        <h1 className="text-center text-2xl font-extrabold">웨딩맵</h1>
        <p className="mt-1 text-center text-sm text-slate-500">웨딩 촬영자를 위한 예식장 지도</p>

        <div className="mt-8 rounded-2xl bg-white p-6 shadow-sm">
          {step === "email" && (
            <form onSubmit={(e) => (e.preventDefault(), submitEmail())} className="space-y-4">
              {KAKAO_ENABLED && (
                <>
                  <KakaoButton onClick={signInWithKakao}>카카오로 로그인</KakaoButton>
                  <Divider>또는 이메일로</Divider>
                </>
              )}
              <p className="text-sm text-slate-600">관리자가 승인한 이메일로 로그인해요. 비밀번호 없이 메일로 받은 코드를 입력하면 돼요.</p>
              <label className="block">
                <span className="text-sm font-semibold">이메일</span>
                <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" inputMode="email" autoComplete="email" className={inputCls} placeholder="you@example.com" />
              </label>
              {error && <p className="text-sm text-rose-600">{error}</p>}
              <button disabled={busy} className={primaryBtn}>
                {busy ? "확인 중…" : "로그인 코드 받기"}
              </button>
              <p className="text-center text-xs text-slate-400">처음이신가요? 이메일을 입력하면 가입 신청 화면으로 안내해요.</p>
            </form>
          )}

          {step === "code" && (
            <form onSubmit={(e) => (e.preventDefault(), verify())} className="space-y-4">
              <p className="text-sm text-slate-600">
                <b>{normalizeEmail(email)}</b> 로 보낸 메일의 <b>숫자 코드</b>를 입력해주세요. 메일 안의 로그인 링크를 눌러도 돼요.
              </p>
              <input
                ref={codeRef}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 10))}
                inputMode="numeric"
                autoComplete="one-time-code"
                className="h-14 w-full rounded-xl border border-slate-200 text-center text-2xl tracking-[0.4em] outline-none focus:border-slate-500"
                placeholder="••••••"
                aria-label="로그인 코드"
              />
              {error && <p className="text-sm text-rose-600">{error}</p>}
              <button disabled={busy} className={primaryBtn}>
                {busy ? "확인 중…" : "로그인"}
              </button>
              <div className="flex justify-between">
                {backToEmail}
                <button
                  type="button"
                  disabled={resendIn > 0 || busy}
                  onClick={async () => {
                    setError(null);
                    try {
                      await sendCode();
                    } catch (e) {
                      setError(friendlyError((e as Error).message));
                    }
                  }}
                  className="text-sm text-slate-500 hover:text-slate-900 disabled:opacity-40"
                >
                  {resendIn > 0 ? `재전송 ${resendIn}초` : "코드 다시 받기"}
                </button>
              </div>
              <p className="text-xs text-slate-400">메일이 안 보이면 스팸함도 확인해주세요.</p>
            </form>
          )}

          {step === "request" && (
            <form onSubmit={(e) => (e.preventDefault(), requestAccess())} className="space-y-4">
              <div>
                <p className="font-bold">가입 신청</p>
                <p className="mt-1 text-sm text-slate-600">
                  <b>{normalizeEmail(email)}</b> 은(는) 아직 승인되지 않은 이메일이에요. 신청하면 관리자 확인 후 로그인할 수 있어요.
                </p>
              </div>
              <label className="block">
                <span className="text-sm font-semibold">이름</span>
                <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={30} className={inputCls} placeholder="홍길동" />
              </label>
              <fieldset>
                <legend className="text-sm font-semibold">소속</legend>
                <div className="mt-1 grid grid-cols-1 gap-2">
                  {TEAMS.map((t) => (
                    <button
                      key={t.code}
                      type="button"
                      onClick={() => (setTeam(t.code), setError(null))}
                      aria-pressed={team === t.code}
                      className={`flex h-12 items-center justify-between rounded-xl border px-4 text-[15px] ${
                        team === t.code ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      <span className="font-semibold">{t.label}</span>
                      <span className={`text-sm ${team === t.code ? "text-white/70" : "text-slate-400"}`}>{t.code}</span>
                    </button>
                  ))}
                </div>
              </fieldset>
              {team && name.trim() && (
                <p className="text-sm text-slate-500">
                  아이디: <b className="text-slate-900">{suggestCode(team, name)}</b>
                </p>
              )}
              {error && <p className="text-sm text-rose-600">{error}</p>}
              <button disabled={busy} className={primaryBtn}>
                {busy ? "신청 중…" : "가입 신청"}
              </button>
              {backToEmail}
            </form>
          )}

          {(step === "requested" || step === "pending") && (
            <div className="space-y-3 text-center">
              <p className="text-lg font-bold">{step === "requested" ? "신청이 접수됐어요" : "승인 대기 중이에요"}</p>
              <p className="text-sm leading-relaxed text-slate-600">
                관리자가 확인하고 승인하면
                <br />
                <b>{normalizeEmail(email)}</b> 로 로그인할 수 있어요.
              </p>
              {backToEmail}
            </div>
          )}

          {step === "suspended" && (
            <div className="space-y-3 text-center">
              <p className="text-lg font-bold">이용이 정지된 계정이에요</p>
              <p className="text-sm text-slate-600">관리자에게 문의해주세요.</p>
              {backToEmail}
            </div>
          )}

          {step === "link" && (
            <div className="space-y-4 text-center">
              <p className="text-lg font-bold">로그인 완료!</p>
              <p className="text-sm leading-relaxed text-slate-600">
                카카오 계정을 연결하면 다음부터는
                <br />
                <b>카카오 버튼 한 번</b>으로 로그인돼요.
              </p>
              <KakaoButton onClick={linkKakao}>카카오 계정 연결하기</KakaoButton>
              <button onClick={() => router.replace("/")} className="text-sm text-slate-500 hover:text-slate-900">
                나중에 할게요
              </button>
            </div>
          )}
        </div>

        <p className="mt-6 text-center text-xs leading-relaxed text-slate-400">
          한 계정은 한 기기에서만 로그인돼요.
          <br />
          다른 기기에서 로그인하면 이전 기기는 자동으로 로그아웃돼요.
        </p>
        <p className="mt-4 text-center text-sm">
          <Link href="/" className="text-slate-500 underline-offset-2 hover:underline">
            지도로 돌아가기
          </Link>
        </p>
      </div>
    </main>
  );
}

function Divider({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-xs text-slate-400">
      <span className="h-px flex-1 bg-slate-200" />
      {children}
      <span className="h-px flex-1 bg-slate-200" />
    </div>
  );
}

function KakaoButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#FEE500] font-semibold text-[#191919] active:brightness-95"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
        <path fill="#191919" d="M12 3C6.48 3 2 6.58 2 11c0 2.86 1.88 5.37 4.7 6.78l-.96 3.5c-.08.3.26.54.52.37l4.17-2.77c.51.07 1.03.12 1.57.12 5.52 0 10-3.58 10-8S17.52 3 12 3z" />
      </svg>
      {children}
    </button>
  );
}
