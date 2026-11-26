"use client";

import { useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";
import { HALL_TYPE } from "@/lib/labels";
import { formatTime } from "@/lib/format";
import { parseTimes } from "@/lib/times";

/* ───────────────────────── 공통 ───────────────────────── */

const inputCls =
  "h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-[15px] outline-none focus:border-slate-500";

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`h-9 rounded-full border px-3.5 text-sm font-medium ${on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600"}`}
    >
      {children}
    </button>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-sm font-semibold text-slate-700">{label}</p>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

function Actions({
  busy,
  onCancel,
  extra,
}: {
  busy: boolean;
  onCancel: () => void;
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 pt-1">
      {extra}
      <button
        type="button"
        onClick={onCancel}
        className="ml-auto h-11 rounded-xl px-4 text-sm font-semibold text-slate-500 hover:bg-slate-100"
      >
        취소
      </button>
      <button
        disabled={busy}
        className="h-11 rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {busy ? "저장 중…" : "저장"}
      </button>
    </div>
  );
}

function friendly(e: { message?: string; code?: string } | null) {
  if (!e) return null;
  if (
    e.code === "42501" ||
    /row-level security|permission/i.test(e.message ?? "")
  )
    return "수정 권한이 없어요. 승인된 회원으로 다시 로그인해 주세요.";
  if (e.code === "23505") return "같은 이름의 홀이 이미 있어요.";
  return "저장하지 못했어요. 다시 시도해 주세요.";
}

/* ───────────────────────── 홀·예식 시간 ───────────────────────── */

type Hall = Tables<"halls">;

