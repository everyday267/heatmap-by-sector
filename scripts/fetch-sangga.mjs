// 상가(상권)정보를 받아 앱용 데이터셋을 만든다.
//
//   npm run fetch:gileum2
//   node scripts/fetch-sangga.mjs --id gileum2 --label "성북구 길음2동" \
//        --sigungu 11290:성북구,11305:강북구 --focus 길음2동 --box-km 3
//
//   --offline   API를 다시 부르지 않고 data/raw/<id>.json(이전 수집 원본)으로 다시 빌드
//
// 결과: data/<id>.json, data/datasets.json(목록) 갱신. 원본은 data/raw/에 (git 제외).

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadEnv } from "./lib/env.mjs";
import { fetchStoresBySigungu, buildDataset } from "./lib/sangga.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "data");

const { values: args } = parseArgs({
  options: {
    id: { type: "string", default: "gileum2" },
    label: { type: "string", default: "서울 성북구 길음2동" },
    sigungu: { type: "string", default: "11290:성북구,11305:강북구" },
    focus: { type: "string", default: "길음2동" },
    "box-km": { type: "string", default: "3" },
    offline: { type: "boolean", default: false },
  },
});

const sigungus = args.sigungu.split(",").map((s) => {
  const [code, name = code] = s.split(":");
  return { code: code.trim(), name: name.trim() };
});
const rawPath = join(DATA, "raw", `${args.id}.json`);

let raw;
if (args.offline) {
  if (!existsSync(rawPath)) throw new Error(`${rawPath}가 없습니다. --offline 없이 먼저 수집하세요.`);
  raw = JSON.parse(readFileSync(rawPath, "utf8"));
  console.log(`원본 재사용: ${raw.items.length}건 (${raw.fetchedAt})`);
} else {
  loadEnv();
  const serviceKey = process.env.DATA_GO_KR_SERVICE_KEY;
  const items = [];
  let stdrYm;
  for (const sg of sigungus) {
    const r = await fetchStoresBySigungu(sg.code, {
      serviceKey,
      onPage: ({ pageNo, got, total }) =>
        process.stdout.write(`\r${sg.name}(${sg.code}) ${pageNo}페이지 · ${got}/${total}건   `),
    });
    process.stdout.write("\n");
    items.push(...r.items);
    stdrYm ??= r.stdrYm;
  }
  raw = { fetchedAt: new Date().toISOString(), stdrYm, sigungus, items };
  mkdirSync(dirname(rawPath), { recursive: true });
  writeFileSync(rawPath, JSON.stringify(raw));
}

const dataset = buildDataset({
  items: raw.items,
  id: args.id,
  label: args.label,
  focusDong: args.focus,
  boxKm: Number(args["box-km"]),
  coverage: (raw.sigungus ?? sigungus).map((s) => s.name),
  stdrYm: raw.stdrYm,
  fetchedAt: raw.fetchedAt,
});

const file = `data/${args.id}.json`;
writeFileSync(join(ROOT, file), JSON.stringify(dataset) + "\n");

// 화면의 데이터셋 목록 갱신 (실데이터를 기본으로).
const manifestPath = join(DATA, "datasets.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.datasets = manifest.datasets.filter((d) => d.id !== args.id);
manifest.datasets.unshift({ id: args.id, label: args.label, file });
manifest.default = args.id;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

const m = dataset.meta;
console.log(
  [
    `✔ ${file}`,
    `  관심 지역: ${m.focus.name} (${m.focus.lat}, ${m.focus.lng})`,
    `  범위 ±${args["box-km"]}km 안 업소 ${m.count.toLocaleString()}곳 · 업종(소분류) ${dataset.categories.length}개`,
    `  수집 범위: ${m.coverage.join(", ")} · 기준월 ${m.stdrYm ?? "?"} · 좌표 없는 업소 ${m.skippedNoCoords}건 제외`,
    `  업종 상위: ${dataset.categories.slice(0, 5).map((c) => `${c.name} ${c.count}`).join(", ")}`,
  ].join("\n"),
);
