"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** 간짜장 맵과 같은 2단 하단 시트: 절반(52%) ↔ 전체 화면, 아래로 끌면 닫힘 */
export type SheetSnap = "half" | "full";

const HALF_RATIO = 0.52;
const MIN_HEIGHT = 60;

function viewportHeight() {
  return Math.max(160, Math.round(window.visualViewport?.height || window.innerHeight));
}
export function sheetHalfHeight() {
  return Math.round(viewportHeight() * HALF_RATIO);
}

export default function BottomSheet({
  children,
  snap,
  onSnapChange,
  closing = false,
  onClosed,
}: {
  children: React.ReactNode;
  snap: SheetSnap;
  onSnapChange: (s: SheetSnap) => void;
  /** true 가 되면 아래로 내려가는 애니메이션 후 onClosed 호출 */
  closing?: boolean;
  onClosed: () => void;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [vh, setVh] = useState(0);
  const [shown, setShown] = useState(false); // 처음 열릴 때 아래에서 올라오게
  const [dragHeight, setDragHeight] = useState<number | null>(null); // 손잡이로 끄는 중 높이
  const [dragOffset, setDragOffset] = useState(0); // 본문으로 끌어내리는 중 이동 거리
  const [leaving, setLeaving] = useState(false);
  const handleDrag = useRef<{ id: number; y: number; h: number; moved: boolean } | null>(null);

  const onClosedRef = useRef(onClosed);
  const onSnapRef = useRef(onSnapChange);
  const snapRef = useRef(snap);
  useEffect(() => {
    onClosedRef.current = onClosed;
    onSnapRef.current = onSnapChange;
    snapRef.current = snap;
  });

  useLayoutEffect(() => {
    const update = () => setVh(viewportHeight());
    update();
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
    return () => {
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
      cancelAnimationFrame(raf);
    };
  }, []);

  const half = Math.round(vh * HALF_RATIO);
  const full = vh;

  const close = () => {
    if (leaving) return;
    setLeaving(true);
    setTimeout(() => onClosedRef.current(), 260);
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (closing) closeRef.current();
  }, [closing]);

  // 절반으로 줄일 때는 내용 맨 위로
  useEffect(() => {
    if (snap === "half") scrollRef.current?.scrollTo({ top: 0 });
  }, [snap]);

  /* ── 손잡이 끌기 (마우스·터치 공통) ── */
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    handleDrag.current = { id: e.pointerId, y: e.clientY, h: sheetRef.current!.getBoundingClientRect().height, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = handleDrag.current;
    if (!d || e.pointerId !== d.id) return;
    const dy = d.y - e.clientY;
    if (Math.abs(dy) > 4) d.moved = true;
    setDragHeight(Math.round(Math.max(MIN_HEIGHT, Math.min(full, d.h + dy))));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = handleDrag.current;
    if (!d || e.pointerId !== d.id) return;
    handleDrag.current = null;
    const current = sheetRef.current!.getBoundingClientRect().height;
    setDragHeight(null);
    if (!d.moved) {
      onSnapRef.current(snapRef.current === "full" ? "half" : "full"); // 탭하면 전환
      return;
    }
    const dy = e.clientY - d.y; // 아래로 끌면 +
    // 닫기: 절반 높이의 72% 아래까지 끌었거나, 절반 상태에서 55px 이상 내림
    // 전체 화면에서 내리면 먼저 절반으로 (전체 → 절반 → 닫기, 2단계)
    if (current < half * 0.72) return close();
    if (d.h <= half + 40 && dy > 55) return close();
    if (dy > 60) return onSnapRef.current("half");
    if (dy < -60) return onSnapRef.current("full");
    onSnapRef.current(Math.abs(current - half) < Math.abs(current - full) ? "half" : "full");
  };

  /* ── 본문 끌기: 내용이 맨 위일 때 아래로 끌면 시트가 따라 내려오고, 충분히 내리면 닫힘 ── */
  useEffect(() => {
    const sh = sheetRef.current;
    const sc = scrollRef.current;
    if (!sh || !sc) return;
    let t: { x: number; y: number; top: boolean; dragging: boolean; dy: number } | null = null;
    const atTop = () => sc.scrollTop <= 0;
    const blocked = (el: EventTarget | null) =>
      el instanceof Element && !!el.closest("input, textarea, select, [contenteditable], [data-sheet-handle], [data-no-sheet-drag]");

    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1 || blocked(e.target)) {
        t = null;
        return;
      }
      t = { x: e.touches[0].clientX, y: e.touches[0].clientY, top: atTop(), dragging: false, dy: 0 };
    };
    const move = (e: TouchEvent) => {
      if (!t) return;
      const dx = e.touches[0].clientX - t.x;
      const dy = e.touches[0].clientY - t.y;
      if (!t.dragging) {
        // 절반 상태에서 위로 밀면 전체 화면으로
        if (snapRef.current === "half" && dy < -24 && Math.abs(dy) > Math.abs(dx)) {
          onSnapRef.current("full");
          t = null;
          return;
        }
        if (!t.top || !atTop() || dy < 0 || Math.abs(dx) > Math.abs(dy) + 4) {
          if (Math.abs(dy) > 8 || Math.abs(dx) > 8) t = null;
          return;
        }
        if (e.cancelable) e.preventDefault(); // 브라우저 스크롤·당겨서 새로고침 막기
        if (dy < 8) return;
        t.dragging = true;
        t.y = e.touches[0].clientY;
      }
      if (e.cancelable) e.preventDefault();
      t.dy = Math.max(0, e.touches[0].clientY - t.y);
      setDragOffset(Math.round(t.dy));
    };
    const end = () => {
      if (!t) return;
      const was = t;
      t = null;
      if (!was.dragging) return;
      const height = sh.getBoundingClientRect().height;
      // 전체 화면에서 조금 내리면 절반으로, 많이 내리면 닫기
      if (snapRef.current === "full" && was.dy > 70 && was.dy < height * 0.45) {
        setDragOffset(0);
        onSnapRef.current("half");
        return;
      }
      if (was.dy > Math.min(140, height * 0.25)) {
        closeRef.current();
        return;
      }
      setDragOffset(0);
    };
    const cancel = () => {
      t = null;
      setDragOffset(0);
    };
    sh.addEventListener("touchstart", start, { passive: true });
    sh.addEventListener("touchmove", move, { passive: false });
    sh.addEventListener("touchend", end);
    sh.addEventListener("touchcancel", cancel);
    return () => {
      sh.removeEventListener("touchstart", start);
      sh.removeEventListener("touchmove", move);
      sh.removeEventListener("touchend", end);
      sh.removeEventListener("touchcancel", cancel);
    };
  }, []);

  const dragging = dragHeight != null || (dragOffset > 0 && !leaving);
  const height = dragHeight ?? (snap === "full" ? full : half);
  const offset = !shown || leaving ? "105%" : `${dragOffset}px`;
  const expanded = snap === "full" && dragHeight == null;

  return (
    <div
      ref={sheetRef}
      className={`fixed inset-x-0 bottom-0 z-30 flex flex-col overflow-hidden bg-white shadow-[0_-8px_32px_rgba(0,0,0,0.12)] ${
        expanded ? "rounded-none" : "rounded-t-3xl"
      }`}
      style={{
        height: vh ? height : "52dvh",
        // 0일 때는 transform 을 없애야 안쪽의 fixed 요소(사진 크게 보기)가 화면 기준으로 뜸
        transform: offset === "0px" ? "none" : `translateY(${offset})`,
        transition: dragging ? "none" : "transform .28s cubic-bezier(.16,1,.3,1), height .24s cubic-bezier(.2,.7,.2,1)",
      }}
    >
      <div
        data-sheet-handle
        className="flex h-9 shrink-0 cursor-grab touch-none items-center justify-center"
        style={expanded ? { paddingTop: "env(safe-area-inset-top)", height: "calc(2.25rem + env(safe-area-inset-top))" } : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => onSnapChange(snap === "full" ? "half" : "full")}
        role="slider"
        aria-label="정보 창 크기"
        aria-valuenow={snap === "full" ? 100 : 52}
        aria-valuetext={snap === "full" ? "전체 화면" : "절반 화면"}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") onSnapChange("full");
          if (e.key === "ArrowDown") (snap === "half" ? close() : onSnapChange("half"));
          if (e.key === "Escape") close();
        }}
      >
        <div className="h-[5px] w-10 rounded-full bg-slate-300" />
      </div>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 touch-pan-y overflow-x-hidden overflow-y-auto overscroll-contain"
        style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}
      >
        {children}
      </div>
    </div>
  );
}