/** 홀 하나 수정 (hall 이 없으면 새 홀 추가) */
export function HallEditor({
  venueId,
  hall,
  times: initialTimes,
  nextSort,
  onDone,
  onCancel,
}: {
  venueId: string;
  hall?: Hall;
  /** 지금 '공통' 시간표 ("HH:MM:SS") */
  times: string[];
  nextSort: number;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(hall?.name ?? "");
  const [floor, setFloor] = useState(hall?.floor ?? "");
  const [outdoor, setOutdoor] = useState(hall?.is_outdoor ?? false);
  const [hallType, setHallType] = useState<string | null>(
    hall?.hall_type ?? null,
  );
  const [timesText, setTimesText] = useState(
    initialTimes.map(formatTime).join(" "),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = parseTimes(timesText);
  const createdHallId = useRef<string | undefined>(undefined);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("홀 이름을 적어주세요");
    if (parsed.invalid.length)
      return setError(`알아볼 수 없는 시간: ${parsed.invalid.join(", ")}`);
    setBusy(true);
    setError(null);
    const row = {
      name: name.trim(),
      floor: floor.trim() || null,
      hall_type: hallType,
      is_outdoor: outdoor,
      // 시작 시간을 적으면 예전 '예식 간격' 값은 필요 없으므로 비움 (시간이 없으면 그대로 둠)
      ...(parsed.times.length ? { interval_minutes: null } : {}),
    };
    // 새 홀을 만든 뒤 시간 저장에서 실패했다면, 다시 저장할 때는 만든 홀을 고침 (중복 생성 방지)
    let hallId = hall?.id ?? createdHallId.current;
    if (hallId) {
      const { error } = await supabase
        .from("halls")
        .update(row)
        .eq("id", hallId);
      if (error) return (setBusy(false), setError(friendly(error)));
    } else {
      const { data, error } = await supabase
        .from("halls")
        .insert({ ...row, venue_id: venueId, sort_order: nextSort })
        .select("id")
        .single();
      if (error || !data) return (setBusy(false), setError(friendly(error)));
      hallId = data.id;
      createdHallId.current = data.id;
    }
    // 시간표: 바뀐 것만 지우고 추가 (그대로인 시간은 기록을 남기지 않음)
    const before = new Set(initialTimes.map(formatTime));
    const after = new Set(parsed.times);
    const removed = [...before].filter((t) => !after.has(t));
    const added = [...after].filter((t) => !before.has(t));
    if (hall && removed.length) {
      const { error } = await supabase
        .from("hall_schedules")
        .delete()
        .eq("hall_id", hallId)
        .eq("day_type", "common")
        .in(
          "start_time",
          removed.map((t) => `${t}:00`),
        );
      if (error) return (setBusy(false), setError(friendly(error)));
    }
    if (added.length) {
      const { error } = await supabase.from("hall_schedules").insert(
        added.map((t) => ({
          hall_id: hallId!,
          start_time: t,
          day_type: "common",
        })),
      );
      if (error) return (setBusy(false), setError(friendly(error)));
    }
    setBusy(false);
    onDone();
  }

  async function remove() {
    if (
      !hall ||
      !confirm(
        `‘${hall.name}’ 홀을 삭제할까요?\n이 홀의 예식 시간도 함께 지워져요.`,
      )
    )
      return;
    setBusy(true);
    const { error } = await supabase.from("halls").delete().eq("id", hall.id);
    setBusy(false);
    if (error) return setError(friendly(error));
    onDone();
  }

  return (
    <form
      onSubmit={save}
      className="space-y-4 rounded-xl border border-slate-300 bg-slate-50 p-4"
    >
      <div className="grid grid-cols-[1fr_6rem] gap-2">
        <Field label="홀 이름">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            className={inputCls}
            placeholder="예: 그랜드볼룸"
            autoFocus={!hall}
          />
        </Field>
        <Field label="층">
          <input
            value={floor}
            onChange={(e) => setFloor(e.target.value)}
            maxLength={30}
            className={inputCls}
            placeholder="예: 3, B1"
          />
        </Field>
      </div>
      <Field
        label="예식 형태"
        hint="분리: 예식홀과 식사 연회장이 나뉨 · 동시: 한 공간에서 예식과 식사를 함께 · 야외는 함께 고를 수 있어요"
      >
        <div className="flex flex-wrap items-center gap-1.5">
          {Object.entries(HALL_TYPE).map(([k, v]) => (
            <Chip
              key={k}
              on={hallType === k}
              onClick={() => setHallType(hallType === k ? null : k)}
            >
              {v}
            </Chip>
          ))}
          <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />
          {/* 야외는 분리/동시와 함께 고를 수 있음 */}
          <Chip on={outdoor} onClick={() => setOutdoor(!outdoor)}>
            야외
          </Chip>
        </div>
      </Field>
      <Field
        label="예식 시간"
        hint="띄어쓰기로 구분해서 입력 (예: 11:00 12:30 14:00 15:30 17:00)"
      >
        <input
          value={timesText}
          onChange={(e) => setTimesText(e.target.value)}
          inputMode="text"
          className={inputCls}
          placeholder="11:00 15:00 18:00"
        />
        {parsed.times.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {parsed.times.map((t) => (
              <span
                key={t}
                className="rounded-lg bg-white px-2 py-1 text-sm font-semibold text-slate-800 ring-1 ring-slate-200"
              >
                {t}
              </span>
            ))}
          </div>
        )}
        {parsed.invalid.length > 0 && (
          <p className="mt-1.5 text-xs text-red-600">
            알아볼 수 없는 시간: {parsed.invalid.join(", ")}
          </p>
        )}
      </Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Actions
        busy={busy}
        onCancel={onCancel}
        extra={
          hall && (
            <button
              type="button"
              onClick={remove}
              className="h-11 rounded-xl px-3 text-sm font-semibold text-rose-600 hover:bg-rose-50"
            >
              홀 삭제
            </button>
          )
        }
      />
    </form>
  );
}

/* ───────────────────────── 주차 ───────────────────────── */

type Venue = Tables<"venues">;


