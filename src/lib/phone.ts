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
 * 예식장 전화번호 표시: 항상 하이픈 (02-542-1877, 031-123-4567, 1588-1234, 0507-1234-5678)
 * 이미 하이픈이 있거나 알 수 없는 형식이면 숫자만 보고 다시 나눔, 못 나누면 원문
 */
export function formatTel(raw: string | null | undefined): string {
  if (!raw) return "";
  const d = raw.replace(/\D/g, "");
  if (/^1[5-9]\d{6}$/.test(d)) return `${d.slice(0, 4)}-${d.slice(4)}`; // 1588-1234
  if (d.startsWith("02")) {
    if (d.length === 9) return `02-${d.slice(2, 5)}-${d.slice(5)}`;
    if (d.length === 10) return `02-${d.slice(2, 6)}-${d.slice(6)}`;
  }
  if (/^050\d/.test(d) && d.length === 12) return `${d.slice(0, 4)}-${d.slice(4, 8)}-${d.slice(8)}`; // 0507-1234-5678
  if (d.startsWith("0") && (d.length === 10 || d.length === 11)) {
    const rest = d.slice(3);
    return `${d.slice(0, 3)}-${rest.slice(0, rest.length - 4)}-${rest.slice(-4)}`;
  }
  return raw.trim();
}
