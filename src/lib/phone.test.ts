import { test } from "node:test";
import assert from "node:assert/strict";
import { formatPhone, isValidKoreanMobile, normalizePhone, toDomestic, toE164 } from "./phone";

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
