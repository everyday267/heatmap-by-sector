import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseLivePopResponse,
  mapLivePopRow,
  fetchLivePopDay,
  findLatestDate,
  aggregateLivePop,
  dayType,
  livePopUrl,
  matchCodesByOrder,
} from "../scripts/lib/livepop.mjs";
import { livePopulationView, POP_BASES } from "../src/population.js";

// 서울 생활인구 응답 형식을 흉내 낸 행 (5세 구간 남녀, 마지막 70세 이상)
const row = (date, hour, code, perField = 1) => {
  const r = { STDR_DE_ID: date, TMZON_PD_SE: String(hour).padStart(2, "0"), ADSTRD_CODE_SE: code, TOT_LVPOP_CO: "0" };
  const bins = [[0, 9], [10, 14], [15, 19], [20, 24], [25, 29], [30, 34], [35, 39], [40, 44], [45, 49], [50, 54], [55, 59], [60, 64], [65, 69], [70, 74]];
  let total = 0;
  for (const sex of ["MALE", "FEMALE"]) for (const [a, b] of bins) {
    r[`${sex}_F${a}T${b}_LVPOP_CO`] = String(perField);
    total += perField;
  }
  r.TOT_LVPOP_CO = String(total);
  return r;
};
const ok = (rows, total = rows.length) =>
  JSON.stringify({ SPOP_LOCAL_RESD_DONG: { list_total_count: total, RESULT: { CODE: "INFO-000", MESSAGE: "정상" }, row: rows } });

test("livePopUrl: 서울 API 경로 형식", () => {
  assert.equal(
    livePopUrl("K/+", 1, 1000, "20260920"),
    "http://openapi.seoul.go.kr:8088/K%2F%2B/json/SPOP_LOCAL_RESD_DONG/1/1000/20260920",
  );
});

test("parseLivePopResponse: 정상 / 데이터 없음 / 인증키 오류(JSON·XML)", () => {
  assert.equal(parseLivePopResponse(ok([row("20260920", 0, "11290660")])).rows.length, 1);
  assert.equal(parseLivePopResponse(JSON.stringify({ RESULT: { CODE: "INFO-200", MESSAGE: "해당하는 데이터가 없습니다." } })).empty, true);
  assert.throws(
    () => parseLivePopResponse(JSON.stringify({ RESULT: { CODE: "INFO-100", MESSAGE: "인증키가 유효하지 않습니다." } })),
    (e) => e.auth === true && /INFO-100.*인증키/.test(e.message),
  );
  assert.throws(
    () => parseLivePopResponse("<RESULT><CODE>INFO-100</CODE><MESSAGE>인증키가 유효하지 않습니다.</MESSAGE></RESULT>"),
    (e) => e.auth === true,
  );
  assert.throws(() => parseLivePopResponse(JSON.stringify({ RESULT: { CODE: "ERROR-500", MESSAGE: "서버 오류" } })), /ERROR-500/);
});

test("mapLivePopRow: 5세 구간을 10세 구간으로, 70세 이상은 70대 칸에", () => {
  const r = mapLivePopRow(row("20260920", 13, "11290685", 2));
  assert.equal(r.hour, 13);
  assert.equal(r.code, "11290685");
  assert.equal(r.total, 56);
  assert.deepEqual(r.ages, [4, 8, 8, 8, 8, 8, 8, 4, 0, 0, 0]);
  assert.equal(mapLivePopRow({ foo: 1 }), null);
});

test("fetchLivePopDay: 1000행씩 넘기고, 인증키는 오류 메시지에서 가린다", async () => {
  const urls = [];
  const many = Array.from({ length: 1000 }, (_, i) => row("20260920", i % 24, "11290660"));
  const fetchImpl = async (u) => {
    urls.push(u);
    return { text: async () => (urls.length === 1 ? ok(many, 1500) : ok(many.slice(0, 500), 1500)) };
  };
  assert.equal((await fetchLivePopDay("20260920", { key: "KEY", fetchImpl })).length, 1500);
  assert.match(urls[1], /\/1001\/2000\/20260920$/);

  const bad = async () => ({ text: async () => JSON.stringify({ RESULT: { CODE: "ERROR-331", MESSAGE: "키 SECRETKEY 오류" } }) });
  await assert.rejects(fetchLivePopDay("20260920", { key: "SECRETKEY", fetchImpl: bad }), (e) => {
    assert.doesNotMatch(e.message, /SECRETKEY/);
    return e.auth === true;
  });
  await assert.rejects(fetchLivePopDay("20260920", { key: "" }), (e) => e.auth === true);
});

test("findLatestDate: 날짜 조건 없이 첫·마지막 행으로 최근 날짜를 찾고, 그 날짜로 조회되는지 확인", async () => {
  const asked = [];
  const fetchImpl = async (u) => {
    const parts = u.split("/");
    asked.push(parts.slice(-3).join("/"));
    const [start, , date] = parts.slice(-3);
    if (!date) return { text: async () => ok([row(start === "1" ? "20260801" : "20260920", 0, "x")], 5000) };
    return { text: async () => (date === "20260920" ? ok([row(date, 0, "x")]) : JSON.stringify({ RESULT: { CODE: "INFO-200", MESSAGE: "없음" } })) };
  };
  assert.equal(await findLatestDate({ key: "k", fetchImpl }), "20260920");
  assert.deepEqual(asked, ["1/1/", "5000/5000/", "1/1/20260920"]);
});

