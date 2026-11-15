"use client";

import { useMemo } from "react";
import { formatDate } from "@/lib/format";

/**
 * 로그인한 회원 화면 전체에 흐리게 깔리는 워터마크 (이름 · 닉네임 · 날짜)
 * 캡처해서 외부로 공유하면 누가 유출했는지 드러나도록. 클릭·스크롤은 통과.
 */
export default function Watermark({ text }: { text: string }) {
  const background = useMemo(() => {
    const label = `${text} · ${formatDate(new Date().toISOString())}`;
    const esc = label.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><text x="160" y="90" text-anchor="middle" dominant-baseline="middle" transform="rotate(-24 160 90)" font-family="sans-serif" font-size="15" font-weight="600" fill="#0f172a" fill-opacity="0.07">${esc}</text></svg>`;
    return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
  }, [text]);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[45] select-none print:z-[9999]"
      style={{ backgroundImage: background, backgroundRepeat: "repeat" }}
    />
  );
}
