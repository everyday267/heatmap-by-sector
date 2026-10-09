// 샘플 데이터셋 전용 지오코더 (DESIGN.md §4). 강남구 랜드마크 고정표로 주소를 찾는다.
// 실데이터셋은 ./geocoders.js의 DatasetGeocoder + ApiGeocoder(카카오)를 쓴다.
//
// interface Geocoder {
//   geocode(address): Promise<{ lat, lng, label } | null>
// }
// 업소 데이터는 StaticPlaceSource(./static.js)가 data/sample.json을 그대로 읽는다.

import { LANDMARKS } from "./sample-landmarks.js";
import { parseCoords } from "./geocoders.js";

// "서울 강남구 역삼동" → "역삼동". 공백으로 끝나는 접두어만 떼어 "강남구청역"은 보존.
const normalize = (s) =>
  s
    .trim()
    .replace(/^(서울특별시|서울시|서울)\s+/, "")
    .replace(/^강남구\s+/, "")
    .replace(/\s+/g, "");

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

    const coords = parseCoords(address);
    if (coords) return coords;

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
