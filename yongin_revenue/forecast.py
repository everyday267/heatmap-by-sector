"""노선 단위 예상 표준운송원가(정산기준액) 산출 로직.

핵심 계산식
-----------
    항목별 예상금액 = 표준단가(항목, 차종) × 운행대수(차종) × 운행일수
    노선 표준운송원가 합계 = Σ 항목별 예상금액

용어 주의
--------
여기서 산출되는 금액은 노선입찰제 준공영제에서 사업자에게 인정되는
**표준운송원가(정산기준액)**이다. 실제 재정지원금은

    재정지원금 = 표준운송원가 − 실제 운송수입금(요금·광고 등)

으로 결정되므로, 이 모듈의 결과는 '사업자가 원가 기준으로 보장받는 상한'이자
재정지원·정산의 기준액이다. 실제 요금수입 자체는 별도 자료가 필요하다.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Tuple

from . import standard_costs as sc


@dataclass(frozen=True)
class Fleet:
    """한 노선을 구성하는 동일 차종 차량 집합."""

    vehicle_type: str
    vehicles: float  # 운행대수 (실수 허용: 평일/휴일 평균 등)

    def __post_init__(self) -> None:
        sc._validate_vehicle_type(self.vehicle_type)
        if self.vehicles < 0:
            raise ValueError(f"운행대수는 0 이상이어야 합니다: {self.vehicles}")


@dataclass
class RouteForecast:
    """노선 예상 표준운송원가 산출 결과."""

    route_no: str
    operating_days: float
    fleets: List[Fleet]
    # 항목별 합계 금액(원): {"인건비": ..., "연료비": ..., ...}
    category_amounts: Dict[str, int]
    # 차종별 소계: {"시내대형": {"인건비": ..., ...}, ...}
    per_fleet: Dict[str, Dict[str, int]] = field(default_factory=dict)

    @property
    def total(self) -> int:
        """노선 표준운송원가 합계(원)."""
        return sum(self.category_amounts.values())

    @property
    def total_vehicle_days(self) -> float:
        """총 운행대일(운행대수 × 운행일수 합)."""
        return sum(f.vehicles for f in self.fleets) * self.operating_days


def forecast_route(
    route_no: str,
    fleets: List[Fleet],
    operating_days: float,
) -> RouteForecast:
    """노선의 운행대수·운행일·표준단가를 결합해 항목별 예상금액을 산출한다.

    Parameters
    ----------
    route_no : 노선번호(표시용)
    fleets : 차종별 운행대수 목록
    operating_days : 운행일수 (예: 월 30.4일, 또는 평일수 등)
    """
    if operating_days < 0:
        raise ValueError(f"운행일수는 0 이상이어야 합니다: {operating_days}")
    if not fleets:
        raise ValueError("fleets(차종별 운행대수)가 최소 1개 필요합니다.")

    category_amounts: Dict[str, int] = {cat: 0 for cat in sc.CATEGORY_ORDER}
    per_fleet: Dict[str, Dict[str, int]] = {}

    for fleet in fleets:
        unit = sc.unit_cost_breakdown(fleet.vehicle_type)
        fleet_amounts: Dict[str, int] = {}
        for cat, unit_won in unit.items():
            amount = round(unit_won * fleet.vehicles * operating_days)
            fleet_amounts[cat] = amount
            category_amounts[cat] += amount
        # 같은 차종이 여러 fleet로 들어오면 누적
        if fleet.vehicle_type in per_fleet:
            for cat, amount in fleet_amounts.items():
                per_fleet[fleet.vehicle_type][cat] += amount
        else:
            per_fleet[fleet.vehicle_type] = fleet_amounts

    return RouteForecast(
        route_no=route_no,
        operating_days=operating_days,
        fleets=list(fleets),
        category_amounts=category_amounts,
        per_fleet=per_fleet,
    )


def category_share(forecast: RouteForecast) -> List[Tuple[str, int, float]]:
    """항목별 (이름, 금액, 비중) 목록을 금액 내림차순 정렬 없이 표준순서로 반환."""
    total = forecast.total or 1
    return [
        (cat, amount, amount / total)
        for cat, amount in forecast.category_amounts.items()
    ]
