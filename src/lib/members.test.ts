import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidEmail, parseMemberLines } from "./members";

test("이메일 형식", () => {
  assert.ok(isValidEmail("snap@example.com"));
  assert.ok(isValidEmail("  Snap.Kim@Example.co.kr "));
  assert.ok(!isValidEmail("snap@example"));
  assert.ok(!isValidEmail("@example.com"));
  assert.ok(!isValidEmail("snap example.com"));
  assert.ok(!isValidEmail("snap@example."));
});

test("명단 붙여넣기 파싱: 이름·이메일(·번호)", () => {
  const { members, errors } = parseMemberLines(
    "이름,이메일,전화\n김철수, Kim@Example.com\nlee@snap.kr\t이 영희\t010-3333-4444\n박민수\n최지우 kim@example.com\n정우성;woo@x.co.kr;+82 10 5555 6666\n번호만 010-1111-2222",
  );
  assert.deepEqual(members, [
    { name: "김철수", email: "kim@example.com", phone: null, code: null, team: null },
    { name: "이 영희", email: "lee@snap.kr", phone: "821033334444", code: null, team: null },
    { name: "정우성", email: "woo@x.co.kr", phone: "821055556666", code: null, team: null },
  ]);
  assert.equal(errors.length, 3); // 이메일 없음 ×2, 중복 ×1
});

test("명단 붙여넣기 파싱: 아이디·이메일", () => {
  const { members, errors } = parseMemberLines("AD_홍길동, hong@x.com\nAM_홍순이\tsooni@x.com\t010-1234-5678\n홍강이 AF_홍강이 kang@x.com");
  assert.deepEqual(members, [
    { name: "홍길동", email: "hong@x.com", phone: null, code: "AD_홍길동", team: "AD" },
    { name: "홍순이", email: "sooni@x.com", phone: "821012345678", code: "AM_홍순이", team: "AM" },
    { name: "홍강이", email: "kang@x.com", phone: null, code: "AF_홍강이", team: "AF" },
  ]);
  assert.equal(errors.length, 0);
});
