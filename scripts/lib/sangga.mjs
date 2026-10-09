// 소상공인시장진흥공단 상가(상권)정보 API 클라이언트와 데이터셋 빌더 (DESIGN.md Phase 4).
// https://www.data.go.kr/data/15012005/openapi.do
//
// 인증키는 이 스크립트(서버 측)에서만 쓰고, 결과는 키 없는 정적 JSON으로 저장한다.

export const API_BASE = "https://apis.data.go.kr/B553077/api/open/sdsc2";
const PAGE_SIZE = 1000; // API 최대값

// 매핑에 꼭 필요한 원본 컬럼. 첫 응답에 없으면 API 형식이 바뀐 것이므로 바로 알린다.
export const REQUIRED_FIELDS = ["bizesId", "bizesNm", "indsSclsCd", "indsSclsNm", "indsLclsNm", "lon", "lat"];

/** 공공데이터포털이 주는 Encoding 키(%2B 등 포함)와 Decoding 키를 모두 받는다. */
export function normalizeServiceKey(key) {
  const k = (key ?? "").trim();
  if (!k) throw new Error("DATA_GO_KR_SERVICE_KEY가 비어 있습니다. README의 '인증키 넣기'를 참고하세요.");
  return /%[0-9A-Fa-f]{2}/.test(k) ? decodeURIComponent(k) : k;
}

/** API 응답 본문 → { items, totalCount, stdrYm }. 오류 응답(XML 포함)은 읽을 수 있는 메시지로 던진다. */
export function parseResponse(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    // 인증 실패 등은 type=json이어도 XML로 온다.
    const msg =
      text.match(/<returnAuthMsg>([^<]+)</)?.[1] ??
      text.match(/<resultMsg>([^<]+)</)?.[1] ??
      text.slice(0, 200);
    throw new Error(`상가정보 API 오류: ${msg.trim()}`);
  }
  const header = json.header ?? json.response?.header ?? {};
  const body = json.body ?? json.response?.body ?? {};
  const code = String(header.resultCode ?? "00");
  if (code === "03") return { items: [], totalCount: 0, stdrYm: header.stdrYm };
  if (code !== "00") throw new Error(`상가정보 API 오류 ${code}: ${header.resultMsg ?? "알 수 없음"}`);
  const items = Array.isArray(body.items) ? body.items : (body.items?.item ?? []);
  return { items, totalCount: Number(body.totalCount ?? items.length), stdrYm: header.stdrYm };
}

/**
 * 시군구 하나의 상가업소 전체를 페이지를 넘기며 받는다.
 * @param {string} sigunguCd 시군구 코드 5자리 (예: 성북구 11290)
 */
export async function fetchStoresBySigungu(sigunguCd, { serviceKey, fetchImpl = fetch, onPage } = {}) {
  const all = [];
  let stdrYm;
  for (let pageNo = 1; ; pageNo++) {
    const url = new URL(`${API_BASE}/storeListInDong`);
    url.search = new URLSearchParams({
      serviceKey: normalizeServiceKey(serviceKey),
      divId: "signguCd",
      key: sigunguCd,
      numOfRows: String(PAGE_SIZE),
      pageNo: String(pageNo),
      type: "json",
    });
    const text = await withRetry(async () => {
      const res = await fetchImpl(url);
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
      return res.text();
    });
    const page = parseResponse(text);
    if (pageNo === 1) assertShape(page.items);
    stdrYm ??= page.stdrYm;
    all.push(...page.items);
    onPage?.({ sigunguCd, pageNo, got: all.length, total: page.totalCount });
    if (page.items.length < PAGE_SIZE || all.length >= page.totalCount) break;
  }
  return { items: all, stdrYm };
}

async function withRetry(fn, delays = [2000, 4000, 8000]) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= delays.length || /상가정보 API 오류/.test(err.message)) throw err;
      await new Promise((r) => setTimeout(r, delays[i]));
    }
  }
}

function assertShape(items) {
  if (!items.length) return;
  const missing = REQUIRED_FIELDS.filter((f) => !(f in items[0]));
  if (missing.length) {
    throw new Error(
      `상가정보 응답에 예상한 컬럼이 없습니다: ${missing.join(", ")}\n` +
        `실제 컬럼: ${Object.keys(items[0]).join(", ")}\n` +
        `scripts/lib/sangga.mjs의 mapStoreItem을 실제 컬럼에 맞게 고쳐야 합니다.`,
    );
  }
}

