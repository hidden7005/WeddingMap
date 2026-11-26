"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Linkify } from "@/components/VenueNotes";
import { removePhotoFiles, venuePhotoFiles } from "@/lib/venuePhotos";
import type { Tables, Views } from "@/lib/database.types";
import { isValidMemberCode, parseMemberLines } from "@/lib/members";
import { formatDate, venueTitle } from "@/lib/format";
import { thumbPath } from "@/lib/image";
import { suggestCode, teamLabel } from "@/lib/teams";
import { DAY_TYPE, EXTERNAL_SNAP_POLICY, FLASH_POLICY, GUEST_FREE_METHOD, HALL_TYPE, OFFICIAL_PHOTO_TIMING, PARKING_CAPACITY } from "@/lib/labels";
import { useAuth } from "@/components/AuthProvider";
import Logo, { APP_NAME } from "@/components/Logo";
import { APP_VERSION } from "@/lib/version";

type Stats = Views<"member_login_stats">;
type Member = Tables<"members"> & { nickname?: string; stats?: Stats };
type Tab = "activity" | "members" | "settings";

/** 공유 의심 기준: 24시간 안에 기기 전환 4회 이상, 또는 7일간 12회 이상 */
function isSuspicious(st?: Stats) {
  return !!st && ((st.switches_24h ?? 0) >= 4 || (st.switches_7d ?? 0) >= 12);
}

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  invited: { text: "승인 · 로그인 전", cls: "bg-slate-100 text-slate-600" },
  active: { text: "가입", cls: "bg-emerald-50 text-emerald-700" },
  suspended: { text: "정지", cls: "bg-rose-50 text-rose-700" },
};

const whenText = (iso: string) => new Date(iso).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function AdminPage() {
  const { status, member, session, settings, refresh } = useAuth();

  if (status === "loading") return <Centered>확인 중…</Centered>;
  if (status !== "member" || member?.role !== "admin") {
    return (
      <Centered>
        <p>관리자만 볼 수 있는 페이지예요.</p>
        <Link href={status === "member" ? "/" : "/login"} className="mt-3 inline-block font-semibold underline">
          {status === "member" ? "지도로 돌아가기" : "로그인"}
        </Link>
      </Centered>
    );
  }
  return <Admin myUserId={session!.user.id} settings={settings} onSettingsChanged={refresh} />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-dvh flex-col items-center justify-center p-6 text-center text-sm text-slate-600">{children}</main>;
}

function Admin({
  myUserId,
  settings,
  onSettingsChanged,
}: {
  myUserId: string;
  settings: { requireLoginToView: boolean; requireLoginFrom: string | null } | null;
  onSettingsChanged: () => Promise<void>;
}) {
  const [tab, setTab] = useState<Tab>("activity");
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statsKey, setStatsKey] = useState(0);

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.from("members").select("*").order("created_at", { ascending: false });
    if (e) return setError(e.message);
    const ids = (data ?? []).map((m) => m.user_id).filter(Boolean) as string[];
    const nick = new Map<string, string>();
    const stats = new Map<string, Stats>();
    if (ids.length) {
      const [{ data: profiles }, { data: st }] = await Promise.all([
        supabase.from("profiles").select("id,nickname").in("id", ids),
        supabase.from("member_login_stats").select("*"),
      ]);
      profiles?.forEach((p) => nick.set(p.id, p.nickname));
      st?.forEach((x) => x.user_id && stats.set(x.user_id, x));
    }
    setMembers((data ?? []).map((m) => ({ ...m, nickname: m.user_id ? nick.get(m.user_id) : undefined, stats: m.user_id ? stats.get(m.user_id) : undefined })));
    setStatsKey((k) => k + 1);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const pending = useMemo(() => (members ?? []).filter((m) => !m.approved_at), [members]);

  const TabBtn = ({ k, children }: { k: Tab; children: React.ReactNode }) => (
    <button
      onClick={() => setTab(k)}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold ${tab === k ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
    >
      {children}
    </button>
  );

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2.5">
          <Logo variant="wordmark" className="h-4" />
          <span className="h-5 w-px bg-slate-300" aria-hidden />
          <span className="text-sm font-semibold text-slate-600">{APP_NAME} 관리자 <span className="ml-1 text-xs font-normal text-slate-400">v{APP_VERSION}</span></span>
        </h1>
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-900">
          지도로 돌아가기 ›
        </Link>
      </div>

      <StatsCards refreshKey={statsKey} />

      <nav className="mt-5 flex gap-1 border-b border-slate-200 pb-2">
        <TabBtn k="activity">최근 활동</TabBtn>
        <TabBtn k="members">
          회원
          {pending.length > 0 && <span className="rounded-full bg-rose-600 px-1.5 text-xs text-white">{pending.length}</span>}
        </TabBtn>
        <TabBtn k="settings">설정</TabBtn>
      </nav>

      {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
      {tab === "activity" && <ActivityTab onChanged={() => setStatsKey((k) => k + 1)} pendingCount={pending.length} goMembers={() => setTab("members")} />}
      {tab === "members" && <MembersTab members={members} myUserId={myUserId} reload={load} />}
      {tab === "settings" && <ViewSetting settings={settings} onChanged={onSettingsChanged} />}
    </main>
  );
}

