import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCoords,
  normalizeAddress,
  DatasetGeocoder,
  ApiGeocoder,
  ChainGeocoder,
} from "../src/sources/geocoders.js";
import { kakaoGeocode } from "../scripts/lib/kakao.mjs";

const meta = {
  focus: { name: "길음2동", lat: 37.605, lng: 127.03 },
  dongs: [
    { name: "길음1동", lat: 37.606, lng: 127.02, count: 300 },
    { name: "길음2동", lat: 37.605, lng: 127.03, count: 500 },
    { name: "돈암1동", lat: 37.595, lng: 127.02, count: 400 },
  ],
};

test("parseCoords", () => {
  assert.deepEqual(parseCoords("37.6, 127.03"), { lat: 37.6, lng: 127.03, label: "37.60000, 127.03000" });
  assert.equal(parseCoords("37.6 127.03").lng, 127.03);
  assert.equal(parseCoords("길음2동"), null);
  assert.equal(parseCoords("95, 127"), null);
});

test("normalizeAddress: 시·구 접두어 제거", () => {
  assert.equal(normalizeAddress("서울특별시 성북구 길음2동"), "길음2동");
  assert.equal(normalizeAddress("서울시 성북구 길음2동"), "길음2동");
  assert.equal(normalizeAddress("성북구 길음2동"), "길음2동");
  assert.equal(normalizeAddress(" 길음 2동 "), "길음2동");
  assert.equal(normalizeAddress("강남구청역"), "강남구청역");
});

test("DatasetGeocoder exact: 좌표와 동 이름 완전일치만", async () => {
  const g = new DatasetGeocoder(meta);
  assert.equal((await g.geocode("서울시 성북구 길음2동")).lat, 37.605);
  assert.equal((await g.geocode("37.6, 127.03")).lat, 37.6);
  assert.equal(await g.geocode("길음"), null);
  assert.equal(await g.geocode("동소문로 1"), null);
});

test("DatasetGeocoder fuzzy: 동 이름 포함 / 부분일치는 업소 많은 동", async () => {
  const g = new DatasetGeocoder(meta, { mode: "fuzzy" });
  assert.match((await g.geocode("길음1동 1287-3")).label, /^길음1동/);
  assert.match((await g.geocode("길음")).label, /^길음2동/);
  assert.equal(await g.geocode("37.6, 127.03"), null); // 좌표는 exact 담당
  assert.equal(await g.geocode("해운대"), null);
});

test("DatasetGeocoder.suggestions: 관심 동을 맨 앞에", () => {
  assert.deepEqual(new DatasetGeocoder(meta).suggestions("길음2동"), ["길음2동", "길음1동", "돈암1동"]);
});

const res = (status, body, type = "application/json") => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => type },
  json: async () => body,
});

test("ApiGeocoder: 성공 / 결과 없음 / 키 없음이면 이후 호출 생략", async () => {
  const calls = [];
  const replies = [res(200, { lat: 37.6, lng: 127.02, label: "길음역" }), res(404, { error: "x" }), res(503, { error: "x" })];
  const g = new ApiGeocoder({ near: { lat: 1, lng: 2 }, fetchImpl: async (u) => (calls.push(u), replies.shift()) });

  assert.equal((await g.geocode("길음역")).label, "길음역");
  assert.match(calls[0], /^api\/geocode\?q=%EA%B8%B8%EC%9D%8C%EC%97%AD&near=1%2C2$/);
  assert.equal(await g.geocode("없는곳"), null);
  assert.equal(g.available, true); // JSON 404 = 결과 없음일 뿐
  assert.equal(await g.geocode("x"), null);
  assert.equal(g.available, false); // 503 = 키 없음
  assert.equal(await g.geocode("y"), null);
  assert.equal(calls.length, 3);
});

test("ApiGeocoder: 정적 호스팅(HTML 404)·네트워크 오류는 null", async () => {
  const g = new ApiGeocoder({ fetchImpl: async () => res(404, null, "text/html") });
  assert.equal(await g.geocode("a"), null);
  assert.equal(g.available, false);
  const g2 = new ApiGeocoder({ fetchImpl: async () => { throw new Error("offline"); } });
  assert.equal(await g2.geocode("a"), null);
});

test("ChainGeocoder: 앞에서부터 처음 찾은 결과", async () => {
  const seen = [];
  const g = (name, hit) => ({ geocode: async () => (seen.push(name), hit) });
  const chain = new ChainGeocoder([g("a", null), g("b", { lat: 1, lng: 2, label: "b" }), g("c", { label: "c" })]);
  assert.equal((await chain.geocode("q")).label, "b");
  assert.deepEqual(seen, ["a", "b"]);
});

test("kakaoGeocode: 주소 검색 → 없으면 근처 키워드 검색", async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url: new URL(url), auth: opts.headers.Authorization });
    if (url.includes("address.json")) return res(200, { documents: [] });
    return res(200, {
      documents: [{ place_name: "길음역 4호선", road_address_name: "서울 성북구 동소문로 지하 248", x: "127.0251", y: "37.6033" }],
    });
  };
  const r = await kakaoGeocode("길음역", { key: "K", near: { lat: 37.605, lng: 127.03 }, fetchImpl });
  assert.deepEqual(r, { lat: 37.6033, lng: 127.0251, label: "길음역 4호선 (서울 성북구 동소문로 지하 248)" });
  assert.equal(calls[0].auth, "KakaoAK K");
  assert.equal(calls[1].url.pathname, "/v2/local/search/keyword.json");
  assert.equal(calls[1].url.searchParams.get("y"), "37.605");
  assert.equal(calls[1].url.searchParams.get("radius"), "20000");
});

test("kakaoGeocode: 주소 검색 성공 / 결과 없음 / 키 없음 / API 오류", async () => {
  const addr = async () => res(200, { documents: [{ address_name: "서울 성북구 길음동 1287", x: "127.02", y: "37.6" }] });
  assert.deepEqual(await kakaoGeocode("길음동 1287", { key: "K", fetchImpl: addr }), {
    lat: 37.6, lng: 127.02, label: "서울 성북구 길음동 1287",
  });
  const none = async () => res(200, { documents: [] });
  assert.equal(await kakaoGeocode("x", { key: "K", fetchImpl: none }), null);
  await assert.rejects(kakaoGeocode("x", { key: "", fetchImpl: none }), /KAKAO_REST_API_KEY/);
  const unauthorized = async () => ({ ...res(401, {}), text: async () => '{"msg":"wrong appKey"}' });
  await assert.rejects(kakaoGeocode("x", { key: "K", fetchImpl: unauthorized }), /401.*wrong appKey/);
});
