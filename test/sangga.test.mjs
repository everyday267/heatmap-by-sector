import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeServiceKey,
  parseResponse,
  fetchStoresBySigungu,
  mapStoreItem,
  buildDataset,
} from "../scripts/lib/sangga.mjs";

// 상가정보 API 응답 형식을 흉내 낸 테스트용 가짜 업소.
let seq = 0;
const item = (o = {}) => ({
  bizesId: `MA${String(++seq).padStart(6, "0")}`,
  bizesNm: "테스트업소",
  brchNm: "",
  indsLclsCd: "I2",
  indsLclsNm: "음식",
  indsMclsCd: "I212",
  indsMclsNm: "비알코올",
  indsSclsCd: "I21201",
  indsSclsNm: "카페",
  signguNm: "성북구",
  adongNm: "길음2동",
  ldongNm: "길음동",
  lnoAdr: "서울특별시 성북구 길음동 1",
  rdnmAdr: "서울특별시 성북구 동소문로 1",
  lon: 127.03,
  lat: 37.605,
  ...o,
});
const page = (items, totalCount = items.length, resultCode = "00") =>
  JSON.stringify({
    header: { resultCode, resultMsg: "NORMAL SERVICE", stdrYm: "202506" },
    body: { items, totalCount, numOfRows: 1000, pageNo: 1 },
  });

test("normalizeServiceKey: Decoding 키는 그대로, Encoding 키는 풀어서", () => {
  assert.equal(normalizeServiceKey(" abc+/= "), "abc+/=");
  assert.equal(normalizeServiceKey("abc%2B%2F%3D"), "abc+/=");
  assert.throws(() => normalizeServiceKey(""), /DATA_GO_KR_SERVICE_KEY/);
  assert.throws(() => normalizeServiceKey(undefined), /DATA_GO_KR_SERVICE_KEY/);
});

test("parseResponse: 정상 / 데이터 없음 / 오류 코드 / XML 인증 오류", () => {
  const ok = parseResponse(page([item()], 1));
  assert.equal(ok.items.length, 1);
  assert.equal(ok.totalCount, 1);
  assert.equal(ok.stdrYm, "202506");

  assert.deepEqual(parseResponse(page([], 0, "03")).items, []);
  assert.throws(() => parseResponse(page([], 0, "10")), /오류 10/);
  assert.throws(
    () =>
      parseResponse(
        "<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>",
      ),
    /SERVICE_KEY_IS_NOT_REGISTERED_ERROR/,
  );
});

test("fetchStoresBySigungu: 페이지를 끝까지 넘기고 요청 파라미터가 맞다", async () => {
  const urls = [];
  const first = Array.from({ length: 1000 }, () => item());
  const second = Array.from({ length: 5 }, () => item());
  const fetchImpl = async (url) => {
    urls.push(new URL(url));
    const body = urls.length === 1 ? page(first, 1005) : page(second, 1005);
    return { status: 200, text: async () => body };
  };
  const r = await fetchStoresBySigungu("11290", { serviceKey: "k%2B", fetchImpl });
  assert.equal(r.items.length, 1005);
  assert.equal(r.stdrYm, "202506");
  assert.equal(urls.length, 2);
  assert.equal(urls[0].pathname, "/B553077/api/open/sdsc2/storeListInDong");
  assert.equal(urls[0].searchParams.get("serviceKey"), "k+");
  assert.equal(urls[0].searchParams.get("divId"), "signguCd");
  assert.equal(urls[0].searchParams.get("key"), "11290");
  assert.equal(urls[1].searchParams.get("pageNo"), "2");
  assert.equal(urls[0].searchParams.get("type"), "json");
});

test("fetchStoresBySigungu: 응답 컬럼이 예상과 다르면 실제 컬럼을 알려준다", async () => {
  const fetchImpl = async () => ({ status: 200, text: async () => page([{ foo: 1, bar: 2 }]) });
  await assert.rejects(
    fetchStoresBySigungu("11290", { serviceKey: "k", fetchImpl }),
    (err) => /bizesId/.test(err.message) && /실제 컬럼: foo, bar/.test(err.message),
  );
});

