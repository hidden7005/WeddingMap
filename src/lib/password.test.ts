import { test } from "node:test";
import assert from "node:assert/strict";
import { passwordProblem } from "./password";

test("비밀번호 확인", () => {
  assert.match(passwordProblem("abc12", "abc12")!, /8자 이상/);
  assert.match(passwordProblem("abcdefgh", "abcdefgh")!, /영문과 숫자/);
  assert.match(passwordProblem("12345678", "12345678")!, /영문과 숫자/);
  assert.match(passwordProblem("wedding2026", "wedding2027")!, /서로 달라요/);
  assert.equal(passwordProblem("wedding2026", "wedding2026"), null);
});
