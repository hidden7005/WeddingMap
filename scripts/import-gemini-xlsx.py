"""
제미나이가 채운 '언아더데이맵_서울경기_예식장_목록.xlsx' → 운영 DB 반영용 SQL

  python3 -I scripts/import-gemini-xlsx.py <xlsx> > out.sql 2> report.txt

규칙 (2026-11 사용자 요청)
  - 예식 시간: 시작 시각만 저장. 시작 시각이 없을 때만 '예식 간격(분)'을 halls.interval_minutes 에 저장
  - 예식 형태: 동시(=한 공간에서 예식+식사) / 분리(=예식홀과 연회장 분리) / 단독 / 야외. 채플은 쓰지 않음
  - 주차: 하객 무료 시간·초과 요금은 칸으로, 나머지는 위치와 금액만 메모로 (몇 대 주차 가능 같은 정보는 버림)
  - 예식장은 ID 로 찾음. 홀은 (예식장, 홀 이름) 기준으로 덮어씀
"""

import json
import re
import sys

import openpyxl

HALL_TYPE = {"동시": "simultaneous", "분리": "separate", "단독": "standalone", "야외": "outdoor"}  # 채플 → 없음


def lit(v):
    if v is None:
        return "null"
    if isinstance(v, (int, float)):
        return str(int(v))
    return "'" + str(v).replace("'", "''") + "'"


def times(text):
    out = []
    for h, m in re.findall(r"(?<!\d)(\d{1,2}):(\d{2})(?!\d)", str(text or "")):
        t = f"{int(h):02d}:{m}"
        if 6 <= int(h) <= 22 and t not in out:
            out.append(t)
    return sorted(out)


def minutes(s):
    """'1시간 30분' / '90분' / '2시간' → 분"""
    h = re.search(r"(\d+(?:\.\d+)?)\s*시간", s)
    m = re.search(r"(\d+)\s*분", s)
    total = (float(h.group(1)) * 60 if h else 0) + (int(m.group(1)) if m else 0)
    return int(total) if total else None


CAPACITY = re.compile(r"(약|총|내부|외부|동시|최대)?\s*[\d,]+(\s*~\s*[\d,]+)?\s*(대|면)(?![가-힣])")


def parse_parking(text):
    """→ (guest_free_minutes, overtime_fee, overtime_unit_minutes, notes)"""
    if not text:
        return None, None, None, None
    free = fee = unit = None
    notes = []
    for seg in re.split(r"\s+/\s+", str(text).strip()):
        seg = seg.strip()
        # 하객 무료 시간 (범위면 짧은 쪽)
        mf = re.search(r"하객\s*((?:\d+(?:\.\d+)?\s*(?:~\s*\d+(?:\.\d+)?\s*)?시간)?\s*(?:\d+\s*분)?)\s*무료", seg)
        if mf and free is None and mf.group(1).strip():
            span = re.sub(r"(\d+)\s*~\s*\d+\s*시간", r"\1시간", mf.group(1))
            free = minutes(span)
            if "~" in mf.group(1):
                notes.append(f"하객 무료 {mf.group(1).strip()}")
        # 초과 요금: N분당 X원 → 원래 단위 그대로 저장 (환산하지 않음)
        mo = re.search(r"초과\s*(\d+)\s*분당\s*([\d,]+)\s*원", seg)
        if mo and fee is None:
            unit, fee = int(mo.group(1)), int(mo.group(2).replace(",", ""))
        # 메모로 남길 것: 위치, 금액(일반·발렛 요금 등). 대수·혼주·버스·확인필요는 버림
        rest = seg
        if mf:
            rest = rest.replace(mf.group(0), "")
        if mo:
            rest = rest.replace(mo.group(0), "")
        rest = CAPACITY.sub("", rest)
        rest = re.sub(r"\([^)]*(대|미공개|확인 필요|표기)[^)]*\)", "", rest)
        rest = re.sub(r"\([^)]*\d+\s*\+[^)]*\)|\(\s*\)", "", rest)  # (내부 150+외부 300) 같은 대수 내역
        rest = re.sub(r"^\((.*)\)$", r"\1", rest.strip())  # 전체가 괄호면 벗김
        rest = re.sub(r"^[\s,·]+|[\s,·]+$", "", rest)
        rest = re.sub(r"\s{2,}", " ", rest)
        if not rest or re.search(r"혼주|버스|확인 필요|미공개|만차", rest):
            continue
        if re.search(r"원|무료|지하|층|B\d|주차장|주차타워|타워|센터|빌딩|건물|등록", rest):
            notes.append(rest)
    return free, fee, unit, (" / ".join(notes)[:500] or None)


