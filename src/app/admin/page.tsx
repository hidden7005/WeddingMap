"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import type { Tables, Views } from "@/lib/database.types";
import { formatPhone } from "@/lib/phone";
import { parseMemberLines } from "@/lib/members";
import { formatDate } from "@/lib/format";
import { useAuth } from "@/components/AuthProvider";

type Stats = Views<"member_login_stats">;
type Member = Tables<"members"> & { nickname?: string; stats?: Stats };

/** 공유 의심 기준: 24시간 안에 기기 전환 4회 이상, 또는 7일간 12회 이상 */
function isSuspicious(st?: Stats) {
  return !!st && ((st.switches_24h ?? 0) >= 4 || (st.switches_7d ?? 0) >= 12);
}

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  invited: { text: "승인 · 로그인 전", cls: "bg-slate-100 text-slate-600" },
  active: { text: "가입", cls: "bg-emerald-50 text-emerald-700" },
  suspended: { text: "정지", cls: "bg-rose-50 text-rose-700" },
};

export default function AdminPage() {
  const { status, member, session, requireLogin, refresh } = useAuth();

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
  return <Admin myUserId={session!.user.id} requireLogin={!!requireLogin} onSettingsChanged={refresh} />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-dvh flex-col items-center justify-center p-6 text-center text-sm text-slate-600">{children}</main>;
}

function Admin({ myUserId, requireLogin, onSettingsChanged }: { myUserId: string; requireLogin: boolean; onSettingsChanged: () => Promise<void> }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [onlySuspicious, setOnlySuspicious] = useState(false);
  const [openLog, setOpenLog] = useState<string | null>(null);

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
    setMembers(
      (data ?? []).map((m) => ({
        ...m,
        nickname: m.user_id ? nick.get(m.user_id) : undefined,
        stats: m.user_id ? stats.get(m.user_id) : undefined,
      })),
    );
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const approved = useMemo(() => (members ?? []).filter((m) => m.approved_at), [members]);
  const pending = useMemo(() => (members ?? []).filter((m) => !m.approved_at), [members]);

  const shown = useMemo(() => {
    const q = filter.replace(/\s/g, "").toLowerCase();
    const base = approved.filter((m) => !onlySuspicious || isSuspicious(m.stats));
    if (!q) return base;
    const qPhone = q.replace(/\D/g, "");
    return base.filter(
      (m) =>
        m.name.replace(/\s/g, "").includes(q) ||
        m.email?.includes(q) ||
        (qPhone.length >= 3 && formatPhone(m.phone).replace(/\D/g, "").includes(qPhone)) ||
        m.nickname?.toLowerCase().includes(q),
    );
  }, [approved, filter, onlySuspicious]);
  const suspiciousCount = useMemo(() => approved.filter((m) => isSuspicious(m.stats)).length, [approved]);

  const counts = useMemo(() => {
    const c = { invited: 0, active: 0, suspended: 0 };
    approved.forEach((m) => (c[m.status as keyof typeof c] += 1));
    return c;
  }, [approved]);

  async function setStatus(m: Member, next: "suspended" | "active" | "invited") {
    const { error: e } = await supabase.from("members").update({ status: next }).eq("id", m.id);
    if (e) return alert("변경하지 못했어요: " + e.message);
    load();
  }

  async function approve(m: Member) {
    const { error: e } = await supabase.from("members").update({ approved_at: new Date().toISOString() }).eq("id", m.id);
    if (e) return alert("승인하지 못했어요: " + e.message);
    load();
  }

  async function reject(m: Member) {
    if (!confirm(`${m.name} (${m.email}) 의 가입 신청을 거절할까요?\n신청 내역이 삭제돼요.`)) return;
    const { error: e } = await supabase.from("members").delete().eq("id", m.id);
    if (e) return alert("거절하지 못했어요: " + e.message);
    load();
  }

  async function remove(m: Member) {
    if (!confirm(`${m.name} (${m.email ?? formatPhone(m.phone)}) 을(를) 명단에서 삭제할까요?\n삭제하면 이 이메일로 더 이상 로그인할 수 없어요.`)) return;
    const { error: e } = await supabase.from("members").delete().eq("id", m.id);
    if (e) return alert("삭제하지 못했어요: " + e.message);
    load();
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-extrabold">관리자</h1>
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-900">
          지도로 돌아가기 ›
        </Link>
      </div>

      <PendingRequests pending={pending} onApprove={approve} onReject={reject} />
      <ViewSetting requireLogin={requireLogin} onChanged={onSettingsChanged} />
      <AddMembers existing={members ?? []} onAdded={load} />

      <section className="mt-8">
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
            placeholder="이름·이메일·닉네임 검색"
            className="h-10 w-48 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-slate-500"
          />
        </div>
        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
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
                      {m.name}
                      {m.role === "admin" && <span className="ml-1.5 text-xs font-normal text-slate-500">관리자</span>}
                      {m.nickname && <span className="ml-1.5 text-xs font-normal text-slate-400">@{m.nickname}</span>}
                    </p>
                    <p className="break-all text-slate-500">
                      {m.email ?? <span className="text-amber-600">이메일 없음 — 로그인 불가</span>}
                      {m.phone && <span className="ml-2 text-xs text-slate-400">{formatPhone(m.phone)}</span>}
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
                        <button onClick={() => setStatus(m, m.user_id ? "active" : "invited")} className="rounded-lg px-2 py-1 text-xs text-slate-600 hover:bg-slate-100">
                          정지 해제
                        </button>
                      ) : (
                        <button onClick={() => setStatus(m, "suspended")} className="rounded-lg px-2 py-1 text-xs text-slate-600 hover:bg-slate-100">
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
          정지하면 그 회원은 즉시 로그아웃되고 다시 로그인할 수 없어요. ‘기기 전환’은 다른 기기의 로그인을 밀어내고 들어온 횟수예요 —
          24시간 4회 이상 또는 7일 12회 이상이면 ‘공유 의심’으로 표시돼요.
        </p>
      </section>
    </main>
  );
}

