"""용인시 노선 예상 표준운송원가 산출 CLI.

예시
----
# 1) 운행대수를 직접 지정 (API 불필요)
python -m yongin_revenue.cli --route-no 5001 --vehicle-type 광역 --vehicles 20 --days 30.4

# 2) data.go.kr에서 실시간 운행대수 조회 (DATAGO_SERVICE_KEY 필요)
python -m yongin_revenue.cli --route-no 5001 --city 용인 --days 30.4 --live

# 3) 용인시 도시코드(cityCode) 확인
python -m yongin_revenue.cli --list-cities
"""
from __future__ import annotations

import argparse
import json
import sys
from typing import List, Optional

from . import datago
from .forecast import Fleet, RouteForecast, forecast_route
from .standard_costs import CATEGORY_BASIS, VEHICLE_TYPES


def _won(n: float) -> str:
    return f"{round(n):,}원"


def _render_text(fc: RouteForecast, show_basis: bool = False) -> str:
    lines: List[str] = []
    lines.append("=" * 64)
    lines.append(f" 노선 {fc.route_no}  예상 표준운송원가(사업자 수령액)")
    lines.append("=" * 64)
    fleet_desc = ", ".join(f"{f.vehicle_type} {f.vehicles:g}대" for f in fc.fleets)
    lines.append(f" 운행대수 : {fleet_desc}")
    lines.append(f" 운행일수 : {fc.operating_days:g}일")
    lines.append(f" 총 운행대일 : {fc.total_vehicle_days:g} 대·일")
    lines.append("-" * 64)
    lines.append(f" {'항목':<12}{'예상금액':>18}{'비중':>10}")
    lines.append("-" * 64)
    total = fc.total or 1
    for cat, amount in fc.category_amounts.items():
        share = amount / total * 100
        lines.append(f" {cat:<12}{_won(amount):>18}{share:>9.1f}%")
    lines.append("-" * 64)
    lines.append(f" {'합계':<12}{_won(fc.total):>18}{100.0:>9.1f}%")
    lines.append("=" * 64)
    if len(fc.per_fleet) > 1:
        lines.append(" [차종별 소계]")
        for vtype, amounts in fc.per_fleet.items():
            lines.append(f"  - {vtype}: {_won(sum(amounts.values()))}")
    if show_basis:
        lines.append(" [항목별 정산기준]")
        for cat in fc.category_amounts:
            lines.append(f"  - {cat}: {CATEGORY_BASIS.get(cat, '')}")
    lines.append("")
    lines.append(" ※ 총액 정산 방식: 사업자는 표준운송원가 전액을 수령합니다(= 예상 수령액).")
    lines.append("    요금 등 운송수입금은 관할관청(용인시)에 귀속됩니다.")
    return "\n".join(lines)


def _render_json(fc: RouteForecast) -> str:
    payload = {
        "route_no": fc.route_no,
        "operating_days": fc.operating_days,
        "fleets": [{"vehicle_type": f.vehicle_type, "vehicles": f.vehicles} for f in fc.fleets],
        "total_vehicle_days": fc.total_vehicle_days,
        "category_amounts": fc.category_amounts,
        "per_fleet": fc.per_fleet,
        "total": fc.total,
    }
    return json.dumps(payload, ensure_ascii=False, indent=2)


def _build_fleets(args: argparse.Namespace) -> List[Fleet]:
    """--vehicles/--vehicle-type 또는 --fleet(반복)로 fleet 목록 구성."""
    fleets: List[Fleet] = []
    if args.fleet:
        for spec in args.fleet:  # 형식: "차종:대수"
            try:
                vtype, count = spec.split(":")
                fleets.append(Fleet(vtype.strip(), float(count)))
            except ValueError as exc:
                raise SystemExit(f"--fleet 형식 오류(차종:대수): {spec!r} ({exc})")
    elif args.vehicles is not None:
        fleets.append(Fleet(args.vehicle_type, float(args.vehicles)))
    return fleets


