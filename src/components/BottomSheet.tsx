"use client";

import { useEffect, useRef, useState } from "react";

export type SheetSnap = "peek" | "full";

/**
 * 모바일 하단 시트. 손잡이를 위아래로 끌거나 탭해서 peek ↔ full 전환.
 * peek 높이는 onPeekHeight 로 부모에 알려 지도 포커스 보정에 사용.
 */
export default function BottomSheet({
  children,
  snap,
  onSnapChange,
  peekHeight,
}: {
  children: React.ReactNode;
  snap: SheetSnap;
  onSnapChange: (s: SheetSnap) => void;
  peekHeight: number;
}) {
  const [dragY, setDragY] = useState<number | null>(null);
  const start = useRef<{ y: number; h: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fullHeight = () => Math.round(window.innerHeight * 0.88);
  const baseHeight = () => (snap === "full" ? fullHeight() : peekHeight);

  useEffect(() => {
    if (snap === "peek") scrollRef.current?.scrollTo({ top: 0 });
  }, [snap]);

  const onPointerDown = (e: React.PointerEvent) => {
    start.current = { y: e.clientY, h: baseHeight() };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!start.current) return;
    const h = start.current.h + (start.current.y - e.clientY);
    setDragY(Math.max(80, Math.min(fullHeight(), h)));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!start.current) return;
    const moved = Math.abs(start.current.y - e.clientY);
    if (moved < 6) {
      onSnapChange(snap === "full" ? "peek" : "full"); // 탭
    } else if (dragY != null) {
      onSnapChange(dragY > (peekHeight + fullHeight()) / 2 ? "full" : "peek");
    }
    start.current = null;
    setDragY(null);
  };

  const height = dragY ?? (snap === "full" ? "88dvh" : peekHeight);

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-30 flex flex-col rounded-t-2xl bg-white shadow-[0_-4px_24px_rgba(0,0,0,0.15)]"
      style={{ height, transition: dragY == null ? "height 0.22s ease" : "none", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div
        className="flex shrink-0 cursor-grab touch-none justify-center py-2.5"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="button"
        aria-label={snap === "full" ? "시트 접기" : "시트 펼치기"}
      >
        <div className="h-1.5 w-10 rounded-full bg-slate-300" />
      </div>
      <div ref={scrollRef} className={`min-h-0 flex-1 overscroll-contain ${snap === "full" ? "overflow-y-auto" : "overflow-hidden"}`}>
        {children}
      </div>
    </div>
  );
}
