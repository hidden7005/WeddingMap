/** 검색창 최근 기록 (이 기기에만 저장). 저장이 막힌 브라우저에서도 오류 없이 동작 */
export type RecentItem = { type: "venue"; id: string; name: string } | { type: "query"; q: string };

const KEY = "wm_recent_v1";
const MAX = 10;

export function loadRecent(): RecentItem[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => x && (x.type === "venue" ? x.id && x.name : x.type === "query" && x.q)).slice(0, MAX) : [];
  } catch {
    return [];
  }
}

function save(list: RecentItem[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* 저장 불가: 무시 */
  }
}

const same = (a: RecentItem, b: RecentItem) => (a.type === "venue" && b.type === "venue" ? a.id === b.id : a.type === "query" && b.type === "query" && a.q === b.q);

export function addRecent(item: RecentItem): RecentItem[] {
  const list = [item, ...loadRecent().filter((x) => !same(x, item))].slice(0, MAX);
  save(list);
  return list;
}

export function removeRecent(item: RecentItem): RecentItem[] {
  const list = loadRecent().filter((x) => !same(x, item));
  save(list);
  return list;
}

export function clearRecent(): RecentItem[] {
  save([]);
  return [];
}
