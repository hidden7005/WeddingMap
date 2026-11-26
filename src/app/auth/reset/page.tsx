"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { MIN_PASSWORD, passwordProblem } from "@/lib/password";
import { useAuth } from "@/components/AuthProvider";
import Logo from "@/components/Logo";

/** 비밀번호 재설정 메일의 링크를 누르면 오는 곳: 새 비밀번호 두 번 입력 */
export default function ResetPassword() {
  const router = useRouter();
  const { claim, refresh, signOut } = useAuth();
  const [ready, setReady] = useState<boolean | null>(null);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let tries = 0;
    const t = setInterval(async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        clearInterval(t);
        setReady(true);
      } else if (++tries > 20) {
        clearInterval(t);
        setReady(false);
      }
    }, 150);
    return () => clearInterval(t);
  }, []);

  async function save() {
    const problem = passwordProblem(pw, pw2);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.auth.updateUser({ password: pw });
    if (e) {
      setBusy(false);
      return setError("바꾸지 못했어요: " + e.message);
    }
    const r = await claim().catch(() => "error");
    if (r !== "ok") {
      await signOut();
      setBusy(false);
      return setError("비밀번호는 바뀌었어요. 다만 아직 승인 전이거나 정지된 계정이라 로그인할 수 없어요.");
    }
    await refresh();
    router.replace("/");
  }

  const inputCls = "mt-1 h-12 w-full rounded-xl border border-slate-200 px-3 text-[15px] outline-none focus:border-slate-500";
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm">
        <Logo className="mx-auto mb-5 h-8" />
        <h1 className="text-lg font-bold">새 비밀번호 만들기</h1>
        {ready === null && <p className="mt-3 text-sm text-slate-500">확인 중…</p>}
        {ready === false && (
          <p className="mt-3 text-sm text-slate-600">
            링크가 만료됐거나 잘못됐어요.{" "}
            <Link href="/login" className="font-semibold underline">
              로그인 화면
            </Link>
            에서 다시 요청해주세요.
          </p>
        )}
        {ready && (
          <form onSubmit={(e) => (e.preventDefault(), save())} className="mt-4 space-y-4">
            <label className="block">
              <span className="text-sm font-semibold">
                새 비밀번호 <span className="font-normal text-slate-400">({MIN_PASSWORD}자 이상, 영문+숫자)</span>
              </span>
              <input value={pw} onChange={(e) => setPw(e.target.value)} type="password" autoComplete="new-password" className={inputCls} />
            </label>
            <label className="block">
              <span className="text-sm font-semibold">새 비밀번호 확인</span>
              <input value={pw2} onChange={(e) => setPw2(e.target.value)} type="password" autoComplete="new-password" className={inputCls} />
            </label>
            {error && <p className="text-sm text-rose-600">{error}</p>}
            <button disabled={busy} className="h-12 w-full rounded-xl bg-slate-900 font-semibold text-white disabled:opacity-50">
              {busy ? "저장 중…" : "저장하고 로그인"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