def _live_fleet(args: argparse.Namespace) -> List[Fleet]:
    """data.go.kr에서 실시간 운행대수를 조회해 fleet 구성."""
    key = args.service_key
    city_code = args.city_code
    if city_code is None:
        city_code = datago.resolve_city_code(args.city, key)
        print(f"[info] {args.city} cityCode = {city_code}", file=sys.stderr)

    hits = datago.search_routes(city_code, args.route_no, key)
    if not hits:
        raise SystemExit(f"노선 '{args.route_no}'를 찾지 못했습니다(cityCode={city_code}).")
    if len(hits) > 1 and not args.route_id:
        print("[warn] 여러 노선이 검색되었습니다. --route-id로 지정하세요:", file=sys.stderr)
        for h in hits:
            print(f"    routeId={h.route_id} {h.route_no} "
                  f"[{h.route_type_raw}→{h.vehicle_type}] {h.start_node}~{h.end_node}",
                  file=sys.stderr)
    hit = next((h for h in hits if h.route_id == args.route_id), hits[0])

    count = datago.count_operating_vehicles(city_code, hit.route_id, key)
    vtype = args.vehicle_type_override or hit.vehicle_type
    print(f"[info] routeId={hit.route_id} 차종={vtype} 실시간 운행대수={count}", file=sys.stderr)
    if count == 0:
        print("[warn] 실시간 운행대수가 0입니다(운휴시간/차고지 대기). "
              "--vehicles로 인가대수를 지정하세요.", file=sys.stderr)
    return [Fleet(vtype, count)]


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="yongin-revenue",
        description="용인시 노선의 운행대수·운행일·표준단가를 결합해 항목별 예상 표준운송원가를 산출",
    )
    p.add_argument("--route-no", default="", help="노선번호(표시/검색용)")
    p.add_argument("--days", type=float, default=30.4, help="운행일수 (기본 30.4일=월평균)")

    # 운행대수 지정 방식
    p.add_argument("--vehicles", type=float, help="운행대수 직접 지정")
    p.add_argument("--vehicle-type", default="시내대형", choices=VEHICLE_TYPES,
                   help="--vehicles와 함께 쓰는 차종 (기본 시내대형)")
    p.add_argument("--fleet", action="append",
                   help="혼합 차종 지정. '차종:대수' 형식, 반복 가능. 예: --fleet 광역:12 --fleet 시내대형:8")

    # data.go.kr 실시간 조회
    p.add_argument("--live", action="store_true", help="data.go.kr에서 실시간 운행대수 조회")
    p.add_argument("--city", default="용인", help="도시명 (기본 용인)")
    p.add_argument("--city-code", type=int, dest="city_code", help="TAGO cityCode 직접 지정")
    p.add_argument("--route-id", default="", help="TAGO routeId (검색 결과가 여러 개일 때)")
    p.add_argument("--vehicle-type-override", choices=VEHICLE_TYPES,
                   help="실시간 조회 시 차종 자동매핑을 덮어씀")
    p.add_argument("--service-key", help="data.go.kr 인증키(미지정 시 DATAGO_SERVICE_KEY 사용)")
    p.add_argument("--list-cities", action="store_true", help="도시코드 목록 출력 후 종료")

    # 출력
    p.add_argument("--json", action="store_true", help="JSON으로 출력")
    p.add_argument("--basis", action="store_true", help="항목별 정산기준 함께 출력")
    return p


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)

    try:
        if args.list_cities:
            for row in datago.list_city_codes(args.service_key):
                print(f"{row.get('citycode')}\t{row.get('cityname')}")
            return 0

        if args.live:
            fleets = _live_fleet(args)
        else:
            fleets = _build_fleets(args)
    except datago.DataGoError as exc:
        print(f"[data.go.kr 오류] {exc}", file=sys.stderr)
        return 2

    if not fleets:
        raise SystemExit(
            "운행대수를 지정하세요: --vehicles, --fleet, 또는 --live 중 하나가 필요합니다."
        )

    fc = forecast_route(args.route_no or "(미지정)", fleets, args.days)
    print(_render_json(fc) if args.json else _render_text(fc, show_basis=args.basis))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
