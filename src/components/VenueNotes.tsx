"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/lib/database.types";
import { formatDate } from "@/lib/format";
import { PHOTO_MAX_SIDE, THUMB_MAX_SIDE, photoPath, resizeToJpeg, thumbPath } from "@/lib/image";
import { useAuth } from "./AuthProvider";

const BUCKET = "venue-photos";
const MAX_PHOTOS = 4;
const MAX_BODY = 500;
const URL_TTL_SEC = 60 * 60;

type Note = Tables<"venue_notes"> & { author: { nickname: string } | null };
type Urls = Record<string, string>; // path → 서명 URL

/**
 * 주차 / 촬영 특이사항: 회원이 글 + 사진(최대 4장)을 올리고 최신순으로 쌓임
 *   [사진][사진][사진][사진]   ← 썸네일, 누르면 크게
 *   코멘트
 *   닉네임 · 날짜
 */
export default function VenueNotes({ venueId, section }: { venueId: string; section: "parking" | "photo" }) {
  const { status, member, session } = useAuth();
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [urls, setUrls] = useState<Urls>({});
  const [error, setError] = useState<string | null>(null);
  const [notReady, setNotReady] = useState(false);
  const [composing, setComposing] = useState(false);
  const [viewer, setViewer] = useState<{ note: Note; index: number } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: e } = await supabase
      .from("venue_notes")
      .select("*, author:profiles!venue_notes_author_id_fkey(nickname)")
      .eq("venue_id", venueId)
      .eq("section", section)
      .order("created_at", { ascending: false });
    if (e) {
      // DB(0008)가 아직 적용되지 않은 경우: 오류 대신 "준비 중"
      if (e.code === "PGRST205" || e.code === "42P01" || /venue_notes/.test(e.message ?? "")) return setNotReady(true);
      return setError("특이사항을 불러오지 못했어요.");
    }
    const list = (data ?? []) as Note[];
    setNotes(list);
    // 썸네일·원본 서명 URL 한 번에 받기
    const paths = list.flatMap((n) => n.photo_paths.flatMap((p) => [thumbPath(p), p]));
    if (paths.length) {
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(paths, URL_TTL_SEC);
      const map: Urls = {};
      signed?.forEach((s) => s.path && s.signedUrl && (map[s.path] = s.signedUrl));
      setUrls(map);
    }
  }, [venueId, section]);

  useEffect(() => {
    load();
  }, [load]);

  const myId = session?.user.id;
  const isAdmin = member?.role === "admin";

  async function remove(n: Note) {
    if (!confirm("이 특이사항과 사진을 삭제할까요?")) return;
    const files = n.photo_paths.flatMap((p) => [p, thumbPath(p)]);
    if (files.length) await supabase.storage.from(BUCKET).remove(files);
    const { error: e } = await supabase.from("venue_notes").delete().eq("id", n.id);
    if (e) return alert("삭제하지 못했어요.");
    load();
  }

  if (notReady) {
    return <p className="rounded-xl border border-dashed border-slate-200 p-5 text-center text-sm text-slate-400">특이사항·사진 기능은 곧 열려요</p>;
  }

  return (
    <div>
      {status === "member" ? (
        composing ? (
          <Composer
            venueId={venueId}
            section={section}
            onCancel={() => setComposing(false)}
            onDone={() => {
              setComposing(false);
              load();
            }}
          />
        ) : (
          <button
            onClick={() => setComposing(true)}
            className="mb-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            <span className="text-lg leading-none">＋</span> 특이사항 쓰기 (사진 최대 4장)
          </button>
        )
      ) : null}

      {error && <p className="text-sm text-rose-600">{error}</p>}
      {!notes ? (
        <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
      ) : notes.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 p-5 text-center text-sm text-slate-400">아직 올라온 특이사항이 없어요</p>
      ) : (
        <ul className="space-y-3">
          {notes.map((n) => (
            <li key={n.id} className="rounded-xl border border-slate-200 p-3">
              {n.photo_paths.length > 0 && (
                <div className="mb-2 grid grid-cols-4 gap-1.5">
                  {n.photo_paths.map((p, i) => (
                    <button
                      key={p}
                      onClick={() => setViewer({ note: n, index: i })}
                      className="aspect-square overflow-hidden rounded-lg bg-slate-100"
                      aria-label={`사진 ${i + 1} 크게 보기`}
                    >
                      {urls[thumbPath(p)] && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={urls[thumbPath(p)]} alt="" loading="lazy" className="h-full w-full object-cover" />
                      )}
                    </button>
                  ))}
                </div>
              )}
              {n.body && <p className="text-sm whitespace-pre-line text-slate-800">{n.body}</p>}
              <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-slate-400">
                <span>
                  {n.author?.nickname ?? "탈퇴한 회원"} · {formatDate(n.created_at)}
                </span>
                {status === "member" && (n.author_id === myId || isAdmin) && (
                  <button onClick={() => remove(n)} className="rounded px-1.5 py-0.5 text-rose-500 hover:bg-rose-50">
                    삭제
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {status === "guest" && (
        <p className="mt-3 rounded-xl bg-slate-50 p-3 text-center text-xs text-slate-500">
          <Link href="/login" className="font-semibold underline">
            로그인
          </Link>
          한 회원은 특이사항과 사진을 올릴 수 있어요.
        </p>
      )}
      {viewer && (
        <Lightbox
          srcs={viewer.note.photo_paths.map((p) => urls[p] ?? urls[thumbPath(p)])}
          start={viewer.index}
          caption={viewer.note.body}
          onClose={() => setViewer(null)}
        />
      )}
    </div>
  );
}

/* ───────────────────────── 작성 ───────────────────────── */

function Composer({
  venueId,
  section,
  onCancel,
  onDone,
}: {
  venueId: string;
  section: "parking" | "photo";
  onCancel: () => void;
  onDone: () => void;
}) {
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<{ file: File; preview: string }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => files.forEach((f) => URL.revokeObjectURL(f.preview)), [files]);

  function addFiles(list: FileList | null) {
    if (!list) return;
    setError(null);
    const picked = Array.from(list).filter((f) => f.type.startsWith("image/") || /\.(jpe?g|png|heic|webp)$/i.test(f.name));
    const room = MAX_PHOTOS - files.length;
    if (picked.length > room) setError(`사진은 최대 ${MAX_PHOTOS}장까지예요. 앞의 ${room}장만 넣었어요.`);
    setFiles((cur) => [...cur, ...picked.slice(0, room).map((file) => ({ file, preview: URL.createObjectURL(file) }))]);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function submit() {
    if (!body.trim() && files.length === 0) return setError("내용을 쓰거나 사진을 넣어주세요.");
    setError(null);
    const noteId = crypto.randomUUID();
    const uploaded: string[] = [];
    try {
      const paths: string[] = [];
      for (let i = 0; i < files.length; i++) {
        setBusy(`사진 올리는 중 ${i + 1}/${files.length}`);
        const [full, thumb] = await Promise.all([
          resizeToJpeg(files[i].file, PHOTO_MAX_SIDE, 0.82),
          resizeToJpeg(files[i].file, THUMB_MAX_SIDE, 0.75),
        ]);
        const p = photoPath(venueId, noteId, i + 1);
        for (const [path, blob] of [
          [p, full],
          [thumbPath(p), thumb],
        ] as const) {
          const { error: e } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false });
          if (e) throw e;
          uploaded.push(path);
        }
        paths.push(p);
      }
      setBusy("저장 중…");
      const { error: e } = await supabase.from("venue_notes").insert({ id: noteId, venue_id: venueId, section, body: body.trim() || null, photo_paths: paths });
      if (e) throw e;
      onDone();
    } catch (e) {
      if (uploaded.length) await supabase.storage.from(BUCKET).remove(uploaded); // 실패하면 올린 사진 정리
      setError("올리지 못했어요. " + ((e as Error).message ?? ""));
      setBusy(null);
    }
  }

  return (
    <div className="mb-3 rounded-xl border border-slate-300 p-3">
      <div className="grid grid-cols-4 gap-1.5">
        {files.map((f, i) => (
          <div key={f.preview} className="relative aspect-square overflow-hidden rounded-lg bg-slate-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={f.preview} alt="" className="h-full w-full object-cover" />
            {!busy && (
              <button
                onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}
                aria-label="사진 빼기"
                className="absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-xs text-white"
              >
                ✕
              </button>
            )}
          </div>
        ))}
        {files.length < MAX_PHOTOS && !busy && (
          <button
            onClick={() => inputRef.current?.click()}
            className="flex aspect-square flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 text-slate-400 hover:bg-slate-50"
          >
            <span className="text-xl leading-none">＋</span>
            <span className="mt-1 text-[11px]">
              사진 {files.length}/{MAX_PHOTOS}
            </span>
          </button>
        )}
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY))}
        rows={3}
        placeholder={section === "parking" ? "예: 지하 2층은 SUV 진입 불가, 주말 오후엔 B1이 금방 차요" : "예: 본식 중 버진로드 진입 금지, 2층 발코니에서 촬영 가능"}
        className="mt-2 w-full resize-none text-sm outline-none placeholder:text-slate-400"
      />
      <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={(e) => addFiles(e.target.files)} />
      {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
      <div className="mt-3 flex items-center justify-between">
        <span className="text-[11px] text-slate-400">
          {body.length}/{MAX_BODY}
        </span>
        <div className="flex gap-2">
          <button onClick={onCancel} disabled={!!busy} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-40">
            취소
          </button>
          <button onClick={submit} disabled={!!busy} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {busy ?? "올리기"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── 크게 보기 ───────────────────────── */

function Lightbox({ srcs, start, caption, onClose }: { srcs: (string | undefined)[]; start: number; caption: string | null; onClose: () => void }) {
  const [i, setI] = useState(start);
  const touchX = useRef<number | null>(null);
  const go = useCallback((d: number) => setI((cur) => (cur + d + srcs.length) % srcs.length), [srcs.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose]);

  // 하단 시트 안에서 열려도 화면 전체를 덮도록 body 에 띄움
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-black/95"
      onClick={onClose}
      onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX.current == null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
        touchX.current = null;
      }}
      role="dialog"
      aria-label="사진 크게 보기"
    >
      <div className="flex items-center justify-between p-3 text-sm text-white/80">
        <span>
          {i + 1} / {srcs.length}
        </span>
        <button onClick={onClose} className="rounded-full px-3 py-1 hover:bg-white/10" aria-label="닫기">
          ✕
        </button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        {srcs[i] && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={srcs[i]} alt="" onClick={(e) => e.stopPropagation()} className="max-h-full max-w-full object-contain" />
        )}
        {srcs.length > 1 && (
          <>
            <button onClick={(e) => (e.stopPropagation(), go(-1))} className="absolute left-2 hidden rounded-full bg-white/10 px-3 py-2 text-white sm:block" aria-label="이전 사진">
              ‹
            </button>
            <button onClick={(e) => (e.stopPropagation(), go(1))} className="absolute right-2 hidden rounded-full bg-white/10 px-3 py-2 text-white sm:block" aria-label="다음 사진">
              ›
            </button>
          </>
        )}
      </div>
      {caption && <p className="p-4 text-center text-sm whitespace-pre-line text-white/90">{caption}</p>}
    </div>,
    document.body,
  );
}
