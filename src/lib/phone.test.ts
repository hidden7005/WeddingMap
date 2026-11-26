import { test } from "node:test";
import assert from "node:assert/strict";
import { formatPhone, formatTel, isValidKoreanMobile, normalizePhone, toDomestic, toE164 } from "./phone";

test("번호 정규화", () => {
  for (const s of ["010-1234-5678", "01012345678", "+82 10 1234 5678", "+82-10-1234-5678", "821012345678"]) {
    assert.equal(normalizePhone(s), "821012345678");
  }
  assert.equal(toE164("010-1234-5678"), "+821012345678");
  assert.equal(formatPhone("821012345678"), "010-1234-5678");
  assert.equal(formatPhone("82111234567"), "011-123-4567");
  assert.equal(toDomestic("821012345678"), "01012345678");
  assert.ok(isValidKoreanMobile("010-1234-5678"));
  assert.ok(!isValidKoreanMobile("02-123-4567"));
  assert.ok(!isValidKoreanMobile("010-12"));
});

test("예식장 전화번호 하이픈", () => {
  assert.equal(formatTel("0234408000"), "02-3440-8000");
  assert.equal(formatTel("025421877"), "02-542-1877");
  assert.equal(formatTel("02-555-5656"), "02-555-5656");
  assert.equal(formatTel("0311234567"), "031-123-4567");
  assert.equal(formatTel("03112345678"), "031-1234-5678");
  assert.equal(formatTel("15881234"), "1588-1234");
  assert.equal(formatTel("050712345678"), "0507-1234-5678");
  assert.equal(formatTel("01012345678"), "010-1234-5678");
  assert.equal(formatTel("내선 1번"), "내선 1번");
});
