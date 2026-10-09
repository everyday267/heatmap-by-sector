// 서울 열린데이터광장 "행정동 단위 서울 생활인구(내국인)" 클라이언트.
// https://data.seoul.go.kr  (서울 열린데이터광장 인증키, 공공데이터포털 키와 별개)
//
// 요청 형식: http://openapi.seoul.go.kr:8088/{KEY}/json/SPOP_LOCAL_RESD_DONG/{시작}/{끝}/{기준일 YYYYMMDD}
// 한 번에 최대 1000행. 하루치는 (행정동 ~424개 × 24시간) 약 1만 행.
//
// 명세를 이 저장소 작업 환경에서 직접 열어 보지 못해 응답 항목은 이름 패턴으로 넓게 받아들인다.
// 형식이 다르면 실제 항목 이름과 응답 앞부분을 출력하고 멈춘다.

import { AGE_BANDS } from "./population.mjs";

export const LIVEPOP_BASE = "http://openapi.seoul.go.kr:8088";
export const LIVEPOP_SERVICE = "SPOP_LOCAL_RESD_DONG";
const PAGE_SIZE = 1000; // API 최대값

const DATE_FIELD = /^STDR_DE_ID$/i;
const HOUR_FIELD = /^TMZON_PD_SE$/i;
const CODE_FIELD = /^ADSTRD_CODE_SE$/i;
const TOTAL_FIELD = /^TOT_LVPOP_CO$/i;
// MALE_F0T9_LVPOP_CO, FEMALE_F70T74_LVPOP_CO … (시작나이 T 끝나이)
const AGE_FIELD = /^(MALE|FEMALE)_F(\d+)T(\d+)_LVPOP_CO$/i;

/** 서울 API 오류 → err.auth(인증키 문제)면 재시도해도 소용없다. */
function seoulError(code, message) {
  const err = new Error(`생활인구 API 오류 ${code}: ${message}`);
  err.auth = /^INFO-100$|^ERROR-(300|301|310|331|332)$/.test(code);
  return err;
}

/** 응답 본문 → { rows, totalCount, empty }. */
export function parseLivePopResponse(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    const code = text.match(/<CODE>([^<]+)</)?.[1];
    const msg = text.match(/<MESSAGE>([^<]+)</)?.[1];
    if (code) {
      if (code === "INFO-200") return { rows: [], totalCount: 0, empty: true };
      throw seoulError(code, msg ?? "");
    }
    throw new Error(`생활인구 API 응답을 읽지 못했습니다: ${text.slice(0, 200)}`);
  }
  // 정상: { SPOP_LOCAL_RESD_DONG: { list_total_count, RESULT, row: [...] } } / 오류: { RESULT: { CODE, MESSAGE } }
  const svc = Object.values(json).find((v) => v && typeof v === "object" && Array.isArray(v.row));
  const result = svc?.RESULT ?? json.RESULT ?? {};
  const code = result.CODE ?? (svc ? "INFO-000" : "UNKNOWN");
  if (code === "INFO-200") return { rows: [], totalCount: 0, empty: true };
  if (code !== "INFO-000") throw seoulError(code, result.MESSAGE ?? JSON.stringify(json).slice(0, 200));
  return { rows: svc.row, totalCount: Number(svc.list_total_count ?? svc.row.length), empty: !svc.row.length };
}

const pickKey = (row, re) => Object.keys(row).find((k) => re.test(k));
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0; // 소수 인원 보호용 "*" 등은 0
};

/** 응답 한 행 → { date, hour, code, total, ages[11] }. 필요한 항목이 없으면 null. */
export function mapLivePopRow(row) {
  const dateKey = pickKey(row, DATE_FIELD);
  const hourKey = pickKey(row, HOUR_FIELD);
  const codeKey = pickKey(row, CODE_FIELD);
  if (!dateKey || !hourKey || !codeKey) return null;
  const ages = new Array(AGE_BANDS).fill(0);
  let ageFields = 0;
  for (const [k, v] of Object.entries(row)) {
    const m = k.match(AGE_FIELD);
    if (!m) continue;
    ages[Math.min(AGE_BANDS - 1, Math.floor(Number(m[2]) / 10))] += num(v);
    ageFields++;
  }
  const totalKey = pickKey(row, TOTAL_FIELD);
  if (!totalKey && !ageFields) return null;
  return {
    date: String(row[dateKey]),
    hour: Number(row[hourKey]),
    code: String(row[codeKey]),
    total: totalKey ? num(row[totalKey]) : ages.reduce((a, b) => a + b, 0),
    ages,
    hasAges: ageFields > 0,
  };
}

function assertShape(rows) {
  if (rows.length && !mapLivePopRow(rows[0])) {
    throw new Error(
      `생활인구 응답에서 기준일/시간대/행정동코드/인구 항목을 찾지 못했습니다.\n` +
        `실제 항목: ${Object.keys(rows[0]).join(", ")}\n` +
        `scripts/lib/livepop.mjs의 *_FIELD 패턴을 맞춰야 합니다.`,
    );
  }
}

