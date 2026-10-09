// 행정안전부 행정동별(통반단위) 성/연령별 주민등록 인구수 API 클라이언트.
// https://www.data.go.kr/data/15108072/openapi.do  (상가정보와 같은 공공데이터포털 인증키, 활용신청은 따로)
//
// 공식 명세를 이 저장소 작업 환경에서 직접 열어 보지 못해, 요청 변수는 공개된 사용 사례 기준이고
// 응답은 항목 이름을 넓게 받아들이도록 썼다. 형식이 다르면 실제 항목 이름을 출력하고 멈춘다.

import { normalizeServiceKey } from "./sangga.mjs";

export const POP_API = "https://apis.data.go.kr/1741000/admmSexdAgePpltn/selectAdmmSexdAgePpltn";
const PAGE_SIZE = 100; // API 최대값

// 연령 구간: 0=만0~9세, 1=10~19세 … 10=100세 이상
export const AGE_BANDS = 11;
const AGE_FIELD = /^(male|feml)(\d+)AgeNmprCnt$/;
const DONG_FIELDS = ["dongNm", "admmNm", "emdNm", "adongNm", "admmDongNm"];
const TOTAL_FIELDS = ["totNmprCnt", "totPpltnCnt", "totPpltn", "totCnt"];

/** 응답 본문 → { items, totalCount }. 오류(XML 포함)는 읽을 수 있는 메시지로 던진다. */
export function parsePopulationResponse(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    const msg =
      text.match(/<returnAuthMsg>([^<]+)</)?.[1] ??
      text.match(/<resultMsg>([^<]+)</)?.[1] ??
      text.slice(0, 200);
    throw new Error(`인구 API 오류: ${msg.trim()}`);
  }
  const root = json.Response ?? json.response ?? json;
  const header = root.head ?? root.header ?? {};
  const body = root.items ? root : (root.body ?? {});
  const code = String(header.resultCode ?? "0");
  if (!["0", "00", "000"].includes(code)) {
    if (["3", "03"].includes(code)) return { items: [], totalCount: 0 };
    throw new Error(`인구 API 오류 ${code}: ${header.resultMsg ?? "알 수 없음"}`);
  }
  const raw = body.items?.item ?? body.items ?? [];
  const items = Array.isArray(raw) ? raw : [raw];
  return { items, totalCount: Number(body.totalCount ?? header.totalCount ?? items.length) };
}

/**
 * 응답 한 행 → { dong, total, ages[11] }.
 * 동 이름 항목이 없으면 fallbackDong(동 코드로 직접 조회한 경우)을 쓰고, 그것도 없으면 null(구 합계 등).
 */
export function mapPopulationRow(row, fallbackDong) {
  const dongKey = DONG_FIELDS.find((k) => typeof row[k] === "string" && row[k].trim());
  const dong = dongKey ? row[dongKey].trim() : fallbackDong;
  if (!dong) return null;
  const ages = new Array(AGE_BANDS).fill(0);
  let ageFields = 0;
  for (const [k, v] of Object.entries(row)) {
    const m = k.match(AGE_FIELD);
    if (!m) continue;
    const band = Math.min(AGE_BANDS - 1, Math.floor(Number(m[2]) / 10));
    ages[band] += Number(v) || 0;
    ageFields++;
  }
  const totalKey = TOTAL_FIELDS.find((k) => k in row);
  const total = totalKey ? Number(row[totalKey]) || 0 : ages.reduce((a, b) => a + b, 0);
  if (!ageFields && !totalKey) return null;
  return { dong, total, ages, hasAges: ageFields > 0, named: Boolean(dongKey) };
}

