"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/AuthProvider";

/**
 * 카카오 로그인·카카오 연결, 또는 이메일 로그인 링크를 누른 뒤 돌아오는 곳.
 * 새로 만들어진 로그인을 "이 기기의 현재 로그인"으로 등록(claim)한 뒤 지도로 이동.
 */
export default function AuthCallback() {
  const router = useRouter();
  const { claim, refresh, signOut } = useAuth();
  const [message, setMessage] = useState("로그인 확인 중…");
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;

    (async () => {
      const params = new URLSearchParams(window.location.search);
      const hash = new URLSearchParams(window.location.hash.slice(1));
      const err = params.get("error_description") ?? hash.get("error_description");
      if (err) {
        setMessage(/승인된 이메일만/.test(err) ? "승인된 이메일만 로그인할 수 있어요. 가입 신청 후 관리자 승인을 기다려주세요." : /already|exists|linked/i.test(err) ? "이 카카오 계정은 이미 다른 회원에게 연결돼 있어요." : `로그인에 실패했어요: ${err}`);
        return;
      }

      // supabase-js 가 주소의 토큰을 읽어 로그인을 마칠 때까지 잠깐 기다림
      let session = null;
      for (let i = 0; i < 20 && !session; i++) {
        session = (await supabase.auth.getSession()).data.session;
        if (!session) await new Promise((r) => setTimeout(r, 150));
      }
      if (!session) return setMessage("로그인 정보를 받지 못했어요. 다시 시도해주세요.");

      const r = await claim().catch(() => "error");
      if (r === "ok") {
        await refresh();
        router.replace(params.get("linked") === "kakao" ? "/?kakao=linked" : "/");
        return;
      }
      if (r === "not_member") {
        await signOut();
        setMessage("승인된 회원 계정과 연결되지 않았어요. 처음이라면 승인된 이메일로 로그인한 뒤, 메뉴에서 카카오를 연결해주세요. 아직 승인 전이라면 가입 신청 후 관리자 승인을 기다려주세요.");
        return;
      }
      if (r === "suspended") {
        await signOut();
        setMessage("이용이 정지된 계정이에요. 관리자에게 문의해주세요.");
        return;
      }
      setMessage("로그인을 마치지 못했어요. 다시 시도해주세요.");
    })();
  }, [claim, refresh, router, signOut]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="max-w-sm text-sm leading-relaxed text-slate-600">{message}</p>
      {!message.endsWith("…") && (
        <Link href="/login" className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white">
          로그인 화면으로
        </Link>
      )}
    </main>
  );
}
