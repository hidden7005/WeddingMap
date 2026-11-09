"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
import { gridCluster, type Site } from "@/lib/sites";

const CLIENT_ID = process.env.NEXT_PUBLIC_NAVER_MAP_CLIENT_ID;
const KOREA_CENTER = { lat: 36.35, lng: 127.85 };
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
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<naver.maps.Map | null>(null);
  const markersRef = useRef<naver.maps.Marker[]>([]);
  const [scriptReady, setScriptReady] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [authError, setAuthError] = useState(false);
  const [idleTick, setIdleTick] = useState(0);
  const [origin, setOrigin] = useState("");

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
      center: new naver.maps.LatLng(KOREA_CENTER.lat, KOREA_CENTER.lng),
      zoom: 7,
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
    setMapReady(true);
    return () => {
      naver.maps.Event.removeListener([idle, click]);
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

    const addSiteMarker = (site: Site) => {
      const first = site.venues[0];
      const selected = site.key === selectedSiteKey;
      const count = site.venues.length;
      const label =
        zoom >= LABEL_ZOOM || selected
          ? `<div class="wm-pin-label">${escapeHtml(first.name)}${count > 1 ? ` 외 ${count - 1}` : ""}</div>`
          : "";
      const marker = new naver.maps.Marker({
        map,
        position: new naver.maps.LatLng(site.lat, site.lng),
        zIndex: selected ? 1000 : 100,
        title: site.venues.map((v) => v.name).join(", "),
        icon: {
          content: `<div class="wm-pin" data-selected="${selected}" style="--pin-color:${pinColor(first.category)}"><span>${count > 1 ? count : ""}</span></div>${label}`,
          anchor: new naver.maps.Point(14, 32),
        },
      });
      naver.maps.Event.addListener(marker, "click", () => onSelectRef.current(site));
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
      <div ref={containerRef} className="h-full w-full" />
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
