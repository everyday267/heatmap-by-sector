// 메모리 PlaceSource (DESIGN.md §4). 샘플이든 실데이터 스냅샷이든 같은 JSON 형식을 읽는다.
//
// interface PlaceSource {
//   query(center, radiusM, categoryCode?): Promise<Place[]>
//   categories(): Promise<Category[]>
// }

import { withinRadius } from "../geo.js";

export class StaticPlaceSource {
  /** @param {{ categories: Category[], places: Place[] }} data  data/*.json 형식 */
  constructor(data) {
    const counts = new Map();
    for (const p of data.places) counts.set(p.categoryCode, (counts.get(p.categoryCode) ?? 0) + 1);
    this._categories = data.categories.map((c) => ({ ...c, count: c.count ?? counts.get(c.code) ?? 0 }));

    const byCode = new Map(this._categories.map((c) => [c.code, c]));
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