function PendingRequests({
  pending,
  onApprove,
  onReject,
}: {
  pending: Member[];
  onApprove: (m: Member) => void;
  onReject: (m: Member) => void;
}) {
  return (
    <section className={`mt-6 rounded-xl border p-4 ${pending.length ? "border-rose-200 bg-rose-50/40" : "border-slate-200"}`}>
      <h2 className="font-bold">
        가입 신청 {pending.length > 0 && <span className="ml-1 rounded-full bg-rose-600 px-2 py-0.5 text-xs text-white">{pending.length}</span>}
      </h2>
      {pending.length === 0 ? (
        <p className="mt-1 text-sm text-slate-500">승인을 기다리는 신청이 없어요.</p>
      ) : (
        <ul className="mt-3 divide-y divide-rose-100">
          {pending.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {m.name}
                  <span className="ml-2 text-xs font-normal text-slate-400">신청 {formatDate(m.created_at)}</span>
                </p>
                <p className="break-all text-slate-600">
                  {m.email}
                  {m.phone && <span className="ml-2 text-slate-400">{formatPhone(m.phone)}</span>}
                </p>
                {m.request_note && <p className="mt-0.5 text-xs text-slate-500">“{m.request_note}”</p>}
              </div>
              <div className="flex gap-1">
                <button onClick={() => onApprove(m)} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white">
                  승인
                </button>
                <button onClick={() => onReject(m)} className="rounded-lg px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50">
                  거절
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-slate-400">사이트의 로그인 화면에서 승인되지 않은 이메일을 입력하면 가입 신청을 할 수 있어요.</p>
    </section>
  );
}

function ViewSetting({ requireLogin, onChanged }: { requireLogin: boolean; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  async function toggle() {
    const next = !requireLogin;
    if (next && !confirm("로그인한 회원만 지도와 정보를 볼 수 있게 할까요?\n비회원은 로그인 화면만 보게 돼요.")) return;
    setBusy(true);
    const { error } = await supabase.from("app_settings").update({ require_login_to_view: next }).eq("id", true);
    if (error) alert("변경하지 못했어요: " + error.message);
    await onChanged();
    setBusy(false);
  }
  return (
    <section className="mt-6 flex items-center justify-between gap-4 rounded-xl border border-slate-200 p-4">
      <div>
        <h2 className="font-bold">로그인한 회원만 보기</h2>
        <p className="text-sm text-slate-500">{requireLogin ? "켜짐 — 비회원은 아무 정보도 볼 수 없어요." : "꺼짐 — 누구나 지도와 정보를 볼 수 있어요. (수정은 회원만)"}</p>
      </div>
      <button
        role="switch"
        aria-checked={requireLogin}
        disabled={busy}
        onClick={toggle}
        className={`relative h-7 w-12 shrink-0 rounded-full transition ${requireLogin ? "bg-emerald-500" : "bg-slate-300"} disabled:opacity-50`}
      >
        <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${requireLogin ? "left-6" : "left-1"}`} />
      </button>
    </section>
  );
}

function AddMembers({ existing, onAdded }: { existing: Member[]; onAdded: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const parsed = useMemo(() => parseMemberLines(text), [text]);
  const existingEmails = useMemo(() => new Set(existing.map((m) => m.email).filter(Boolean)), [existing]);
  const fresh = parsed.members.filter((m) => !existingEmails.has(m.email));
  const dupCount = parsed.members.length - fresh.length;

  async function onFile(f: File) {
    setText(await f.text());
  }

  async function submit() {
    if (!fresh.length) return;
    setBusy(true);
    setResult(null);
    const now = new Date().toISOString();
    const { error } = await supabase.from("members").insert(fresh.map((m) => ({ name: m.name, email: m.email, phone: m.phone, approved_at: now })));
    setBusy(false);
    if (error) return setResult(error.code === "23505" ? "이미 등록된 이메일이나 번호가 섞여 있어요. 목록을 새로고침한 뒤 다시 시도해주세요." : "등록하지 못했어요: " + error.message);
    setResult(`${fresh.length}명을 승인 상태로 등록했어요. 이제 이 이메일로 로그인할 수 있어요.`);
    setText("");
    onAdded();
  }

  return (
    <section className="mt-6 rounded-xl border border-slate-200 p-4">
      <h2 className="font-bold">회원 추가</h2>
      <p className="mt-1 text-sm text-slate-500">
        한 줄에 한 명씩 <b>이름, 이메일</b>을 입력하세요 (휴대폰 번호는 있으면 함께 저장). 여기 등록한 사람은 <b>바로 승인</b>돼요. 엑셀에서 열을 복사해
        붙여넣거나 CSV 파일을 올려도 돼요.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder={"홍길동, hong@example.com\n김철수\tkim@snap.kr\t010-1234-5678"}
        className="mt-3 w-full rounded-lg border border-slate-200 p-3 font-mono text-sm outline-none focus:border-slate-500"
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <label className="cursor-pointer rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
          CSV 파일 선택
          <input type="file" accept=".csv,.txt,text/csv,text/plain" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
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
      {parsed.errors.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-amber-700">
          {parsed.errors.slice(0, 10).map((e) => (
            <li key={e}>⚠ {e}</li>
          ))}
          {parsed.errors.length > 10 && <li>…외 {parsed.errors.length - 10}건</li>}
        </ul>
      )}
      {result && <p className="mt-2 text-sm text-emerald-700">{result}</p>}
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
          <span className="tabular-nums text-slate-400">{new Date(r.created_at).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
          <span>{r.device ?? "알 수 없는 기기"}</span>
          <span className="text-slate-400">{r.method === "oauth" ? "카카오" : r.method === "otp" || r.method === "magiclink" ? "이메일" : r.method ?? ""}</span>
          {r.replaced_other && <span className="text-rose-600">다른 기기 밀어냄</span>}
        </li>
      ))}
      {!rows.length && <li>기록 없음</li>}
    </ul>
  );
}
