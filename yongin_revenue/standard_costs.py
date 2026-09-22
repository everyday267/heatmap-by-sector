"""표준운송원가(표준단가) 데이터와 항목별 대당·1일 단가 산출.

기준 자료: 2024년 경기도 공공관리제 표준운송원가(경기교통공사 공개자료).
용인시 노선입찰제 조례는 경기도 표준운송원가를 검토·적용할 수 있도록 규정하고
있어, 용인시 자체 용역 수치를 확보하기 전까지 가장 근접한 실무 기준으로 사용한다.

산출 방식
---------
문서에는 차종별 총원가(원/대·일)와 **인건비·연료비·차량감가상각비**의 구성비만
명시되어 있고, 나머지 항목은 차종 공통 범위(예: 정비비 5.3~5.7%)로만 제시된다.
따라서 다음 규칙으로 항목별 대당·1일 단가를 재구성한다.

1. 총원가(TOTAL_PER_VEHICLE_DAY)를 앵커로 고정한다.
2. 문서에 차종별로 명시된 항목(DOCUMENTED_RATIOS)은 그 비율을 그대로 적용한다.
3. 남은 잔여분(총원가 − 명시항목 합)을 잔여 항목들의 대표 구성비
   (RESIDUAL_WEIGHTS, 문서 범위의 중앙값)에 비례해 배분한다.
4. 반올림 오차는 가장 큰 잔여 항목(정비비)에 흡수시켜 항목 합 = 총원가를 보장한다.

이 규칙 덕분에 (a) 문서가 확정한 값은 그대로 유지되고, (b) 항목 합이 항상
총원가와 정확히 일치하며, (c) 용인시 공식 수치가 확보되면 상수만 교체하면 된다.
"""
from __future__ import annotations

from typing import Dict, List

# 지원 차종
VEHICLE_TYPES: List[str] = ["시내대형", "시내중형", "광역"]

# 차종별 총 표준운송원가 (원/대·일) — 2024 경기도 공개자료
TOTAL_PER_VEHICLE_DAY: Dict[str, int] = {
    "시내대형": 949_723,
    "시내중형": 873_392,
    "광역": 973_846,
}

# 문서에 차종별로 명시된 항목 구성비 (고정)
# 인건비 = 운전직 인건비 + 기타복리후생비
DOCUMENTED_RATIOS: Dict[str, Dict[str, float]] = {
    "시내대형": {"인건비": 0.653, "연료비": 0.167},
    "시내중형": {"인건비": 0.710, "연료비": 0.109},
    "광역": {"인건비": 0.636, "연료비": 0.148},
}

# 문서에 절대값(원/대·일)으로 명시된 항목 — 반올림된 비율보다 우선한다.
# 차량감가상각비: 시내대형 34,470 / 시내중형 26,800 / 광역 48,829 (2024 경기도)
DOCUMENTED_ABSOLUTE: Dict[str, Dict[str, int]] = {
    "시내대형": {"차량감가상각비": 34_470},
    "시내중형": {"차량감가상각비": 26_800},
    "광역": {"차량감가상각비": 48_829},
}

# 잔여 항목의 대표 구성비 (문서 범위의 중앙값). 잔여분을 이 가중치로 배분한다.
#   정비비 5.3~5.7% / 일반관리비 4.1~4.6% / 보험료 1.6~1.8%
#   기타차량유지비 1.1~1.2% / 차고지비 0.2~0.3% / 성과이윤 1.7~2.6%
RESIDUAL_WEIGHTS: Dict[str, float] = {
    "정비비": 0.055,
    "일반관리비": 0.0435,
    "보험료": 0.017,
    "기타차량유지비": 0.0115,
    "차고지비": 0.0025,
    "성과이윤": 0.0215,
}

# 출력·정렬 순서
CATEGORY_ORDER: List[str] = [
    "인건비",
    "연료비",
    "정비비",
    "차량감가상각비",
    "보험료",
    "기타차량유지비",
    "일반관리비",
    "차고지비",
    "성과이윤",
]

# 항목별 정산기준(참고용 메타데이터)
CATEGORY_BASIS: Dict[str, str] = {
    "인건비": "한도 내 실비/협약단가 (노사 임금협정·4대보험 11.98%·퇴직급여 1/12)",
    "연료비": "실비 ((운행거리+충전공차거리)×연료단가)",
    "정비비": "협약단가 (업체별 60th 백분위수)",
    "차량감가상각비": "기준단가 (취득가액[구입가-보조금] 9년 정액법, 60th 백분위수)",
    "보험료": "협약단가 (업체별 60th 백분위수)",
    "기타차량유지비": "협약단가 (업체별 60th 백분위수)",
    "일반관리비": "협약단가 (관리직 0.17명/대, 임원 0.028명/대)",
    "차고지비": "기준단가 (공시지가, 대형 40㎡·중형 28㎡/대)",
    "성과이윤": "협약단가 ((인건비+경비+일반관리비)×2.7% 노선입찰형, 서비스평가 연동)",
}

RESIDUAL_ROUNDING_SINK = "정비비"  # 반올림 오차를 흡수할 항목

_MISSING = "차종은 {types} 중 하나여야 합니다: {got!r}"


def _validate_vehicle_type(vehicle_type: str) -> None:
    if vehicle_type not in TOTAL_PER_VEHICLE_DAY:
        raise ValueError(_MISSING.format(types=VEHICLE_TYPES, got=vehicle_type))


def unit_cost_breakdown(vehicle_type: str) -> Dict[str, int]:
    """차종별 항목별 대당·1일 표준단가(원)를 반환한다.

    반환 dict의 값 합계는 항상 TOTAL_PER_VEHICLE_DAY[vehicle_type]와 정확히 일치한다.
    """
    _validate_vehicle_type(vehicle_type)
    total = TOTAL_PER_VEHICLE_DAY[vehicle_type]

    # 1) 문서 명시 항목 (비율 기반 + 절대값 기반)
    fixed = {cat: round(total * ratio) for cat, ratio in DOCUMENTED_RATIOS[vehicle_type].items()}
    fixed.update(DOCUMENTED_ABSOLUTE.get(vehicle_type, {}))

    # 2) 잔여분 배분
    residual = total - sum(fixed.values())
    weight_sum = sum(RESIDUAL_WEIGHTS.values())
    residual_won = {
        cat: round(residual * weight / weight_sum) for cat, weight in RESIDUAL_WEIGHTS.items()
    }

    breakdown = {**fixed, **residual_won}

    # 3) 반올림 오차 보정 → 합계 == total 보장
    breakdown[RESIDUAL_ROUNDING_SINK] += total - sum(breakdown.values())

    # 4) 정렬
    return {cat: breakdown[cat] for cat in CATEGORY_ORDER if cat in breakdown}


def total_unit_cost(vehicle_type: str) -> int:
    """차종별 총 대당·1일 표준운송원가(원)."""
    _validate_vehicle_type(vehicle_type)
    return TOTAL_PER_VEHICLE_DAY[vehicle_type]
