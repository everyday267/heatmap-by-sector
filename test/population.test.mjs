import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parsePopulationResponse,
  mapPopulationRow,
  aggregateByDong,
  recentMonths,
  fetchDongPopulation,
  fetchPopulationByDongCodes,
  toAdmmCd,
} from "../scripts/lib/population.mjs";
import { PopulationGrid, combinedAdvice, MIN_POP } from "../src/population.js";
import { DensityBenchmark } from "../src/benchmark.js";

// 행정안전부 API 형식을 흉내 낸 행 (만 나이 10세 단위, 남녀 따로)
const row = (dongNm, perBand = 10, extra = {}) => {
  const r = { ctpvNm: "서울특별시", sggNm: "성북구", dongNm, ...extra };
  for (let a = 0; a <= 100; a += 10) {
    r[`male${a}AgeNmprCnt`] = String(perBand);
    r[`feml${a}AgeNmprCnt`] = String(perBand);
  }
  return r;
};
const body = (items, extra = {}) =>
  JSON.stringify({ Response: { head: { resultCode: "0", resultMsg: "NORMAL", totalCount: items.length }, items: { item: items }, ...extra } });

test("parsePopulationResponse: 감싸는 구조가 달라도 행을 꺼낸다", () => {
  assert.equal(parsePopulationResponse(body([row("길음2동")])).items.length, 1);
  const alt = JSON.stringify({ response: { header: { resultCode: "00" }, body: { items: [row("길음1동")], totalCount: 1 } } });
  assert.equal(parsePopulationResponse(alt).items[0].dongNm, "길음1동");
  // item이 하나면 배열이 아니라 객체로 오는 경우
  const single = JSON.stringify({ Response: { head: { resultCode: "0" }, items: { item: row("미아동") } } });
  assert.equal(parsePopulationResponse(single).items.length, 1);
});

test("parsePopulationResponse: 오류 코드·XML 인증 오류", () => {
  assert.throws(() => parsePopulationResponse(JSON.stringify({ Response: { head: { resultCode: "-4", resultMsg: "인증키 오류" } } })), /-4.*인증키/);
  assert.throws(() => parsePopulationResponse("<OpenAPI_ServiceResponse><returnAuthMsg>SERVICE_ACCESS_DENIED_ERROR</returnAuthMsg></OpenAPI_ServiceResponse>"), /SERVICE_ACCESS_DENIED/);
});

test("parsePopulationResponse: JSON으로 온 게이트웨이 오류(키 미등록)도 오류로", () => {
  const text = JSON.stringify({
    OpenAPI_ServiceResponse: { cmmMsgHeader: { errMsg: "SERVICE_KEY_IS_NOT_REGISTERED_ERROR", returnAuthMsg: "등록되지 않은 서비스키", returnReasonCode: "30" } },
  });
  assert.throws(() => parsePopulationResponse(text), (err) => {
    assert.equal(err.gateway, true);
    assert.match(err.message, /SERVICE_KEY_IS_NOT_REGISTERED_ERROR \(등록되지 않은 서비스키\).*활용신청/);
    return true;
  });
});

test("fetchDongPopulation: 게이트웨이 오류면 다른 lv로 재시도하지 않고 바로", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return { text: async () => JSON.stringify({ OpenAPI_ServiceResponse: { cmmMsgHeader: { errMsg: "SERVICE_KEY_IS_NOT_REGISTERED_ERROR" } } }) };
  };
  await assert.rejects(fetchDongPopulation("11290", { serviceKey: "k", ym: "202609", fetchImpl }), (e) => e.gateway === true);
  assert.equal(calls, 1);
});

test("mapPopulationRow: 남녀 합쳐 10세 구간, 총인구 항목이 있으면 그 값", () => {
  const r = mapPopulationRow(row("길음2동", 5));
  assert.equal(r.dong, "길음2동");
  assert.equal(r.ages.length, 11);
  assert.ok(r.ages.every((v) => v === 10));
  assert.equal(r.total, 110);
  assert.equal(mapPopulationRow(row("길음2동", 5, { totNmprCnt: "123" })).total, 123);
  assert.equal(mapPopulationRow({ ctpvNm: "서울", sggNm: "성북구", totNmprCnt: "1" }), null); // 동 이름 없는 구 합계
});

test("aggregateByDong: 통·반 단위 행을 동으로 합친다", () => {
  const rows = [row("길음2동", 1), row("길음2동", 2), row("길음1동", 1)].map(mapPopulationRow);
  const d = aggregateByDong(rows);
  assert.deepEqual(d.map((x) => [x.name, x.total]), [["길음1동", 22], ["길음2동", 66]]);
  assert.equal(d[1].ages[3], 6);
});

