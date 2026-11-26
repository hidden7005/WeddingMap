import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTimes } from "./times";

test("예식 시간 입력 해석", () => {
  assert.deepEqual(parseTimes("11:00 15:00 18:00").times, ["11:00", "15:00", "18:00"]);
  assert.deepEqual(parseTimes("18:00, 11:00 / 11:00").times, ["11:00", "18:00"]);
  assert.deepEqual(parseTimes("11시 1시반 3시").times, ["11:00", "13:30", "15:00"]);
  assert.deepEqual(parseTimes("1100 1530").times, ["11:00", "15:30"]);
  assert.deepEqual(parseTimes("12 12:30 오후 1시 오전 10시").times, ["10:00", "12:00", "12:30", "13:00"]);
  assert.deepEqual(parseTimes("11:00 abc 25:00").invalid, ["abc", "25:00"]);
  assert.deepEqual(parseTimes("   ").times, []);
  // 앞에 0을 붙이거나 9시는 오전 그대로
  assert.deepEqual(parseTimes("09:30 0900 9시 오전 8시").times, ["08:00", "09:00", "09:30"]);
  assert.deepEqual(parseTimes("1:30 5시").times, ["13:30", "17:00"]);
});

import { formatOvertime } from "./format";
test("초과 요금 표시", () => {
  assert.equal(formatOvertime(1000, 10), "10분당 1,000원");
  assert.equal(formatOvertime(6000, 60), "1시간당 6,000원");
  assert.equal(formatOvertime(0, null), "없음");
  assert.equal(formatOvertime(null, 10), null);
});
