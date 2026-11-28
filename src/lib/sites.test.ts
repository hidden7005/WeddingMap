import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";
import { gridCluster, groupSites, searchPins, type VenuePin } from "./sites";
import { formatMinutes, isStale } from "./format";

// 실제 CSV로 테스트용 핀 생성
const rows: Record<string, string>[] = parse(readFileSync("data/전국_예식장_목록_호텔포함.csv"), { bom: true, columns: true });
const pins: VenuePin[] = rows.map((r, i) => ({
  id: String(i),
  name: r.상호명,
  branch_name: r.지점명 || null,
  sido: r.시도,
  sigungu: r.시군구,
  road_address: r.도로명주소,
  lat: Number(r.위도),
  lng: Number(r.경도),
  category: "wedding_hall",
}));

test("같은 도로명주소·같은 위치는 한 지점으로 묶인다 (주소 겹침 28곳 중 5m 넘게 떨어진 3곳은 나눔)", () => {
  const sites = groupSites(pins);
  assert.equal(sites.length, 821 - 53 + 25);
  const multi = sites.filter((s) => s.venues.length > 1);
  assert.equal(multi.length, 25);
  assert.equal(multi.reduce((a, s) => a + s.venues.length, 0), 53);
});

test("검색: 이름 우선, 지역 AND 검색, 공백 무시", () => {
  const r1 = searchPins(pins, "신라모노그램");
  assert.ok(r1[0].name.includes("신라모노그램"));
  const r2 = searchPins(pins, "강릉 호텔");
  assert.ok(r2.length > 0 && r2.every((p) => p.sigungu === "강릉시" || p.road_address.includes("강릉")));
  assert.ok(searchPins(pins, "신라 모노그램").some((p) => p.name.includes("신라모노그램")));
  assert.equal(searchPins(pins, "   ").length, 0);
  assert.equal(searchPins(pins, "서울", 10).length, 10);
});

test("격자 클러스터링", () => {
  const pts = [
    { x: 1, y: 1, item: "a" },
    { x: 10, y: 20, item: "b" },
    { x: 100, y: 100, item: "c" },
  ];
  const c = gridCluster(pts, 64);
  assert.equal(c.length, 2);
  assert.deepEqual(c.find((x) => x.items.length === 2)!.items.sort(), ["a", "b"]);
  assert.deepEqual({ x: c[0].x, y: c[0].y }, { x: 5.5, y: 10.5 });
});

test("포맷", () => {
  assert.equal(formatMinutes(120), "2시간");
  assert.equal(formatMinutes(90), "1시간 30분");
  assert.equal(formatMinutes(30), "30분");
  assert.equal(formatMinutes(1440), "종일 무료");
  const now = new Date("2026-11-08T00:00:00Z");
  assert.equal(isStale("2025-11-01T00:00:00Z", now), true);
  assert.equal(isStale("2026-01-01T00:00:00Z", now), false);
  assert.equal(isStale(null, now), false);
});

test("같은 주소라도 5m 넘게 떨어지면 핀을 나눔 (같은 단지 A동·B동)", () => {
  const base = { branch_name: null, sido: "서울특별시", sigungu: "마포구", road_address: "서울특별시 마포구 마포대로 92", category: "wedding_hall" };
  const sites = groupSites([
    { ...base, id: "a", name: "글래드호텔 마포", lat: 37.5429306, lng: 126.9512418 },
    { ...base, id: "b", name: "아펠가모 공덕", lat: 37.5428496, lng: 126.9513323 },
    { ...base, id: "c", name: "같은 자리", lat: 37.5429306, lng: 126.9512418 },
  ]);
  assert.equal(sites.length, 2);
  assert.deepEqual(sites.map((s) => s.venues.length).sort(), [1, 2]);
  assert.ok(sites.every((s) => s.address === base.road_address));
  assert.equal(new Set(sites.map((s) => s.key)).size, 2);
});
