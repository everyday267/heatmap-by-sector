// 서울 생활인구(행정동 단위)를 받아 데이터셋 옆에 붙인다. 서울 열린데이터광장 인증키 필요.
//
//   npm run fetch:gileum2:livepop
//   node scripts/fetch-livepop.mjs --id gileum2 --days 14
//
// 결과: data/<id>-livepop.json (행정동별 평일/주말 × 24시간 평균), data/datasets.json에 livepop 경로 추가.
// 상가 데이터(data/<id>.json)의 행정동 코드로 동을 맞추므로 상가 데이터를 먼저 만들어 두어야 한다.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadEnv } from "./lib/env.mjs";
import { aggregateLivePop, fetchLivePopDay, findLatestDate, mapLivePopRow, ymd } from "./lib/livepop.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "data");

const { values: args } = parseArgs({
  options: {
    id: { type: "string", default: "gileum2" },
    days: { type: "string", default: "14" },
  },
});

loadEnv();
const key = (process.env.SEOUL_OPENAPI_KEY ?? "").trim();
const dataset = JSON.parse(readFileSync(join(DATA, `${args.id}.json`), "utf8"));
const wanted = new Set(dataset.meta.dongs.filter((d) => d.code).map((d) => String(d.code).slice(0, 8)));
if (!wanted.size) {
  console.error("데이터셋에 행정동 코드가 없습니다. 상가 데이터를 다시 수집하세요(npm run fetch:gileum2).");
  process.exit(1);
}

try {
  const latest = await findLatestDate({ key, log: console.log });
  const base = new Date(Date.UTC(+latest.slice(0, 4), +latest.slice(4, 6) - 1, +latest.slice(6, 8)));
  const dates = Array.from({ length: Number(args.days) }, (_, i) => ymd(new Date(base.getTime() - i * 86_400_000)));

  const rows = [];
  for (const date of dates) {
    const day = await fetchLivePopDay(date, { key });
    // 서울 전체 행정동이 오므로 데이터셋 동만 남긴다.
    const mine = day.map(mapLivePopRow).filter((r) => r && wanted.has(r.code.slice(0, 8)));
    rows.push(...mine);
    console.log(`  ${date}: ${day.length}행 중 ${mine.length}행`);
  }

  const { dongs, missing } = aggregateLivePop(rows, dataset.meta.dongs);
  if (!dongs.length) {
    const sample = rows[0] ?? null;
    throw new Error(
      `데이터셋 행정동과 맞는 생활인구가 없습니다. 행정동 코드 체계가 다를 수 있습니다.\n` +
        `데이터셋 코드 예: ${[...wanted].slice(0, 3).join(", ")} / 응답 첫 행: ${JSON.stringify(sample)}`,
    );
  }

  const file = `data/${args.id}-livepop.json`;
  const out = {
    meta: {
      source: { name: "서울 열린데이터광장 행정동 단위 서울 생활인구(내국인)", url: "https://data.seoul.go.kr" },
      from: dates.at(-1),
      to: dates[0],
      days: dates.length,
      fetchedAt: new Date().toISOString(),
      hasAges: rows.some((r) => r.hasAges),
      layout: "weekday/weekend[hour] = [총인구, 만 0~9세, 10~19세, … 100세 이상] (해당 날짜들의 평균)",
    },
    dongs,
  };
  writeFileSync(join(ROOT, file), JSON.stringify(out) + "\n");

  const manifestPath = join(DATA, "datasets.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const entry = manifest.datasets.find((d) => d.id === args.id);
  if (entry) {
    entry.livepop = file;
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  }

  const noon = (d) => d.weekday?.[12]?.[0] ?? 0;
  console.log(
    [
      `✔ ${file}`,
      `  기간 ${out.meta.from}~${out.meta.to} (${dates.length}일) · 행정동 ${dongs.length}개 · 연령별 ${out.meta.hasAges ? "있음" : "없음"}`,
      `  평일 12시 생활인구 합계 ${Math.round(dongs.reduce((s, d) => s + noon(d), 0)).toLocaleString()}명`,
      `  상가 데이터 행정동 ${dataset.meta.dongs.length}개 중 생활인구 없음: ${missing.length ? missing.join(", ") : "없음"}`,
    ].join("\n"),
  );
} catch (err) {
  console.error(err.message);
  if (err.auth) console.error("\n서울 열린데이터광장 인증키(SEOUL_OPENAPI_KEY)를 확인하세요.");
  process.exit(1);
}
