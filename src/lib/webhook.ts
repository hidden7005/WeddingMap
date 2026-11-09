import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Supabase Auth Hook 서명 검증 (Standard Webhooks 규격)
 * secret 형식: "v1,whsec_<base64>"  (Supabase 대시보드에서 생성)
 * 헤더: webhook-id, webhook-timestamp, webhook-signature ("v1,<base64> v1,<base64>...")
 */
export function verifyWebhook(
  body: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  secret: string,
  nowSec = Math.floor(Date.now() / 1000),
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > 5 * 60) return false; // 5분 넘은 요청 거부

  const key = Buffer.from(secret.replace(/^v1,/, "").replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();

  return signature.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) return false;
    const given = Buffer.from(sig, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

/** 테스트용: 서명 만들기 */
export function signWebhook(body: string, id: string, timestamp: string, secret: string): string {
  const key = Buffer.from(secret.replace(/^v1,/, "").replace(/^whsec_/, ""), "base64");
  return "v1," + createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
}
