// 밀도 계산 도메인 로직 (DESIGN.md §5).
// 데이터 출처(샘플/공공데이터/API)를 전혀 모르는 순수 함수만 둔다.

const EARTH_RADIUS_M = 6_371_000;

const toRad = (deg) => (deg * Math.PI) / 180;

/** 두 위경도 사이의 거리(m) — Haversine 공식. */
export function haversineM(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 반경(m) 원의 면적(㎢). */
export function circleAreaKm2(radiusM) {
  const r = radiusM / 1000;
  return Math.PI * r * r;
}

/** 중심에서 radiusM 이내의 업소만, 가까운 순으로 거리(distanceM)를 붙여 반환. */
export function withinRadius(places, center, radiusM) {
  const out = [];
  for (const p of places) {
    const distanceM = haversineM(center, p);
    if (distanceM <= radiusM) out.push({ ...p, distanceM });
  }
  return out.sort((x, y) => x.distanceM - y.distanceM);
}

// perKm2 기준 등급 경계 (DESIGN.md §5.3, 초기값 · 튜닝 대상).
export const DENSITY_LEVELS = [
  { min: 40, level: "매우높음" },
  { min: 15, level: "높음" },
  { min: 5, level: "보통" },
  { min: 0, level: "낮음" },
];

export function densityLevel(perKm2) {
  return DENSITY_LEVELS.find((d) => perKm2 >= d.min).level;
}

/**
 * 밀도 계산.
 * @param {Place[]} places      contextRadiusM 안의 동일 업종 업소 (반경 바깥 비교용 포함)
 * @param {LatLng}  center
 * @param {number}  radiusM     분석 반경
 * @param {number} [contextRadiusM] 주변 평균을 낼 더 넓은 반경 (없으면 비교 생략)
 */
export function computeDensity(places, center, radiusM, contextRadiusM) {
  const inside = withinRadius(places, center, radiusM);
  const areaKm2 = circleAreaKm2(radiusM);
  const perKm2 = inside.length / areaKm2;

  let contextPerKm2 = null;
  let relative = null;
  if (contextRadiusM && contextRadiusM > radiusM) {
    const contextCount = withinRadius(places, center, contextRadiusM).length;
    contextPerKm2 = contextCount / circleAreaKm2(contextRadiusM);
    relative = contextPerKm2 > 0 ? perKm2 / contextPerKm2 : null;
  }

  return {
    count: inside.length,
    areaKm2,
    perKm2,
    level: densityLevel(perKm2),
    contextPerKm2,
    relative, // 주변 평균 대비 배수 (1.0 = 평균)
    places: inside,
    heatPoints: toHeatPoints(places),
  };
}

/** Leaflet.heat 입력 형식 [lat, lng, weight]. 기본 가중치 1 (DESIGN.md §5.4). */
export function toHeatPoints(places, weight = 1) {
  return places.map((p) => [p.lat, p.lng, weight]);
}

/** 결과를 한 줄 해석 문구로. */
export function interpret(result, categoryName, radiusM) {
  const where = `반경 ${formatDistance(radiusM)} 안에 ${categoryName} ${result.count}곳`;
  const rel =
    result.relative == null
      ? ""
      : result.relative >= 1.15
        ? ` — 주변 평균보다 ${result.relative.toFixed(1)}배 밀집`
        : result.relative <= 0.85
          ? ` — 주변 평균의 ${Math.round(result.relative * 100)}% 수준`
          : " — 주변 평균과 비슷";

  const advice = {
    매우높음: "경쟁이 매우 치열합니다. 광고 반경에서 제외하거나 뚜렷한 차별화가 필요합니다.",
    높음: "경쟁이 많은 편입니다. 광고 입찰가를 낮추거나 틈새 타깃을 노려보세요.",
    보통: "경쟁 수준이 보통입니다. 수요(인구·유동인구)와 함께 판단하세요.",
    낮음: "경쟁이 적습니다. 수요가 확인되면 진입·광고 집중 후보 지역입니다.",
  }[result.level];

  return { headline: where + rel + ".", advice };
}

export function formatDistance(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(m % 1000 === 0 ? 0 : 1)}km` : `${Math.round(m)}m`;
}
