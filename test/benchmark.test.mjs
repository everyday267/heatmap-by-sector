import { test } from "node:test";
import assert from "node:assert/strict";
import { DensityBenchmark, rankOf, rankLabel, levelFromPercentile, percentileOf } from "../src/benchmark.js";

const M_LAT = 111_320;
const M_LNG = M_LAT * Math.cos((37.6 * Math.PI) / 180);
const B = { south: 37.58, west: 127.0, north: 37.58 + 3000 / M_LAT, east: 127.0 + 3000 / M_LNG }; // 3km × 3km
const at = (xM, yM, code = "cafe") => ({ lat: B.south + yM / M_LAT, lng: B.west + xM / M_LNG, categoryCode: code });

test("rankOf: 작은 값 비율(less)과 같거나 작은 값 비율(leq), 동점 처리", () => {
  const s = Int32Array.from([0, 0, 1, 2, 2, 2, 5, 9, 9, 10]);
  assert.deepEqual(rankOf(s, 2), { less: 0.3, leq: 0.6 });
  assert.deepEqual(rankOf(s, 0), { less: 0, leq: 0.2 });
  assert.deepEqual(rankOf(s, 3), { less: 0.6, leq: 0.6 });
  assert.deepEqual(rankOf(s, 99), { less: 1, leq: 1 });
});

test("levelFromPercentile: 상위 10/30/70% 경계", () => {
  assert.equal(levelFromPercentile(0), "낮음");
  assert.equal(levelFromPercentile(0.29), "낮음");
  assert.equal(levelFromPercentile(0.3), "보통");
  assert.equal(levelFromPercentile(0.69), "보통");
  assert.equal(levelFromPercentile(0.7), "높음");
  assert.equal(levelFromPercentile(0.9), "매우높음");
  assert.equal(levelFromPercentile(1), "매우높음");
});

test("percentileOf: 동점은 절반씩, 0곳은 항상 0", () => {
  const s = Int32Array.from([0, 0, 1, 2, 2, 2, 5, 9, 9, 10]);
  assert.ok(Math.abs(percentileOf(s, 2) - 0.45) < 1e-12); // (0.3 + 0.6) / 2
  assert.ok(Math.abs(percentileOf(s, 10) - 0.95) < 1e-12);
  assert.equal(percentileOf(s, 0), 0);
  // 기준점 전부가 같은 개수(고른 지역) → 같은 개수면 한가운데
  assert.equal(percentileOf(Int32Array.from([7, 7, 7, 7]), 7), 0.5);
});

test("rankLabel: 위쪽 절반은 상위, 아래쪽은 하위, 0곳은 없음", () => {
  assert.equal(rankLabel(0.75, 5), "상위 25%");
  assert.equal(rankLabel(1, 5), "상위 1%");
  assert.equal(rankLabel(0.3, 5), "하위 30%");
  assert.equal(rankLabel(0, 0), "반경 안에 없음");
});

// 3km 칸에 100m 간격으로 카페 1곳씩 고르게 + (1500,1500) 근처에 카페 40곳 군집 + 편의점 몇 곳
function fixture() {
  const places = [];
  for (let x = 50; x < 3000; x += 100) for (let y = 50; y < 3000; y += 100) places.push(at(x, y));
  for (let i = 0; i < 40; i++) places.push(at(1500 + (i % 8) * 10, 1500 + Math.floor(i / 8) * 10));
  places.push(at(2050, 2050, "store"), at(2150, 2150, "store"));
  return places;
}

test("DensityBenchmark: 군집 한가운데는 매우높음, 고른 곳은 보통 근처, 없는 업종 0곳은 낮음", () => {
  const bm = new DensityBenchmark(fixture(), B);
  const ref = bm.reference(500);
  // 원(500m)이 범위 안에 드는 칸만: 500m~2500m → 20×20칸
  assert.equal(ref.n, 400);

  // 기준점 분포: 군집이 안 닿는 칸(대부분)은 모두 같은 개수, 군집이 닿는 칸(약 17%)은 그보다 많다.
  const cafe = [...ref.counts.get("cafe")];
  const base = cafe[0];
  const top = cafe.at(-1);
  assert.ok(cafe.filter((v) => v === base).length / cafe.length > 0.7);

  const hot = bm.rank("cafe", 500, top + 1);
  assert.equal(hot.level, "매우높음");
  assert.equal(hot.label, "상위 1%");
  assert.equal(bm.rank("cafe", 500, top).level, "매우높음"); // 군집 한가운데(상위 17% 동점) → 중간 순위 0.92

  // 고른 지역의 흔한 개수는 한가운데 → 보통 (동점을 모두 아래로 보내면 "낮음"이 되던 문제)
  assert.equal(bm.rank("cafe", 500, base).level, "보통");
  assert.equal(bm.rank("cafe", 500, Math.floor(base / 2)).level, "낮음");

  const none = bm.rank("nothing-here", 500, 0);
  assert.equal(none.percentile, 0);
  assert.equal(none.level, "낮음");
  assert.equal(none.label, "반경 안에 없음");

  // 편의점: 대부분 0곳 → 1곳만 있어도 위쪽, 0곳이면 낮음
  assert.equal(bm.rank("store", 500, 0).level, "낮음");
  assert.ok(bm.rank("store", 500, 2).percentile > 0.9);
});

test("DensityBenchmark: 반경이 커지면 가장자리 기준점이 빠지고, 너무 적으면 전체 칸으로 대체", () => {
  const bm = new DensityBenchmark(fixture(), B);
  assert.equal(bm.reference(1000).n, 100); // 1000m~2000m → 10×10칸
  assert.equal(bm.reference(1400).n, 900); // 안쪽 칸 4개(<30) → 상가 있는 칸 전체 30×30
  assert.equal(bm.reference(500), bm.reference(500)); // 캐시
});

test("DensityBenchmark: 기준점 자체가 30개 미만이면 null (고정 기준으로 대체)", () => {
  const bm = new DensityBenchmark([at(100, 100), at(200, 200)], B);
  assert.equal(bm.rank("cafe", 500, 1), null);
});
