// 샘플 업소 데이터 생성기 (DESIGN.md §7 Phase 1).
// 실제 상가정보가 아닌 가짜 데이터다. 시드가 고정이라 다시 돌려도 같은 결과가 나온다.
//
//   node scripts/generate-sample.mjs   → data/sample.json

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LANDMARKS, SAMPLE_BOUNDS } from "../src/sources/sample-landmarks.js";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "sample.json");
const SEED = 20261009;

// 업종별 총 개수와 상권 중심(랜드마크 id → 가중치). 실제 상권 분위기를 대략 흉내 낸 값.
const CATEGORIES = [
  { code: "cafe", name: "카페", major: "음식", total: 380, spread: 0.22,
    hubs: { gangnam: 3, sinnonhyeon: 2, garosu: 3, apgujeong: 2, yeoksam: 2, samseong: 1 } },
  { code: "korean", name: "한식", major: "음식", total: 320, spread: 0.25,
    hubs: { gangnam: 3, yeoksam: 3, seolleung: 2, nonhyeon: 2, samseong: 1 } },
  { code: "chicken", name: "치킨·호프", major: "음식", total: 140, spread: 0.4,
    hubs: { gangnam: 2, nonhyeon: 1, dogok: 2, gaepo: 2 } },
  { code: "convenience", name: "편의점", major: "소매", total: 220, spread: 0.55,
    hubs: { gangnam: 1, yeoksam: 1, seolleung: 1, samseong: 1, daechi: 1 } },
  { code: "hair", name: "미용실", major: "생활서비스", total: 200, spread: 0.25,
    hubs: { garosu: 3, apgujeong: 3, sinnonhyeon: 2, gangnam: 1 } },
  { code: "academy", name: "입시·보습학원", major: "교육", total: 260, spread: 0.12,
    hubs: { daechi: 8, dogok: 1, gaepo: 1 } },
  { code: "pharmacy", name: "약국", major: "의료", total: 90, spread: 0.3,
    hubs: { gangnam: 2, sinnonhyeon: 2, yeoksam: 1, daechi: 1 } },
  { code: "clinic", name: "의원(피부·성형)", major: "의료", total: 230, spread: 0.12,
    hubs: { sinnonhyeon: 4, apgujeong: 3, gangnam: 2, garosu: 1 } },
  { code: "fitness", name: "헬스·필라테스", major: "생활서비스", total: 110, spread: 0.3,
    hubs: { yeoksam: 2, seolleung: 2, samseong: 2, gangnam: 1 } },
  { code: "realestate", name: "부동산중개", major: "부동산", total: 170, spread: 0.3,
    hubs: { daechi: 2, dogok: 3, gaepo: 3, "gangnamgu-office": 1 } },
];

const HUB_SIGMA_M = 320; // 상권 중심에서 퍼지는 정도(표준편차, m)
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LNG = M_PER_DEG_LAT * Math.cos((37.5 * Math.PI) / 180);

// mulberry32 — 작고 결정적인 PRNG.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = rng(SEED);
const gauss = () => {
  const u = 1 - rand();
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const inBounds = (p) =>
  p.lat >= SAMPLE_BOUNDS.south && p.lat <= SAMPLE_BOUNDS.north &&
  p.lng >= SAMPLE_BOUNDS.west && p.lng <= SAMPLE_BOUNDS.east;

const byId = Object.fromEntries(LANDMARKS.map((l) => [l.id, l]));

function pickHub(hubs) {
  const entries = Object.entries(hubs);
  const sum = entries.reduce((s, [, w]) => s + w, 0);
  let r = rand() * sum;
  for (const [id, w] of entries) if ((r -= w) <= 0) return byId[id];
  return byId[entries[0][0]];
}

function nearestLandmark(p) {
  let best = LANDMARKS[0];
  let bestD = Infinity;
  for (const l of LANDMARKS) {
    const d = ((l.lat - p.lat) * M_PER_DEG_LAT) ** 2 + ((l.lng - p.lng) * M_PER_DEG_LNG) ** 2;
    if (d < bestD) [best, bestD] = [l, d];
  }
  return best;
}

function samplePoint(cat) {
  for (;;) {
    let p;
    if (rand() < cat.spread) {
      // 배경: 샘플 지역 전체에 고르게
      p = {
        lat: SAMPLE_BOUNDS.south + rand() * (SAMPLE_BOUNDS.north - SAMPLE_BOUNDS.south),
        lng: SAMPLE_BOUNDS.west + rand() * (SAMPLE_BOUNDS.east - SAMPLE_BOUNDS.west),
      };
    } else {
      const hub = pickHub(cat.hubs);
      p = {
        lat: hub.lat + (gauss() * HUB_SIGMA_M) / M_PER_DEG_LAT,
        lng: hub.lng + (gauss() * HUB_SIGMA_M) / M_PER_DEG_LNG,
      };
    }
    if (inBounds(p)) return p;
  }
}

const round6 = (x) => Math.round(x * 1e6) / 1e6;

const places = [];
for (const cat of CATEGORIES) {
  for (let i = 1; i <= cat.total; i++) {
    const p = samplePoint(cat);
    const near = nearestLandmark(p);
    places.push({
      id: `${cat.code}-${String(i).padStart(4, "0")}`,
      name: `샘플 ${cat.name} ${near.name.replace(/역$/, "")}점 #${i}`,
      categoryCode: cat.code, // categoryName/Major는 로드 시 categories에서 채운다
      lat: round6(p.lat),
      lng: round6(p.lng),
      address: `서울 강남구 ${near.dong} (샘플)`,
    });
  }
}

const out = {
  meta: {
    note: "가짜 샘플 데이터입니다. 실제 업소가 아닙니다. scripts/generate-sample.mjs로 생성.",
    seed: SEED,
    region: "서울 강남구 일대",
    bounds: SAMPLE_BOUNDS,
    count: places.length,
  },
  categories: CATEGORIES.map(({ code, name, major }) => ({ code, name, major })),
  places,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out) + "\n");
console.log(`wrote ${places.length} places → ${OUT}`);
