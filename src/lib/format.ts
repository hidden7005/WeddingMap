export function formatMinutes(min: number | null | undefined): string | null {
  if (min == null) return null;
  if (min === 0) return "없음";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h}시간 ${m}분`;
  if (h) return `${h}시간`;
  return `${m}분`;
}

export function formatWon(won: number | null | undefined): string | null {
  if (won == null) return null;
  if (won === 0) return "무료";
  return `${won.toLocaleString("ko-KR")}원`;
}

/** "11:00:00" → "11:00" */
export function formatTime(t: string | null | undefined): string {
  return (t ?? "").slice(0, 5);
}

export function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

/** 26.11.26 (연도 두 자리) */
export function formatShortDate(iso: string | null | undefined): string | null {
  const full = formatDate(iso);
  return full ? full.slice(2) : null;
}

/** 확인일이 1년 넘게 지났는지 */
export function isStale(iso: string | null | undefined, now = new Date()): boolean {
  if (!iso) return false;
  const oneYearAgo = new Date(now);
  oneYearAgo.setFullYear(now.getFullYear() - 1);
  return new Date(iso) < oneYearAgo;
}

export function venueTitle(v: { name: string | null; branch_name: string | null }) {
  const name = v.name ?? "";
  const branch = v.branch_name?.trim();
  // 이름에 이미 지점 이름이 들어 있으면 (아펠가모 반포 + 반포점) 지점명은 붙이지 않음
  if (!branch || name.includes(branch.replace(/점$/, ""))) return name;
  return `${name} ${branch}`;
}

/** 초과 요금 표시: 10분당 1,000원 / 1시간당 6,000원 / 0원이면 '없음' */
export function formatOvertime(fee: number | null | undefined, unitMinutes: number | null | undefined): string | null {
  if (fee == null) return null;
  if (fee === 0) return "없음";
  const won = `${fee.toLocaleString("ko-KR")}원`;
  if (!unitMinutes) return won;
  return `${unitMinutes === 60 ? "1시간" : `${unitMinutes}분`}당 ${won}`;
}