test("mapStoreItem: 이름+지점명, 도로명 우선, 좌표 없으면 null", () => {
  const p = mapStoreItem(item({ bizesId: "X1", bizesNm: "스타벅스", brchNm: "길음역점", lon: "127.0251234567", lat: "37.6031" }));
  assert.deepEqual(p, {
    id: "X1",
    name: "스타벅스 길음역점",
    categoryCode: "I21201",
    categoryName: "카페",
    categoryMajor: "음식",
    lat: 37.6031,
    lng: 127.025123,
    address: "서울특별시 성북구 동소문로 1",
    dong: "길음2동",
  });
  assert.equal(mapStoreItem(item({ rdnmAdr: "" })).address, "서울특별시 성북구 길음동 1");
  assert.equal(mapStoreItem(item({ lon: "", lat: "" })), null);
  assert.equal(mapStoreItem(item({ lon: 0, lat: 0 })), null);
});

test("buildDataset: 관심 동 중심 ±boxKm만, 업종·동 집계, 기본값", () => {
  const items = [
    item({ bizesId: "a", lat: 37.6, lon: 127.03 }),
    item({ bizesId: "b", lat: 37.61, lon: 127.03 }),
    item({ bizesId: "a", lat: 37.6, lon: 127.03 }), // 중복
    item({ bizesId: "c", adongNm: "길음1동", indsSclsCd: "I20101", indsSclsNm: "백반/한식", lat: 37.605, lon: 127.02 }),
    item({ bizesId: "far", adongNm: "장위1동", lat: 37.62, lon: 127.06 }), // 3km 밖 (동쪽 ~3.1km)
    item({ bizesId: "nocoord", lat: "", lon: "" }),
  ];
  const ds = buildDataset({ items, id: "t", label: "테스트", focusDong: "길음2동", boxKm: 2, coverage: ["성북구"], fetchedAt: "now" });

  assert.deepEqual(ds.meta.focus, { name: "길음2동", lat: 37.605, lng: 127.03 });
  assert.deepEqual(ds.places.map((p) => p.id).sort(), ["a", "b", "c"]);
  assert.equal(ds.meta.count, 3);
  assert.equal(ds.meta.skippedNoCoords, 1);
  assert.deepEqual(ds.categories.map((c) => [c.name, c.count]), [["카페", 2], ["백반/한식", 1]]);
  assert.equal(ds.meta.defaults.cat, "I21201");
  assert.equal(ds.meta.defaults.q, "길음2동");
  assert.deepEqual(ds.meta.dongs.map((d) => d.name), ["길음1동", "길음2동"]);
  assert.equal(ds.places[0].categoryName, undefined); // 업종명은 categories에서
  assert.ok(ds.meta.bounds.south < 37.605 && ds.meta.bounds.north > 37.605);
});

test("buildDataset: 관심 동이 없으면 받은 동 목록과 함께 실패", () => {
  assert.throws(
    () => buildDataset({ items: [item({ adongNm: "길음1동" })], focusDong: "길음2동" }),
    /길음2동.*길음1동/,
  );
});

test("buildDataset: 업소번호만 다른 중복 등록은 한 곳으로", () => {
  const items = [
    item({ bizesId: "d1", bizesNm: "강북세일학원", indsSclsCd: "P10501", lat: 37.605, lon: 127.03 }),
    item({ bizesId: "d2", bizesNm: "강북세일 학원", indsSclsCd: "P10501", lat: 37.605000004, lon: 127.03 }),
    item({ bizesId: "d3", bizesNm: "강북세일학원", indsSclsCd: "P10501", lat: 37.6052, lon: 127.03 }), // 20m 떨어진 다른 곳
    item({ bizesId: "d4", bizesNm: "강북세일학원", indsSclsCd: "P10502", lat: 37.605, lon: 127.03 }), // 다른 업종
  ];
  const ds = buildDataset({ items, focusDong: "길음2동" });
  assert.deepEqual(ds.places.map((p) => p.id).sort(), ["d1", "d3", "d4"]);
  assert.equal(ds.meta.duplicatesRemoved, 1);
});
