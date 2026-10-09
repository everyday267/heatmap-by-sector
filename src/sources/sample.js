// 샘플 데이터 어댑터 (DESIGN.md §4).
// 실데이터 연동 시 같은 메서드를 가진 LocalDataPlaceSource / KakaoGeocoder로 교체한다.
//
// interface PlaceSource {
//   query(center, radiusM, categoryCode?): Promise<Place[]>
//   categories(): Promise<Category[]>
// }
// interface Geocoder {
//   geocode(address): Promise<{ lat, lng, label } | null>
// }

import { withinRadius } from "../geo.js";
import { LANDMARKS } from "./sample-landmarks.js";

export class SamplePlaceSource {
  /** @param {{ categories: Category[], places: Place[] }} data  data/sample.json 형식 */
  constructor(data) {
    this._categories = data.categories;
    const byCode = new Map(data.categories.map((c) => [c.code, c]));
    this._places = data.places.map((p) => {
      const c = byCode.get(p.categoryCode);
      return { ...p, categoryName: c?.name ?? p.categoryCode, categoryMajor: c?.major ?? "" };
    });
  }

  async categories() {
    return this._categories;
  }

  async query(center, radiusM, categoryCode) {
    const pool = categoryCode
      ? this._places.filter((p) => p.categoryCode === categoryCode)
      : this._places;
    return withinRadius(pool, center, radiusM);
  }
}

// "서울 강남구 역삼동" → "역삼동". 공백으로 끝나는 접두어만 떼어 "강남구청역"은 보존.
const normalize = (s) =>
  s
    .trim()
    .replace(/^(서울특별시|서울시|서울)\s+/, "")
    .replace(/^강남구\s+/, "")
    .replace(/\s+/g, "");

// "37.4979, 127.0276" 같은 좌표 직접 입력.
const COORD_RE = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

export class SampleGeocoder {
  constructor(landmarks = LANDMARKS) {
    this._landmarks = landmarks;
  }

  /** 자동완성용 예시 주소 목록. */
  suggestions() {
    return this._landmarks.map((l) => l.name);
  }

  async geocode(address) {
    if (!address || !address.trim()) return null;

    const m = address.match(COORD_RE);
    if (m) {
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
        return { lat, lng, label: `${lat.toFixed(5)}, ${lng.toFixed(5)}` };
      }
    }

    const q = normalize(address);
    if (q.length < 2) return null;

    // 1순위: 이름/별칭 완전일치, 2순위: 입력이 이름/별칭을 포함("역삼동 123-4"),
    // 3순위: 이름/별칭이 입력을 포함("가로수" → "가로수길").
    // 2·3순위는 가장 긴 키를 우선 ("신논현역 앞"이 "논현역"이 아니라 "신논현역"으로).
    const pairs = this._landmarks.flatMap((l) =>
      [l.name, ...l.aliases].map((k) => ({ l, k: normalize(k) })),
    );
    const longest = (list) => list.sort((a, b) => b.k.length - a.k.length)[0]?.l;
    const hit =
      pairs.find((x) => x.k === q)?.l ??
      longest(pairs.filter((x) => q.includes(x.k))) ??
      longest(pairs.filter((x) => x.k.includes(q)));

    return hit ? { lat: hit.lat, lng: hit.lng, label: `${hit.name} (서울 강남구 ${hit.dong})` } : null;
  }
}
