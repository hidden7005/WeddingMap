/* eslint-disable @next/next/no-img-element */

export const APP_NAME = "언아더데이 맵";

/**
 * ANOTHERDAY 로고 (검은 글씨, 투명 배경)
 *   full     ANOTHERDAY + PHOTO&FILM — 로그인 등 크게 보이는 곳
 *   wordmark ANOTHERDAY 만 — 헤더처럼 작게 들어가는 곳
 */
export default function Logo({ className = "h-7", variant = "full" }: { className?: string; variant?: "full" | "wordmark" }) {
  return (
    <img
      src={variant === "wordmark" ? "/logo-anotherday-wordmark.png" : "/logo-anotherday.png"}
      alt={variant === "wordmark" ? "ANOTHERDAY" : "ANOTHERDAY PHOTO&FILM"}
      className={`w-auto select-none ${className}`}
      draggable={false}
    />
  );
}
