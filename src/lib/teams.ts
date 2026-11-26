/** 소속 → 아이디 앞부분 */
export const TEAMS = [
  { code: "AD", label: "언아더데이" },
  { code: "AM", label: "에이모먼트" },
  { code: "AF", label: "언아더데이 필름" },
] as const;

export type TeamCode = (typeof TEAMS)[number]["code"];

export function teamLabel(code: string | null | undefined): string | null {
  return TEAMS.find((t) => t.code === code)?.label ?? null;
}

/** 소속 + 이름 → 아이디 (AM + 홍순이 → AM_홍순이) */
export function suggestCode(team: string | null | undefined, name: string): string {
  const n = name.replace(/\s+/g, "");
  return team ? `${team}_${n}` : n;
}