/** 통·반 단위 행이 와도 동 이름으로 합친다. */
export function aggregateByDong(rows) {
  const byDong = new Map();
  for (const r of rows) {
    const d = byDong.get(r.dong) ?? { name: r.dong, total: 0, ages: new Array(AGE_BANDS).fill(0) };
    d.total += r.total;
    r.ages.forEach((v, i) => (d.ages[i] += v));
    byDong.set(r.dong, d);
  }
  return [...byDong.values()].sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

function assertShape(items, fallbackDong) {
  if (!items.length) return;
  if (!items.some((row) => mapPopulationRow(row, fallbackDong))) {
    throw new Error(
      `인구 응답에서 행정동 이름이나 인구 항목을 찾지 못했습니다.\n` +
        `실제 항목: ${Object.keys(items[0]).join(", ")}\n` +
        `scripts/lib/population.mjs의 DONG_FIELDS/TOTAL_FIELDS/AGE_FIELD를 맞춰야 합니다.`,
    );
  }
}

/** 로그용 응답 앞부분. 인증키가 섞여 있으면 가린다. */
function snippetOf(text, serviceKey) {
  let t = String(text).replace(/\s+/g, " ").slice(0, 400);
  const k = normalizeServiceKey(serviceKey);
  for (const v of [k, encodeURIComponent(k)]) if (v) t = t.split(v).join("***");
  return t;
}

/** 한 번의 조회(페이지 넘김 포함) → { rows, snippet }. 0행일 때 원인을 볼 수 있게 첫 응답 앞부분을 남긴다. */
export async function requestRows({ admmCd, ym, lv, serviceKey, fetchImpl = fetch, fallbackDong }) {
  const rows = [];
  let snippet = "";
  for (let pageNo = 1; ; pageNo++) {
    const url = new URL(POP_API);
    url.search = new URLSearchParams({
      serviceKey: normalizeServiceKey(serviceKey),
      admmCd,
      srchFrYm: ym,
      srchToYm: ym,
      lv,
      regSeCd: "1",
      type: "JSON",
      numOfRows: String(PAGE_SIZE),
      pageNo: String(pageNo),
    });
    const text = await (await fetchImpl(url)).text();
    if (pageNo === 1) snippet = snippetOf(text, serviceKey);
    const page = parsePopulationResponse(text);
    if (pageNo === 1) assertShape(page.items, fallbackDong);
    rows.push(...page.items);
    if (page.items.length < PAGE_SIZE || rows.length >= page.totalCount) break;
  }
  return { rows, snippet };
}

/** 기준월 후보: 매월 2일 이후 전월분이 공표되므로 전월부터 거슬러 올라간다. */
export function recentMonths(now = new Date(), count = 3) {
  const out = [];
  for (let i = 1; i <= count; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/**
 * 방법 1: 시군구 코드로 한 번에 행정동별 인구.
 * @param {string} sigunguCd 시군구 코드 5자리 → 행정기관코드 10자리(뒤 00000)로 조회
 */
export async function fetchDongPopulation(sigunguCd, { serviceKey, ym, fetchImpl = fetch, log = () => {} } = {}) {
  const admmCd = `${sigunguCd}00000`.slice(0, 10);
  // lv(조회 단위)는 명세를 확인하지 못해, 동 단위 행이 나오는 값을 차례로 시도한다.
  const errors = [];
  for (const lv of ["3", "4"]) {
    let res;
    try {
      res = await requestRows({ admmCd, ym, lv, serviceKey, fetchImpl });
    } catch (err) {
      errors.push(`lv=${lv}: ${err.message}`);
      continue;
    }
    const mapped = res.rows.map((r) => mapPopulationRow(r)).filter(Boolean);
    const dongs = aggregateByDong(mapped);
    log(`  [구 코드] ${admmCd} ${ym} lv=${lv}: ${res.rows.length}행 → 행정동 ${dongs.length}개`);
    if (dongs.length >= 2) return { ym, dongs, hasAges: mapped.some((r) => r.hasAges) };
    errors.push(`lv=${lv}: 행정동 단위 행이 없음 (${res.rows.length}행) 응답: ${res.snippet}`);
  }
  throw new Error(`[구 코드] ${sigunguCd} ${ym} 실패\n  ${errors.join("\n  ")}`);
}

/** 상가정보의 행정동 코드(8자리면 뒤에 00) → 10자리. */
export const toAdmmCd = (code) => String(code ?? "").padEnd(10, "0").slice(0, 10);

/**
 * 방법 2: 행정동 코드로 동마다 조회. 먼저 첫 동으로 통하는 lv를 찾고, 안 되면 바로 멈춘다(호출 낭비 방지).
 * @param {{ name, code }[]} dongs  데이터셋 meta.dongs
 */
export async function fetchPopulationByDongCodes(dongs, { serviceKey, ym, fetchImpl = fetch, log = () => {} } = {}) {
  const targets = dongs.filter((d) => d.code);
  if (!targets.length) throw new Error("[동 코드] 데이터셋에 행정동 코드가 없습니다 (상가 데이터를 다시 수집하세요)");

  const one = async (d, lv) => {
    const res = await requestRows({ admmCd: toAdmmCd(d.code), ym, lv, serviceKey, fetchImpl, fallbackDong: d.name });
    const mapped = res.rows.map((r) => mapPopulationRow(r, d.name)).filter(Boolean);
    // 동 이름이 붙은 행이 오면 그 동 것만, 이름 없는 행(통·반)만 오면 전부 이 동으로 합친다.
    const mine = mapped.some((r) => r.named) ? mapped.filter((r) => r.dong === d.name) : mapped;
    const [agg] = aggregateByDong(mine.map((r) => ({ ...r, dong: d.name })));
    return { agg, rows: res.rows.length, snippet: res.snippet, hasAges: mine.some((r) => r.hasAges) };
  };

  const errors = [];
  let lvOk = null;
  for (const lv of ["3", "4", "2"]) {
    try {
      const r = await one(targets[0], lv);
      log(`  [동 코드] ${targets[0].name}(${toAdmmCd(targets[0].code)}) ${ym} lv=${lv}: ${r.rows}행 → 인구 ${r.agg?.total ?? 0}`);
      if (r.agg?.total > 0) {
        lvOk = lv;
        break;
      }
      errors.push(`lv=${lv}: 0행 응답: ${r.snippet}`);
    } catch (err) {
      errors.push(`lv=${lv}: ${err.message}`);
    }
  }
  if (!lvOk) throw new Error(`[동 코드] ${targets[0].name} ${ym} 실패\n  ${errors.join("\n  ")}`);

  const out = [];
  let hasAges = true;
  const missing = [];
  for (const d of targets) {
    const r = await one(d, lvOk);
    if (r.agg?.total > 0) {
      out.push(r.agg);
      hasAges &&= r.hasAges;
    } else missing.push(d.name);
  }
  log(`  [동 코드] lv=${lvOk}: ${out.length}/${targets.length}개 동 성공${missing.length ? ` · 실패: ${missing.join(", ")}` : ""}`);
  return { ym, dongs: out.sort((a, b) => a.name.localeCompare(b.name, "ko")), hasAges };
}
