"""
서울 웨딩홀·호텔 DB(xlsx) → halls / hall_schedules 입력 SQL 생성

  python3 -I scripts/halls-from-xlsx.py <xlsx> <venues.csv> [업체명,업체명] > out.sql

- 예식장은 도로명주소로 지도(venues)와 짝을 맞춤 (괄호·쉼표 뒤 상세주소는 무시)
- "11:00 / 12:30 ..." 처럼 시각이 있으면 시간표로, 없으면 원문을 예식 안내(schedule_note)로
- 예식 형태: 야외(층) > 채플(이름) > 동시·분리(둘 다 가능=비움) > 분리예식 > 동시예식 > 단독(이름)
- 같은 예식장·같은 홀 이름이 이미 있으면 덮어씀 (여러 번 실행해도 안전)
"""
import csv, json, re, sys
import openpyxl

PREFERRED = {"서울특별시 마포구 마포대로 92": "아펠가모"}  # 한 주소에 여러 곳: 이름에 이 글자가 든 곳
# 엑셀 주소가 DB와 다른데 같은 곳 (엑셀 주소 → DB 주소)
ROAD_ALIAS = {"서울특별시 송파구 법원로9길 26": "서울특별시 송파구 법원로11길 25"}  # 루이비스컨벤션 송파문정점
# CSV에 없고 운영 DB에 직접 등록한 곳 (상가업소번호 자리에 DB의 source_key)
EXTRA_VENUES = [
    {"상호명": "보테가마지오", "지점명": "", "도로명주소": "서울특별시 성동구 서울숲2길 32-14", "상가업소번호": "m:bottegamaggio-seongsu"},
    {"상호명": "더세인트", "지점명": "", "도로명주소": "서울특별시 구로구 경인로 662", "상가업소번호": "m:thesaint-guro"},
]
SKIP_FLOOR_SUFFIX = re.compile(r"^(B?\d+)층$")

def road(s):
    return re.sub(r"\s+", " ", re.sub(r"\(.*?\)", "", s or "").split(",")[0]).strip()

def lit(v):
    return "null" if v is None else "'" + str(v).replace("'", "''") + "'"

def hall_type(name, floor, text):
    if re.search(r"\(야외|^야외|야외가든", floor or ""): return "outdoor"   # "(야외)", "야외", "(야외가든)" — "야외 연계" 는 제외
    if re.search(r"동시\s*[·/]\s*분리", text): return None
    if "분리예식" in text: return "separate"
    if "동시예식" in text: return "simultaneous"
    if "단독" in name: return "standalone"
    return None

def times(text):
    # "17:00~18:00" 같은 범위는 시작 시각만
    text = re.sub(r"(\d{1,2}:\d{2})\s*~\s*\d{1,2}:\d{2}", r"\1", text)
    out = []
    for h, m in re.findall(r"(?<!\d)(\d{1,2}):(\d{2})(?!\d)", text):
        t = f"{int(h):02d}:{m}"
        if 6 <= int(h) <= 22 and t not in out: out.append(t)
    return out

def floor_value(f):
    f = (f or "").strip()
    m = SKIP_FLOOR_SUFFIX.match(f)
    return m.group(1) if m else (f or None)

def main(xlsx, venues_csv, only=None):
    ws = openpyxl.load_workbook(xlsx, data_only=True, read_only=True).worksheets[0]
    it = ws.iter_rows(values_only=True); hdr = next(it)
    rows = [dict(zip(hdr, r)) for r in it if r and r[0]]
    ven = list(csv.DictReader(open(venues_csv, encoding="utf-8-sig"))) + EXTRA_VENUES
    by_road = {}
    for v in ven: by_road.setdefault(road(v["도로명주소"]), []).append(v)

    halls, keys, sched, report, order = [], [], [], {"matched": {}, "unmatched": {}}, {}
    for r in rows:
        vname, a = r["웨딩홀·호텔명"], road(r["도로명 주소"])
        if only and vname not in only: continue
        a = ROAD_ALIAS.get(a, a)
        cands = by_road.get(a, [])
        if a in PREFERRED: cands = [v for v in cands if PREFERRED[a] in v["상호명"]]
        if len(cands) != 1:
            report["unmatched"].setdefault(vname, a); continue
        v = cands[0]
        report["matched"].setdefault(vname, f'{v["상호명"]} {v["지점명"]}'.strip())
        text = str(r["예식 시간 및 간격"] or "").strip()
        order[vname] = order.get(vname, 0) + 1
        note = (text + (f' (출처: {r["출처"]})' if r.get("출처") else ""))[:300]
        name = str(r["예식홀 이름"]).strip()
        # 이름은 나중에 바뀔 수 있어 상가업소번호(=source_key)가 있으면 그걸로 찾음
        key = f"{lit(v['도로명주소'])}, {lit(v.get('상가업소번호') or v['상호명'])}, {lit(name)}"
        keys.append(f"({key})")
        halls.append(f"({key}, {lit(floor_value(r['층수']))}, {lit(hall_type(name, r['층수'], text))}, {lit(note)}, {order[vname]})")
        ts = times(text)
        if ts: sched.append(f"({key}, {lit(' '.join(ts))})")

    print("-- 생성: scripts/halls-from-xlsx.py (여러 번 실행해도 안전)")
    print("with v(road, vk, hall, floor, hall_type, note, sort_order) as (values\n  " + ",\n  ".join(halls) + "\n)")
    print("insert into public.halls (venue_id, name, floor, hall_type, schedule_note, sort_order)")
    print("select ve.id, v.hall, v.floor, v.hall_type, v.note, v.sort_order from v join public.venues ve on ve.road_address = v.road and (ve.source_key = v.vk or ve.name = v.vk)")
    print("on conflict (venue_id, name) do update set floor = excluded.floor, hall_type = excluded.hall_type, schedule_note = excluded.schedule_note, sort_order = excluded.sort_order, checked_at = now();")
    print("with v(road, vk, hall) as (values\n  " + ",\n  ".join(keys) + "\n)")
    print("delete from public.hall_schedules s using public.halls h, public.venues ve, v where s.hall_id = h.id and h.venue_id = ve.id and ve.road_address = v.road and (ve.source_key = v.vk or ve.name = v.vk) and h.name = v.hall;")
    if sched:
        print("with v(road, vk, hall, ts) as (values\n  " + ",\n  ".join(sched) + "\n)")
        print("insert into public.hall_schedules (hall_id, start_time, day_type)")
        print("select h.id, t::time, 'common' from v join public.venues ve on ve.road_address = v.road and (ve.source_key = v.vk or ve.name = v.vk) join public.halls h on h.venue_id = ve.id and h.name = v.hall")
        print("  cross join unnest(string_to_array(v.ts, ' ')) t on conflict do nothing;")
    json.dump(report, sys.stderr, ensure_ascii=False, indent=1)

if __name__ == "__main__":
    # 세 번째 인자(선택): 이 엑셀 업체명만 (쉼표로 구분)
    main(sys.argv[1], sys.argv[2], set(sys.argv[3].split(",")) if len(sys.argv) > 3 else None)
