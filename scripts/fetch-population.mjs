// 행정동별 주민등록 인구를 받아 데이터셋 옆에 붙인다.
//
//   npm run fetch:gileum2:population
//   node scripts/fetch-population.mjs --id gileum2 --sigungu 11290:성북구,11305:강북구
//
// 결과: data/<id>-population.json, data/datasets.json의 해당 항목에 population 경로 추가.
// 상가 데이터(data/<id>.json)를 먼저 만들어 두어야 행정동 이름을 맞춰 볼 수 있다.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadEnv } from "./lib/env.mjs";
import { fetchDongPopulation, recentMonths } from "./lib/population.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "data");

const { values: args } = parseArgs({
  options: {
    id: { type: "string", default: "gileum2" },
    sigungu: { type: "string", default: "11290:성북구,11305:강북구" },
  },
});
const sigungus = args.sigungu.split(",").map((s) => {
  const [code, name = code] = s.split(":");
  return { code: code.trim(), name: name.trim() };
});

loadEnv();
const serviceKey = process.env.DATA_GO_KR_SERVICE_KEY;

let result = null;
const failures = [];
for (const ym of recentMonths()) {
  try {
    const dongs = [];
    let hasAges = true;
    for (const sg of sigungus) {
      const r = await fetchDongPopulation(sg.code, { serviceKey, ym, log: console.log });
      dongs.push(...r.dongs);
      hasAges &&= r.hasAges;
    }
    result = { ym, dongs, hasAges };
    break;
  } catch (err) {
    failures.push(err.message);
    console.log(`${ym}: 실패, 이전 달로 다시 시도`);
  }
}
if (!result) {
  console.error(failures.join("\n"));
  console.error("\n활용신청(15108072)이 승인됐는지, 인증키가 같은지 확인하세요.");
  process.exit(1);
}

// 상가 데이터의 행정동 이름과 맞춰 본다.
const datasetFile = join(DATA, `${args.id}.json`);
const dataset = JSON.parse(readFileSync(datasetFile, "utf8"));
const storeDongs = new Set(dataset.meta.dongs.map((d) => d.name));
const popDongs = new Set(result.dongs.map((d) => d.name));
const missingPop = [...storeDongs].filter((n) => !popDongs.has(n));

const file = `data/${args.id}-population.json`;
const out = {
  meta: {
    source: {
      name: "행정안전부 행정동별 성/연령별 주민등록 인구수",
      url: "https://www.data.go.kr/data/15108072/openapi.do",
    },
    ym: result.ym,
    fetchedAt: new Date().toISOString(),
    coverage: sigungus.map((s) => s.name),
    hasAges: result.hasAges,
    ageBands: "ages[i] = 만 (10*i)~(10*i+9)세, 마지막은 100세 이상",
  },
  dongs: result.dongs,
};
writeFileSync(join(ROOT, file), JSON.stringify(out) + "\n");

const manifestPath = join(DATA, "datasets.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const entry = manifest.datasets.find((d) => d.id === args.id);
if (entry) {
  entry.population = file;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
}

const total = result.dongs.reduce((s, d) => s + d.total, 0);
console.log(
  [
    `✔ ${file}`,
    `  기준월 ${result.ym} · 행정동 ${result.dongs.length}개 · 인구 ${total.toLocaleString()}명 · 연령별 ${result.hasAges ? "있음" : "없음"}`,
    `  상가 데이터 행정동 ${storeDongs.size}개 중 인구 없음: ${missingPop.length ? missingPop.join(", ") : "없음"}`,
  ].join("\n"),
);