export function ParkingEditor({
  venue,
  onDone,
  onCancel,
}: {
  venue: Venue;
  onDone: () => void;
  onCancel: () => void;
}) {
  // 하객 무료 주차: [ ]시간 [ ]분 직접 입력, '무료 없음'은 따로 (DB: 0 = 없음, null = 모름)
  const g = venue.guest_free_minutes;
  const [noFree, setNoFree] = useState(g === 0);
  const [freeH, setFreeH] = useState(g ? String(Math.floor(g / 60) || "") : "");
  const [freeM, setFreeM] = useState(g ? String(g % 60 || "") : "");
  const [unit, setUnit] = useState<number>(
    venue.overtime_unit_minutes ?? 10,
  );
  const [fee, setFee] = useState(
    venue.overtime_fee != null ? String(venue.overtime_fee) : "",
  );
  const [notes, setNotes] = useState(venue.parking_notes ?? "");
  // 기본 10·30·60분 + DB에 들어 있는 단위(예: 5분, 15분)는 그대로 보여줌
  const unitOptions = [...new Set([10, 30, 60, ...(venue.overtime_unit_minutes ? [venue.overtime_unit_minutes] : [])])].sort((a, b) => a - b);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const feeNumber = fee.replace(/[^\d]/g, "");
  const digits = (v: string) => v.replace(/[^\d]/g, "").slice(0, 3);
  const freeTotal = Number(freeH || 0) * 60 + Number(freeM || 0);
  const free: number | null = noFree ? 0 : freeTotal > 0 ? freeTotal : null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!noFree && Number(freeM || 0) >= 60) return setError("분은 59분까지 적어주세요");
    setBusy(true);
    setError(null);
    const { error } = await supabase
      .from("venues")
      .update({
        guest_free_minutes: free,
        overtime_fee: feeNumber ? Number(feeNumber) : null,
        overtime_unit_minutes: feeNumber && Number(feeNumber) > 0 ? unit : null,
        parking_notes: notes.trim() || null,
      })
      .eq("id", venue.id);
    setBusy(false);
    if (error) return setError(friendly(error));
    onDone();
  }

  return (
    <form
      onSubmit={save}
      className="space-y-5 rounded-xl border border-slate-300 bg-slate-50 p-4"
    >
      <Field label="하객 무료 주차">
        <div className="flex flex-wrap items-center gap-2">
          <div className={`flex items-center gap-1.5 text-[15px] ${noFree ? "opacity-40" : ""}`}>
            <input
              value={freeH}
              onChange={(e) => setFreeH(digits(e.target.value))}
              disabled={noFree}
              inputMode="numeric"
              aria-label="무료 시간"
              className="h-11 w-16 shrink-0 rounded-xl border border-slate-200 bg-white px-2 text-center text-[15px] outline-none focus:border-slate-500"
              placeholder="0"
            />
            <span className="shrink-0">시간</span>
            <input
              value={freeM}
              onChange={(e) => setFreeM(digits(e.target.value))}
              disabled={noFree}
              inputMode="numeric"
              aria-label="무료 분"
              className="h-11 w-16 shrink-0 rounded-xl border border-slate-200 bg-white px-2 text-center text-[15px] outline-none focus:border-slate-500"
              placeholder="0"
            />
            <span className="shrink-0">분 무료</span>
          </div>
          <Chip on={noFree} onClick={() => setNoFree(!noFree)}>
            무료 없음
          </Chip>
        </div>
      </Field>

      <Field label="초과 요금" hint="비워두면 '미입력'으로 표시돼요">
        <div className="flex items-center gap-2">
          <div className="flex shrink-0 rounded-xl border border-slate-200 bg-white p-0.5">
            {unitOptions.map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => setUnit(u)}
                aria-pressed={unit === u}
                className={`h-9 rounded-lg px-3 text-sm font-semibold ${unit === u ? "bg-slate-900 text-white" : "text-slate-500"}`}
              >
                {u === 60 ? "1시간당" : `${u}분당`}
              </button>
            ))}
          </div>
          <div className="relative min-w-0 flex-1">
            <input
              value={feeNumber ? Number(feeNumber).toLocaleString("ko-KR") : ""}
              onChange={(e) => setFee(e.target.value)}
              inputMode="numeric"
              className={`${inputCls} pr-9 text-right`}
              placeholder="예: 2,000"
            />
            <span className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-sm text-slate-500">
              원
            </span>
          </div>
        </div>
      </Field>

      <Field
        label="위치·요금"
        hint="몇 대 주차 가능 같은 정보는 적지 않아도 돼요"
      >
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={500}
          rows={2}
          className={`${inputCls} h-auto py-2.5`}
          placeholder="예: 건물 지하 2~4층 / 발렛 30,000원"
        />
      </Field>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <Actions busy={busy} onCancel={onCancel} />
    </form>
  );
}

