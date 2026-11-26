/**
 * 예식 시간 입력 해석: "11:00 15:00 18:00", "11시 1시반", "1100, 1530", "11 12:30" 등
 * → 정렬·중복 제거된 "HH:MM" 목록. 해석 못 한 조각은 invalid 로.
 * 앞에 0 없이 쓴 1~8시는 오후로 봄 (예식은 낮~저녁): "1" → 13:00, "11" → 11:00, "09:30" → 09:30
 */
export function parseTimes(text: string): { times: string[]; invalid: string[] } {
  const out = new Set<string>();
  const invalid: string[] = [];
  const tokens = text
    .replace(/시\s*반/g, "시30분")
    .replace(/(오전|오후)\s+/g, "$1")
    .split(/[\s,，/·|]+|(?<=분)(?=\d)/)
    .map((t) => t.trim())
    .filter(Boolean);
  for (const tok of tokens) {
    const t = parseOne(tok);
    if (t) out.add(t);
    else invalid.push(tok);
  }
  return { times: [...out].sort(), invalid };
}

function parseOne(tok: string): string | null {
  let h: number, m: number;
  let pm = false;
  let s = tok.replace(/\s/g, "");
  if (/^오후/.test(s)) (pm = true), (s = s.slice(2));
  else if (/^오전/.test(s)) s = s.slice(2);
  let mt: RegExpMatchArray | null;
  if ((mt = s.match(/^(\d{1,2})[:：.](\d{2})$/))) (h = +mt[1]), (m = +mt[2]);
  else if ((mt = s.match(/^(\d{1,2})시(?:(\d{1,2})분?)?$/))) (h = +mt[1]), (m = mt[2] ? +mt[2] : 0);
  else if ((mt = s.match(/^(\d{3,4})$/))) (h = Math.floor(+mt[1] / 100)), (m = +mt[1] % 100);
  else if ((mt = s.match(/^(\d{1,2})$/))) (h = +mt[1]), (m = 0);
  else return null;
  if (pm && h < 12) h += 12;
  // 앞에 0 없이 쓴 1~8시는 오후로 봄 (예식은 낮~저녁). '09:30', '0930', '9시', '오전 8시'처럼 쓰면 그대로
  else if (!pm && h >= 1 && h <= 8 && !/^오전/.test(tok) && !/^0/.test(s)) h += 12;
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