test("recentMonths: 전월부터 거슬러 올라감 (연도 넘김)", () => {
  assert.deepEqual(recentMonths(new Date(Date.UTC(2026, 0, 15))), ["202512", "202511", "202510"]);
});

test("fetchDongPopulation: 요청 변수, 동 단위 행이 없으면 다음 lv 시도", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(new URL(url));
    const lv = urls.at(-1).searchParams.get("lv");
    // lv=3은 구 합계 한 줄만, lv=4는 통 단위 행
    const items = lv === "3" ? [{ sggNm: "성북구", totNmprCnt: "400000" }] : [row("길음2동", 1), row("길음2동", 1), row("길음1동", 1)];
    return { text: async () => body(items) };
  };
  const r = await fetchDongPopulation("11290", { serviceKey: "k%2B", ym: "202609", fetchImpl });
  assert.deepEqual(r.dongs.map((d) => [d.name, d.total]), [["길음1동", 22], ["길음2동", 44]]);
  assert.equal(r.hasAges, true);
  const u = urls[0].searchParams;
  assert.equal(urls[0].pathname, "/1741000/admmSexdAgePpltn/selectAdmmSexdAgePpltn");
  assert.equal(u.get("serviceKey"), "k+");
  assert.equal(u.get("admmCd"), "1129000000");
  assert.equal(u.get("srchFrYm"), "202609");
  assert.equal(u.get("srchToYm"), "202609");
  assert.deepEqual(urls.map((x) => x.searchParams.get("lv")), ["3", "4"]);
});

test("fetchDongPopulation: 항목 이름이 예상과 다르면 실제 항목을 알려준다", async () => {
  const fetchImpl = async () => ({ text: async () => body([{ foo: "1", bar: "2" }]) });
  await assert.rejects(
    fetchDongPopulation("11290", { serviceKey: "k", ym: "202609", fetchImpl }),
    (err) => /실제 항목: foo, bar/.test(err.message),
  );
});

test("fetchDongPopulation: 0행이면 응답 앞부분을 오류에 담고, 인증키는 가린다", async () => {
  const fetchImpl = async () => ({
    text: async () => JSON.stringify({ Response: { head: { resultCode: "0", resultMsg: "NODATA key=SECRET+KEY" }, items: { item: [] } } }),
  });
  await assert.rejects(fetchDongPopulation("11290", { serviceKey: "SECRET+KEY", ym: "202609", fetchImpl }), (err) => {
    assert.match(err.message, /NODATA key=\*\*\*/);
    assert.doesNotMatch(err.message, /SECRET/);
    return true;
  });
});

test("toAdmmCd: 8자리 행정동 코드는 10자리로", () => {
  assert.equal(toAdmmCd("11290685"), "1129068500");
  assert.equal(toAdmmCd("1129068500"), "1129068500");
});

test("fetchPopulationByDongCodes: 첫 동으로 통하는 lv를 찾은 뒤 동마다 조회", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    const u = new URL(url).searchParams;
    calls.push(`${u.get("admmCd")}/${u.get("lv")}`);
    // lv=3은 빈 응답, lv=4는 동 이름 없는 통 단위 행 2개
    const items = u.get("lv") === "4" ? [{ tong: "1", ...row(undefined, 1) }, { tong: "2", ...row(undefined, 2) }] : [];
    for (const it of items) delete it.dongNm;
    return { text: async () => body(items) };
  };
  const dongs = [{ name: "길음2동", code: "11290685" }, { name: "길음1동", code: "1129066000" }, { name: "코드없음" }];
  const r = await fetchPopulationByDongCodes(dongs, { serviceKey: "k", ym: "202609", fetchImpl });
  assert.deepEqual(r.dongs.map((d) => [d.name, d.total]), [["길음1동", 66], ["길음2동", 66]]);
  assert.deepEqual(calls, ["1129068500/3", "1129068500/4", "1129068500/4", "1129066000/4"]);
});

test("fetchPopulationByDongCodes: 동 이름이 붙은 행이 오면 그 동 것만", async () => {
  const fetchImpl = async () => ({ text: async () => body([row("길음2동", 1), row("미아동", 5)]) });
  const r = await fetchPopulationByDongCodes([{ name: "길음2동", code: "1129068500" }], { serviceKey: "k", ym: "202609", fetchImpl });
  assert.deepEqual(r.dongs.map((d) => [d.name, d.total]), [["길음2동", 22]]);
});

test("fetchPopulationByDongCodes: 동 코드가 없으면 다시 수집하라고 안내", async () => {
  await assert.rejects(fetchPopulationByDongCodes([{ name: "길음2동" }], { serviceKey: "k", ym: "202609" }), /다시 수집/);
});

