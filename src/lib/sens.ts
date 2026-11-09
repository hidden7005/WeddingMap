import { createHmac } from "node:crypto";

/**
 * 네이버 클라우드 SENS 문자 발송
 * https://api.ncloud-docs.com/docs/ai-application-service-sens-smsv2
 */
export type SensConfig = {
  accessKey: string;
  secretKey: string;
  serviceId: string;
  /** 등록된 발신번호, 숫자만 (예: 01012345678) */
  from: string;
};

export function sensSignature(method: string, uri: string, timestamp: string, accessKey: string, secretKey: string) {
  const message = `${method} ${uri}\n${timestamp}\n${accessKey}`;
  return createHmac("sha256", secretKey).update(message).digest("base64");
}

export function buildSensRequest(cfg: SensConfig, to: string, content: string, timestamp = String(Date.now())) {
  const uri = `/sms/v2/services/${cfg.serviceId}/messages`;
  return {
    url: `https://sens.apigw.ntruss.com${uri}`,
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "x-ncp-apigw-timestamp": timestamp,
        "x-ncp-iam-access-key": cfg.accessKey,
        "x-ncp-apigw-signature-v2": sensSignature("POST", uri, timestamp, cfg.accessKey, cfg.secretKey),
      },
      body: JSON.stringify({
        type: "SMS",
        contentType: "COMM",
        countryCode: "82",
        from: cfg.from.replace(/\D/g, ""),
        content,
        messages: [{ to: to.replace(/\D/g, "") }],
      }),
    } satisfies RequestInit,
  };
}

export async function sendSms(cfg: SensConfig, to: string, content: string) {
  const { url, init } = buildSensRequest(cfg, to, content);
  const res = await fetch(url, init);
  const text = await res.text();
  if (res.status !== 202) throw new Error(`SENS ${res.status}: ${text}`);
  return JSON.parse(text) as { requestId: string; statusCode: string; statusName: string };
}
