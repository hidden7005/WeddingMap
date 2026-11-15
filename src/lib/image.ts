/**
 * 올리기 전에 휴대폰에서 사진 줄이기 → JPEG
 * - 긴 변 maxSide 픽셀 이하로 (작으면 그대로 크기 유지)
 * - 사진의 회전 정보(EXIF)를 반영해 똑바로 저장
 */
export async function resizeToJpeg(file: Blob, maxSide: number, quality: number): Promise<Blob> {
  const bitmap = await loadBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("이미지를 처리할 수 없어요.");
  ctx.fillStyle = "#fff"; // 투명 PNG 배경
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  if ("close" in bitmap) bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("이미지 변환에 실패했어요."))), "image/jpeg", quality),
  );
}

async function loadBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* 일부 브라우저는 옵션 미지원 → 아래로 */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new Error("이 사진 형식은 열 수 없어요. (JPG·PNG로 올려주세요)");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const PHOTO_MAX_SIDE = 1600;
export const THUMB_MAX_SIDE = 400;

/** {venueId}/{noteId}/{n}.jpg  ↔  썸네일 {venueId}/{noteId}/{n}_t.jpg */
export function thumbPath(path: string) {
  return path.replace(/\.jpg$/, "_t.jpg");
}
export function photoPath(venueId: string, noteId: string, n: number) {
  return `${venueId}/${noteId}/${n}.jpg`;
}
