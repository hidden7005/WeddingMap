"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { groupSites, searchPins, toPins, type Site, type VenuePin } from "@/lib/sites";
import NaverMap, { type MapFocus } from "./NaverMap";
import VenueDetail from "./VenueDetail";
import BottomSheet, { sheetHalfHeight, type SheetSnap } from "./BottomSheet";
import { SearchInput, VenueList } from "./SearchBox";
import { useMediaQuery } from "./useMediaQuery";
import UserMenu from "./UserMenu";
import { useAuth } from "./AuthProvider";
import Link from "next/link";
import Logo, { APP_NAME } from "./Logo";
import VenueRequestPrompt from "./VenueRequest";
import { APP_VERSION } from "@/lib/version";
import AdminInbox from "./AdminInbox";

type Selection = { venueId: string | null; siteKey: string } | null;

export default function MapApp() {
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const auth = useAuth();
  const searchParams = useSearchParams();

  const [pins, setPins] = useState<VenuePin[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [snap, setSnap] = useState<SheetSnap>("half");
  const [sheetClosing, setSheetClosing] = useState(false);
  const [halfHeight, setHalfHeight] = useState(0);
  useEffect(() => {
    const update = () => setHalfHeight(sheetHalfHeight());
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  const initialVenue = useRef(searchParams.get("v"));

  // 예식장 목록 로드
  const load = useCallback(() => {
    setLoadError(null);
    supabase
      .from("venue_map")
      .select("id,name,branch_name,sido,sigungu,road_address,lat,lng,category")
      .range(0, 9999)
      .then(({ data, error }) => {
        if (error) setLoadError(error.message);
        else setPins(toPins(data as never));
      });
  }, []);
  useEffect(() => {
    if (auth.status !== "loading") load();
  }, [load, auth.status]);

  const sites = useMemo(() => (pins ? groupSites(pins) : []), [pins]);
  const siteByVenue = useMemo(() => {
    const m = new Map<string, Site>();
    for (const s of sites) for (const v of s.venues) m.set(v.id, s);
    return m;
  }, [sites]);
  const results = useMemo(() => (pins && query.trim() ? searchPins(pins, query) : []), [pins, query]);

  const selectedSite = selection ? sites.find((s) => s.key === selection.siteKey) ?? null : null;

  const syncUrl = (venueId: string | null) => {
    const url = new URL(window.location.href);
    if (venueId) url.searchParams.set("v", venueId);
    else url.searchParams.delete("v");
    window.history.replaceState(null, "", url);
  };

  const selectVenue = useCallback(
    (id: string, opts: { pan?: boolean } = {}) => {
      const site = siteByVenue.get(id);
      if (!site) return;
      setSelection((prev) => {
        if (!prev) setSnap("half"); // 처음 열 때만 절반으로, 열려 있으면 크기 유지
        return { venueId: id, siteKey: site.key };
      });
      setSheetClosing(false);
      syncUrl(id);
      if (opts.pan) setFocus({ lat: site.lat, lng: site.lng, nonce: Date.now() });
    },
    [siteByVenue],
  );

  const selectSite = useCallback(
    (site: Site) => {
      if (site.venues.length === 1) return selectVenue(site.venues[0].id);
      setSelection((prev) => {
        if (!prev) setSnap("half");
        return { venueId: null, siteKey: site.key };
      });
      setSheetClosing(false);
      syncUrl(null);
    },
    [selectVenue],
  );

  const clearSelection = useCallback(() => {
    setSelection(null);
    setSheetClosing(false);
    syncUrl(null);
  }, []);
  // 모바일은 시트가 내려가는 애니메이션 뒤에 닫음
  const requestClose = useCallback(() => {
    if (isDesktop) clearSelection();
    else setSheetClosing(true);
  }, [isDesktop, clearSelection]);

  // ?v=<id> 로 들어온 경우 해당 예식장 열기
  useEffect(() => {
    if (pins && initialVenue.current) {
      selectVenue(initialVenue.current, { pan: true });
      initialVenue.current = null;
    }
  }, [pins, selectVenue]);

  const pickFromSearch = (v: VenuePin) => {
    setSearchOpen(false);
    (document.activeElement as HTMLElement | null)?.blur();
    selectVenue(v.id, { pan: true });
  };

  /* ── 패널/시트 내용 ── */
  const panelContent = selectedSite ? (
    selection?.venueId ? (
      <VenueDetail
        key={selection.venueId}
        venueId={selection.venueId}
        siblings={selectedSite.venues}
        onSelectVenue={(id) => selectVenue(id)}
        onClose={requestClose}
      />
    ) : (
      <div>
        <div className="flex items-start justify-between px-5 pt-1 pb-2">
          <div>
            <p className="text-xs font-semibold text-slate-500">같은 주소 {selectedSite.venues.length}곳</p>
            <p className="mt-0.5 text-sm text-slate-700">{selectedSite.address}</p>
          </div>
          <button onClick={requestClose} aria-label="닫기" className="-mr-2 rounded-full p-2 text-slate-400 hover:bg-slate-100">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <VenueList items={selectedSite.venues} onSelect={(v) => selectVenue(v.id)} />
      </div>
    )
  ) : null;

  const map = (
    <NaverMap
      sites={sites}
      selectedSiteKey={selection?.siteKey ?? null}
      onSelectSite={selectSite}
      onMapClick={() => {
        setSearchOpen(false);
        if (!isDesktop && selection) requestClose(); // 간짜장처럼 지도를 누르면 정보 창 닫힘
      }}
      focus={focus}
      bottomInset={!isDesktop && selection ? halfHeight : 0}
      showZoomControl={isDesktop}
      autoLocate={!searchParams.get("v")}
      locateClassName={isDesktop ? "right-4 bottom-6" : "right-3 bottom-6"}
    />
  );

  const status = loadError ? (
    <div className="rounded-xl bg-white p-3 text-sm shadow">
      예식장 목록을 불러오지 못했어요.{" "}
      <button onClick={load} className="font-semibold underline">
        다시 시도
      </button>
    </div>
  ) : !pins ? (
    <div className="rounded-full bg-white/90 px-3 py-1.5 text-xs text-slate-600 shadow">예식장 불러오는 중…</div>
  ) : null;

  if (auth.status === "loading" || auth.requireLogin === null) {
    return <div className="flex h-dvh items-center justify-center text-sm text-slate-400">불러오는 중…</div>;
  }
  if (auth.requireLogin && auth.status !== "member") return <LoginGate />;

  /* ── PC: 왼쪽 패널 + 지도 ── */
  if (isDesktop) {
    return (
      <div className="flex h-dvh">
        <aside className="flex w-[400px] shrink-0 flex-col border-r border-slate-200 bg-white">
          <div className="border-b border-slate-100 p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h1>
                <button onClick={refreshHome} aria-label="언아더데이 맵 처음 화면으로" className="flex items-center gap-2">
                  <Logo variant="wordmark" className="h-[13px]" />
                  <span className="h-5 w-px bg-slate-300" aria-hidden />
                  <span className="text-sm font-semibold whitespace-nowrap text-slate-600">{APP_NAME}</span>
                </button>
              </h1>
              <UserMenu />
            </div>
            <SearchInput value={query} onChange={(v) => (setQuery(v), setSearchOpen(true))} onFocus={() => setSearchOpen(true)} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {query.trim() && (searchOpen || !panelContent) ? (
              <VenueList items={results} onSelect={pickFromSearch} empty={<VenueRequestPrompt key={query.trim()} query={query} />} />
            ) : panelContent ? (
              <div className="pt-3">
                {query.trim() && (
                  <button onClick={() => setSearchOpen(true)} className="mb-2 px-5 text-sm text-slate-500 hover:text-slate-900">
                    ‹ ‘{query.trim()}’ 검색 결과 {results.length}건
                  </button>
                )}
                {panelContent}
              </div>
            ) : (
              <Intro count={pins?.length} />
            )}
          </div>
        </aside>
        <main className="relative min-w-0 flex-1">
          {map}
          <div className="pointer-events-none absolute top-4 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2 [&>*]:pointer-events-auto">
            {status}
            <AdminInbox onOpenVenue={(id) => selectVenue(id, { pan: true })} onVenueDeleted={() => (clearSelection(), load())} />
          </div>
          <Legend className="absolute right-[4.5rem] bottom-6" />
          <VersionBadge className="absolute bottom-11 left-3" />
        </main>
      </div>
    );
  }

  /* ── 모바일: 전체 지도 + 상단 검색 + 하단 시트 ── */
  return (
    <div className="relative h-dvh overflow-hidden">
      {map}

      <div className="absolute inset-x-0 top-0 z-20 p-3" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
        <div className="flex gap-2">
          {/* 언아더데이 로고: 누르면 처음 화면으로 새로고침 */}
          <button
            onClick={refreshHome}
            aria-label="언아더데이 맵 처음 화면으로"
            className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-a.png" alt="ANOTHERDAY" className="h-6 w-6" draggable={false} />
          </button>
          <SearchInput className="min-w-0 flex-1" value={query} onChange={(v) => (setQuery(v), setSearchOpen(true))} onFocus={() => setSearchOpen(true)} />
          <UserMenu compact />
        </div>
        {searchOpen && query.trim() && (
          <div className="mt-2 max-h-[60dvh] overflow-y-auto rounded-xl bg-white shadow-lg">
            <VenueList items={results} onSelect={pickFromSearch} empty={<VenueRequestPrompt key={query.trim()} query={query} />} />
          </div>
        )}
        <div className="mt-2 flex flex-col items-center gap-2">
          {status}
          <AdminInbox onOpenVenue={(id) => selectVenue(id, { pan: true })} onVenueDeleted={() => (clearSelection(), load())} />
        </div>
      </div>

      {!selection && <Legend className="absolute bottom-6 left-1/2 z-10 -translate-x-1/2" />}
      <VersionBadge className="absolute bottom-11 left-3 z-10" />

      {panelContent && (
        <BottomSheet snap={snap} onSnapChange={setSnap} closing={sheetClosing} onClosed={clearSelection}>
          {panelContent}
        </BottomSheet>
      )}
    </div>
  );
}

function LoginGate() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-6 text-center">
      <div>
        <h1 className="flex flex-col items-center gap-2">
          <Logo className="h-10" />
          <span className="text-base font-semibold text-slate-600">{APP_NAME}</span>
        </h1>
        <p className="mt-2 text-sm text-slate-500">회원만 이용할 수 있어요.</p>
        <Link href="/login" className="mt-6 inline-block rounded-xl bg-slate-900 px-6 py-3 font-semibold text-white">
          로그인
        </Link>
      </div>
    </main>
  );
}

function Legend({ className = "" }: { className?: string }) {
  const Item = ({ color, text }: { color: string; text: string }) => (
    <span className="flex items-center gap-1">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      {text}
    </span>
  );
  return (
    <div className={`flex h-11 items-center gap-3 rounded-full border border-slate-200 bg-white/95 px-4 text-xs text-slate-600 shadow-sm ${className}`}>
      <Item color="var(--color-brand)" text="웨딩홀" />
      <Item color="var(--color-hotel)" text="호텔" />
      <Item color="var(--color-etc)" text="기타" />
    </div>
  );
}

function Intro({ count }: { count?: number }) {
  return (
    <div className="p-5 text-sm text-slate-600">
      <p className="text-2xl font-extrabold text-slate-900">{count != null ? `${count.toLocaleString()}곳` : "…"}</p>
      <p className="mt-1">전국 예식장의 촬영 규정, 홀 시간표, 주차를 확인하세요.</p>
      <ul className="mt-5 space-y-2 text-slate-500">
        <li>🔍 위 검색창에 예식장 이름이나 지역을 입력하거나</li>
        <li>🗺️ 지도에서 마커를 눌러 상세 정보를 볼 수 있어요.</li>
        <li>🔢 숫자가 적힌 핀은 같은 건물에 있는 예식장 수예요.</li>
      </ul>
    </div>
  );
}

/** 간짜장처럼 지도 왼쪽 아래 작은 버전 표시 (네이버 로고 바로 위) */
function VersionBadge({ className = "" }: { className?: string }) {
  return (
    <span className={`pointer-events-none rounded-md border border-slate-200 bg-white/85 px-2 py-0.5 text-[11px] font-semibold text-slate-500 ${className}`}>
      v{APP_VERSION}
    </span>
  );
}

/** 로고를 누르면 처음 화면으로 새로고침 (선택한 예식장·검색어 초기화) */
function refreshHome() {
  window.location.assign("/");
}
