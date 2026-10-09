// 인구 대비 경쟁 (경쟁 대비 수요).
//
// 인구는 행정동 단위로만 있으므로, 동 인구를 그 동 업소가 있는 100m 칸들에 고르게 나눠
// 반경 안 인구를 추정한다. 가게가 없는 산·공원에는 인구를 두지 않는다. 대신 가게가 거의 없는
// 대단지 아파트 안쪽 인구는 주변 상가 칸으로 쏠리므로, 반경 300m 이상에서 쓰는 것이 맞다.
//
// 지금 위치의 "업소 1곳당 인구"를 같은 반경의 기준점(src/benchmark.js)들과 비교해 순위를 매긴다.

import { levelFromPercentile, percentileOf, planarProjection, rankLabel } from "./benchmark.js";

export const POP_CELL_M = 100; // scripts/lib/sangga.mjs의 POP_CELL_M과 같아야 한다
export const MIN_POP = 200; // 반경 안 (타깃) 인구가 이보다 적으면 비율이 크게 흔들려 판단하지 않는다
export const RECOMMENDED_MIN_RADIUS_M = 300;

// ages[i] = 만 10*i ~ 10*i+9세 (마지막은 100세 이상)
export const AGE_GROUPS = [
  { key: "all", label: "전체", bands: null },
  { key: "0", label: "10세 미만", bands: [0] },
  { key: "10", label: "10대", bands: [1] },
  { key: "20", label: "20대", bands: [2] },
  { key: "30", label: "30대", bands: [3] },
  { key: "20-30", label: "20~30대", bands: [2, 3] },
  { key: "40-50", label: "40~50대", bands: [4, 5] },
  { key: "60+", label: "60대 이상", bands: [6, 7, 8, 9, 10] },
];
const groupOf = (key) => AGE_GROUPS.find((g) => g.key === key) ?? AGE_GROUPS[0];