/* ───────────────────────── 숫자 카드 ───────────────────────── */

type AdminStats = Record<
  | "members"
  | "members_active"
  | "pending"
  | "joined_today"
  | "joined_7d"
  | "visits_today"
  | "visits_yesterday"
  | "visits_7d"
  | "logins_today"
  | "notes_today"
  | "notes_total"
  | "photos_total"
  | "edits_today"
  | "suspicious",
  number
>;

function StatsCards({ refreshKey }: { refreshKey: number }) {
  const [s, setS] = useState<AdminStats | null>(null);
  useEffect(() => {
    supabase.rpc("admin_stats").then(({ data }) => setS((data as AdminStats | null) ?? null));
  }, [refreshKey]);
  const n = (v?: number) => (v ?? 0).toLocaleString("ko-KR");
  const cards: { label: string; value: string; sub: string; warn?: boolean }[] = [
    { label: "회원", value: `${n(s?.members)}명`, sub: `가입 ${n(s?.members_active)} · 7일 +${n(s?.joined_7d)}` },
    { label: "오늘 가입", value: `${n(s?.joined_today)}명`, sub: `승인 대기 ${n(s?.pending)}`, warn: (s?.pending ?? 0) > 0 },
    { label: "오늘 방문", value: `${n(s?.visits_today)}명`, sub: `어제 ${n(s?.visits_yesterday)} · 7일 ${n(s?.visits_7d)}` },
    { label: "오늘 로그인", value: `${n(s?.logins_today)}회`, sub: `공유 의심 ${n(s?.suspicious)}명`, warn: (s?.suspicious ?? 0) > 0 },
    { label: "오늘 특이사항", value: `${n(s?.notes_today)}개`, sub: `전체 ${n(s?.notes_total)} · 사진 ${n(s?.photos_total)}` },
    { label: "오늘 정보 수정", value: `${n(s?.edits_today)}건`, sub: "주차·홀·촬영 정보" },
  ];
  return (
    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
      {cards.map((c) => (
        <div key={c.label} className={`rounded-xl border p-3 ${c.warn ? "border-rose-200 bg-rose-50/50" : "border-slate-200"}`}>
          <p className="text-xs text-slate-500">{c.label}</p>
          <p className="mt-0.5 text-lg font-extrabold">{s ? c.value : "–"}</p>
          <p className={`text-[11px] ${c.warn ? "font-semibold text-rose-600" : "text-slate-400"}`}>{c.sub}</p>
        </div>
      ))}
    </div>
  );
}

/* ───────────────────────── 최근 활동 ───────────────────────── */

type NoteRow = Tables<"venue_notes"> & {
  author: { nickname: string } | null;
  venue: { name: string; branch_name: string | null } | null;
};
type EditRow = Views<"edits_with_user">;

const FIELD_LABEL: Record<string, string> = {
  guest_free_minutes: "하객 무료 주차(분)",
  overtime_fee: "초과 요금",
  overtime_unit_minutes: "초과 요금 단위(분)",
  guest_free_methods: "무료 처리 방법",
  parking_capacity: "주차 규모",
  parking_notes: "주차 메모",
  official_vendor_designated: "원판 지정 업체",
  official_vendor_name: "원판 업체명",
  external_snap_policy: "외부 스냅",
  official_photo_timing: "원판 촬영 시점",
  flash_policy: "플래시",
  external_vendor_fee: "외부 업체 등록비",
  pass_required: "출입증",
  equipment_route: "장비 반입 동선",
  bridal_room_info: "신부대기실",
  photo_notes: "촬영 메모",
  name: "이름",
  floor: "층",
  hall_type: "홀 형태",
  start_time: "시작 시각",
  day_type: "요일",
  fee: "요금",
  walk_minutes: "도보(분)",
  memo: "메모",
  schedule_note: "예식 안내",
  interval_minutes: "예식 간격(분)",
};
const TABLE_LABEL: Record<string, string> = { venues: "예식장", halls: "홀", hall_schedules: "시간표", nearby_parking: "주변 주차장" };
const ACTION_LABEL: Record<string, string> = { insert: "추가", update: "수정", delete: "삭제" };