def main(path):
    ws = openpyxl.load_workbook(path, data_only=True, read_only=True)["예식장"]
    it = ws.iter_rows(values_only=True)
    next(it)
    rows = [r for r in it if r and r[0]]

    halls, sched, parking = [], [], {}
    venues_with_halls = []
    order = {}
    report = {"halls": 0, "with_times": 0, "interval_only": 0, "chapel_cleared": 0, "parking": 0, "examples": []}
    for r in rows:
        vid = str(r[0]).strip()
        hall, floor, htype, ts, interval, park = r[8], r[9], r[10], r[11], r[12], r[13]
        if park and vid not in parking:
            p = parse_parking(park)
            if any(x is not None for x in p):
                parking[vid] = p
                if len(report["examples"]) < 12:
                    report["examples"].append({"원문": park, "무료(분)": p[0], "초과": f"{p[2]}분당 {p[1]}원" if p[1] else None, "메모": p[3]})
        if not hall:
            continue
        name = re.sub(r"\s+", " ", str(hall)).strip()[:60]
        if vid not in venues_with_halls:
            venues_with_halls.append(vid)
        order[vid] = order.get(vid, 0) + 1
        t = times(ts)
        if htype == "채플":
            report["chapel_cleared"] += 1
        iv = None if t else (int(interval) if isinstance(interval, (int, float)) and 10 <= interval <= 600 else None)
        fl = str(floor).strip()[:30] if floor not in (None, "") else None
        if fl:
            fl = re.sub(r"^(B?\d+)층$", r"\1", fl)
        halls.append(f"({lit(vid)}::uuid, {lit(name)}, {lit(fl)}, {lit(HALL_TYPE.get(str(htype).strip()) if htype else None)}, {lit(iv)}, {order[vid]})")
        report["halls"] += 1
        if t:
            report["with_times"] += 1
            sched.append(f"({lit(vid)}::uuid, {lit(name)}, {lit(' '.join(t))})")
        elif iv:
            report["interval_only"] += 1

    print("-- 생성: scripts/import-gemini-xlsx.py")
    print("begin;")
    print("create temp table x_halls (venue_id uuid, name text, floor text, hall_type text, interval_minutes int, sort_order int) on commit drop;")
    print("insert into x_halls values\n  " + ",\n  ".join(halls) + ";")
    # 엑셀에 홀이 있는 예식장: 엑셀에 없는 홀은 지움 (회원이 직접 고친 홀은 남김)
    print("delete from public.halls h where h.venue_id in (select distinct venue_id from x_halls) and h.updated_by is null")
    print("  and not exists (select 1 from x_halls x where x.venue_id = h.venue_id and x.name = h.name);")
    print("insert into public.halls (venue_id, name, floor, hall_type, interval_minutes, sort_order)")
    print("select x.venue_id, x.name, x.floor, x.hall_type, x.interval_minutes, x.sort_order from x_halls x join public.venues v on v.id = x.venue_id")
    print("on conflict (venue_id, name) do update set floor = excluded.floor, hall_type = excluded.hall_type,")
    print("  interval_minutes = excluded.interval_minutes, sort_order = excluded.sort_order, checked_at = now();")
    if sched:
        print("create temp table x_sched (venue_id uuid, name text, ts text) on commit drop;")
        print("insert into x_sched values\n  " + ",\n  ".join(sched) + ";")
        print("delete from public.hall_schedules s using public.halls h, x_sched x")
        print("  where s.hall_id = h.id and h.venue_id = x.venue_id and h.name = x.name and s.day_type = 'common';")
        print("insert into public.hall_schedules (hall_id, start_time, day_type)")
        print("select h.id, t::time, 'common' from x_sched x join public.halls h on h.venue_id = x.venue_id and h.name = x.name")
        print("  cross join unnest(string_to_array(x.ts, ' ')) t on conflict do nothing;")
    if parking:
        vals = [f"({lit(k)}::uuid, {lit(f)}, {lit(fee)}, {lit(u)}, {lit(n)})" for k, (f, fee, u, n) in parking.items()]
        print("update public.venues v set guest_free_minutes = coalesce(p.free, v.guest_free_minutes),")
        print("  overtime_fee = coalesce(p.fee, v.overtime_fee), overtime_unit_minutes = coalesce(p.unit, v.overtime_unit_minutes),")
        print("  parking_notes = coalesce(p.notes, v.parking_notes)")
        print("from (values\n  " + ",\n  ".join(vals) + "\n) p(id, free, fee, unit, notes) where v.id = p.id;")
        report["parking"] = len(parking)
    print("commit;")
    report["venues_with_halls"] = len(venues_with_halls)
    json.dump(report, sys.stderr, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main(sys.argv[1])