export class PopulationGrid {
  /**
   * @param {Place[]} places        데이터셋 업소 (dong 포함)
   * @param {object}  bounds        데이터 범위
   * @param {{ meta, dongs: { name, total, ages[] }[] }} population  data/<id>-population.json
   * @param {{ name, cells }[]} dongMeta  데이터셋 meta.dongs (cells = 범위 밖 포함 칸 수)
   */
  constructor(places, bounds, population, dongMeta = []) {
    this.meta = population.meta;
    this.hasAges = population.meta?.hasAges !== false;
    const { toXY } = planarProjection(bounds);
    this._toXY = toXY;
    this._cache = new Map();

    // 칸마다 가장 많은 업소가 속한 동을 그 칸의 동으로 본다.
    const votes = new Map();
    for (const p of places) {
      if (!p.dong) continue;
      const { x, y } = toXY(p);
      const key = `${Math.floor(y / POP_CELL_M)}:${Math.floor(x / POP_CELL_M)}`;
      if (!votes.has(key)) votes.set(key, new Map());
      const v = votes.get(key);
      v.set(p.dong, (v.get(p.dong) ?? 0) + 1);
    }
    const cellDong = new Map();
    const viewCells = new Map(); // 동 → 범위 안 칸 수
    for (const [key, v] of votes) {
      const dong = [...v.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
      cellDong.set(key, dong);
      viewCells.set(dong, (viewCells.get(dong) ?? 0) + 1);
    }

    const popByDong = new Map(population.dongs.map((d) => [d.name, d]));
    const totalCells = new Map(dongMeta.map((d) => [d.name, d.cells]));
    this.missingDongs = [...viewCells.keys()].filter((n) => !popByDong.has(n)).sort();

    this.cells = [];
    for (const [key, dong] of cellDong) {
      const pop = popByDong.get(dong);
      if (!pop) continue;
      // 범위 밖까지 센 칸 수로 나눠야 범위에 걸친 동의 인구가 안쪽에 몰리지 않는다.
      const share = 1 / Math.max(totalCells.get(dong) ?? 0, viewCells.get(dong));
      const [i, j] = key.split(":").map(Number);
      this.cells.push({
        x: (j + 0.5) * POP_CELL_M,
        y: (i + 0.5) * POP_CELL_M,
        total: pop.total * share,
        ages: (pop.ages ?? []).map((v) => v * share),
      });
    }
  }

  _cellPop(cell, group) {
    if (!group.bands || !this.hasAges) return cell.total;
    let s = 0;
    for (const b of group.bands) s += cell.ages[b] ?? 0;
    return s;
  }

  _sumWithin(x, y, radiusM, group) {
    const r2 = radiusM * radiusM;
    let s = 0;
    for (const c of this.cells) {
      const dx = c.x - x;
      const dy = c.y - y;
      if (dx * dx + dy * dy <= r2) s += this._cellPop(c, group);
    }
    return s;
  }

  /** 반경 안 (타깃 연령) 인구 추정치. */
  popWithin(center, radiusM, groupKey = "all") {
    const { x, y } = this._toXY(center);
    return this._sumWithin(x, y, radiusM, groupOf(groupKey));
  }

  _referencePops(ref, radiusM, group) {
    const key = `${radiusM}|${group.key}`;
    if (!this._cache.has(key)) {
      this._cache.set(key, Float64Array.from(ref.points, (pt) => this._sumWithin(pt.x, pt.y, radiusM, group)));
    }
    return this._cache.get(key);
  }

  /**
   * 업소 1곳당 인구와 그 순위. 순위가 높을수록(= 인구에 비해 가게가 많을수록) 인구 대비 경쟁이 높다.
   * @returns {{ pop, perStore, percentile?, level?, label?, n?, reason? }}
   */
  demand({ center, radiusM, groupKey = "all", categoryCode, count, benchmark }) {
    const group = groupOf(groupKey);
    const pop = this.popWithin(center, radiusM, group.key);
    const perStore = count > 0 ? pop / count : null;
    if (pop < MIN_POP) return { pop, perStore, reason: "반경 안 인구가 적어 판단하기 어렵습니다" };

    const ref = benchmark.reference(radiusM);
    const raw = ref.raw?.get(categoryCode);
    const pops = this._referencePops(ref, radiusM, group);
    const ratios = [];
    for (let i = 0; i < ref.n; i++) {
      if (pops[i] >= MIN_POP) ratios.push((raw ? raw[i] : 0) / pops[i]);
    }
    if (ratios.length < 30) return { pop, perStore, reason: "비교할 기준점이 부족합니다" };

    const sorted = Float64Array.from(ratios).sort();
    const percentile = percentileOf(sorted, count / pop);
    return {
      pop,
      perStore,
      percentile,
      level: levelFromPercentile(percentile),
      label: rankLabel(percentile, count),
      n: sorted.length,
    };
  }
}

const HIGH = new Set(["높음", "매우높음"]);

/** 경쟁 강도(가게 수)와 인구 대비 경쟁을 함께 본 조언. */
export function combinedAdvice(storeLevel, demandLevel) {
  const storeHigh = HIGH.has(storeLevel);
  if (HIGH.has(demandLevel)) {
    return storeHigh
      ? "가게도 많고 인구에 비해서도 많은 과밀 상권입니다. 광고 반경에서 빼는 것을 먼저 검토하세요."
      : "가게 수는 많지 않지만 인구가 더 적어 이미 포화에 가깝습니다. 신규 진입·광고 확대는 신중하게.";
  }
  if (demandLevel === "낮음") {
    if (storeHigh) return "가게는 많지만 인구가 받쳐주는 상권입니다. 경쟁은 치열해도 수요가 있어 차별화하면 해볼 만합니다.";
    if (storeLevel === "낮음") return "가게도 적고 인구에 비해서도 적은 기회 후보입니다. 진입·광고 집중을 검토해 볼 만합니다.";
    return "인구에 비해 가게가 적은 편입니다. 진입·광고 확대를 검토해 볼 만합니다.";
  }
  return storeHigh
    ? "가게가 많고, 인구 대비로는 평범한 수준입니다. 차별화가 필요합니다."
    : "경쟁과 수요가 모두 보통 수준입니다. 타깃 연령을 바꿔 다시 보세요.";
}
