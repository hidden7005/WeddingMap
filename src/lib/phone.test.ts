import { test } from "node:test";
import assert from "node:assert/strict";
import { formatPhone, isValidKoreanMobile, normalizePhone, parseMemberLines, toDomestic, toE164 } from "./phone";

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

test("명단 붙여넣기 파싱", () => {
  const { members, errors } = parseMemberLines(
    "이름,전화번호\n김철수, 010-1111-2222\n010 3333 4444\t이 영희\n박민수\n최지우 01011112222\n정우성;+82 10 5555 6666",
  );
  assert.deepEqual(members, [
    { name: "김철수", phone: "821011112222" },
    { name: "이 영희", phone: "821033334444" },
    { name: "정우성", phone: "821055556666" },
  ]);
  assert.equal(errors.length, 2); // 번호 없는 줄, 중복 번호
});