// --- PopulationGrid ---
const M_LAT = 111_320;
const M_LNG = M_LAT * Math.cos((37.6 * Math.PI) / 180);
const B = { south: 37.58, west: 127.0, north: 37.58 + 3000 / M_LAT, east: 127.0 + 3000 / M_LNG };
const at = (xM, yM, dong, code = "cafe") => ({ lat: B.south + yM / M_LAT, lng: B.west + xM / M_LNG, dong, categoryCode: code });
const pop = (dongs) => ({ meta: { ym: "202609", hasAges: true }, dongs });
const ages = (each) => new Array(11).fill(each);

test("PopulationGrid: 동 인구를 그 동의 상가 칸에 고르게, 범위 밖 칸 수까지 분모로", () => {
  // A동: 범위 안 칸 2개, 범위 밖까지 4칸 → 칸당 1/4. B동: 칸 1개. C동: 인구 데이터 없음.
  const places = [at(150, 150, "A"), at(155, 155, "A"), at(450, 150, "A"), at(2550, 2550, "B"), at(1500, 1500, "C")];
  const g = new PopulationGrid(places, B, pop([
    { name: "A", total: 4000, ages: ages(4000 / 11) },
    { name: "B", total: 1000, ages: ages(1000 / 11) },
  ]), [{ name: "A", cells: 4 }, { name: "B", cells: 1 }, { name: "C", cells: 1 }]);

  assert.equal(g.cells.length, 3);
  assert.deepEqual(g.missingDongs, ["C"]);
  // A동 칸 2개만 들어오는 반경 → 4000 × 2/4
  assert.ok(Math.abs(g.popWithin(at(300, 150), 200) - 2000) < 1e-6);
  assert.ok(Math.abs(g.popWithin(at(2550, 2550), 100) - 1000) < 1e-6);
  // 20대(구간 2) 1/11
  assert.ok(Math.abs(g.popWithin(at(2550, 2550), 100, "20") - 1000 / 11) < 1e-6);
  assert.ok(Math.abs(g.popWithin(at(2550, 2550), 100, "20-30") - 2000 / 11) < 1e-6);
  assert.equal(g.popWithin(at(1500, 1500), 50), 0); // 인구 없는 동
});

test("PopulationGrid.demand: 인구에 비해 가게가 많은 곳일수록 높은 순위", () => {
  // 3km 칸 전체에 100m마다 상가 1곳(같은 동) + 인구 고르게 → 기준점 1곳당 인구 동일
  const places = [];
  for (let x = 50; x < 3000; x += 100) for (let y = 50; y < 3000; y += 100) places.push(at(x, y, "A", "other"));
  // 카페: 왼쪽 절반에만 칸마다 1곳
  for (let x = 50; x < 1500; x += 100) for (let y = 50; y < 3000; y += 100) places.push(at(x + 5, y + 5, "A"));
  const cells = 900;
  const g = new PopulationGrid(places, B, pop([{ name: "A", total: cells * 100, ages: ages((cells * 100) / 11) }]), [{ name: "A", cells }]);
  const bm = new DensityBenchmark(places, B);

  const center = at(750, 1500);
  const count = places.filter((p) => p.categoryCode === "cafe" && Math.hypot((p.lat - center.lat) * M_LAT, (p.lng - center.lng) * M_LNG) <= 500).length;
  const left = g.demand({ center, radiusM: 500, categoryCode: "cafe", count, benchmark: bm });
  assert.ok(left.pop > 7000 && left.pop < 8500, `pop ${left.pop}`);
  assert.ok(Math.abs(left.perStore - 100) < 15, `perStore ${left.perStore}`);
  assert.ok(["높음", "매우높음"].includes(left.level), left.level);

  const none = g.demand({ center: at(2250, 1500), radiusM: 500, categoryCode: "cafe", count: 0, benchmark: bm });
  assert.equal(none.level, "낮음");
  assert.equal(none.perStore, null);

  const empty = g.demand({ center: at(-5000, -5000), radiusM: 500, categoryCode: "cafe", count: 1, benchmark: bm });
  assert.ok(empty.pop < MIN_POP);
  assert.equal(empty.level, undefined);
  assert.match(empty.reason, /인구가 적어/);
});

test("combinedAdvice: 가게 수 × 인구 대비 조합", () => {
  assert.match(combinedAdvice("매우높음", "높음"), /과밀/);
  assert.match(combinedAdvice("낮음", "매우높음"), /포화/);
  assert.match(combinedAdvice("높음", "낮음"), /수요가 있어/);
  assert.match(combinedAdvice("낮음", "낮음"), /기회 후보/);
  assert.match(combinedAdvice("보통", "낮음"), /진입·광고 확대/);
  assert.match(combinedAdvice("높음", "보통"), /차별화/);
  assert.match(combinedAdvice("보통", "보통"), /보통/);
});
