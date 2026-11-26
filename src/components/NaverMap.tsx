"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
import { gridCluster, type Site } from "@/lib/sites";

const CLIENT_ID = process.env.NEXT_PUBLIC_NAVER_MAP_CLIENT_ID;
/** 현재 위치를 못 받으면 서울 중심(시청)에서 시작 */
const SEOUL_CENTER = { lat: 37.5665, lng: 126.978 };
const START_ZOOM = 12;
const MY_LOCATION_ZOOM = 14;
/** 이 줌 이상이면 클러스터를 풀고 개별 마커 */
const UNCLUSTER_ZOOM = 14;
/** 이 줌 이상이면 마커 아래 이름 표시 */
const LABEL_ZOOM = 15;
const CELL_SIZE = 64;

export type MapFocus = { lat: number; lng: number; zoom?: number; nonce: number };

type Props = {
  sites: Site[];
  selectedSiteKey: string | null;
  onSelectSite: (site: Site) => void;
  onMapClick?: () => void;
  focus: MapFocus | null;
  /** 하단 시트에 가려지는 높이(px). 포커스 시 마커가 시트 위로 오도록 보정 */
  bottomInset?: number;
  showZoomControl?: boolean;
  /** 처음 열 때 현재 위치로 이동 (예식장 링크로 들어온 경우엔 false) */
  autoLocate?: boolean;
  /** 현재 위치 버튼 위치 (Tailwind 클래스) */
  locateClassName?: string;
};

declare global {
  interface Window {
    navermap_authFailure?: () => void;
  }
}

