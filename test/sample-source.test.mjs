import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SampleGeocoder } from "../src/sources/sample.js";
import { StaticPlaceSource } from "../src/sources/static.js";
import { LANDMARKS, SAMPLE_BOUNDS } from "../src/sources/sample-landmarks.js";

const data = JSON.parse(readFileSync(new URL("../data/sample.json", import.meta.url)));
const source = new StaticPlaceSource(data);
const geocoder = new SampleGeocoder();

test("sample.json: 모든 업소가 샘플 범위 안, 업종 코드가 유효", () => {
  const codes = new Set(data.categories.map((c) => c.code));
  assert.equal(data.places.length, data.meta.count);
  for (const p of data.places) {
    assert.ok(codes.has(p.categoryCode), p.id);
    assert.ok(p.lat >= SAMPLE_BOUNDS.south && p.lat <= SAMPLE_BOUNDS.north, p.id);
    assert.ok(p.lng >= SAMPLE_BOUNDS.west && p.lng <= SAMPLE_BOUNDS.east, p.id);
  }
  assert.equal(new Set(data.places.map((p) => p.id)).size, data.places.length);
});

test("StaticPlaceSource: 업종명·대분류를 채운다", async () => {
  const [p] = await source.query({ lat: 37.4979, lng: 127.0276 }, 300, "cafe");
  assert.equal(p.categoryName, "카페");
  assert.equal(p.categoryMajor, "음식");
});

test("StaticPlaceSource.query: 업종 필터 + 반경", async () => {
  const center = LANDMARKS.find((l) => l.id === "daechi");
  const academies = await source.query(center, 500, "academy");
  assert.ok(academies.length > 0);
  assert.ok(academies.every((p) => p.categoryCode === "academy" && p.distanceM <= 500));

  const all = await source.query(center, 500);
  assert.ok(all.length > academies.length);
});

test("샘플 상권 특성: 학원은 강남역보다 대치동에 훨씬 밀집", async () => {
  const daechi = await source.query(LANDMARKS.find((l) => l.id === "daechi"), 500, "academy");
  const gangnam = await source.query(LANDMARKS.find((l) => l.id === "gangnam"), 500, "academy");
  assert.ok(daechi.length > gangnam.length * 3, `${daechi.length} vs ${gangnam.length}`);
});

test("SampleGeocoder: 랜드마크 이름·별칭·주소형 입력", async () => {
  const cases = {
    "강남역": "강남역",
    "서울 강남구 역삼동 123-4": "역삼역",
    "서울특별시 강남구 신사동": "신사동 가로수길",
    "코엑스": "삼성역",
    "가로수": "신사동 가로수길",
    "강남구청역": "강남구청역",
    "서울 강남구청": "강남구청역",
    "신논현역 앞": "신논현역",
    "논현역": "논현역",
  };
  for (const [input, expected] of Object.entries(cases)) {
    const r = await geocoder.geocode(input);
    assert.ok(r, `${input} → null`);
    assert.ok(r.label.startsWith(expected), `${input} → ${r.label} (expected ${expected})`);
  }
});

test("SampleGeocoder: 좌표 직접 입력", async () => {
  assert.deepEqual(
    { ...(await geocoder.geocode("37.5, 127.03")), label: undefined },
    { lat: 37.5, lng: 127.03, label: undefined },
  );
  assert.equal((await geocoder.geocode("37.5 127.03")).lng, 127.03);
  assert.equal(await geocoder.geocode("95, 127"), null);
});

test("SampleGeocoder: 모르는 주소·빈 입력은 null", async () => {
  assert.equal(await geocoder.geocode(""), null);
  assert.equal(await geocoder.geocode("   "), null);
  assert.equal(await geocoder.geocode("부산 해운대구"), null);
  assert.equal(await geocoder.geocode("역"), null);
});

test("StaticPlaceSource.categories: 개수가 없으면 업소 수로 채운다", async () => {
  const cats = await source.categories();
  const cafe = cats.find((c) => c.code === "cafe");
  assert.equal(cafe.count, data.places.filter((p) => p.categoryCode === "cafe").length);
});
