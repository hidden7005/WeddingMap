/**
 * Supabase Auth "Send SMS" Hook
 *
 * Supabase가 인증번호 문자를 보내야 할 때 이 주소로 요청한다.
 *   1) 요청이 진짜 Supabase에서 왔는지 서명 확인
 *   2) 회원 명단에 있는(정지 아닌) 번호인지 확인 → 아니면 문자 안 보냄
 *   3) 네이버 SENS로 문자 발송
 *
 * 필요한 환경변수 (Vercel → Settings → Environment Variables, 모두 서버 전용)
 *   SEND_SMS_HOOK_SECRET        Supabase 대시보드에서 훅을 만들 때 생성되는 "v1,whsec_..." 값
 *   SUPABASE_SERVICE_ROLE_KEY   명단 조회용
 *   NCP_ACCESS_KEY, NCP_SECRET_KEY, NCP_SENS_SERVICE_ID, NCP_SENS_FROM
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { verifyWebhook } from "@/lib/webhook";
import { sendSms } from "@/lib/sens";
import { normalizePhone, toDomestic } from "@/lib/phone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type HookPayload = { user: { id: string; phone: string }; sms: { otp: string } };

/** Supabase 훅 규격의 오류 응답 → 로그인 화면에 message 가 전달됨 */
function hookError(httpCode: number, message: string) {
  return Response.json({ error: { http_code: httpCode, message } }, { status: httpCode });
}

export async function POST(req: Request) {
  const env = process.env;
  const body = await req.text();

  if (!env.SEND_SMS_HOOK_SECRET) return hookError(500, "SMS hook is not configured");
  const valid = verifyWebhook(
    body,
    {
      id: req.headers.get("webhook-id"),
      timestamp: req.headers.get("webhook-timestamp"),
      signature: req.headers.get("webhook-signature"),
    },
    env.SEND_SMS_HOOK_SECRET,
  );
  if (!valid) return hookError(401, "invalid signature");

  let payload: HookPayload;
  try {
    payload = JSON.parse(body);
  } catch {
    return hookError(400, "invalid payload");
  }
  const phone = normalizePhone(payload.user?.phone ?? "");
  const otp = payload.sms?.otp;
  if (!phone || !otp) return hookError(400, "invalid payload");

  // 명단 확인
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return hookError(500, "member check is not configured");
  const admin = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: member, error } = await admin.from("members").select("status").eq("phone", phone).maybeSingle();
  if (error) return hookError(500, "member check failed");
  if (!member || member.status === "suspended") return hookError(403, "회원 명단에 없는 번호예요.");

  // 문자 발송
  if (!env.NCP_ACCESS_KEY || !env.NCP_SECRET_KEY || !env.NCP_SENS_SERVICE_ID || !env.NCP_SENS_FROM) {
    return hookError(500, "SMS provider is not configured");
  }
  try {
    await sendSms(
      { accessKey: env.NCP_ACCESS_KEY, secretKey: env.NCP_SECRET_KEY, serviceId: env.NCP_SENS_SERVICE_ID, from: env.NCP_SENS_FROM },
      toDomestic(phone),
      `[웨딩맵] 인증번호 ${otp}`,
    );
  } catch (e) {
    console.error("SENS send failed", e);
    return hookError(502, "SMS provider error");
  }
  return Response.json({});
}
