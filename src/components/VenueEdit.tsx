"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";
import { GUEST_FREE_METHOD, HALL_TYPE } from "@/lib/labels";
import { formatMinutes, formatTime } from "@/lib/format";
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
  const [hallType, setHallType] = useState<string | null>(
    hall?.hall_type ?? null,
  );
  const [timesText, setTimesText] = useState(
    initialTimes.map(formatTime).join(" "),
  );
  const [interval, setInterval_] = useState(
    hall?.interval_minutes != null ? String(hall.interval_minutes) : "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = parseTimes(timesText);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("홀 이름을 적어주세요");
    if (parsed.invalid.length)
      return setError(`알아볼 수 없는 시간: ${parsed.invalid.join(", ")}`);
    const iv = interval.trim() ? Number(interval.replace(/[^\d]/g, "")) : null;
    if (iv != null && (iv < 10 || iv > 600))
      return setError("예식 간격은 10~600분 사이로 적어주세요");
    setBusy(true);
    setError(null);
    const row = {
      name: name.trim(),
      floor: floor.trim() || null,
      hall_type: hallType,
      // 시작 시간을 적으면 간격은 시간에서 계산하므로 비움
      interval_minutes: parsed.times.length ? null : iv,
    };
    let hallId = hall?.id;
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
        hint="분리: 예식홀과 식사 연회장이 나뉨 · 동시: 한 공간에서 예식과 식사를 함께"
      >
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(HALL_TYPE).map(([k, v]) => (
            <Chip
              key={k}
              on={hallType === k}
              onClick={() => setHallType(hallType === k ? null : k)}
            >
              {v}
            </Chip>
          ))}
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
      <Field
        label="예식 간격 (분)"
        hint={
          parsed.times.length
            ? "시작 시간을 적으면 간격은 자동으로 계산돼요"
            : "시작 시간을 모를 때만 적어주세요 (예: 90)"
        }
      >
        <input
          value={parsed.times.length ? "" : interval}
          onChange={(e) => setInterval_(e.target.value)}
          disabled={parsed.times.length > 0}
          inputMode="numeric"
          className={`${inputCls} w-28 disabled:bg-slate-100`}
          placeholder="90"
        />
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

/** 하객 무료 주차 선택지 (분). null = 모름 */
const FREE_OPTIONS = [0, 30, 60, 90, 120, 150, 180, 240, 300];

export function ParkingEditor({
  venue,
  onDone,
  onCancel,
}: {
  venue: Venue;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [free, setFree] = useState<number | null>(venue.guest_free_minutes);
  const [unit, setUnit] = useState<number>(
    venue.overtime_unit_minutes === 60 ? 60 : 30,
  );
  const [fee, setFee] = useState(
    venue.overtime_fee != null ? String(venue.overtime_fee) : "",
  );
  const [methods, setMethods] = useState<string[]>(
    venue.guest_free_methods ?? [],
  );
  const [notes, setNotes] = useState(venue.parking_notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const feeNumber = fee.replace(/[^\d]/g, "");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase
      .from("venues")
      .update({
        guest_free_minutes: free,
        overtime_fee: feeNumber ? Number(feeNumber) : null,
        overtime_unit_minutes: feeNumber ? unit : null,
        guest_free_methods: methods.length ? methods : null,
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
        <div className="flex flex-wrap gap-1.5">
          {FREE_OPTIONS.map((m) => (
            <Chip
              key={m}
              on={free === m}
              onClick={() => setFree(free === m ? null : m)}
            >
              {m === 0 ? "무료 없음" : `${formatMinutes(m)} 무료`}
            </Chip>
          ))}
        </div>
      </Field>

      <Field label="초과 요금" hint="비워두면 '미입력'으로 표시돼요">
        <div className="flex items-center gap-2">
          <div className="flex shrink-0 rounded-xl border border-slate-200 bg-white p-0.5">
            {[30, 60].map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => setUnit(u)}
                aria-pressed={unit === u}
                className={`h-9 rounded-lg px-3 text-sm font-semibold ${unit === u ? "bg-slate-900 text-white" : "text-slate-500"}`}
              >
                {u === 30 ? "30분당" : "1시간당"}
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

      <Field label="무료 처리 방법" hint="여러 개 고를 수 있어요">
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(GUEST_FREE_METHOD).map(([k, v]) => (
            <Chip
              key={k}
              on={methods.includes(k)}
              onClick={() =>
                setMethods(
                  methods.includes(k)
                    ? methods.filter((x) => x !== k)
                    : [...methods, k],
                )
              }
            >
              {v}
            </Chip>
          ))}
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
