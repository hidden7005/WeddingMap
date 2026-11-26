"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { isValidEmail, normalizeEmail } from "@/lib/members";
import { TEAMS, suggestCode } from "@/lib/teams";
import { MIN_PASSWORD, passwordProblem } from "@/lib/password";
import { useAuth } from "@/components/AuthProvider";

const KAKAO_ENABLED = process.env.NEXT_PUBLIC_KAKAO_LOGIN === "on";

/**
 * email     이메일 입력 → 상태 확인
 * password  승인 + 계정 있음 → 비밀번호로 로그인
 * setpw     승인 + 계정 없음(관리자가 직접 등록) → 비밀번호 만들기
 * request   명단에 없음 → 가입 신청 (이름·소속·비밀번호)
 */
type Step = "email" | "password" | "setpw" | "request" | "requested" | "pending" | "suspended" | "confirm" | "resetSent" | "link";

function friendlyError(message: string): string {
  if (/email_login_status|request_access|schema cache|could not find the function/i.test(message)) return "로그인 기능은 준비 중이에요. 조금만 기다려주세요.";
  if (/invalid login credentials/i.test(message)) return "이메일 또는 비밀번호가 맞지 않아요.";
  if (/email not confirmed/i.test(message)) return "이메일 확인이 아직 안 됐어요. 메일함에서 확인 링크를 눌러주세요.";
  if (/already registered|already been registered|user already exists/i.test(message)) return "이미 계정이 있는 이메일이에요. 비밀번호로 로그인해주세요.";
  if (/가입 신청을 먼저/.test(message)) return "가입 신청을 먼저 해주세요.";
  if (/password/i.test(message) && /(short|least|weak|characters)/i.test(message)) return `비밀번호를 ${MIN_PASSWORD}자 이상으로 더 복잡하게 만들어주세요.`;
  if (/rate|too many|security purposes|seconds/i.test(message)) return "요청이 너무 많아요. 잠시 후 다시 시도해주세요.";
  return message;
}

