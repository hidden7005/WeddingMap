"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { formatPhone, isValidKoreanMobile, normalizePhone, toE164 } from "@/lib/phone";
import { useAuth } from "@/components/AuthProvider";

const RESEND_SECONDS = 60;

function friendlyError(message: string): string {
  if (/expired|invalid/i.test(message) && /token|otp/i.test(message)) return "인증번호가 틀렸거나 만료됐어요. 다시 확인해주세요.";
  if (/rate|too many|security purposes/i.test(message)) return "요청이 너무 많아요. 잠시 후 다시 시도해주세요.";
  if (/member|명단/i.test(message)) return "회원 명단에 없는 번호예요. 관리자에게 문의해주세요.";
  if (/sms|provider|hook/i.test(message)) return "문자를 보내지 못했어요. 잠시 후 다시 시도하거나 관리자에게 문의해주세요.";
  return message;
}

export default function LoginPage() {
  const router = useRouter();
  const { status, claim, refresh } = useAuth();
  const [step, setStep] = useState<"info" | "code">("info");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (status === "member") router.replace("/");
  }, [status, router]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function sendCode() {
    setError(null);
    if (!name.trim()) return setError("이름을 입력해주세요.");
    if (!isValidKoreanMobile(phone)) return setError("휴대폰 번호를 정확히 입력해주세요. (예: 010-1234-5678)");
    setBusy(true);
    try {
      const { data: ok, error: e1 } = await supabase.rpc("check_member", { p_name: name, p_phone: phone });
      if (e1) throw e1;
      if (!ok) return setError("등록된 회원 정보와 일치하지 않아요. 이름과 번호를 확인하거나 관리자에게 문의해주세요.");
      const { error: e2 } = await supabase.auth.signInWithOtp({ phone: toE164(phone) });
      if (e2) throw e2;
      setStep("code");
      setCode("");
      setResendIn(RESEND_SECONDS);
      setTimeout(() => codeRef.current?.focus(), 50);
    } catch (e) {
      setError(friendlyError((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setError(null);
    if (!/^\d{6}$/.test(code)) return setError("문자로 받은 6자리 숫자를 입력해주세요.");
    setBusy(true);
    try {
      const { error: e } = await supabase.auth.verifyOtp({ phone: toE164(phone), token: code, type: "sms" });
      if (e) throw e;
      const r = await claim(); // 이 기기를 현재 로그인으로 → 다른 기기는 자동 로그아웃
      if (r !== "ok") {
        await supabase.auth.signOut({ scope: "local" });
        throw new Error(r === "suspended" ? "이용이 정지된 계정이에요." : "회원 명단에 없는 번호예요. 관리자에게 문의해주세요.");
      }
      await refresh();
      router.replace("/");
    } catch (e) {
      setError(friendlyError((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-sm">
        <h1 className="text-center text-2xl font-extrabold">웨딩맵</h1>
        <p className="mt-1 text-center text-sm text-slate-500">웨딩 촬영자를 위한 예식장 지도</p>

        <div className="mt-8 rounded-2xl bg-white p-6 shadow-sm">
          {step === "info" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendCode();
              }}
              className="space-y-4"
            >
              <p className="text-sm text-slate-600">관리자에게 등록된 이름과 휴대폰 번호로 로그인해요.</p>
              <label className="block">
                <span className="text-sm font-semibold">이름</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  className="mt-1 h-12 w-full rounded-xl border border-slate-200 px-3 text-[15px] outline-none focus:border-slate-500"
                  placeholder="홍길동"
                />
              </label>
              <label className="block">
                <span className="text-sm font-semibold">휴대폰 번호</span>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  className="mt-1 h-12 w-full rounded-xl border border-slate-200 px-3 text-[15px] outline-none focus:border-slate-500"
                  placeholder="010-1234-5678"
                />
              </label>
              {error && <p className="text-sm text-rose-600">{error}</p>}
              <button disabled={busy} className="h-12 w-full rounded-xl bg-slate-900 font-semibold text-white disabled:opacity-50">
                {busy ? "확인 중…" : "인증번호 받기"}
              </button>
            </form>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                verify();
              }}
              className="space-y-4"
            >
              <p className="text-sm text-slate-600">
                <b>{formatPhone(normalizePhone(phone))}</b> 로 보낸 6자리 인증번호를 입력해주세요.
              </p>
              <input
                ref={codeRef}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                className="h-14 w-full rounded-xl border border-slate-200 text-center text-2xl tracking-[0.5em] outline-none focus:border-slate-500"
                placeholder="••••••"
                aria-label="인증번호"
              />
              {error && <p className="text-sm text-rose-600">{error}</p>}
              <button disabled={busy} className="h-12 w-full rounded-xl bg-slate-900 font-semibold text-white disabled:opacity-50">
                {busy ? "확인 중…" : "로그인"}
              </button>
              <div className="flex justify-between text-sm">
                <button type="button" onClick={() => (setStep("info"), setError(null))} className="text-slate-500 hover:text-slate-900">
                  ‹ 번호 다시 입력
                </button>
                <button type="button" disabled={resendIn > 0 || busy} onClick={sendCode} className="text-slate-500 hover:text-slate-900 disabled:opacity-40">
                  {resendIn > 0 ? `재전송 ${resendIn}초` : "인증번호 재전송"}
                </button>
              </div>
            </form>
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
