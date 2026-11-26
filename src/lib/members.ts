import { normalizePhone } from "./phone";

/** 간단한 이메일 형식 확인 (DB 규칙과 같은 기준) */
export function isValidEmail(input: string): boolean {
  const e = input.trim().toLowerCase();
  const at = e.indexOf("@");
  if (at < 1 || e.length > 254 || e.includes(" ")) return false;
  const domain = e.slice(at + 1);
  return domain.indexOf(".") > 0 && !domain.endsWith(".");
}

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

const EMAIL_IN_LINE = /[^\s,;<>()"']+@[^\s,;<>()"']+\.[^\s,;<>()"']+/;
const PHONE_IN_LINE = /(\+?82[\s-]?|0)1[016789][\s-]?\d{3,4}[\s-]?\d{4}/;

/**
 * 관리자 일괄 등록: 한 줄에 "이름, 이메일" (휴대폰 번호는 있으면 함께 저장, 순서 무관)
 * 엑셀에서 열을 복사해 붙여넣어도 됨 (쉼표·탭·공백 구분)
 */
export function parseMemberLines(text: string): {
  members: { name: string; email: string; phone: string | null }[];
  errors: string[];
} {
  const members: { name: string; email: string; phone: string | null }[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((line, i) => {
      const emailMatch = line.match(EMAIL_IN_LINE);
      if (!emailMatch) {
        if (i === 0 && /이름|name|이메일|email|메일/i.test(line)) return; // 머리글 줄
        errors.push(`${i + 1}번째 줄: 이메일을 찾을 수 없어요 — "${line}"`);
        return;
      }
      const email = normalizeEmail(emailMatch[0]);
      if (!isValidEmail(email)) {
        errors.push(`${i + 1}번째 줄: 이메일 형식이 이상해요 — ${email}`);
        return;
      }
      let rest = line.replace(emailMatch[0], " ");
      const phoneMatch = rest.match(PHONE_IN_LINE);
      const phone = phoneMatch ? normalizePhone(phoneMatch[0]) : null;
      if (phoneMatch) rest = rest.replace(phoneMatch[0], " ");
      const name = rest.replace(/[,\t;]/g, " ").replace(/\s+/g, " ").trim();
      if (!name) {
        errors.push(`${i + 1}번째 줄: 이름이 없어요 — "${line}"`);
        return;
      }
      if (seen.has(email)) {
        errors.push(`${i + 1}번째 줄: 위에 같은 이메일이 있어요 — ${email}`);
        return;
      }
      seen.add(email);
      members.push({ name, email, phone });
    });
  return { members, errors };
}