test("findLatestDate: 날짜 조건이 안 먹으면 하루씩 거슬러 찾고, 끝내 없으면 응답을 담아 알린다", async () => {
  const fetchImpl = async (u) => {
    const date = u.split("/").at(-1);
    if (!date) return { text: async () => ok([row("20260920", 0, "x")], 1) };
    return { text: async () => (date === "20260918" ? ok([row(date, 0, "x")]) : JSON.stringify({ RESULT: { CODE: "INFO-200", MESSAGE: "없음" } })) };
  };
  assert.equal(await findLatestDate({ key: "k", fetchImpl, now: new Date(Date.UTC(2026, 8, 25)) }), "20260918");

  const never = async (u) => ({
    text: async () => (u.endsWith("/") ? ok([row("2026-09-20", 0, "x")], 1) : JSON.stringify({ RESULT: { CODE: "INFO-200", MESSAGE: "없음" } })),
  });
  await assert.rejects(findLatestDate({ key: "k", fetchImpl: never, maxBack: 3 }), /날짜 조건 전달 방식.*INFO-200/s);
});

test("dayType: 토·일은 주말", () => {
  assert.equal(dayType("20260919"), "weekend"); // 토
  assert.equal(dayType("20260920"), "weekend"); // 일
  assert.equal(dayType("20260921"), "weekday"); // 월
});

test("aggregateLivePop: 동 코드로 이름 붙이고, 평일/주말 시간대별 평균", () => {
  const rows = [
    row("20260921", 12, "11290685", 1), // 월
    row("20260922", 12, "11290685", 3), // 화 → 평일 12시 평균 = 2씩
    row("20260920", 12, "11290685", 5), // 일 → 주말
    row("20260921", 12, "99999999", 9), // 데이터셋에 없는 동
  ].map(mapLivePopRow);
  const { dongs, missing } = aggregateLivePop(rows, [{ name: "길음2동", code: "11290685" }, { name: "길음1동", code: "11290660" }]);
  assert.deepEqual(missing, ["길음1동"]);
  assert.equal(dongs.length, 1);
  const [d] = dongs;
  assert.equal(d.weekday[12][0], 56); // 28필드 × 2
  assert.equal(d.weekend[12][0], 140);
  assert.equal(d.weekday[3], null); // 자료 없는 시간
  assert.equal(d.weekday[12][1], 4); // 0~9세 남녀 각 2
});

test("livePopulationView: 기준의 시간대 평균, 심야는 평일:주말 5:2 가중", () => {
  const slot = (t) => [t, ...new Array(11).fill(t / 11)];
  const hours = (fn) => Array.from({ length: 24 }, (_, h) => slot(fn(h)));
  const live = {
    meta: { hasAges: true },
    dongs: [{ name: "길음2동", weekday: hours((h) => (h >= 11 && h < 14 ? 1000 : 100)), weekend: hours(() => 200) }],
  };
  assert.equal(livePopulationView(live, "live-wd-lunch").dongs[0].total, 1000);
  assert.equal(livePopulationView(live, "live-we").dongs[0].total, 200);
  const night = livePopulationView(live, "live-night").dongs[0].total;
  assert.ok(Math.abs(night - (100 * 5 + 200 * 2) / 7) < 1e-9);
  assert.equal(livePopulationView(live, "live-wd").dongs[0].ages.length, 11);
  assert.throws(() => livePopulationView(live, "resident"));
  assert.ok(POP_BASES.some((b) => b.key === "live-wd-evening"));
});

test("matchCodesByOrder: 같은 구 안에서 코드 순서대로 짝짓고 새벽 인구로 확인", () => {
  const dongs = [
    { name: "번2동", code: "11305603" },
    { name: "번1동", code: "11305595" },
    { name: "수유1동", code: "11305615" },
  ];
  const codes = ["11305600", "11305590", "11305610"];
  const night = { 11305590: 15000, 11305600: 13500, 11305610: 40000 };
  const resident = { 번1동: 15825, 번2동: 14073, 수유1동: 19210 };
  const { aliases, log } = matchCodesByOrder(dongs, codes, (c) => night[c], (n) => resident[n]);
  assert.deepEqual([...aliases.entries()].sort(), [["11305590", "11305595"], ["11305600", "11305603"]]);
  assert.match(log.join("\n"), /수유1동.*2\.08 → 버림/);
});

test("matchCodesByOrder: 개수가 다르면 맞추지 않고 이유를 남긴다", () => {
  const { aliases, log } = matchCodesByOrder([{ name: "번1동", code: "11305595" }], ["11305590", "11305600"], () => 1, () => 1);
  assert.equal(aliases.size, 0);
  assert.match(log[0], /개수가 달라/);
});
