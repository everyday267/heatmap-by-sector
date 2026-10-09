import { test } from "node:test";
import assert from "node:assert/strict";
import {
  haversineM,
  circleAreaKm2,
  withinRadius,
  densityLevel,
  computeDensity,
  toHeatPoints,
  interpret,
  formatDistance,
} from "../src/geo.js";

const GANGNAM = { lat: 37.4979, lng: 127.0276 };
const YEOKSAM = { lat: 37.5006, lng: 127.0364 };

// 중심에서 북쪽으로 distM 떨어진 점.
const north = (c, distM) => ({ lat: c.lat + distM / 111_195, lng: c.lng });

test("haversineM: 같은 점은 0", () => {
  assert.equal(haversineM(GANGNAM, GANGNAM), 0);
});

test("haversineM: 강남역–역삼역 약 830m", () => {
  const d = haversineM(GANGNAM, YEOKSAM);
  assert.ok(d > 780 && d < 880, `got ${d}`);
});

test("haversineM: 대칭", () => {
  assert.equal(haversineM(GANGNAM, YEOKSAM), haversineM(YEOKSAM, GANGNAM));
});

test("circleAreaKm2: 반경 1km는 π㎢", () => {
  assert.ok(Math.abs(circleAreaKm2(1000) - Math.PI) < 1e-12);
  assert.ok(Math.abs(circleAreaKm2(500) - Math.PI / 4) < 1e-12);
});

test("withinRadius: 반경 안만, 가까운 순, 거리 포함", () => {
  const places = [
    { id: "far", ...north(GANGNAM, 900) },
    { id: "mid", ...north(GANGNAM, 400) },
    { id: "near", ...north(GANGNAM, 100) },
  ];
  const got = withinRadius(places, GANGNAM, 500);
  assert.deepEqual(got.map((p) => p.id), ["near", "mid"]);
  assert.ok(Math.abs(got[0].distanceM - 100) < 1);
  // 원본은 건드리지 않는다
  assert.equal(places[2].distanceM, undefined);
});

test("densityLevel: 구간 경계", () => {
  assert.equal(densityLevel(0), "낮음");
  assert.equal(densityLevel(4.99), "낮음");
  assert.equal(densityLevel(5), "보통");
  assert.equal(densityLevel(15), "높음");
  assert.equal(densityLevel(39.9), "높음");
  assert.equal(densityLevel(40), "매우높음");
  assert.equal(densityLevel(500), "매우높음");
});

test("computeDensity: 개수·면적당 밀도·등급", () => {
  // 반경 500m(0.785㎢) 안에 20곳 → 약 25.5/㎢ → 높음
  const inside = Array.from({ length: 20 }, (_, i) => ({ id: `i${i}`, ...north(GANGNAM, 10 + i * 20) }));
  const r = computeDensity(inside, GANGNAM, 500);
  assert.equal(r.count, 20);
  assert.ok(Math.abs(r.perKm2 - 20 / (Math.PI / 4)) < 1e-9);
  assert.equal(r.level, "높음");
  assert.equal(r.relative, null);
  assert.equal(r.heatPoints.length, 20);
});

test("computeDensity: 주변 평균 대비 배수", () => {
  // 반경 500m 안 10곳, 500m~2km 사이 0곳 → 2km 원 평균 대비 (2000/500)² = 16배
  const inside = Array.from({ length: 10 }, (_, i) => ({ id: `i${i}`, ...north(GANGNAM, 50 * i) }));
  const r = computeDensity(inside, GANGNAM, 500, 2000);
  assert.ok(Math.abs(r.relative - 16) < 1e-9, `got ${r.relative}`);

  // 주변이 균일하면 1배 근처
  const uniform = [];
  for (let dx = -2000; dx <= 2000; dx += 100)
    for (let dy = -2000; dy <= 2000; dy += 100)
      uniform.push({ lat: GANGNAM.lat + dy / 111_195, lng: GANGNAM.lng + dx / 88_200 });
  const u = computeDensity(uniform, GANGNAM, 500, 2000);
  assert.ok(u.relative > 0.9 && u.relative < 1.1, `got ${u.relative}`);
});

test("computeDensity: 업소 0곳", () => {
  const r = computeDensity([], GANGNAM, 500, 2000);
  assert.equal(r.count, 0);
  assert.equal(r.perKm2, 0);
  assert.equal(r.level, "낮음");
  assert.equal(r.relative, null);
});

test("toHeatPoints: [lat, lng, weight]", () => {
  assert.deepEqual(toHeatPoints([{ lat: 1, lng: 2 }]), [[1, 2, 1]]);
  assert.deepEqual(toHeatPoints([{ lat: 1, lng: 2 }], 0.5), [[1, 2, 0.5]]);
});

test("interpret: 문구에 개수·배수·조언 포함", () => {
  const r = { count: 23, level: "매우높음", relative: 2.14 };
  const t = interpret(r, "카페", 500);
  assert.equal(t.headline, "반경 500m 안에 카페 23곳 — 주변 평균보다 2.1배 밀집.");
  assert.match(t.advice, /치열/);

  assert.match(interpret({ count: 1, level: "낮음", relative: 0.4 }, "약국", 1000).headline, /1km.*40% 수준/);
  assert.match(interpret({ count: 5, level: "보통", relative: 1.0 }, "약국", 300).headline, /비슷/);
  assert.doesNotMatch(interpret({ count: 0, level: "낮음", relative: null }, "약국", 300).headline, /평균/);
});

test("interpret: 업종별 순위가 있으면 문구 앞쪽에", () => {
  const r = { count: 45, level: "높음", relative: 1.5, rank: { label: "상위 25%" } };
  assert.equal(
    interpret(r, "카페", 500).headline,
    "반경 500m 안에 카페 45곳 — 이 지역 상가 위치 중 상위 25%, 주변 평균보다 1.5배 밀집.",
  );
});

test("interpret: 0곳이면 순위 문구는 생략", () => {
  const r = { count: 0, level: "낮음", relative: null, rank: { label: "반경 안에 없음" } };
  assert.equal(interpret(r, "약국", 300).headline, "반경 300m 안에 약국 0곳.");
});

test("formatDistance", () => {
  assert.equal(formatDistance(500), "500m");
  assert.equal(formatDistance(1000), "1km");
  assert.equal(formatDistance(1500), "1.5km");
});
