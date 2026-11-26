"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Tables, Views } from "@/lib/database.types";
import {
  CATEGORY,
  DAY_TYPE,
  DAY_TYPE_ORDER,
  EXTERNAL_SNAP_POLICY,
  FLASH_POLICY,
  GUEST_FREE_METHOD,
  HALL_TYPE,
  OFFICIAL_PHOTO_TIMING,
  isHotel,
  label,
} from "@/lib/labels";
import {
  formatDate,
  formatMinutes,
  formatTime,
  formatWon,
  isStale,
  venueTitle,
} from "@/lib/format";
import type { VenuePin } from "@/lib/sites";
import VenueNotes from "./VenueNotes";
import { VenueDeleteRequest } from "./VenueRequest";
import { HallEditor, ParkingEditor } from "./VenueEdit";
import { useAuth } from "./AuthProvider";

type Editor = { editor: { nickname: string } | null };
type Venue = Tables<"venues"> & Editor;
type Hall = Tables<"halls"> & Editor;
type Parking = Tables<"nearby_parking"> & Editor;
type Schedule = Views<"hall_schedules_computed">;

type Detail = {
  venue: Venue;
  halls: Hall[];
  schedules: Schedule[];
  parking: Parking[];
};

const TABS = [
  { key: "photo", label: "촬영" },
  { key: "halls", label: "홀·시간" },
  { key: "parking", label: "주차" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

async function fetchDetail(id: string): Promise<Detail> {
  const [v, h, s, p] = await Promise.all([
    supabase
      .from("venues")
      .select("*, editor:profiles!venues_updated_by_fkey(nickname)")
      .eq("id", id)
      .single(),
    supabase
      .from("halls")
      .select("*, editor:profiles!halls_updated_by_fkey(nickname)")
      .eq("venue_id", id)
      .order("sort_order")
      .order("name"),
    supabase
      .from("hall_schedules_computed")
      .select("*")
      .eq("venue_id", id)
      .order("start_time"),
    supabase
      .from("nearby_parking")
      .select("*, editor:profiles!nearby_parking_updated_by_fkey(nickname)")
      .eq("venue_id", id)
      .order("walk_minutes", { nullsFirst: false }),
  ]);
  const err = v.error ?? h.error ?? s.error ?? p.error;
  if (err) throw err;
  return {
    venue: v.data as Venue,
    halls: (h.data ?? []) as Hall[],
    schedules: s.data ?? [],
    parking: (p.data ?? []) as Parking[],
  };
}

export default function VenueDetail({
  venueId,
  siblings,
  onSelectVenue,
  onClose,
}: {
  venueId: string;
  /** 같은 주소의 다른 예식장 */
  siblings: VenuePin[];
  onSelectVenue: (id: string) => void;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("photo");
  const [reload, setReload] = useState(0);
  const auth = useAuth();
  const canEdit = auth.status === "member";
  // 저장 후 다시 불러오기 (화면 깜빡임 없이)
  const refresh = () =>
    fetchDetail(venueId)
      .then(setDetail)
      .catch(() => {});

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    fetchDetail(venueId)
      .then((d) => !cancelled && setDetail(d))
      .catch((e) => !cancelled && setError(e?.message ?? "불러오기 실패"));
    return () => {
      cancelled = true;
    };
  }, [venueId, reload]);

  if (error) {
    return (
      <div className="p-5 text-sm">
        <p className="text-slate-700">정보를 불러오지 못했어요.</p>
        <p className="mt-1 text-xs text-slate-400">{error}</p>
        <button
          onClick={() => setReload((r) => r + 1)}
          className="mt-3 rounded-lg bg-slate-900 px-3 py-2 text-white"
        >
          다시 시도
        </button>
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="space-y-3 p-5" aria-busy>
        <div className="h-5 w-2/3 animate-pulse rounded bg-slate-200" />
        <div className="h-4 w-full animate-pulse rounded bg-slate-100" />
        <div className="h-24 w-full animate-pulse rounded bg-slate-100" />
      </div>
    );
  }

  const { venue } = detail;
  const others = siblings.filter((s) => s.id !== venue.id);

  return (
    <div className="flex min-h-0 flex-col">
      {/* 헤더 */}
      <div className="px-5 pt-1 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {/* 홈페이지 소제목처럼 넓은 자간의 영문 분류 */}
            <p className="wm-eyebrow flex flex-wrap items-center gap-x-2">
              <span
                style={{
                  color: isHotel(venue.category)
                    ? "var(--color-hotel)"
                    : undefined,
                }}
              >
                {isHotel(venue.category)
                  ? "Hotel"
                  : venue.category === "auxiliary"
                    ? "Etc"
                    : "Wedding Hall"}
              </span>
              <span className="tracking-normal normal-case">
                {label(CATEGORY, venue.category)}
                {venue.category === "auxiliary" && venue.registered_industry
                  ? ` · ${venue.registered_industry}`
                  : ""}
              </span>
            </p>
            <h2 className="mt-1.5 text-[20px] leading-snug font-bold tracking-[-0.02em] text-slate-900">
              {venueTitle(venue)}
            </h2>
            <p className="mt-0.5 text-sm text-slate-600">
              {venue.road_address}
              {venue.floor ? ` ${venue.floor}층` : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="-mr-2 shrink-0 rounded-full p-2 text-slate-400 hover:bg-slate-100"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="mt-2.5 space-y-0.5 text-sm">
          {venue.phone && (
            <p>
              <span className="inline-block w-14 text-slate-500">phone.</span>
              <a
                href={`tel:${venue.phone}`}
                className="text-slate-600 underline-offset-2 hover:underline"
              >
                {venue.phone}
              </a>
            </p>
          )}
          {venue.homepage && (
            <a
              href={
                /^https?:\/\//.test(venue.homepage)
                  ? venue.homepage
                  : `https://${venue.homepage}`
              }
              target="_blank"
              rel="noreferrer"
              className="block text-slate-600 underline-offset-2 hover:underline"
            >
              <span className="inline-block w-14 text-slate-500">web.</span>
              홈페이지 ↗
            </a>
          )}
        </div>
        {others.length > 0 && (
          <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm">
            <p className="text-xs font-semibold text-slate-500">
              같은 주소에 {others.length}곳 더 있어요
            </p>
            <ul className="mt-1">
              {others.map((o) => (
                <li key={o.id}>
                  <button
                    onClick={() => onSelectVenue(o.id)}
                    className="py-0.5 text-left text-slate-800 hover:underline"
                  >
                    {venueTitle(o)} ›
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* 탭 */}
      <div
        role="tablist"
        className="sticky top-0 z-10 flex border-b border-slate-200 bg-white px-2"
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 py-3 text-sm font-semibold ${tab === t.key ? "border-b-2 border-slate-900 text-slate-900" : "text-slate-400"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="px-5 py-4">
        {tab === "parking" && (
          <ParkingTab
            venue={venue}
            parking={detail.parking}
            canEdit={canEdit}
            onSaved={refresh}
          />
        )}
        {tab === "halls" && (
          <HallsTab
            venueId={venue.id}
            halls={detail.halls}
            schedules={detail.schedules}
            canEdit={canEdit}
            onSaved={refresh}
          />
        )}
        {tab === "photo" && <PhotoTab venue={venue} />}

        {venue.editor && (
          <p className="mt-2 text-center text-[11px] text-slate-400">
            마지막 수정 {venue.editor.nickname} · {formatDate(venue.updated_at)}
          </p>
        )}
        <VenueDeleteRequest venueId={venue.id} venueName={venueTitle(venue)} />
      </div>
    </div>
  );
}

/* ───────────────────────── 공통 ───────────────────────── */

function Row({ label: l, value }: { label: string; value: React.ReactNode }) {
  const empty =
    value == null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0);
  return (
    <div className="flex gap-3 py-2 text-sm">
      <dt className="w-28 shrink-0 text-slate-500">{l}</dt>
      <dd
        className={
          empty
            ? "text-slate-300"
            : "font-medium whitespace-pre-line text-slate-900"
        }
      >
        {empty ? "미입력" : value}
      </dd>
    </div>
  );
}

function Checked({
  at,
  by,
}: {
  at: string | null | undefined;
  by?: string | null;
}) {
  if (!at) return null;
  const stale = isStale(at);
  return (
    <p className={`text-[11px] ${stale ? "text-amber-600" : "text-slate-400"}`}>
      최종 확인 {formatDate(at)}
      {by ? ` · ${by}` : ""}
      {stale ? " · 1년 넘은 정보예요" : ""}
    </p>
  );
}

function Section({
  title,
  checkedAt,
  checkedBy,
  onEdit,
  children,
}: {
  title: string;
  checkedAt?: string | null;
  checkedBy?: string | null;
  /** 있으면 제목 옆에 '수정' 버튼 */
  onEdit?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`mb-5 ${isStale(checkedAt) && !onEdit ? "opacity-50" : ""}`}
    >
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h3 className="text-[15px] font-bold text-slate-900">{title}</h3>
        <div className="flex items-baseline gap-2">
          <Checked at={checkedAt} by={checkedBy} />
          {onEdit && (
            <button
              onClick={onEdit}
              className="shrink-0 rounded-md border border-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              수정
            </button>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 p-5 text-center text-sm text-slate-400">
      {children}
    </div>
  );
}

/* ───────────────────────── 주차 ───────────────────────── */

function ParkingTab({
  venue,
  parking,
  canEdit,
  onSaved,
}: {
  venue: Venue;
  parking: Parking[];
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const hasInfo =
    venue.guest_free_minutes != null ||
    venue.parking_capacity != null ||
    (venue.guest_free_methods?.length ?? 0) > 0 ||
    venue.overtime_fee != null;

  const overtime =
    venue.overtime_fee != null
      ? `${formatWon(venue.overtime_fee)}${venue.overtime_unit_minutes ? ` / ${formatMinutes(venue.overtime_unit_minutes)}` : ""}`
      : null;

  return (
    <>
      <Section
        title="예식장 주차"
        checkedAt={venue.parking_checked_at}
        checkedBy={venue.editor?.nickname}
        onEdit={canEdit && !editing ? () => setEditing(true) : undefined}
      >
        {editing ? (
          <ParkingEditor
            venue={venue}
            onCancel={() => setEditing(false)}
            onDone={() => {
              setEditing(false);
              onSaved();
            }}
          />
        ) : hasInfo ? (
          <dl className="divide-y divide-slate-100">
            <Row
              label="하객 무료 주차"
              value={formatMinutes(venue.guest_free_minutes)}
            />
            <Row label="초과 요금" value={overtime} />
            <Row
              label="무료 처리 방법"
              value={venue.guest_free_methods
                ?.map((m) => label(GUEST_FREE_METHOD, m))
                .join(", ")}
            />
            {venue.parking_notes && (
              <Row label="위치·요금" value={venue.parking_notes} />
            )}
          </dl>
        ) : (
          <Empty>아직 입력된 주차 정보가 없어요</Empty>
        )}
      </Section>

      <Section
        title={`주변 주차장${parking.length ? ` ${parking.length}` : ""}`}
      >
        {parking.length ? (
          <ul className="space-y-2">
            {parking.map((p) => (
              <li
                key={p.id}
                className={`rounded-xl border border-slate-200 p-3 ${isStale(p.checked_at) ? "opacity-50" : ""}`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-semibold">{p.name}</p>
                  {p.walk_minutes != null && (
                    <p className="shrink-0 text-xs text-slate-500">
                      도보 {p.walk_minutes}분
                    </p>
                  )}
                </div>
                {p.fee && (
                  <p className="mt-0.5 text-sm text-slate-700">{p.fee}</p>
                )}
                {p.memo && (
                  <p className="mt-0.5 text-sm whitespace-pre-line text-slate-500">
                    {p.memo}
                  </p>
                )}
                <div className="mt-1">
                  <Checked at={p.checked_at} by={p.editor?.nickname} />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>등록된 주변 주차장이 없어요</Empty>
        )}
      </Section>

      <Section title="주차 특이사항">
        <VenueNotes venueId={venue.id} section="parking" />
      </Section>
    </>
  );
}

/* ───────────────────────── 홀·시간 ───────────────────────── */

/** "2" → "2층", "B1" → "B1층", "MAIN TOWER 2층" 처럼 글이면 그대로 */
function floorLabel(f: string | null) {
  if (!f) return null;
  return /^B?\d+$/.test(f.trim()) ? `${f.trim()}층` : f;
}

function HallsTab({
  venueId,
  halls,
  schedules,
  canEdit,
  onSaved,
}: {
  venueId: string;
  halls: Hall[];
  schedules: Schedule[];
  canEdit: boolean;
  onSaved: () => void;
}) {
  // 수정 중인 홀 id, 새 홀은 "new"
  const [editing, setEditing] = useState<string | null>(null);
  const done = () => {
    setEditing(null);
    onSaved();
  };
  const commonTimes = (hallId: string) =>
    schedules
      .filter((s) => s.hall_id === hallId && s.day_type === "common")
      .map((s) => s.start_time!);
  const addHall = canEdit && (
    <div className="mt-2">
      {editing === "new" ? (
        <HallEditor
          venueId={venueId}
          times={[]}
          nextSort={halls.length + 1}
          onCancel={() => setEditing(null)}
          onDone={done}
        />
      ) : (
        <button
          onClick={() => setEditing("new")}
          className="h-11 w-full rounded-xl border border-dashed border-slate-300 text-sm font-semibold text-slate-600 hover:bg-slate-50"
        >
          + 홀 추가
        </button>
      )}
    </div>
  );
  if (!halls.length)
    return (
      <>
        <Empty>아직 등록된 홀이 없어요</Empty>
        {addHall}
      </>
    );
  const anySimultaneous = schedules.some((s) => s.is_simultaneous);

  return (
    <>
      {anySimultaneous && (
        <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
          ⚠️ 같은 시간에 다른 홀에서도 예식이 있어요 (‘겹침’ 표시)
        </p>
      )}
      {halls.map((h) => {
        const mine = schedules.filter((s) => s.hall_id === h.id);
        const byDay = DAY_TYPE_ORDER.map(
          (d) => [d, mine.filter((s) => s.day_type === d)] as const,
        ).filter(([, l]) => l.length);
        return (
          <Section
            key={h.id}
            title={h.name}
            checkedAt={h.checked_at}
            checkedBy={h.editor?.nickname}
            onEdit={
              canEdit && editing !== h.id ? () => setEditing(h.id) : undefined
            }
          >
            {editing === h.id ? (
              <HallEditor
                venueId={venueId}
                hall={h}
                times={commonTimes(h.id)}
                nextSort={halls.length + 1}
                onCancel={() => setEditing(null)}
                onDone={done}
              />
            ) : (
              <>
                <p className="text-sm text-slate-500">
                  {[floorLabel(h.floor), label(HALL_TYPE, h.hall_type)]
                    .filter(Boolean)
                    .join(" · ") || "층·형태 미입력"}
                </p>
                {byDay.length ? (
                  <div className="mt-2 space-y-2">
                    {byDay.map(([day, list]) => (
                      <div key={day}>
                        <p className="mb-1 text-xs font-semibold text-slate-500">
                          {DAY_TYPE[day]}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {list.map((s) => (
                            <span
                              key={s.id}
                              className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm ${
                                s.is_simultaneous
                                  ? "bg-amber-100 text-amber-900"
                                  : "bg-slate-100 text-slate-800"
                              }`}
                            >
                              <b className="font-semibold">
                                {formatTime(s.start_time)}
                              </b>
                              {s.is_simultaneous && (
                                <span className="text-[11px] font-semibold">
                                  겹침
                                </span>
                              )}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  // 시작 시각을 모를 때만 예식 간격
                  <p className="mt-2 text-sm text-slate-500">
                    {h.interval_minutes ? (
                      <>
                        예식 간격{" "}
                        <b className="font-semibold text-slate-800">
                          {h.interval_minutes}분
                        </b>
                        <span className="ml-1.5 text-xs text-slate-400">
                          시작 시간 미확인
                        </span>
                      </>
                    ) : (
                      <span className="text-slate-300">시간표 미입력</span>
                    )}
                    {/* 로그인한 회원은 바로 시간 입력 */}
                    {canEdit && (
                      <button
                        onClick={() => setEditing(h.id)}
                        className="ml-2 rounded-md bg-slate-900 px-2 py-0.5 text-xs font-semibold text-white"
                      >
                        + 시간 입력
                      </button>
                    )}
                  </p>
                )}
                {h.photo_notes && (
                  <p className="mt-2 rounded-lg bg-slate-50 p-2 text-sm whitespace-pre-line text-slate-700">
                    📷 {h.photo_notes}
                  </p>
                )}
              </>
            )}
          </Section>
        );
      })}
      {addHall}
    </>
  );
}

/* ───────────────────────── 촬영 ───────────────────────── */

function PhotoTab({ venue }: { venue: Venue }) {
  const hasInfo =
    venue.official_vendor_designated != null ||
    venue.external_snap_policy != null ||
    venue.official_photo_timing != null ||
    venue.flash_policy != null ||
    venue.external_vendor_fee != null ||
    venue.pass_required != null ||
    !!venue.equipment_route ||
    !!venue.bridal_room_info;

  const designated =
    venue.official_vendor_designated == null
      ? null
      : venue.official_vendor_designated
        ? `있음${venue.official_vendor_name ? ` (${venue.official_vendor_name})` : ""}`
        : "없음";

  return (
    <>
      <Section title="촬영 규정" checkedAt={venue.photo_checked_at}>
        {hasInfo ? (
          <dl className="divide-y divide-slate-100">
            <Row label="원판 지정 업체" value={designated} />
            <Row
              label="외부 스냅"
              value={label(EXTERNAL_SNAP_POLICY, venue.external_snap_policy)}
            />
            <Row
              label="원판 촬영 시점"
              value={label(OFFICIAL_PHOTO_TIMING, venue.official_photo_timing)}
            />
            <Row
              label="플래시"
              value={label(FLASH_POLICY, venue.flash_policy)}
            />
            <Row
              label="외부 업체 등록비"
              value={formatWon(venue.external_vendor_fee)}
            />
            <Row
              label="출입증"
              value={
                venue.pass_required == null
                  ? null
                  : venue.pass_required
                    ? "필요"
                    : "불필요"
              }
            />
            <Row label="장비 반입 동선" value={venue.equipment_route} />
            <Row label="신부대기실" value={venue.bridal_room_info} />
            {venue.photo_notes && (
              <Row label="메모" value={venue.photo_notes} />
            )}
          </dl>
        ) : (
          <Empty>아직 입력된 촬영 규정이 없어요</Empty>
        )}
      </Section>

      <Section title="촬영 특이사항">
        <VenueNotes venueId={venue.id} section="photo" />
      </Section>
    </>
  );
}