/** 선택형 값은 화면 라벨로 (tight → 협소) */
const VALUE_LABEL: Record<string, Record<string, string>> = {
  parking_capacity: PARKING_CAPACITY,
  guest_free_methods: GUEST_FREE_METHOD,
  external_snap_policy: EXTERNAL_SNAP_POLICY,
  official_photo_timing: OFFICIAL_PHOTO_TIMING,
  flash_policy: FLASH_POLICY,
  hall_type: HALL_TYPE,
  day_type: DAY_TYPE,
};

function short(v: unknown, field?: string | null): string {
  if (v === null || v === undefined) return "없음";
  if (typeof v === "boolean") return v ? "예" : "아니오";
  const map = field ? VALUE_LABEL[field] : undefined;
  if (map) {
    if (Array.isArray(v)) return v.map((x) => map[String(x)] ?? String(x)).join(", ") || "없음";
    if (typeof v === "string") return map[v] ?? v;
  }
  const t = typeof v === "string" ? v : JSON.stringify(v);
  return t.length > 30 ? t.slice(0, 30) + "…" : t;
}

function ActivityTab({ onChanged, pendingCount, goMembers }: { onChanged: () => void; pendingCount: number; goMembers: () => void }) {
  const [notes, setNotes] = useState<NoteRow[] | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [edits, setEdits] = useState<(EditRow & { venueName?: string })[] | null>(null);

  const load = useCallback(async () => {
    const [{ data: n }, { data: e }] = await Promise.all([
      supabase
        .from("venue_notes")
        .select("*, author:profiles!venue_notes_author_id_fkey(nickname), venue:venues!venue_notes_venue_id_fkey(name,branch_name)")
        .order("created_at", { ascending: false })
        .limit(30),
      supabase.from("edits_with_user").select("*").neq("table_name", "venue_notes").order("created_at", { ascending: false }).limit(30),
    ]);
    const list = (n ?? []) as NoteRow[];
    setNotes(list);
    const paths = list.flatMap((x) => x.photo_paths.map(thumbPath));
    if (paths.length) {
      const { data: signed } = await supabase.storage.from("venue-photos").createSignedUrls(paths, 3600);
      const m: Record<string, string> = {};
      signed?.forEach((x) => x.path && x.signedUrl && (m[x.path] = x.signedUrl));
      setThumbs(m);
    }
    const venueIds = [...new Set((e ?? []).map((x) => x.venue_id).filter(Boolean))] as string[];
    const names = new Map<string, string>();
    if (venueIds.length) {
      const { data: vs } = await supabase.from("venues").select("id,name,branch_name").in("id", venueIds);
      vs?.forEach((v) => names.set(v.id, venueTitle(v)));
    }
    setEdits((e ?? []).map((x) => ({ ...x, venueName: x.venue_id ? names.get(x.venue_id) : undefined })));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function removeNote(n: NoteRow) {
    if (!confirm(`${n.author?.nickname ?? "회원"} 의 특이사항을 삭제할까요?`)) return;
    const { error } = await supabase.from("venue_notes").delete().eq("id", n.id);
    if (error) return alert("삭제하지 못했어요: " + error.message);
    const files = n.photo_paths.flatMap((p) => [p, thumbPath(p)]);
    if (files.length) await supabase.storage.from("venue-photos").remove(files);
    load();
    onChanged();
  }

  return (
    <div className="mt-4 space-y-8">
      {pendingCount > 0 && (
        <button onClick={goMembers} className="w-full rounded-xl border border-rose-200 bg-rose-50 p-3 text-left text-sm font-semibold text-rose-700">
          승인 대기 중인 가입 신청 {pendingCount}건 › 회원 탭에서 승인
        </button>
      )}

      <VenueRequests />

      <section>
        <h2 className="font-bold">최근 특이사항 · 코멘트</h2>
        {!notes ? (
          <p className="mt-2 text-sm text-slate-400">불러오는 중…</p>
        ) : notes.length === 0 ? (
          <p className="mt-2 rounded-xl border border-dashed border-slate-200 p-5 text-center text-sm text-slate-400">아직 올라온 특이사항이 없어요</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200">
            {notes.map((n) => (
              <li key={n.id} className="p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/?v=${n.venue_id}`} className="font-semibold hover:underline">
                      {n.venue ? venueTitle(n.venue) : "예식장"}
                    </Link>
                    <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{n.section === "parking" ? "주차" : "촬영"}</span>
                    <p className="text-xs text-slate-400">
                      {n.author?.nickname ?? "탈퇴한 회원"} · {whenText(n.created_at)}
                    </p>
                  </div>
                  <button onClick={() => removeNote(n)} className="shrink-0 rounded px-2 py-1 text-xs text-rose-600 hover:bg-rose-50">
                    삭제
                  </button>
                </div>
                {n.photo_paths.length > 0 && (
                  <div className="mt-2 flex gap-1.5">
                    {n.photo_paths.map((p) => (
                      <div key={p} className="h-14 w-14 overflow-hidden rounded-md bg-slate-100">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {thumbs[thumbPath(p)] && <img src={thumbs[thumbPath(p)]} alt="" className="h-full w-full object-cover" />}
                      </div>
                    ))}
                  </div>
                )}
                {n.body && <p className="mt-1.5 break-words whitespace-pre-line text-slate-700"><Linkify text={n.body} /></p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="font-bold">최근 정보 수정</h2>
        {!edits ? (
          <p className="mt-2 text-sm text-slate-400">불러오는 중…</p>
        ) : edits.length === 0 ? (
          <p className="mt-2 rounded-xl border border-dashed border-slate-200 p-5 text-center text-sm text-slate-400">아직 수정된 정보가 없어요</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">
            {edits.map((e) => (
              <li key={e.id} className="px-3 py-2">
                <div className="flex flex-wrap items-baseline gap-x-1.5">
                  {e.venue_id ? (
                    <Link href={`/?v=${e.venue_id}`} className="font-semibold hover:underline">
                      {e.venueName ?? "예식장"}
                    </Link>
                  ) : (
                    <span className="font-semibold">예식장</span>
                  )}
                  <span className="text-slate-500">
                    {TABLE_LABEL[e.table_name ?? ""] ?? e.table_name} {ACTION_LABEL[e.action ?? ""] ?? e.action}
                  </span>
                </div>
                {e.action === "update" && e.field && (
                  <p className="text-xs text-slate-600">
                    {FIELD_LABEL[e.field] ?? e.field}: {short(e.old_value, e.field)} → <b>{short(e.new_value, e.field)}</b>
                  </p>
                )}
                <p className="text-[11px] text-slate-400">
                  {e.user_nickname ?? "알 수 없음"} · {e.created_at ? whenText(e.created_at) : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ───────────────────────── 회원 ───────────────────────── */

function MembersTab({ members, myUserId, reload }: { members: Member[] | null; myUserId: string; reload: () => Promise<void> }) {
  const [filter, setFilter] = useState("");
  const [onlySuspicious, setOnlySuspicious] = useState(false);
  const [openLog, setOpenLog] = useState<string | null>(null);

  const approved = useMemo(() => (members ?? []).filter((m) => m.approved_at), [members]);
  const pending = useMemo(() => (members ?? []).filter((m) => !m.approved_at), [members]);
  const shown = useMemo(() => {
    const q = filter.replace(/\s/g, "").toLowerCase();
    const base = approved.filter((m) => !onlySuspicious || isSuspicious(m.stats));
    if (!q) return base;
    return base.filter(
      (m) =>
        m.name.replace(/\s/g, "").includes(q) ||
        m.member_code?.toLowerCase().includes(q) ||
        m.email?.includes(q),
    );
  }, [approved, filter, onlySuspicious]);
  const suspiciousCount = useMemo(() => approved.filter((m) => isSuspicious(m.stats)).length, [approved]);
  const counts = useMemo(() => {
    const c = { invited: 0, active: 0, suspended: 0 };
    approved.forEach((m) => (c[m.status as keyof typeof c] += 1));
    return c;
  }, [approved]);

  async function update(m: Member, patch: Partial<Tables<"members">>, failMsg: string) {
    const { error } = await supabase.from("members").update(patch).eq("id", m.id);
    if (error) {
      alert(error.code === "23505" ? "이미 다른 회원이 쓰는 아이디예요." : `${failMsg}: ${error.message}`);
      return false;
    }
    await reload();
    return true;
  }

  async function editCode(m: Member) {
    const v = prompt(`${m.name} 님의 아이디 (예: AF_${m.name})`, m.member_code ?? "");
    if (v === null) return;
    if (!isValidMemberCode(v)) return alert("아이디는 2~30자, 띄어쓰기 없이 입력해주세요.");
    await update(m, { member_code: v.trim() }, "아이디를 바꾸지 못했어요");
  }

  async function remove(m: Member, what = "명단에서 삭제") {
    if (!confirm(`${m.member_code ?? m.name} (${m.email ?? "이메일 없음"}) 을(를) ${what}할까요?`)) return;
    const { error } = await supabase.from("members").delete().eq("id", m.id);
    if (error) return alert("삭제하지 못했어요: " + error.message);
    reload();
  }

  return (
    <div className="mt-4 space-y-8">
      <section className={`rounded-xl border p-4 ${pending.length ? "border-rose-200 bg-rose-50/40" : "border-slate-200"}`}>
        <h2 className="font-bold">
          가입 신청 {pending.length > 0 && <span className="ml-1 rounded-full bg-rose-600 px-2 py-0.5 text-xs text-white">{pending.length}</span>}
        </h2>
        {pending.length === 0 ? (
          <p className="mt-1 text-sm text-slate-500">승인을 기다리는 신청이 없어요.</p>
        ) : (
          <ul className="mt-3 divide-y divide-rose-100">
            {pending.map((m) => (
              <PendingRow
                key={m.id}
                m={m}
                onApprove={(code) => update(m, { approved_at: new Date().toISOString(), member_code: code }, "승인하지 못했어요")}
                onReject={() => remove(m, "가입 신청 거절(삭제)")}
              />
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-slate-400">
          아이디는 소속과 이름으로 미리 채워져 있어요 (언아더데이 AD_ · 에이모먼트 AM_ · 언아더데이 필름 AF_). 같은 이름이 있으면 고친 뒤 승인하세요.
        </p>
      </section>

      <AddMembers existing={members ?? []} onAdded={reload} />

      <section>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="font-bold">승인된 회원 {members ? approved.length : ""}</h2>
            <p className="text-xs text-slate-500">
              가입(로그인함) {counts.active} · 로그인 전 {counts.invited} · 정지 {counts.suspended}
            </p>
          </div>
          <label className={`flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm ${suspiciousCount ? "text-rose-700" : "text-slate-400"}`}>
            <input type="checkbox" checked={onlySuspicious} onChange={(e) => setOnlySuspicious(e.target.checked)} />
            공유 의심만 {suspiciousCount}
          </label>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="아이디·이름·이메일 검색"
            className="h-10 w-48 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-slate-500"
          />
        </div>
        {!members ? (
          <p className="mt-4 text-sm text-slate-400">불러오는 중…</p>
        ) : shown.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">회원이 없어요</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200">
            {shown.map((m) => {
              const me = m.user_id === myUserId;
              const st = STATUS_LABEL[m.status];
              return (
                <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      {m.member_code ?? <span className="text-amber-600">아이디 없음</span>}
                      <span className="ml-1.5 text-xs font-normal text-slate-500">
                        {m.name}
                        {m.team && ` · ${teamLabel(m.team)}`}
                      </span>
                      {m.role === "admin" && <span className="ml-1.5 text-xs font-normal text-slate-500">· 관리자</span>}
                      <button onClick={() => editCode(m)} className="ml-1.5 text-xs font-normal text-slate-400 underline hover:text-slate-900">
                        아이디 변경
                      </button>
                    </p>
                    <p className="break-all text-slate-500">
                      {m.email ?? <span className="text-amber-600">이메일 없음 — 로그인 불가</span>}
                      {m.joined_at && <span className="ml-2 text-xs text-slate-400">가입 {formatDate(m.joined_at)}</span>}
                    </p>
                    {m.stats && (
                      <button onClick={() => setOpenLog(openLog === m.id ? null : m.id)} className="mt-0.5 text-left text-xs text-slate-500 hover:text-slate-900">
                        최근 7일 로그인 {m.stats.logins_7d}회 · 기기 {m.stats.devices_7d}종 · 기기 전환 24시간 {m.stats.switches_24h}회 / 7일 {m.stats.switches_7d}회
                        <span className="ml-1 underline">{openLog === m.id ? "접기" : "접속 기록"}</span>
                      </button>
                    )}
                  </div>
                  {isSuspicious(m.stats) && <span className="rounded-md bg-rose-600 px-2 py-0.5 text-xs font-semibold text-white">공유 의심</span>}
                  <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${st.cls}`}>{st.text}</span>
                  {!me && (
                    <div className="flex gap-1">
                      {m.status === "suspended" ? (
                        <button onClick={() => update(m, { status: m.user_id ? "active" : "invited" }, "변경하지 못했어요")} className="rounded-lg px-2 py-1 text-xs text-slate-600 hover:bg-slate-100">
                          정지 해제
                        </button>
                      ) : (
                        <button onClick={() => update(m, { status: "suspended" }, "변경하지 못했어요")} className="rounded-lg px-2 py-1 text-xs text-slate-600 hover:bg-slate-100">
                          정지
                        </button>
                      )}
                      <button onClick={() => remove(m)} className="rounded-lg px-2 py-1 text-xs text-rose-600 hover:bg-rose-50">
                        삭제
                      </button>
                    </div>
                  )}
                  {openLog === m.id && m.user_id && <LoginLog userId={m.user_id} />}
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-2 text-xs text-slate-400">
          정지하면 그 회원은 즉시 로그아웃되고 다시 로그인할 수 없어요. ‘기기 전환’은 다른 기기의 로그인을 밀어내고 들어온 횟수예요 — 24시간 4회 이상 또는
          7일 12회 이상이면 ‘공유 의심’으로 표시돼요.
        </p>
      </section>
    </div>
  );
}

function PendingRow({ m, onApprove, onReject }: { m: Member; onApprove: (code: string) => Promise<boolean>; onReject: () => void }) {
  const [code, setCode] = useState(() => suggestCode(m.team, m.name));
  const [busy, setBusy] = useState(false);
  const ok = isValidMemberCode(code);
  return (
    <li className="py-3 text-sm">
      <p className="font-semibold">
        {m.name}
        {m.team && <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-normal text-slate-600">{teamLabel(m.team)}</span>}
        <span className="ml-2 text-xs font-normal text-slate-400">신청 {formatDate(m.created_at)}</span>
      </p>
      <p className="break-all text-slate-600">{m.email}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={`아이디 (예: AF_${m.name})`}
          className="h-9 w-48 rounded-lg border border-slate-300 bg-white px-2.5 text-sm outline-none focus:border-slate-600"
          aria-label={`${m.name} 아이디`}
        />
        <button
          disabled={!ok || busy}
          onClick={async () => {
            setBusy(true);
            await onApprove(code.trim());
            setBusy(false);
          }}
          className="h-9 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white disabled:opacity-40"
        >
          승인
        </button>
        <button onClick={onReject} className="h-9 rounded-lg px-3 text-xs text-rose-600 hover:bg-rose-50">
          거절
        </button>
      </div>
    </li>
  );
}

function AddMembers({ existing, onAdded }: { existing: Member[]; onAdded: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);
  const parsed = useMemo(() => parseMemberLines(text), [text]);
  const existingEmails = useMemo(() => new Set(existing.map((m) => m.email).filter(Boolean)), [existing]);
  const fresh = parsed.members.filter((m) => !existingEmails.has(m.email));
  const dupCount = parsed.members.length - fresh.length;

  async function submit() {
    if (!fresh.length) return;
    setBusy(true);
    setResult(null);
    setResultError(null);
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("members")
      .insert(fresh.map((m) => ({ name: m.name, email: m.email, member_code: m.code, team: m.team, approved_at: now })));
    setBusy(false);
    if (error) return setResultError(error.code === "23505" ? "이미 등록된 이메일·아이디가 섞여 있어요. 확인 후 다시 시도해주세요." : "등록하지 못했어요: " + error.message);
    setResult(`${fresh.length}명을 승인 상태로 등록했어요. 이제 이 이메일로 로그인할 수 있어요.`);
    setText("");
    onAdded();
  }

  return (
    <section className="rounded-xl border border-slate-200 p-4">
      <h2 className="font-bold">회원 직접 등록</h2>
      <p className="mt-1 text-sm text-slate-500">
        한 줄에 한 명씩 <b>아이디, 이메일</b>을 입력하세요 . 여기 등록한 사람은 <b>바로 승인</b>돼요. 엑셀에서 열을 복사해
        붙여넣거나 CSV 파일을 올려도 돼요.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder={"AD_홍길동, hong@example.com\nAM_홍순이\tsooni@example.com\t010-1234-5678"}
        className="mt-3 w-full rounded-lg border border-slate-200 p-3 font-mono text-sm outline-none focus:border-slate-500"
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <label className="cursor-pointer rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
          CSV 파일 선택
          <input type="file" accept=".csv,.txt,text/csv,text/plain" className="hidden" onChange={async (e) => e.target.files?.[0] && setText(await e.target.files[0].text())} />
        </label>
        <button disabled={busy || !fresh.length} onClick={submit} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
          {fresh.length ? `${fresh.length}명 등록` : "등록"}
        </button>
        {text.trim() && (
          <span className="text-xs text-slate-500">
            인식 {parsed.members.length}명{dupCount ? ` · 이미 등록된 이메일 ${dupCount}명 제외` : ""}
          </span>
        )}
      </div>
      {fresh.length > 0 && (
        <ul className="mt-2 text-xs text-slate-500">
          {fresh.slice(0, 5).map((m) => (
            <li key={m.email}>
              {m.code ?? <span className="text-amber-600">아이디 없음</span>} · {m.name} · {m.email}
            </li>
          ))}
          {fresh.length > 5 && <li>…외 {fresh.length - 5}명</li>}
        </ul>
      )}
      {parsed.errors.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-amber-700">
          {parsed.errors.slice(0, 10).map((e) => (
            <li key={e}>⚠ {e}</li>
          ))}
          {parsed.errors.length > 10 && <li>…외 {parsed.errors.length - 10}건</li>}
        </ul>
      )}
      {result && <p className="mt-2 text-sm text-emerald-700">{result}</p>}
      {resultError && <p className="mt-2 text-sm text-rose-600">{resultError}</p>}
    </section>
  );
}

function LoginLog({ userId }: { userId: string }) {
  const [rows, setRows] = useState<Tables<"login_events">[] | null>(null);
  useEffect(() => {
    supabase
      .from("login_events")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data }) => setRows(data ?? []));
  }, [userId]);
  if (!rows) return <p className="w-full text-xs text-slate-400">불러오는 중…</p>;
  return (
    <ul className="mt-1 w-full space-y-0.5 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap gap-x-2">
          <span className="tabular-nums text-slate-400">{whenText(r.created_at)}</span>
          <span>{r.device ?? "알 수 없는 기기"}</span>
          <span className="text-slate-400">{r.method === "oauth" ? "카카오" : r.method === "otp" || r.method === "magiclink" ? "이메일" : r.method ?? ""}</span>
          {r.replaced_other && <span className="text-rose-600">다른 기기 밀어냄</span>}
        </li>
      ))}
      {!rows.length && <li>기록 없음</li>}
    </ul>
  );
}

/* ───────────────────────── 설정 ───────────────────────── */

/** ISO → <input type="date"> 값 (한국 날짜) */
function toKstDate(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

function ViewSetting({
  settings,
  onChanged,
}: {
  settings: { requireLoginToView: boolean; requireLoginFrom: string | null } | null;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [date, setDate] = useState(toKstDate(settings?.requireLoginFrom ?? null));
  useEffect(() => setDate(toKstDate(settings?.requireLoginFrom ?? null)), [settings?.requireLoginFrom]);
  const on = !!settings?.requireLoginToView;
  const from = settings?.requireLoginFrom ? new Date(settings.requireLoginFrom) : null;
  const fromPassed = !!from && Date.now() >= from.getTime();

  async function save(patch: { require_login_to_view?: boolean; require_login_from?: string | null }) {
    setBusy(true);
    const { error } = await supabase.from("app_settings").update(patch).eq("id", true);
    if (error) alert("변경하지 못했어요: " + error.message);
    await onChanged();
    setBusy(false);
  }

  return (
    <div className="mt-4 space-y-4">
      <section className="rounded-xl border border-slate-200 p-4">
        <h2 className="font-bold">누가 볼 수 있나요</h2>
        <p className="mt-1 text-sm">
          지금:{" "}
          {on || fromPassed ? (
            <b className="text-rose-700">로그인한 회원만 볼 수 있어요</b>
          ) : (
            <b className="text-emerald-700">누구나 볼 수 있어요 (수정은 회원만)</b>
          )}
        </p>
      </section>

      <section className="rounded-xl border border-slate-200 p-4">
        <h2 className="font-bold">로그인 필수 시작일</h2>
        <p className="mt-1 text-sm text-slate-500">이 날짜 0시(한국 시간)부터 로그인한 회원만 볼 수 있게 자동으로 바뀌어요.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-10 rounded-lg border border-slate-300 px-3 text-sm" />
          <button
            disabled={busy || !date}
            onClick={() => save({ require_login_from: new Date(`${date}T00:00:00+09:00`).toISOString() })}
            className="h-10 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-40"
          >
            저장
          </button>
          {settings?.requireLoginFrom && (
            <button disabled={busy} onClick={() => save({ require_login_from: null })} className="h-10 rounded-lg px-3 text-sm text-slate-600 hover:bg-slate-100">
              시작일 지우기
            </button>
          )}
        </div>
        {from && (
          <p className={`mt-2 text-sm ${fromPassed ? "text-rose-700" : "text-slate-600"}`}>
            {toKstDate(settings!.requireLoginFrom)} 부터 {fromPassed ? "적용 중이에요" : "적용 예정이에요"}
          </p>
        )}
      </section>

      <section className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 p-4">
        <div>
          <h2 className="font-bold">지금 바로 로그인 필수</h2>
          <p className="text-sm text-slate-500">시작일과 상관없이 즉시 회원만 보게 해요.</p>
        </div>
        <button
          role="switch"
          aria-checked={on}
          disabled={busy}
          onClick={() => {
            if (!on && !confirm("지금 바로 로그인한 회원만 볼 수 있게 할까요?")) return;
            save({ require_login_to_view: !on });
          }}
          className={`relative h-7 w-12 shrink-0 rounded-full transition ${on ? "bg-emerald-500" : "bg-slate-300"} disabled:opacity-50`}
        >
          <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-6" : "left-1"}`} />
        </button>
      </section>
    </div>
  );
}

type RequestRow = Tables<"venue_requests"> & { requester: { nickname: string } | null };

/** 식장 등록 요청: 처리 전 요청을 위에, 처리한 요청은 최근 10건 */
function VenueRequests() {
  const [rows, setRows] = useState<RequestRow[] | null>(null);
  const [missing, setMissing] = useState(false);
  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("venue_requests")
      .select("*, requester:profiles!venue_requests_requested_by_fkey(nickname)")
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) return setMissing(true);
    // 처리 전 요청은 전부, 처리한 요청은 최근 것만
    setRows(data as RequestRow[]);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function setStatus(r: RequestRow, status: "done" | "rejected" | "pending") {
    const { error } = await supabase.from("venue_requests").update({ status }).eq("id", r.id);
    if (error) return alert("처리하지 못했어요: " + error.message);
    load();
  }
  // 삭제 요청: 예식장을 지도에서 바로 지움 (사본은 DB 백업에 남음)
  async function deleteVenue(r: RequestRow) {
    if (!confirm(`‘${r.name}’ 을(를) 지도에서 삭제할까요?\n홀·시간표·특이사항도 함께 지워져요.`)) return;
    const photos = await venuePhotoFiles(r.venue_id);
    const { data, error } = await supabase.rpc("admin_delete_venue", { p_request_id: r.id });
    if (error) return alert("삭제하지 못했어요: " + error.message);
    if (data === "deleted") await removePhotoFiles(photos);
    if (data === "not_pending") alert("이미 처리된 요청이에요.");
    if (data === "already_gone") alert("이미 지도에서 지워진 예식장이에요. 요청만 완료로 바꿨어요.");
    load();
  }

  if (missing) return null;
  const pending = rows?.filter((r) => r.status === "pending") ?? [];
  const handled = rows?.filter((r) => r.status !== "pending").slice(0, 10) ?? [];
  return (
    <section>
      <h2 className="font-bold">
        식장 등록·삭제 요청 {pending.length > 0 && <span className="ml-1 rounded-full bg-rose-500 px-2 py-0.5 text-xs text-white">{pending.length}</span>}
      </h2>
      {!rows ? (
        <p className="mt-2 text-sm text-slate-400">불러오는 중…</p>
      ) : rows.length === 0 ? (
        <p className="mt-2 rounded-xl border border-dashed border-slate-200 p-5 text-center text-sm text-slate-400">아직 등록 요청이 없어요</p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200">
          {[...pending, ...handled].map((r) => (
            <li key={r.id} className={`p-3 text-sm ${r.status !== "pending" ? "opacity-60" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold">
                    <span
                      className={`mr-1.5 rounded px-1.5 py-0.5 text-[11px] font-semibold ${r.kind === "delete" ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-700"}`}
                    >
                      {r.kind === "delete" ? "삭제" : "등록"}
                    </span>
                    {r.kind === "delete" && r.venue_id ? (
                      <Link href={`/?v=${r.venue_id}`} className="hover:underline">
                        {r.name}
                      </Link>
                    ) : (
                      r.name
                    )}
                    {r.status !== "pending" && (
                      <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-normal text-slate-600">
                        {r.status === "done" ? (r.kind === "delete" ? "삭제함" : "등록 완료") : "반려"}
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {r.requester?.nickname ?? "탈퇴한 회원"} · {whenText(r.created_at)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {r.status === "pending" ? (
                    <>
                      {r.kind === "delete" ? (
                        <button onClick={() => deleteVenue(r)} className="rounded bg-rose-600 px-2 py-1 text-xs text-white">
                          삭제
                        </button>
                      ) : (
                        <button onClick={() => setStatus(r, "done")} className="rounded bg-slate-900 px-2 py-1 text-xs text-white">
                          등록 완료
                        </button>
                      )}
                      <button onClick={() => setStatus(r, "rejected")} className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100">
                        반려
                      </button>
                    </>
                  ) : (
                    // 지도에서 이미 지운 삭제 요청은 되돌릴 수 없음
                    !(r.kind === "delete" && r.status === "done") && (
                      <button onClick={() => setStatus(r, "pending")} className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100">
                        되돌리기
                      </button>
                    )
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1.5 text-xs text-slate-400">등록 요청은 예식장 정보를 Claude에게 주면 지도에 추가해요. ‘등록 완료’는 표시만 바꿔요.</p>
    </section>
  );
}