const round6 = (x) => Math.round(x * 1e6) / 1e6;

/** 원본 업소 한 건 → 내부 Place (DESIGN.md §3.1). 좌표가 없으면 null. */
export function mapStoreItem(item) {
  const lat = Number(item.lat);
  const lng = Number(item.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || lng === 0) return null;
  return {
    id: String(item.bizesId),
    name: [item.bizesNm, item.brchNm].filter(Boolean).join(" "),
    categoryCode: item.indsSclsCd,
    categoryName: item.indsSclsNm,
    categoryMajor: item.indsLclsNm,
    lat: round6(lat),
    lng: round6(lng),
    address: item.rdnmAdr || item.lnoAdr || "",
    dong: item.adongNm || item.ldongNm || "",
  };
}

const M_PER_DEG_LAT = 111_320;

/**
 * 원본 업소 목록 → 앱이 읽는 데이터셋 JSON (data/sample.json과 같은 형식).
 * 관심 행정동(focusDong)의 업소 중심을 기준으로 ±boxKm 사각형 안만 남긴다.
 */
export function buildDataset({ items, id, label, focusDong, boxKm = 3, coverage = [], stdrYm, fetchedAt }) {
  const byId = new Map();
  let skipped = 0;
  for (const item of items) {
    const p = mapStoreItem(item);
    if (p) byId.set(p.id, p);
    else skipped++;
  }
  const all = [...byId.values()];

  // 행정동별 업소 중심점 → 지오코딩(동 이름 검색)과 관심 지역 중심에 쓴다.
  const dongAgg = new Map();
  for (const p of all) {
    if (!p.dong) continue;
    const d = dongAgg.get(p.dong) ?? { name: p.dong, lat: 0, lng: 0, count: 0 };
    d.lat += p.lat;
    d.lng += p.lng;
    d.count++;
    dongAgg.set(p.dong, d);
  }
  const dongs = [...dongAgg.values()].map((d) => ({
    name: d.name,
    lat: round6(d.lat / d.count),
    lng: round6(d.lng / d.count),
    count: d.count,
  }));

  const focus = dongs.find((d) => d.name === focusDong);
  if (!focus) {
    const names = dongs.map((d) => d.name).sort().join(", ");
    throw new Error(`'${focusDong}' 업소를 찾지 못했습니다. 받은 데이터의 행정동: ${names || "(없음)"}`);
  }

  const dLat = (boxKm * 1000) / M_PER_DEG_LAT;
  const dLng = (boxKm * 1000) / (M_PER_DEG_LAT * Math.cos((focus.lat * Math.PI) / 180));
  const bounds = {
    south: round6(focus.lat - dLat),
    west: round6(focus.lng - dLng),
    north: round6(focus.lat + dLat),
    east: round6(focus.lng + dLng),
  };
  const inBounds = (p) =>
    p.lat >= bounds.south && p.lat <= bounds.north && p.lng >= bounds.west && p.lng <= bounds.east;

  const places = all.filter(inBounds);

  const catAgg = new Map();
  for (const p of places) {
    const c = catAgg.get(p.categoryCode) ?? { code: p.categoryCode, name: p.categoryName, major: p.categoryMajor, count: 0 };
    c.count++;
    catAgg.set(p.categoryCode, c);
  }
  const categories = [...catAgg.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ko"));
  const cafe = categories.find((c) => c.name === "카페");

  return {
    meta: {
      id,
      label,
      kind: "real",
      note: "소상공인시장진흥공단 상가(상권)정보 기반. 폐업·미등록 업소가 섞여 있을 수 있습니다.",
      source: { name: "소상공인시장진흥공단 상가(상권)정보", url: "https://www.data.go.kr/data/15012005/openapi.do" },
      stdrYm: stdrYm ?? null,
      fetchedAt,
      coverage,
      bounds,
      focus: { name: focus.name, lat: focus.lat, lng: focus.lng },
      dongs: dongs.filter(inBounds).sort((a, b) => a.name.localeCompare(b.name, "ko")),
      defaults: { q: focus.name, cat: (cafe ?? categories[0])?.code },
      count: places.length,
      skippedNoCoords: skipped,
    },
    categories,
    // 업종명·대분류는 categories에서 채우므로 업소에는 코드만 남긴다.
    places: places.map(({ categoryName, categoryMajor, ...rest }) => rest),
  };
}
