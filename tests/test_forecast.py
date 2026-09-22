"""표준단가 재구성과 노선 예상원가 산출 로직 검증 (네트워크 불필요)."""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from yongin_revenue import forecast as fc
from yongin_revenue import standard_costs as sc
from yongin_revenue.forecast import Fleet, forecast_route
from yongin_revenue import datago


# ---- 표준단가 재구성 -------------------------------------------------------

@pytest.mark.parametrize("vtype", sc.VEHICLE_TYPES)
def test_breakdown_sums_to_total(vtype):
    """항목별 대당·1일 단가의 합은 총원가와 정확히 일치해야 한다."""
    breakdown = sc.unit_cost_breakdown(vtype)
    assert sum(breakdown.values()) == sc.TOTAL_PER_VEHICLE_DAY[vtype]


@pytest.mark.parametrize("vtype", sc.VEHICLE_TYPES)
def test_documented_ratios_preserved(vtype):
    """문서에 명시된 인건비/연료비/감가상각비 비율이 그대로 반영돼야 한다."""
    total = sc.TOTAL_PER_VEHICLE_DAY[vtype]
    breakdown = sc.unit_cost_breakdown(vtype)
    for cat, ratio in sc.DOCUMENTED_RATIOS[vtype].items():
        assert breakdown[cat] == round(total * ratio)


def test_depreciation_matches_source_absolute():
    """감가상각비 재구성 값이 문서의 절대값과 근사(±1원)해야 한다."""
    expected = {"시내대형": 34_470, "시내중형": 26_800, "광역": 48_829}
    for vtype, want in expected.items():
        got = sc.unit_cost_breakdown(vtype)["차량감가상각비"]
        assert abs(got - want) <= max(1, round(want * 0.005))


def test_invalid_vehicle_type():
    with pytest.raises(ValueError):
        sc.unit_cost_breakdown("트럭")


# ---- 노선 예상원가 산출 ----------------------------------------------------

def test_forecast_multiplies_correctly():
    """항목별 예상금액 = 단가 × 대수 × 일수."""
    result = forecast_route("5001", [Fleet("광역", 10)], 30)
    unit = sc.unit_cost_breakdown("광역")
    for cat, unit_won in unit.items():
        assert result.category_amounts[cat] == round(unit_won * 10 * 30)
    assert result.total == round(sc.TOTAL_PER_VEHICLE_DAY["광역"] * 10 * 30)


def test_total_equals_unit_total_times_vehicle_days():
    result = forecast_route("A", [Fleet("시내대형", 12)], 25.5)
    assert result.total == round(sc.TOTAL_PER_VEHICLE_DAY["시내대형"] * 12 * 25.5)
    assert result.total_vehicle_days == pytest.approx(12 * 25.5)


def test_mixed_fleet_aggregates():
    """혼합 차종의 항목별 금액은 차종별 합과 같아야 한다."""
    result = forecast_route("B", [Fleet("광역", 5), Fleet("시내대형", 7)], 30)
    only_gj = forecast_route("B", [Fleet("광역", 5)], 30)
    only_dh = forecast_route("B", [Fleet("시내대형", 7)], 30)
    for cat in sc.CATEGORY_ORDER:
        assert result.category_amounts[cat] == (
            only_gj.category_amounts[cat] + only_dh.category_amounts[cat]
        )


def test_same_type_multiple_fleets_accumulate():
    result = forecast_route("C", [Fleet("시내중형", 3), Fleet("시내중형", 4)], 10)
    single = forecast_route("C", [Fleet("시내중형", 7)], 10)
    assert result.category_amounts == single.category_amounts
    assert set(result.per_fleet) == {"시내중형"}


def test_zero_days_is_zero():
    result = forecast_route("D", [Fleet("광역", 10)], 0)
    assert result.total == 0


def test_negative_days_rejected():
    with pytest.raises(ValueError):
        forecast_route("E", [Fleet("광역", 10)], -1)


def test_empty_fleets_rejected():
    with pytest.raises(ValueError):
        forecast_route("F", [], 30)


def test_category_share_sums_to_one():
    result = forecast_route("G", [Fleet("시내대형", 8)], 30.4)
    shares = fc.category_share(result)
    assert sum(s for _, _, s in shares) == pytest.approx(1.0, abs=1e-6)


# ---- 차종 매핑 -------------------------------------------------------------

@pytest.mark.parametrize("raw,expected", [
    ("광역버스", "광역"),
    ("직행좌석형시내버스", "광역"),
    ("마을버스", "시내중형"),
    ("일반형시내버스", "시내대형"),
    ("간선버스", "시내대형"),
    ("", "시내대형"),
])
def test_route_type_mapping(raw, expected):
    assert datago.map_route_type(raw) == expected
