import type { Views } from "./database.types";

export type VenuePin = {
  id: string;
  name: string;
  branch_name: string | null;
  sido: string;
  sigungu: string;
  road_address: string;
  lat: number;
  lng: number;
  category: string;
};

/** 같은 도로명주소 = 지도 위 한 지점(site) */
export type Site = {
  key: string; // road_address
  lat: number;
  lng: number;
  venues: VenuePin[];
};

export function toPins(rows: Views<"venue_map">[]): VenuePin[] {
  return rows
    .filter((r) => r.id && r.lat != null && r.lng != null && r.name && r.road_address)
    .map((r) => ({
      id: r.id!,
      name: r.name!,
      branch_name: r.branch_name,
      sido: r.sido ?? "",
      sigungu: r.sigungu ?? "",
      road_address: r.road_address!,
      lat: r.lat!,
      lng: r.lng!,
      category: r.category ?? "wedding_hall",
    }));
}

export function groupSites(pins: VenuePin[]): Site[] {
  const map = new Map<string, Site>();
  for (const p of pins) {
    const s = map.get(p.road_address);
    if (s) s.venues.push(p);
    else map.set(p.road_address, { key: p.road_address, lat: p.lat, lng: p.lng, venues: [p] });
  }
  for (const s of map.values()) {
    // 좌표는 평균 (대부분 동일)
    s.lat = s.venues.reduce((a, v) => a + v.lat, 0) / s.venues.length;
    s.lng = s.venues.reduce((a, v) => a + v.lng, 0) / s.venues.length;
    s.venues.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }
  return [...map.values()];
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");

/** 예식장명·지점명·지역·주소 검색. 공백 무시, 여러 단어는 AND */
export function searchPins(pins: VenuePin[], query: string, limit = 50): VenuePin[] {
  const terms = query.trim().split(/\s+/).filter(Boolean).map(norm);
  if (!terms.length) return [];
  const scored: { p: VenuePin; score: number }[] = [];
  for (const p of pins) {
    const name = norm(`${p.name}${p.branch_name ?? ""}`);
    const region = norm(`${p.sido}${p.sigungu}${p.road_address}`);
    let score = 0;
    let ok = true;
    for (const t of terms) {
      if (name.startsWith(t)) score += 3;
      else if (name.includes(t)) score += 2;
      else if (region.includes(t)) score += 1;
      else {
        ok = false;
        break;
      }
    }
    if (ok) scored.push({ p, score });
  }
  scored.sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name, "ko"));
  return scored.slice(0, limit).map((s) => s.p);
}

export type Cluster<T> = { x: number; y: number; items: T[] };

/**
 * 화면 픽셀 좌표 기준 격자 클러스터링.
 * cellSize 픽셀 칸 안에 들어온 점을 하나로 묶는다. 중심은 구성원 평균.
 */
export function gridCluster<T>(
  points: { x: number; y: number; item: T }[],
  cellSize: number,
): Cluster<T>[] {
  const cells = new Map<string, { sx: number; sy: number; items: T[] }>();
  for (const p of points) {
    const key = `${Math.floor(p.x / cellSize)}:${Math.floor(p.y / cellSize)}`;
    const c = cells.get(key);
    if (c) {
      c.sx += p.x;
      c.sy += p.y;
      c.items.push(p.item);
    } else cells.set(key, { sx: p.x, sy: p.y, items: [p.item] });
  }
  return [...cells.values()].map((c) => ({ x: c.sx / c.items.length, y: c.sy / c.items.length, items: c.items }));
}
