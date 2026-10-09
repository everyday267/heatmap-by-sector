// 업종별 경쟁 강도 기준 (DESIGN.md §5.3 개선).
//
// 고정 기준(개/㎢)은 업종마다 흔한 정도가 달라 카페·미용실이 어디서나 "매우높음"이 된다.
// 대신 같은 데이터 범위 안에서 "상가가 하나라도 있는 cellM 칸"들을 기준점으로 삼아,
// 각 기준점의 반경 안 동일 업종 개수 분포에서 지금 위치가 몇 등인지로 등급을 매긴다.

const M_PER_DEG_LAT = 111_320;
const MIN_REFERENCE_POINTS = 30;

// 순위(0~1, 클수록 이 업종이 더 몰린 위치) → 등급.
export const PERCENTILE_LEVELS = [
  { min: 0.9, level: "매우높음" },
  { min: 0.7, level: "높음" },
  { min: 0.3, level: "보통" },
  { min: 0, level: "낮음" },
];

export function levelFromPercentile(pct) {
  return PERCENTILE_LEVELS.find((d) => pct >= d.min).level;
}

/** 오름차순 정렬된 counts에서 count보다 작은 값의 비율(less)과 같거나 작은 값의 비율(leq). */
export function rankOf(sortedCounts, count) {
  const n = sortedCounts.length;
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedCounts[mid] < count) lo = mid + 1;
    else hi = mid;
  }
  const less = lo;
  hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedCounts[mid] <= count) lo = mid + 1;
    else hi = mid;
  }
  return { less: less / n, leq: lo / n };
}

/**
 * 순위(0~1). 동점은 절반씩 나눠 센다(중간 순위): 기준점 대부분이 같은 개수인 고른 지역에서
 * 평범한 위치가 "낮음"으로 몰리지 않게. 반경 안에 0곳이면 경쟁이 없으므로 항상 0.
 */
export function percentileOf(sortedCounts, count) {
  if (count <= 0) return 0;
  const { less, leq } = rankOf(sortedCounts, count);
  return (less + leq) / 2;
}

/** "상위 25%" / "하위 30%" / "반경 안에 없음" 표시용. */
export function rankLabel(pct, count) {
  if (count <= 0) return "반경 안에 없음";
  return pct >= 0.5
    ? `상위 ${Math.max(1, Math.round((1 - pct) * 100))}%`
    : `하위 ${Math.max(1, Math.round(pct * 100))}%`;
}

export class DensityBenchmark {
  /**
   * @param {Place[]} places  데이터셋 전체 업소
   * @param {{south, west, north, east}} bounds  데이터 범위
   */
  constructor(places, bounds, { cellM = 100 } = {}) {
    this._cellM = cellM;
    this._cache = new Map(); // radiusM → { n, counts: Map<code, Int32Array(sorted)> }

    // 수 km 범위라 평면 좌표(m)로 계산해도 오차가 무시할 만하다. 반경 질의를 빠르게 하려고 미리 바꿔 둔다.
    const mLng = M_PER_DEG_LAT * Math.cos(((bounds.south + bounds.north) / 2) * (Math.PI / 180));
    this._width = (bounds.east - bounds.west) * mLng;
    this._height = (bounds.north - bounds.south) * M_PER_DEG_LAT;
    this._toXY = (p) => ({ x: (p.lng - bounds.west) * mLng, y: (p.lat - bounds.south) * M_PER_DEG_LAT });

    this._codes = [];
    const codeIndex = new Map();
    // 업소를 cellM 칸에 담아 둔다: 기준점(상가가 있는 칸의 중심)과 반경 질의 인덱스로 같이 쓴다.
    this._buckets = new Map(); // "i:j" → [{ x, y, c }]
    for (const p of places) {
      if (!codeIndex.has(p.categoryCode)) {
        codeIndex.set(p.categoryCode, this._codes.length);
        this._codes.push(p.categoryCode);
      }
      const { x, y } = this._toXY(p);
      const key = `${Math.floor(y / cellM)}:${Math.floor(x / cellM)}`;
      if (!this._buckets.has(key)) this._buckets.set(key, []);
      this._buckets.get(key).push({ x, y, c: codeIndex.get(p.categoryCode) });
    }
  }

  /** 반경 radiusM 기준의 업종별 개수 분포 (반경마다 한 번 계산해 캐시). */
  reference(radiusM) {
    if (this._cache.has(radiusM)) return this._cache.get(radiusM);

    const cell = this._cellM;
    const centers = [...this._buckets.keys()].map((k) => {
      const [i, j] = k.split(":").map(Number);
      return { i, j, x: (j + 0.5) * cell, y: (i + 0.5) * cell };
    });
    // 분석 원이 데이터 범위 밖으로 잘리는 기준점은 개수가 적게 세어지므로 뺀다.
    const inside = centers.filter(
      (c) => c.x >= radiusM && this._width - c.x >= radiusM && c.y >= radiusM && this._height - c.y >= radiusM,
    );
    const points = inside.length >= MIN_REFERENCE_POINTS ? inside : centers;

    const r2 = radiusM * radiusM;
    const reach = Math.ceil(radiusM / cell);
    const perCode = new Array(this._codes.length); // 업종 번호 → Int32Array(기준점 순서대로)
    points.forEach((pt, idx) => {
      for (let di = -reach; di <= reach; di++) {
        for (let dj = -reach; dj <= reach; dj++) {
          // 칸 전체가 원 밖이면 건너뛴다 (칸 사각형에서 중심까지 가장 가까운 거리로 판단).
          const gx = Math.max(0, Math.abs(dj) - 0.5) * cell;
          const gy = Math.max(0, Math.abs(di) - 0.5) * cell;
          if (gx * gx + gy * gy > r2) continue;
          const bucket = this._buckets.get(`${pt.i + di}:${pt.j + dj}`);
          if (!bucket) continue;
          for (const q of bucket) {
            const dx = q.x - pt.x;
            const dy = q.y - pt.y;
            if (dx * dx + dy * dy > r2) continue;
            (perCode[q.c] ??= new Int32Array(points.length))[idx]++;
          }
        }
      }
    });

    const counts = new Map();
    perCode.forEach((arr, c) => counts.set(this._codes[c], arr.sort()));
    const ref = { n: points.length, counts };
    this._cache.set(radiusM, ref);
    return ref;
  }

  /** 지금 위치의 개수가 같은 업종 분포에서 어디쯤인지. 기준점이 너무 적으면 null. */
  rank(categoryCode, radiusM, count) {
    const ref = this.reference(radiusM);
    if (ref.n < MIN_REFERENCE_POINTS) return null;
    // 이 업종이 어느 기준점에도 없으면 분포는 전부 0.
    const sorted = ref.counts.get(categoryCode) ?? new Int32Array(ref.n);
    const percentile = percentileOf(sorted, count);
    return { percentile, level: levelFromPercentile(percentile), label: rankLabel(percentile, count), n: ref.n };
  }
}