export default function LoginPage() {
  const router = useRouter();
  const { status, claim, refresh, signInWithKakao, linkKakao } = useAuth();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [name, setName] = useState("");
  const [team, setTeam] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "member" && step !== "link") router.replace("/");
  }, [status, step, router]);

  const go = (s: Step) => {
    setError(null);
    setPassword("");
    setPassword2("");
    setStep(s);
  };

  async function run(fn: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(friendlyError((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  /** 로그인 성공 후: 이 기기를 현재 로그인으로 등록 (이전 기기는 자동 로그아웃) */
  async function finishLogin() {
    const r = await claim();
    if (r !== "ok") {
      await supabase.auth.signOut({ scope: "local" });
      if (r === "suspended") return go("suspended");
      return go("pending"); // 계정은 있지만 아직 승인 전
    }
    await refresh();
    if (KAKAO_ENABLED) {
      const { data } = await supabase.auth.getUser();
      if (!data.user?.identities?.some((i) => i.provider === "kakao")) return setStep("link");
    }
    router.replace("/");
  }

  const submitEmail = () =>
    run(async () => {
      if (!isValidEmail(email)) throw new Error("이메일 주소를 정확히 입력해주세요.");
      const { data: st, error: e } = await supabase.rpc("email_login_status", { p_email: normalizeEmail(email) });
      if (e) throw e;
      if (st === "approved") return go("password");
      if (st === "approved_new") return go("setpw");
      if (st === "pending") return go("pending");
      if (st === "suspended") return go("suspended");
      go("request");
    });

  const login = () =>
    run(async () => {
      if (!password) throw new Error("비밀번호를 입력해주세요.");
      const { error: e } = await supabase.auth.signInWithPassword({ email: normalizeEmail(email), password });
      if (e) throw e;
      await finishLogin();
    });

  /** 계정 만들기 (관리자가 직접 등록한 사람 / 가입 신청자 공통) */
  async function createAccount(): Promise<"session" | "confirm"> {
    const problem = passwordProblem(password, password2);
    if (problem) throw new Error(problem);
    const { data, error: e } = await supabase.auth.signUp({
      email: normalizeEmail(email),
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (e) throw e;
    // Supabase는 이미 있는 이메일이면 오류 대신 빈 계정을 돌려주기도 함
    if (data.user && data.user.identities && data.user.identities.length === 0) throw new Error("already registered");
    return data.session ? "session" : "confirm";
  }

  const setFirstPassword = () =>
    run(async () => {
      const r = await createAccount();
      if (r === "confirm") return go("confirm");
      await finishLogin();
    });

  const requestAccess = () =>
    run(async () => {
      if (!name.trim()) throw new Error("이름을 입력해주세요.");
      if (!team) throw new Error("소속을 선택해주세요.");
      const problem = passwordProblem(password, password2);
      if (problem) throw new Error(problem);
      const { data: r, error: e } = await supabase.rpc("request_access", { p_name: name.trim(), p_email: normalizeEmail(email), p_team: team });
      if (e) throw e;
      if (r === "already_approved") return go("password");
      if (r === "suspended") return go("suspended");
      if (r === "too_many") throw new Error("신청이 많이 밀려 있어요. 잠시 후 다시 시도하거나 관리자에게 직접 연락해주세요.");
      if (r === "invalid") throw new Error("입력한 내용을 다시 확인해주세요.");
      // requested / already_pending → 비밀번호 계정 만들기 (승인 전이라 아직 아무것도 못 봄)
      const created = await createAccount().catch((err: Error) => {
        if (/already/i.test(err.message)) return "exists" as const;
        throw err;
      });
      await supabase.auth.signOut({ scope: "local" });
      go(created === "confirm" ? "confirm" : "requested");
    });

  const sendReset = () =>
    run(async () => {
      const { error: e } = await supabase.auth.resetPasswordForEmail(normalizeEmail(email), { redirectTo: `${window.location.origin}/auth/reset` });
      if (e) throw e;
      go("resetSent");
    });

  const inputCls = "mt-1 h-12 w-full rounded-xl border border-slate-200 px-3 text-[15px] outline-none focus:border-slate-500";
  const primaryBtn = "h-12 w-full rounded-xl bg-slate-900 font-semibold text-white disabled:opacity-50";
  const backToEmail = (
    <button type="button" onClick={() => go("email")} className="text-sm text-slate-500 hover:text-slate-900">
      ‹ 다른 이메일로
    </button>
  );
  const emailLine = (
    <p className="text-sm text-slate-600">
      <b className="break-all">{normalizeEmail(email)}</b>
    </p>
  );
  const pwFields = (
    <>
      <label className="block">
        <span className="text-sm font-semibold">
          비밀번호 <span className="font-normal text-slate-400">({MIN_PASSWORD}자 이상, 영문+숫자)</span>
        </span>
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="new-password" className={inputCls} />
      </label>
      <label className="block">
        <span className="text-sm font-semibold">비밀번호 확인</span>
        <input value={password2} onChange={(e) => setPassword2(e.target.value)} type="password" autoComplete="new-password" className={inputCls} />
        {password2 && password !== password2 && <span className="mt-1 block text-xs text-rose-600">비밀번호가 서로 달라요.</span>}
        {password2 && password === password2 && password.length >= MIN_PASSWORD && <span className="mt-1 block text-xs text-emerald-600">비밀번호가 같아요.</span>}
      </label>
    </>
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
              <label className="block">
                <span className="text-sm font-semibold">이메일</span>
                <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" inputMode="email" autoComplete="email" className={inputCls} placeholder="you@example.com" />
              </label>
              {error && <p className="text-sm text-rose-600">{error}</p>}
              <button disabled={busy} className={primaryBtn}>
                {busy ? "확인 중…" : "다음"}
              </button>
              <p className="text-center text-xs text-slate-400">처음이신가요? 이메일을 입력하면 가입 신청 화면으로 안내해요.</p>
            </form>
          )}

          {step === "password" && (
            <form onSubmit={(e) => (e.preventDefault(), login())} className="space-y-4">
              {emailLine}
              <label className="block">
                <span className="text-sm font-semibold">비밀번호</span>
                <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" autoFocus className={inputCls} />
              </label>
              {error && <p className="text-sm text-rose-600">{error}</p>}
              <button disabled={busy} className={primaryBtn}>
                {busy ? "로그인 중…" : "로그인"}
              </button>
              <div className="flex justify-between">
                {backToEmail}
                <button type="button" disabled={busy} onClick={sendReset} className="text-sm text-slate-500 hover:text-slate-900">
                  비밀번호를 잊으셨나요?
                </button>
              </div>
            </form>
          )}

          {step === "setpw" && (
            <form onSubmit={(e) => (e.preventDefault(), setFirstPassword())} className="space-y-4">
              <div>
                <p className="font-bold">비밀번호 만들기</p>
                <p className="mt-1 text-sm text-slate-600">관리자가 등록한 이메일이에요. 앞으로 로그인할 때 쓸 비밀번호를 만들어주세요.</p>
              </div>
              {emailLine}
              {pwFields}
              {error && <p className="text-sm text-rose-600">{error}</p>}
              <button disabled={busy} className={primaryBtn}>
                {busy ? "만드는 중…" : "비밀번호 만들고 로그인"}
              </button>
              {backToEmail}
            </form>
          )}

          {step === "request" && (
            <form onSubmit={(e) => (e.preventDefault(), requestAccess())} className="space-y-4">
              <div>
                <p className="font-bold">가입 신청</p>
                <p className="mt-1 text-sm text-slate-600">신청하면 관리자 확인 후 로그인할 수 있어요.</p>
              </div>
              {emailLine}
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
              {pwFields}
              {error && <p className="text-sm text-rose-600">{error}</p>}
              <button disabled={busy} className={primaryBtn}>
                {busy ? "신청 중…" : "가입 신청"}
              </button>
              {backToEmail}
            </form>
          )}

          {(step === "requested" || step === "pending") && (
            <Message title={step === "requested" ? "신청이 접수됐어요" : "승인 대기 중이에요"}>
              관리자가 확인하고 승인하면
              <br />
              <b>{normalizeEmail(email)}</b> 와 비밀번호로 로그인할 수 있어요.
              <div className="mt-3">{backToEmail}</div>
            </Message>
          )}

          {step === "confirm" && (
            <Message title="메일함을 확인해주세요">
              <b>{normalizeEmail(email)}</b> 로 보낸 메일의 확인 링크를 눌러주세요. 확인이 끝나면 로그인할 수 있어요. (승인 전이라면 승인 후에)
              <div className="mt-3">{backToEmail}</div>
            </Message>
          )}

          {step === "resetSent" && (
            <Message title="비밀번호 재설정 메일을 보냈어요">
              <b>{normalizeEmail(email)}</b> 로 보낸 메일의 링크를 눌러 새 비밀번호를 만들어주세요. 메일이 안 보이면 스팸함도 확인해주세요.
              <div className="mt-3">{backToEmail}</div>
            </Message>
          )}

          {step === "suspended" && (
            <Message title="이용이 정지된 계정이에요">
              관리자에게 문의해주세요.
              <div className="mt-3">{backToEmail}</div>
            </Message>
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

function Message({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 text-center">
      <p className="text-lg font-bold">{title}</p>
      <div className="text-sm leading-relaxed text-slate-600">{children}</div>
    </div>
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