/* ───────────────────────── 주변 주차장 ───────────────────────── */

type NearbyParking = Tables<"nearby_parking">;

export function NearbyParkingEditor({
  venueId,
  parking,
  onDone,
  onCancel,
}: {
  venueId: string;
  /** 있으면 수정 */
  parking?: NearbyParking;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(parking?.name ?? "");
  const [fee, setFee] = useState(parking?.fee ?? "");
  const [walk, setWalk] = useState(parking?.walk_minutes != null ? String(parking.walk_minutes) : "");
  const [memo, setMemo] = useState(parking?.memo ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("주차장 이름을 적어주세요");
    setBusy(true);
    setError(null);
    const row = {
      name: name.trim().slice(0, 80),
      fee: fee.trim().slice(0, 200) || null,
      walk_minutes: walk ? Math.min(120, Number(walk)) : null,
      memo: memo.trim().slice(0, 500) || null,
    };
    const { error } = parking
      ? await supabase.from("nearby_parking").update(row).eq("id", parking.id)
      : await supabase.from("nearby_parking").insert({ ...row, venue_id: venueId });
    setBusy(false);
    if (error) return setError(friendly(error));
    onDone();
  }

  async function remove() {
    if (!parking || !confirm(`‘${parking.name}’ 주차장을 삭제할까요?`)) return;
    setBusy(true);
    const { error } = await supabase.from("nearby_parking").delete().eq("id", parking.id);
    setBusy(false);
    if (error) return setError(friendly(error));
    onDone();
  }

  return (
    <form onSubmit={save} className="space-y-4 rounded-xl border border-slate-300 bg-slate-50 p-4">
      <Field label="주차장 이름">
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={inputCls} placeholder="예: 아시아공원 공영주차장" autoFocus />
      </Field>
      <Field label="요금">
        <input value={fee} onChange={(e) => setFee(e.target.value)} maxLength={200} className={inputCls} placeholder="예: 10분당 500원 / 1일 20,000원" />
      </Field>
      <Field label="도보 (분)">
        <input
          value={walk}
          onChange={(e) => setWalk(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
          inputMode="numeric"
          className="h-11 w-24 rounded-xl border border-slate-200 bg-white px-3 text-center text-[15px] outline-none focus:border-slate-500"
          placeholder="예: 5"
        />
      </Field>
      <Field label="메모" hint="네이버 지도 링크를 넣으면 누를 수 있어요">
        <textarea
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          maxLength={500}
          rows={2}
          className={`${inputCls} h-auto py-2.5`}
          placeholder="예: 주말엔 오전에 금방 차요 / https://naver.me/…"
        />
      </Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Actions
        busy={busy}
        onCancel={onCancel}
        extra={
          parking ? (
            <button type="button" onClick={remove} disabled={busy} className="h-11 rounded-xl px-3 text-sm font-semibold text-rose-600 hover:bg-rose-50">
              삭제
            </button>
          ) : undefined
        }
      />
    </form>
  );
}
