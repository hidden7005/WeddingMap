# 웨딩맵 — 웨딩 촬영자를 위한 예식장 지도

전국 예식장의 주차·홀 시간표·촬영 규정을 지도에서 확인하고 함께 입력·수정하는 모바일 우선 웹앱.
Next.js(App Router) + TypeScript + Tailwind / Supabase / 네이버 지도.

## 진행 상황

| 단계 | 내용 | 상태 |
|---|---|---|
| 1 | Supabase 스키마 + RLS + CSV import | ✅ 완료 (WeddingMap 프로젝트, 서울 리전에 적용됨) |
| 2 | 지도 화면 (마커·클러스터·검색·상세 시트, 읽기 전용) | |
| 3 | 로그인 + 입력·수정 폼 + 수정 이력 | |
| 4 | 필터, 완성도 색상, 공유 URL, 길찾기 | |
| 5 | 배포 설정 (Vercel, 네이버 지도 허용 도메인) | |

## 폴더 구조

```
supabase/migrations/
  20261108000001_init_schema.sql          테이블 (profiles, venues, nearby_parking, halls, hall_schedules, edits)
  20261108000002_triggers_and_history.sql 수정자·수정시각·최종 확인일 자동 갱신, 수정 이력 자동 기록
  20261108000003_views.sql                계산 뷰 (예식 간격·동시예식, 지도용 목록·완성도, 이력+이름)
  20261108000004_rls.sql                  권한 정책
  20261108000005_advisor_fixes.sql        Supabase 보안 점검 지적 사항 보완
supabase/setup_all.sql                    위 마이그레이션을 순서대로 합친 파일 (SQL Editor에 한 번에 붙여넣기용)
supabase/seed.sql                         CSV를 변환한 upsert SQL (스크립트로 생성)
scripts/import-venues.ts                  CSV → venues import
data/전국_예식장_목록_호텔포함.csv
```

## 1단계 실행 방법

```bash
npm install
cp .env.local.example .env.local   # Supabase URL·키 입력
```

**① 스키마 적용** — 둘 중 하나

- Supabase 대시보드 → SQL Editor 에 `supabase/setup_all.sql` 전체를 붙여넣고 실행
- 또는 Supabase CLI: `npx supabase link --project-ref <프로젝트ID>` 후 `npx supabase db push`

**② 예식장 데이터 넣기** — 둘 중 하나

```bash
npm run import:venues:dry   # 먼저 변환 결과만 확인 (DB 안 건드림)
npm run import:venues       # .env.local 의 SERVICE_ROLE_KEY 로 upsert
```

또는 서비스 키 없이 `supabase/seed.sql` 내용을 SQL Editor에 붙여넣어 실행.
(`npm run import:venues:dry -- --sql=supabase/seed.sql` 로 다시 생성 가능)

두 방법 모두 여러 번 실행해도 중복되지 않고, **사용자가 입력한 주차·촬영 정보는 덮어쓰지 않습니다.**

**③ 확인할 화면** — Supabase 대시보드

- Table Editor → `venues` : 821행 (wedding_hall 675 / hotel_4 68 / hotel_5 63 / auxiliary 15)
- SQL Editor:
  ```sql
  select completeness, count(*) from venue_map group by 1;            -- none 821
  select count(distinct road_address) from venue_map where same_address_count > 1;  -- 28
  ```
- Authentication → Policies : 6개 테이블 모두 RLS 켜짐

## 데이터 설계 요점

- **내부 id는 uuid**. CSV 재import용 고정 키 `source_key` = 상가업소번호, 없는 호텔(131곳)은 `h:` + (상호명|도로명주소) 해시.
- **같은 주소 묶기**: `road_address` 가 같으면 지도에서 마커 하나. `venue_map.same_address_count` 로 개수 제공.
  CSV 기준 **28개 주소 / 59곳** (요청서의 27개와 1개 차이 — CSV의 `같은주소_업소수` 열로 계산해도 28개).
- **예식 간격·동시예식은 저장하지 않음** → `hall_schedules_computed` 뷰가 계산
  - 간격: 같은 홀, 겹치는 요일의 다음 예식까지 분
  - 동시예식: 같은 예식장 **다른 홀**에 같은 시각 + 겹치는 요일 예식이 있으면 true
  - 요일 `common`(공통)은 토·일·평일 모두와 겹치는 것으로 처리
- **최종 확인일**은 섹션별: 주차 `parking_checked_at`, 촬영 `photo_checked_at`, 홀 `halls.checked_at`(시간표 변경 시 함께 갱신), 주변 주차장 `checked_at`.
  섹션 값이 바뀌면 트리거가 자동 갱신. 값 변경 없이 "정보 맞음 확인"만 할 때는 앱이 `*_checked_at` 을 직접 보냄.
- **수정 이력**: 로그인 사용자의 변경을 트리거가 필드 단위로 `edits` 에 자동 기록 (클라이언트는 쓰기 불가 → 위조 불가). import는 기록 안 함.
- **완성도** (`venue_map.completeness`): 주차·홀·촬영 3개 섹션 중
  - 주차 = 무료시간 / 주차규모 / 무료처리방법 / 업체차량 처리방법 중 하나라도 입력
  - 홀 = 시간표가 있는 홀이 1개 이상
  - 촬영 = 외부스냅 범위 / 원판 지정 여부 / 플래시 중 하나라도 입력
  - 3개 모두 → `complete`(초록), 일부 → `partial`(노랑), 없음 → `none`(회색)

## 권한 (RLS)

| | 비로그인 | 로그인 |
|---|---|---|
| 모든 테이블·뷰 읽기 | ✅ | ✅ |
| venues 주차·촬영 컬럼 수정 | ❌ | ✅ |
| venues 원본 컬럼(이름·주소·좌표 등) 수정, 행 추가·삭제 | ❌ | ❌ (import 스크립트만) |
| halls / hall_schedules / nearby_parking 추가·수정·삭제 | ❌ | ✅ |
| edits 쓰기 | ❌ | ❌ (트리거만) |

## 선택형 값 코드 ↔ 화면 라벨

| 컬럼 | 코드 → 라벨 |
|---|---|
| `category` | wedding_hall 예식장업 · hotel_4 호텔(4성) · hotel_5 호텔(5성) · auxiliary 보조(다른 업종 등록) |
| `guest_free_methods` (복수) | auto 자동 · front_desk 안내데스크 등록 · ticket 주차권 · plate_input 차량번호 입력 |
| `vendor_parking_methods` (복수) | same_as_guest 하객과 동일 · auto · front_desk · ticket · plate_input · paid 유료 · not_allowed 주차 불가 |
| `parking_capacity` | ample 넉넉 · normal 보통 · tight 협소 |
| `external_snap_policy` | all_allowed 전부 허용 · no_official 원판만 불가 · ceremony_restricted 본식 제한 · no_external 외부 업체 불가 |
| `official_photo_timing` | before 예식 전 선촬영 · after 예식 직후 · mixed 혼합 |
| `flash_policy` | allowed 허용 · limited 제한 · prohibited 금지 |
| `halls.hall_type` | standalone 단독 · separate 분리 · simultaneous 동시 · chapel 채플 · outdoor 야외 |
| `hall_schedules.day_type` | sat 토 · sun 일 · weekday 평일 · common 공통 |
