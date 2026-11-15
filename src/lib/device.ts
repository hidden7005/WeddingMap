/** User-Agent → "iPhone · 카카오톡" 같은 짧은 기기 요약 (관리자 접속 기록용) */
export function deviceLabel(ua: string): string {
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua) || (/Macintosh/.test(ua) && /Mobile/.test(ua))
      ? "iPad"
      : /Android/.test(ua)
        ? /Mobile/.test(ua)
          ? "Android"
          : "Android 태블릿"
        : /Windows/.test(ua)
          ? "Windows"
          : /Macintosh|Mac OS X/.test(ua)
            ? "Mac"
            : /Linux/.test(ua)
              ? "Linux"
              : "기타";
  const browser = /KAKAOTALK/i.test(ua)
    ? "카카오톡"
    : /NAVER\(inapp/i.test(ua)
      ? "네이버앱"
      : /SamsungBrowser/.test(ua)
        ? "삼성인터넷"
        : /Edg\//.test(ua)
          ? "Edge"
          : /Whale\//.test(ua)
            ? "Whale"
            : /CriOS|Chrome\//.test(ua)
              ? "Chrome"
              : /FxiOS|Firefox\//.test(ua)
                ? "Firefox"
                : /Safari\//.test(ua)
                  ? "Safari"
                  : "브라우저";
  return `${os} · ${browser}`;
}