function pinColor(category: string) {
  if (category === "hotel_4" || category === "hotel_5") return "var(--color-hotel)";
  if (category === "auxiliary") return "var(--color-etc)";
  return "var(--color-brand)";
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export default function NaverMap({
  sites,
  selectedSiteKey,
  onSelectSite,
  onMapClick,
  focus,
  bottomInset = 0,
  showZoomControl = false,
  autoLocate = true,
  locateClassName = "right-3 bottom-6",
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<naver.maps.Map | null>(null);
  const markersRef = useRef<naver.maps.Marker[]>([]);
  const [scriptReady, setScriptReady] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [authError, setAuthError] = useState(false);
  const [idleTick, setIdleTick] = useState(0);
  const [origin, setOrigin] = useState("");
  const [locating, setLocating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const meMarkerRef = useRef<naver.maps.Marker | null>(null);
  /** 사용자가 지도를 직접 움직였거나 마커를 눌렀는지 (그러면 첫 위치 이동을 안 함) */
  const userMovedRef = useRef(false);

  // 최신 콜백을 ref로 들고 있어 마커 리스너를 매번 다시 달지 않아도 되게
  const onSelectRef = useRef(onSelectSite);
  const onMapClickRef = useRef(onMapClick);
  useEffect(() => {
    onSelectRef.current = onSelectSite;
    onMapClickRef.current = onMapClick;
  });

  useEffect(() => {
    window.navermap_authFailure = () => setAuthError(true);
    setOrigin(window.location.origin);
    // 다른 페이지에서 돌아온 경우 스크립트가 이미 로드돼 있을 수 있음
    if (window.naver?.maps) setScriptReady(true);
  }, []);

  // 지도 생성
  useEffect(() => {
    if (!scriptReady || !containerRef.current || mapRef.current) return;
    const map = new naver.maps.Map(containerRef.current, {
      center: new naver.maps.LatLng(SEOUL_CENTER.lat, SEOUL_CENTER.lng),
      zoom: START_ZOOM,
      minZoom: 6,
      zoomControl: showZoomControl,
      zoomControlOptions: { position: naver.maps.Position.RIGHT_CENTER },
      scaleControl: false,
      mapDataControl: false,
      logoControlOptions: { position: naver.maps.Position.BOTTOM_LEFT },
    });
    mapRef.current = map;
    const idle = naver.maps.Event.addListener(map, "idle", () => setIdleTick((t) => t + 1));
    const click = naver.maps.Event.addListener(map, "click", () => onMapClickRef.current?.());
    const drag = naver.maps.Event.addListener(map, "dragstart", () => (userMovedRef.current = true));
    setMapReady(true);
    return () => {
      naver.maps.Event.removeListener([idle, click, drag]);
    };
  }, [scriptReady, showZoomControl]);

  // 마커 그리기: 화면 안의 지점만, 줌에 따라 클러스터
  const draw = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const m of markersRef.current) m.setMap(null);
    markersRef.current = [];

    const zoom = map.getZoom();
    const bounds = map.getBounds() as naver.maps.LatLngBounds;
    const projection = map.getProjection();
    const visible = sites.filter((s) => bounds.hasLatLng(new naver.maps.LatLng(s.lat, s.lng)));

    // 거의 같은 위치의 핀은 옆으로 살짝 벌려서 모두 보이게 (예: 같은 단지 A동·B동)
    const placed: { x: number; y: number }[] = [];
    const spreadOffset = (site: Site) => {
      const p = projection.fromCoordToOffset(new naver.maps.LatLng(site.lat, site.lng));
      let dx = 0;
      while (placed.some((q) => Math.abs(q.x - (p.x + dx)) < 26 && Math.abs(q.y - p.y) < 26)) dx += 30;
      // 이웃 핀과 이름표가 겹치지 않게: 근처에 핀이 있으면 이름표를 위/아래 번갈아
      const near = placed.filter((q) => Math.abs(q.x - (p.x + dx)) < 120 && Math.abs(q.y - p.y) < 40).length;
      placed.push({ x: p.x + dx, y: p.y });
      return { dx, labelAbove: near % 2 === 1 };
    };

    const addSiteMarker = (site: Site) => {
      const { dx, labelAbove } = spreadOffset(site);
      const first = site.venues[0];
      const selected = site.key === selectedSiteKey;
      const count = site.venues.length;
      const label =
        zoom >= LABEL_ZOOM || selected
          ? `<div class="wm-pin-label${labelAbove ? " wm-pin-label-above" : ""}">${escapeHtml(first.name)}${count > 1 ? ` 외 ${count - 1}` : ""}</div>`
          : "";
      const marker = new naver.maps.Marker({
        map,
        position: new naver.maps.LatLng(site.lat, site.lng),
        zIndex: selected ? 1000 : 100,
        title: site.venues.map((v) => v.name).join(", "),
        icon: {
          content: `<div class="wm-pin" data-selected="${selected}" style="--pin-color:${pinColor(first.category)}"><span>${count > 1 ? count : ""}</span></div>${label}`,
          anchor: new naver.maps.Point(14 - dx, 32),
        },
      });
      naver.maps.Event.addListener(marker, "click", () => {
        userMovedRef.current = true;
        onSelectRef.current(site);
      });
      markersRef.current.push(marker);
    };

    if (zoom >= UNCLUSTER_ZOOM) {
      visible.forEach(addSiteMarker);
      return;
    }

    const points = visible.map((s) => {
      const p = projection.fromCoordToOffset(new naver.maps.LatLng(s.lat, s.lng));
      return { x: p.x, y: p.y, item: s };
    });
    for (const c of gridCluster(points, CELL_SIZE)) {
      if (c.items.length === 1 || c.items.some((s) => s.key === selectedSiteKey)) {
        // 선택된 지점은 항상 따로 보여줌
        c.items.forEach(addSiteMarker);
        continue;
      }
      const venueCount = c.items.reduce((a, s) => a + s.venues.length, 0);
      const size = venueCount < 10 ? 36 : venueCount < 50 ? 44 : 52;
      const lat = c.items.reduce((a, s) => a + s.lat, 0) / c.items.length;
      const lng = c.items.reduce((a, s) => a + s.lng, 0) / c.items.length;
      const marker = new naver.maps.Marker({
        map,
        position: new naver.maps.LatLng(lat, lng),
        zIndex: 50,
        icon: {
          content: `<div class="wm-cluster" style="width:${size}px;height:${size}px">${venueCount}</div>`,
          anchor: new naver.maps.Point(size / 2, size / 2),
        },
      });
      naver.maps.Event.addListener(marker, "click", () => {
        userMovedRef.current = true;
        const b = new naver.maps.LatLngBounds(
          new naver.maps.LatLng(Math.min(...c.items.map((s) => s.lat)), Math.min(...c.items.map((s) => s.lng))),
          new naver.maps.LatLng(Math.max(...c.items.map((s) => s.lat)), Math.max(...c.items.map((s) => s.lng))),
        );
        map.fitBounds(b, { top: 80, right: 40, bottom: 40 + bottomInset, left: 40 });
        // 모두 거의 같은 위치면 fitBounds 가 과하게 확대하지 않도록
        if (map.getZoom() > 16) map.setZoom(16);
      });
      markersRef.current.push(marker);
    }
  }, [sites, selectedSiteKey, bottomInset]);

  useEffect(() => {
    if (mapReady) draw();
  }, [mapReady, idleTick, draw]);

  const showToast = (msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  };

  /** 내 위치 점 표시 (move 면 그 위치로 지도 이동) */
  const showMe = useCallback((c: GeolocationCoordinates, move: boolean, zoom = 15) => {
    const map = mapRef.current;
    if (!map) return;
    const p = new naver.maps.LatLng(c.latitude, c.longitude);
    if (!meMarkerRef.current) {
      meMarkerRef.current = new naver.maps.Marker({
        map,
        position: p,
        zIndex: 1100,
        clickable: false,
        icon: { content: '<div class="wm-me" aria-label="내 위치"></div>', anchor: new naver.maps.Point(11, 11) },
      });
    } else meMarkerRef.current.setPosition(p);
    if (move) {
      if (map.getZoom() < zoom) map.setZoom(zoom, false);
      map.setCenter(p);
      if (bottomInset) map.panBy(new naver.maps.Point(0, bottomInset / 2));
    }
  }, [bottomInset]);

  // 버튼을 누를 때 브라우저가 위치 권한을 물어봄 (간짜장과 같은 방식)
  const locateMe = () => {
    if (locating) return;
    if (!navigator.geolocation) return showToast("이 브라우저에서는 위치 확인을 지원하지 않아요");
    if (!window.isSecureContext) return showToast("현재 위치는 HTTPS 주소에서만 쓸 수 있어요");
    setLocating(true);
    showToast("현재 위치를 확인하고 있어요");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        showMe(pos.coords, true);
        showToast("현재 위치로 이동했어요");
      },
      (err) => {
        setLocating(false);
        const messages: Record<number, string> = {
          1: "위치 접근이 차단돼 있어요. 브라우저(사이트) 설정에서 위치 권한을 허용해 주세요",
          2: "현재 위치를 확인할 수 없어요. GPS·위치 서비스를 켜 주세요",
          3: "위치 확인 시간이 초과됐어요. 다시 눌러 주세요",
        };
        showToast(messages[err.code] ?? "위치를 확인하지 못했어요");
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  };

  // 처음 열 때 현재 위치로 (첫 방문이면 브라우저가 위치 권한을 물어봄). 못 받으면 서울 중심 그대로.
  // 위치를 받기 전에 사용자가 검색·예식장 선택으로 지도를 옮겼으면 이동하지 않고 파란 점만 표시
  const focusRef = useRef(focus);
  focusRef.current = focus;
  useEffect(() => {
    if (!mapReady || !navigator.geolocation || !window.isSecureContext) return;
    const startFocus = focusRef.current;
    navigator.geolocation.getCurrentPosition(
      (pos) => showMe(pos.coords, autoLocate && focusRef.current === startFocus && !userMovedRef.current, MY_LOCATION_ZOOM),
      () => {},
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady]);

  // 검색·URL 등으로 특정 위치에 포커스
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !focus) return;
    map.setZoom(focus.zoom ?? Math.max(map.getZoom(), 16), false);
    map.setCenter(new naver.maps.LatLng(focus.lat, focus.lng));
    if (bottomInset) map.panBy(new naver.maps.Point(0, bottomInset / 2));
    // focus 객체가 바뀔 때만 이동 (nonce 로 같은 위치 재포커스 허용)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, focus]);

  return (
    <div className="relative isolate h-full w-full bg-slate-100">
      {CLIENT_ID && (
        <Script
          src={`https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${CLIENT_ID}&ncpClientId=${CLIENT_ID}`}
          strategy="afterInteractive"
          onReady={() => setScriptReady(true)}
          onError={() => setAuthError(true)}
        />
      )}
      <div ref={containerRef} className="relative z-0 h-full w-full" />
      {mapReady && (
        <button
          type="button"
          onClick={locateMe}
          disabled={locating}
          aria-label="현재 위치로 이동"
          title="현재 위치로 이동"
          aria-busy={locating}
          className={`absolute z-10 flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-900 shadow-sm transition active:scale-95 disabled:cursor-wait disabled:opacity-60 ${locateClassName}`}
        >
          <svg viewBox="0 0 24 24" className="h-[23px] w-[23px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="7" />
            <circle cx="12" cy="12" r="2" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          </svg>
        </button>
      )}
      {toast && (
        <div role="status" className="pointer-events-none absolute inset-x-0 top-20 z-40 flex justify-center px-6">
          <div className="max-w-sm rounded-full bg-slate-900/85 px-4 py-2 text-center text-[13px] font-medium text-white shadow-lg">{toast}</div>
        </div>
      )}
      {(!CLIENT_ID || authError) && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
          <div className="max-w-sm rounded-2xl bg-white p-5 text-sm shadow-lg">
            <p className="font-semibold">지도를 불러오지 못했어요</p>
            <p className="mt-2 text-slate-600">
              {!CLIENT_ID
                ? ".env.local 에 NEXT_PUBLIC_NAVER_MAP_CLIENT_ID 를 넣어주세요."
                : "네이버 클라우드 콘솔 → Maps → Application → 변경 → Web 서비스 URL에 아래 주소가 등록돼 있는지 확인해주세요. (저장 후 반영까지 몇 분 걸릴 수 있어요)"}
            </p>
            {CLIENT_ID && <p className="mt-3 rounded-lg bg-slate-100 px-3 py-2 font-mono text-[13px] break-all select-all">{origin}</p>}
          </div>
        </div>
      )}
      {CLIENT_ID && !authError && !mapReady && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">지도 불러오는 중…</div>
      )}
    </div>
  );
}
