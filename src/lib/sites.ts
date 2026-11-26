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

/** 지도 위 한 지점(site): 같은 주소·같은 위치의 예식장 묶음 */
export type Site = {
  key: string; // 주소 (같은 주소가 나뉘면 뒤에 #2, #3…)
  address: string;
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

/** 같은 지점으로 묶는 거리: 주소가 같아도 이보다 멀면 (예: 같은 단지의 A동·B동) 핀을 나눔 */
export const SAME_SITE_METERS = 5;

function meters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const dy = (a.lat - b.lat) * 111_000;
  const dx = (a.lng - b.lng) * 111_000 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dx, dy);
}

/** 같은 도로명주소이면서 거의 같은 좌표(5m 이내) = 지도 위 한 지점(site) */
export function groupSites(pins: VenuePin[]): Site[] {
  const byAddress = new Map<string, VenuePin[]>();
  for (const p of pins) {
    const l = byAddress.get(p.road_address);
    if (l) l.push(p);
    else byAddress.set(p.road_address, [p]);
  }
  const sites: Site[] = [];
  for (const [address, list] of byAddress) {
    const groups: VenuePin[][] = [];
    for (const p of list) {
      const g = groups.find((g) => meters(g[0], p) <= SAME_SITE_METERS);
      if (g) g.push(p);
      else groups.push([p]);
    }
    groups.forEach((venues, i) => {
      venues.sort((a, b) => a.name.localeCompare(b.name, "ko"));
      sites.push({
        // 첫 묶음은 주소 그대로 (기존 링크·선택 유지), 나뉜 곳은 #2, #3…
        key: i === 0 ? address : `${address}#${i + 1}`,
        address,
        lat: venues.reduce((a, v) => a + v.lat, 0) / venues.length,
        lng: venues.reduce((a, v) => a + v.lng, 0) / venues.length,
        venues,
      });
    });
  }
  return sites;
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
