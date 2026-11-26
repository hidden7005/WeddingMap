import { supabase } from "./supabase";
import { thumbPath } from "./image";

/** 예식장을 지우기 전에, 그 예식장 특이사항에 붙은 사진 파일 목록 (원본 + 썸네일) */
export async function venuePhotoFiles(venueId: string | null | undefined): Promise<string[]> {
  if (!venueId) return [];
  const { data } = await supabase.from("venue_notes").select("photo_paths").eq("venue_id", venueId);
  return (data ?? []).flatMap((n) => (n.photo_paths ?? []).flatMap((p: string) => [p, thumbPath(p)]));
}

/** 예식장을 지운 뒤 남은 사진 파일 정리 (실패해도 삭제 자체는 이미 끝났으므로 조용히 넘어감) */
export async function removePhotoFiles(files: string[]) {
  if (files.length) await supabase.storage.from("venue-photos").remove(files);
}
