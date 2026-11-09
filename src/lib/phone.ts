/** '010-1234-5678', '+82 10 1234 5678' → '821012345678' (DB·Supabase Auth 형식) */
export function normalizePhone(input: string): string {
  const d = input.replace(/[^0-9]/g, "");
  return d.startsWith("0") ? "82" + d.slice(1) : d;
}

/** 한국 휴대폰 번호인지 (010/011/016~019) */
export function isValidKoreanMobile(input: string): boolean {
  return /^821[016789][0-9]{7,8}$/.test(normalizePhone(input));
}

/** signInWithOtp 용 E.164: '+821012345678' */
export function toE164(input: string): string {
  return "+" + normalizePhone(input);
}

/** 화면 표시용: '821012345678' → '010-1234-5678' */
export function formatPhone(stored: string | null | undefined): string {
  if (!stored) return "";
  const local = "0" + normalizePhone(stored).replace(/^82/, "");
  if (local.length === 11) return `${local.slice(0, 3)}-${local.slice(3, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`;
  return local;
}

/** 문자 발송(SENS)용 국내 형식: '01012345678' */
export function toDomestic(stored: string): string {
  return "0" + normalizePhone(stored).replace(/^82/, "");
}

/**
 * 관리자 일괄 등록: 한 줄에 "이름, 전화번호" (쉼표·탭·공백 구분, 순서 무관)
 * 엑셀에서 두 열을 복사해 붙여넣어도 됨.
 */
export function parseMemberLines(text: string): { members: { name: string; phone: string }[]; errors: string[] } {
  const members: { name: string; phone: string }[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((line, i) => {
      const phoneMatch = line.match(/(\+?82[\s-]?|0)1[016789][\s-]?\d{3,4}[\s-]?\d{4}/);
      if (!phoneMatch) {
        if (i === 0 && /이름|name|전화|phone/i.test(line)) return; // 머리글 줄
        errors.push(`${i + 1}번째 줄: 휴대폰 번호를 찾을 수 없어요 — "${line}"`);
        return;
      }
      const phone = normalizePhone(phoneMatch[0]);
      const name = line.replace(phoneMatch[0], "").replace(/[,\t;]/g, " ").replace(/\s+/g, " ").trim();
      if (!name) {
        errors.push(`${i + 1}번째 줄: 이름이 없어요 — "${line}"`);
        return;
      }
      if (seen.has(phone)) {
        errors.push(`${i + 1}번째 줄: 위에 같은 번호가 있어요 — ${formatPhone(phone)}`);
        return;
      }
      seen.add(phone);
      members.push({ name, phone });
    });
  return { members, errors };
}