export function livePopUrl(key, start, end, date) {
  return `${LIVEPOP_BASE}/${encodeURIComponent(key)}/json/${LIVEPOP_SERVICE}/${start}/${end}/${date}`;
}

const mask = (text, key) => (key ? String(text).split(key).join("***").split(encodeURIComponent(key)).join("***") : String(text));

/** 하루치 전체(모든 행정동 × 24시간). 자료가 아직 없는 날이면 빈 배열. */
export async function fetchLivePopDay(date, { key, fetchImpl = fetch } = {}) {
  if (!key) throw Object.assign(new Error("SEOUL_OPENAPI_KEY가 비어 있습니다."), { auth: true });
  const rows = [];
  for (let start = 1; ; start += PAGE_SIZE) {
    const res = await fetchImpl(livePopUrl(key, start, start + PAGE_SIZE - 1, date));
    const text = await res.text();
    let page;
    try {
      page = parseLivePopResponse(text);
    } catch (err) {
      err.message = mask(err.message, key);
      throw err;
    }
    if (start === 1) assertShape(page.rows);
    rows.push(...page.rows);
    if (page.empty || page.rows.length < PAGE_SIZE || rows.length >= page.totalCount) break;
  }
  return rows;
}

/** YYYYMMDD 문자열 (UTC 기준 날짜 계산). */
export const ymd = (d) =>
  `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;

async function getPage(url, key, fetchImpl) {
  const text = await (await fetchImpl(url)).text();
  try {
    return { ...parseLivePopResponse(text), text };
  } catch (err) {
    err.message = mask(err.message, key);
    throw err;
  }
}

/** 날짜 조건 없이 몇 행 받아 본다(전체 건수, 실제 날짜 형식 확인용). */
async function peekUnfiltered(key, fetchImpl, start, end) {
  const url = `${LIVEPOP_BASE}/${encodeURIComponent(key)}/json/${LIVEPOP_SERVICE}/${start}/${end}/`;
  return getPage(url, key, fetchImpl);
}

/**
 * 자료가 있는 가장 최근 날짜를 찾는다.
 * 1) 날짜 조건 없이 첫 행·마지막 행의 기준일을 보고 가장 최근 날짜를 고른 뒤, 그 날짜로 조회가 되는지 확인
 * 2) 안 되면 이틀 전부터 하루씩 거슬러 날짜 조건으로 찾아본다
 * 끝내 못 찾으면 원인을 볼 수 있게 날짜 조건 없는 응답 앞부분을 오류에 담는다.
 */
export async function findLatestDate({ key, fetchImpl = fetch, now = new Date(), maxBack = 120, log = () => {} } = {}) {
  if (!key) throw Object.assign(new Error("SEOUL_OPENAPI_KEY가 비어 있습니다."), { auth: true });
  const notes = [];

  const first = await peekUnfiltered(key, fetchImpl, 1, 1);
  if (!first.empty) {
    assertShape(first.rows);
    const dates = [mapLivePopRow(first.rows[0]).date];
    if (first.totalCount > 1) {
      const last = await peekUnfiltered(key, fetchImpl, first.totalCount, first.totalCount);
      if (!last.empty) dates.push(mapLivePopRow(last.rows[0]).date);
    }
    const candidate = dates.sort().at(-1);
    log(`  날짜 조건 없이: 전체 ${first.totalCount.toLocaleString()}행, 첫·마지막 행 기준일 ${dates.join(" / ")}`);
    const check = await getPage(livePopUrl(key, 1, 1, candidate), key, fetchImpl);
    if (!check.empty) {
      log(`  최근 자료일: ${candidate}`);
      return candidate;
    }
    notes.push(`기준일 ${candidate}로 조회하면 데이터 없음 → 날짜 조건 전달 방식이 다를 수 있음. 응답: ${mask(check.text, key).slice(0, 300)}`);
  } else {
    notes.push(`날짜 조건 없이도 데이터 없음. 응답: ${mask(first.text, key).slice(0, 300)}`);
  }

  for (let back = 2; back <= maxBack; back++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - back));
    const date = ymd(d);
    const page = await getPage(livePopUrl(key, 1, 1, date), key, fetchImpl);
    if (!page.empty) {
      assertShape(page.rows);
      log(`  최근 자료일: ${date}`);
      return date;
    }
  }
  throw new Error(`최근 ${maxBack}일 안에 날짜 조건으로 찾은 생활인구 자료가 없습니다.\n  ${notes.join("\n  ")}`);
}

/** 날짜 문자열의 요일로 평일/주말 구분 (공휴일은 따로 보지 않음). */
export const dayType = (date) => {
  const d = new Date(Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8)));
  return [0, 6].includes(d.getUTCDay()) ? "weekend" : "weekday";
};

const toCode8 = (code) => String(code ?? "").slice(0, 8);

/**
 * 행정동 코드 체계 차이(행정안전부 ↔ 통계청)로 짝을 못 찾은 동을 맞춘다.
 * 같은 시군구 안에서 짝 없는 코드 수가 같으면 코드 순서대로 짝짓고, 새벽 생활인구가
 * 주민등록 인구와 비슷한지(0.6~1.6배)로 하나하나 확인한다. 확인 안 된 짝은 버린다.
 *
 * @param {{ name, code }[]} unmatchedDongs  생활인구 코드가 없는 데이터셋 동
 * @param {string[]} unmatchedCodes           데이터셋에 없는 생활인구 코드 (같은 시군구들)
 * @param {(code) => number} nightPop         생활인구 코드의 새벽 평균 인구
 * @param {(name) => number|undefined} residentPop  주민등록 인구
 * @returns {{ aliases: Map<liveCode, datasetCode>, log: string[] }}
 */
export function matchCodesByOrder(unmatchedDongs, unmatchedCodes, nightPop, residentPop) {
  const aliases = new Map();
  const log = [];
  const bySgg = (code) => toCode8(code).slice(0, 5);
  const sggs = new Set([...unmatchedDongs.map((d) => bySgg(d.code)), ...unmatchedCodes.map(bySgg)]);
  for (const sgg of sggs) {
    const dongs = unmatchedDongs.filter((d) => bySgg(d.code) === sgg).sort((a, b) => toCode8(a.code).localeCompare(toCode8(b.code)));
    const codes = unmatchedCodes.filter((c) => bySgg(c) === sgg).sort();
    if (!dongs.length) continue;
    if (dongs.length !== codes.length) {
      log.push(`${sgg}: 짝 없는 동 ${dongs.length}개(${dongs.map((d) => `${d.name}:${toCode8(d.code)}`).join(", ")}) ↔ 생활인구 코드 ${codes.length}개(${codes.join(", ")}) — 개수가 달라 맞추지 않음`);
      continue;
    }
    dongs.forEach((d, i) => {
      const live = nightPop(codes[i]);
      const res = residentPop(d.name);
      const ratio = res ? live / res : NaN;
      const ok = ratio >= 0.6 && ratio <= 1.6;
      log.push(`${d.name}:${toCode8(d.code)} ↔ ${codes[i]} 새벽 생활인구 ${Math.round(live)} / 주민등록 ${res ?? "?"} = ${Number.isFinite(ratio) ? ratio.toFixed(2) : "?"} ${ok ? "→ 연결" : "→ 버림"}`);
      if (ok) aliases.set(codes[i], toCode8(d.code));
    });
  }
  return { aliases, log };
}
const round1 = (x) => Math.round(x * 10) / 10;

/**
 * 여러 날의 행 → 행정동별 평일/주말 × 24시간 평균.
 * 생활인구 행정동 코드(8자리)를 상가 데이터 동 코드와 맞춰 이름을 붙인다.
 * @param {object[]} mappedRows  mapLivePopRow 결과
 * @param {{ name, code }[]} dongs  데이터셋 meta.dongs
 * @returns {{ dongs: { name, code, weekday, weekend }[], missing: string[] }}
 *   weekday/weekend: 길이 24 배열, 각 칸 [총인구, 연령구간0..10] (평균, 그 날짜 유형 자료가 없으면 null)
 */
export function aggregateLivePop(mappedRows, dongs) {
  const nameByCode = new Map(dongs.filter((d) => d.code).map((d) => [toCode8(d.code), d.name]));
  // code → type → hour → { sum[12], days:Set }
  const acc = new Map();
  for (const r of mappedRows) {
    const name = nameByCode.get(toCode8(r.code));
    if (!name || !(r.hour >= 0 && r.hour < 24)) continue;
    const type = dayType(r.date);
    if (!acc.has(name)) acc.set(name, { weekday: [], weekend: [] });
    const slot = (acc.get(name)[type][r.hour] ??= { sum: new Array(AGE_BANDS + 1).fill(0), days: new Set() });
    slot.sum[0] += r.total;
    r.ages.forEach((v, i) => (slot.sum[i + 1] += v));
    slot.days.add(r.date);
  }
  const avg = (slots) =>
    slots.length === 0
      ? null
      : Array.from({ length: 24 }, (_, h) => {
          const s = slots[h];
          return s ? s.sum.map((v) => round1(v / s.days.size)) : null;
        });
  const out = [...acc.entries()].map(([name, t]) => ({
    name,
    code: [...nameByCode.entries()].find(([, n]) => n === name)?.[0],
    weekday: avg(t.weekday),
    weekend: avg(t.weekend),
  }));
  const missing = dongs.filter((d) => !acc.has(d.name)).map((d) => d.name);
  return { dongs: out.sort((a, b) => a.name.localeCompare(b.name, "ko")), missing };
}
