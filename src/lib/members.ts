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

/** 아이디 형식: 2~30자, 공백 없음 (예: AD_홍길동) */
export function isValidMemberCode(code: string): boolean {
  const c = code.trim();
  return c.length >= 2 && c.length <= 30 && !/\s/.test(c);
}

/** 아이디의 밑줄 뒤를 이름으로: AD_홍길동 → 홍길동 */
export function nameFromCode(code: string): string {
  const i = code.indexOf("_");
  return (i >= 0 ? code.slice(i + 1) : code).trim() || code.trim();
}

export type ParsedMember = { name: string; email: string; phone: string | null; code: string | null };

/**
 * 관리자 일괄 등록: 한 줄에 "아이디, 이메일" 또는 "이름, 이메일" (휴대폰 번호는 있으면 함께, 순서 무관)
 *   - 밑줄(_)이 들어간 칸은 아이디로 보고, 이름은 밑줄 뒤 (AD_홍길동 → 홍길동)
 *   - 엑셀에서 열을 복사해 붙여넣어도 됨 (쉼표·탭·공백 구분)
 */
export function parseMemberLines(text: string): {
  members: ParsedMember[];
  errors: string[];
} {
  const members: ParsedMember[] = [];
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
      const tokens = rest.replace(/[,\t;]/g, " ").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
      const codeToken = tokens.find((t) => t.includes("_") && isValidMemberCode(t)) ?? null;
      const others = tokens.filter((t) => t !== codeToken).join(" ");
      const name = others || (codeToken ? nameFromCode(codeToken) : "");
      if (!name) {
        errors.push(`${i + 1}번째 줄: 이름이 없어요 — "${line}"`);
        return;
      }
      if (seen.has(email)) {
        errors.push(`${i + 1}번째 줄: 위에 같은 이메일이 있어요 — ${email}`);
        return;
      }
      seen.add(email);
      members.push({ name, email, phone, code: codeToken });
    });
  return { members, errors };
}
