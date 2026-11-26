export const MIN_PASSWORD = 8;

/** 비밀번호 확인: 문제가 있으면 안내 문구, 괜찮으면 null */
export function passwordProblem(pw: string, pw2: string): string | null {
  if (pw.length < MIN_PASSWORD) return `비밀번호는 ${MIN_PASSWORD}자 이상이어야 해요.`;
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return "비밀번호에 영문과 숫자를 함께 넣어주세요.";
  if (pw !== pw2) return "비밀번호와 비밀번호 확인이 서로 달라요.";
  return null;
}
