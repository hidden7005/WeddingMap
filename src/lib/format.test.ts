import { test } from "node:test";
import assert from "node:assert/strict";
import { venueTitle } from "./format";

test("venueTitle: 이름에 지점명이 이미 있으면 한 번만", () => {
  assert.equal(venueTitle({ name: "아펠가모 반포", branch_name: "반포점" }), "아펠가모 반포");
  assert.equal(venueTitle({ name: "루이비스컨벤션", branch_name: "안양점" }), "루이비스컨벤션 안양점");
  assert.equal(venueTitle({ name: "엘타워", branch_name: null }), "엘타워");
});
