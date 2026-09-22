"""data.go.kr(TAGO 국가대중교통정보) 실시간 호출 클라이언트.

용인시 노선의 **운행대수**와 **차종**을 공공데이터포털 API에서 조회한다.

사용 API (제공기관: 국토교통부 / 서비스ID 1613000)
--------------------------------------------------
- BusRouteInfoInqireService/getCtyCodeList   : 도시코드 목록 (용인시 코드 확인용)
- BusRouteInfoInqireService/getRouteNoList   : 노선번호로 노선 검색 (routeId·차종 확보)
- BusLcInfoInqireService/getRouteAcctoBusLcList : 노선별 실시간 버스 위치 → 운행대수 추정

운행대수 관련 주의
-----------------
`getRouteAcctoBusLcList`는 **호출 시점에 노선 위를 달리고 있는 차량**만 반환한다.
차고지 대기·정비 중 차량은 빠지므로 이 값은 '인가대수'가 아니라 **실시간 관측
최소값**이다. 정확한 인가/운행대수는
  (a) 여러 시간대에 반복 샘플링해 최대값을 취하거나,
  (b) 용인시청 인가대수 자료로 override(--vehicles)
하는 것을 권장한다.

인증키
------
공공데이터포털에서 발급받은 일반 인증키(Decoding)를 환경변수 DATAGO_SERVICE_KEY
로 전달한다. (URL 인코딩된 키가 아니라 디코딩 키를 넣어야 requests가 이중 인코딩
하지 않는다.)
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Dict, List, Optional

import requests

BASE = "https://apis.data.go.kr/1613000"
ROUTE_INFO = f"{BASE}/BusRouteInfoInqireService"
BUS_LOCATION = f"{BASE}/BusLcInfoInqireService"

# 참고용 도시코드 (TAGO). 반드시 --list-cities(getCtyCodeList)로 검증 후 사용할 것.
# 용인시는 통상 31190으로 알려져 있으나 서비스 버전에 따라 다를 수 있다.
KNOWN_CITY_CODES: Dict[str, int] = {
    "용인": 31190,
}

# TAGO routetp(노선유형) → 표준운송원가 차종 매핑
_ROUTE_TYPE_KEYWORDS = [
    (("광역", "직행좌석", "급행", "순환", "좌석"), "광역"),
    (("마을", "중형"), "시내중형"),
]
DEFAULT_VEHICLE_TYPE = "시내대형"


class DataGoError(RuntimeError):
    """data.go.kr 호출/파싱 오류."""


@dataclass
class RouteHit:
    route_id: str
    route_no: str
    route_type_raw: str
    start_node: str = ""
    end_node: str = ""

    @property
    def vehicle_type(self) -> str:
        return map_route_type(self.route_type_raw)


def map_route_type(route_type_raw: str) -> str:
    """TAGO 노선유형 문자열을 표준운송원가 차종으로 매핑."""
    text = route_type_raw or ""
    for keywords, vtype in _ROUTE_TYPE_KEYWORDS:
        if any(k in text for k in keywords):
            return vtype
    return DEFAULT_VEHICLE_TYPE


def _service_key(explicit: Optional[str]) -> str:
    key = explicit or os.environ.get("DATAGO_SERVICE_KEY")
    if not key:
        raise DataGoError(
            "인증키가 없습니다. 환경변수 DATAGO_SERVICE_KEY를 설정하거나 "
            "service_key 인자로 전달하세요. (공공데이터포털 Decoding 키)"
        )
    return key


def _get(url: str, params: Dict[str, object], service_key: Optional[str], timeout: int) -> dict:
    query = {"serviceKey": _service_key(service_key), "_type": "json", **params}
    try:
        resp = requests.get(url, params=query, timeout=timeout)
        resp.raise_for_status()
    except requests.RequestException as exc:  # 네트워크/HTTP 오류
        raise DataGoError(f"요청 실패: {url} ({exc})") from exc

    # 공공데이터포털은 오류 시 XML(에러코드)로 응답하기도 한다.
    ctype = resp.headers.get("Content-Type", "")
    if "json" not in ctype and not resp.text.lstrip().startswith("{"):
        raise DataGoError(
            f"JSON이 아닌 응답(대개 인증키/트래픽 오류): {resp.text[:300]}"
        )
    try:
        data = resp.json()
    except ValueError as exc:
        raise DataGoError(f"JSON 파싱 실패: {resp.text[:300]}") from exc

    header = (data.get("response", {}).get("header") or {})
    code = header.get("resultCode")
    if code not in (None, "00", 0):
        raise DataGoError(
            f"API 오류 resultCode={code} msg={header.get('resultMsg')}"
        )
    return data


def _items(data: dict) -> List[dict]:
    """response.body.items.item을 항상 list로 정규화."""
    body = data.get("response", {}).get("body") or {}
    items = body.get("items")
    if not items:  # 빈 문자열/None/빈 dict
        return []
    item = items.get("item") if isinstance(items, dict) else items
    if item is None:
        return []
    return item if isinstance(item, list) else [item]


def list_city_codes(service_key: Optional[str] = None, timeout: int = 10) -> List[dict]:
    """도시코드 목록 조회 (용인시 정확한 cityCode 확인용)."""
    data = _get(f"{ROUTE_INFO}/getCtyCodeList", {"numOfRows": 1000}, service_key, timeout)
    return _items(data)


def resolve_city_code(
    city_name: str,
    service_key: Optional[str] = None,
    timeout: int = 10,
) -> int:
    """도시명(부분일치)으로 cityCode를 조회. API 실패 시 KNOWN_CITY_CODES로 폴백."""
    try:
        for row in list_city_codes(service_key, timeout):
            name = str(row.get("cityname", ""))
            if city_name in name:
                return int(row["citycode"])
    except DataGoError:
        pass
    for known, code in KNOWN_CITY_CODES.items():
        if known in city_name:
            return code
    raise DataGoError(f"'{city_name}' 도시코드를 찾지 못했습니다. --list-cities로 확인하세요.")


def search_routes(
    city_code: int,
    route_no: str,
    service_key: Optional[str] = None,
    timeout: int = 10,
) -> List[RouteHit]:
    """노선번호로 노선을 검색해 routeId·차종을 확보."""
    data = _get(
        f"{ROUTE_INFO}/getRouteNoList",
        {"cityCode": city_code, "routeNo": route_no, "numOfRows": 100, "pageNo": 1},
        service_key,
        timeout,
    )
    hits: List[RouteHit] = []
    for row in _items(data):
        hits.append(
            RouteHit(
                route_id=str(row.get("routeid", "")),
                route_no=str(row.get("routeno", "")),
                route_type_raw=str(row.get("routetp", "")),
                start_node=str(row.get("startnodenm", "")),
                end_node=str(row.get("endnodenm", "")),
            )
        )
    return hits


def count_operating_vehicles(
    city_code: int,
    route_id: str,
    service_key: Optional[str] = None,
    timeout: int = 10,
) -> int:
    """노선별 실시간 버스 위치 목록의 대수를 반환(운행대수 실시간 관측값)."""
    data = _get(
        f"{BUS_LOCATION}/getRouteAcctoBusLcList",
        {"cityCode": city_code, "routeId": route_id, "numOfRows": 500, "pageNo": 1},
        service_key,
        timeout,
    )
    body = data.get("response", {}).get("body") or {}
    total = body.get("totalCount")
    if isinstance(total, int):
        return total
    if isinstance(total, str) and total.isdigit():
        return int(total)
    return len(_items(data))
