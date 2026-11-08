// DB 코드 ↔ 화면 라벨

export const CATEGORY: Record<string, string> = {
  wedding_hall: "웨딩홀",
  hotel_4: "호텔 4성",
  hotel_5: "호텔 5성",
  auxiliary: "기타 업종",
};

export const GUEST_FREE_METHOD: Record<string, string> = {
  auto: "자동",
  front_desk: "안내데스크 등록",
  ticket: "주차권",
  plate_input: "차량번호 입력",
};

export const PARKING_CAPACITY: Record<string, string> = {
  ample: "넉넉",
  normal: "보통",
  tight: "협소",
};

export const EXTERNAL_SNAP_POLICY: Record<string, string> = {
  all_allowed: "전부 허용",
  no_official: "원판만 불가",
  ceremony_restricted: "본식 제한",
  no_external: "외부 업체 불가",
};

export const OFFICIAL_PHOTO_TIMING: Record<string, string> = {
  before: "예식 전 선촬영",
  after: "예식 직후",
  mixed: "혼합",
};

export const FLASH_POLICY: Record<string, string> = {
  allowed: "허용",
  limited: "제한",
  prohibited: "금지",
};

export const HALL_TYPE: Record<string, string> = {
  standalone: "단독",
  separate: "분리",
  simultaneous: "동시",
  chapel: "채플",
  outdoor: "야외",
};

export const DAY_TYPE: Record<string, string> = {
  sat: "토요일",
  sun: "일요일",
  weekday: "평일",
  common: "공통",
};
export const DAY_TYPE_ORDER = ["common", "sat", "sun", "weekday"];

export function label(map: Record<string, string>, code: string | null | undefined) {
  if (code == null) return null;
  return map[code] ?? code;
}

export function isHotel(category: string | null | undefined) {
  return category === "hotel_4" || category === "hotel_5";
}
