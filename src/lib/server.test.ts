import { test } from "node:test";
import assert from "node:assert/strict";
import { signWebhook, verifyWebhook } from "./webhook";
import { buildSensRequest, sensSignature } from "./sens";

const secret = "v1,whsec_" + Buffer.from("super-secret-key-1234567890").toString("base64");

test("웹훅 서명 검증", () => {
  const body = JSON.stringify({ user: { phone: "821012345678" }, sms: { otp: "123456" } });
  const ts = "1762600000";
  const sig = signWebhook(body, "msg_1", ts, secret);
  const h = { id: "msg_1", timestamp: ts, signature: sig };
  assert.ok(verifyWebhook(body, h, secret, 1762600010));
  assert.ok(verifyWebhook(body, { ...h, signature: "v1,AAAA " + sig }, secret, 1762600010)); // 여러 서명 중 하나 일치
  assert.ok(!verifyWebhook(body + " ", h, secret, 1762600010)); // 본문 변조
  assert.ok(!verifyWebhook(body, h, "v1,whsec_" + Buffer.from("other").toString("base64"), 1762600010)); // 다른 키
  assert.ok(!verifyWebhook(body, h, secret, 1762600000 + 600)); // 10분 지남
  assert.ok(!verifyWebhook(body, { ...h, signature: null }, secret, 1762600010));
});

test("SENS 요청 형식·서명", () => {
  // 네이버 문서 방식: base64(HMAC-SHA256(secretKey, "POST {uri}\n{timestamp}\n{accessKey}"))
  const sig = sensSignature("POST", "/sms/v2/services/ncp:sms:kr:1:wm/messages", "1700000000000", "AK", "SK");
  assert.equal(sig, "NYd5LvOrFA7H9cP0pNc0w3EPvL4apPnHQ1NE+xZr9R4="); // python hmac 으로 따로 계산한 값
  const { url, init } = buildSensRequest(
    { accessKey: "AK", secretKey: "SK", serviceId: "ncp:sms:kr:1:wm", from: "010-1111-2222" },
    "01033334444",
    "[웨딩맵] 인증번호 123456",
    "1700000000000",
  );
  assert.equal(url, "https://sens.apigw.ntruss.com/sms/v2/services/ncp:sms:kr:1:wm/messages");
  const h = init.headers as Record<string, string>;
  assert.equal(h["x-ncp-apigw-signature-v2"], sig);
  const body = JSON.parse(init.body as string);
  assert.equal(body.from, "01011112222");
  assert.deepEqual(body.messages, [{ to: "01033334444" }]);
  assert.equal(body.type, "SMS");
});
