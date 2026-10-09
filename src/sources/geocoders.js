// 실데이터용 지오코더 (DESIGN.md §4 Geocoder 인터페이스).
//
// interface Geocoder {
//   geocode(address): Promise<{ lat, lng, label } | null>
// }

// "37.4979, 127.0276" / "37.4979 127.0276" 같은 좌표 직접 입력.
const COORD_RE = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

export function parseCoords(text) {
  const m = (text ?? "").match(COORD_RE);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng, label: `${lat.toFixed(5)}, ${lng.toFixed(5)}` };
}

/** "서울특별시 성북구 길음2동" → "길음2동". 공백으로 끝나는 시·도/구 접두어만 뗀다. */
export function normalizeAddress(s) {
  return (s ?? "")
    .trim()
    .replace(/^(서울특별시|서울시|서울)\s+/, "")
    .replace(/^\S+구\s+/, "")
    .replace(/\s+/g, "");
}

/**
 * 데이터셋 안의 행정동 중심점(meta.dongs)으로 찾는다. API 키 없이도 동 이름은 검색된다.
 * mode "exact": 좌표 입력 + 동 이름 완전일치 / "fuzzy": 부분일치(마지막 수단).
 */
export class DatasetGeocoder {
  constructor(meta, { mode = "exact" } = {}) {
    this._dongs = meta.dongs ?? [];
    this._mode = mode;
  }

  suggestions(focusName) {
    const names = this._dongs.map((d) => d.name);
    return focusName ? [focusName, ...names.filter((n) => n !== focusName)] : names;
  }

  async geocode(address) {
    if (this._mode === "exact") {
      const c = parseCoords(address);
      if (c) return c;
    }
    const q = normalizeAddress(address);
    if (q.length < 2) return null;
    const hit =
      this._mode === "exact"
        ? this._dongs.find((d) => d.name === q)
        : // "길음2동 123-4" → 길음2동, "길음" → 길음1동/길음2동 중 업소가 많은 쪽
          this._dongs.filter((d) => q.includes(d.name)).sort((a, b) => b.name.length - a.name.length)[0] ??
          this._dongs.filter((d) => d.name.includes(q)).sort((a, b) => b.count - a.count)[0];
    return hit ? { lat: hit.lat, lng: hit.lng, label: `${hit.name} (업소 중심점)` } : null;
  }
}

/**
 * 로컬 서버의 /api/geocode(카카오 로컬 API 프록시)를 부른다. 키는 서버에만 있다.
 * 서버에 키가 없거나(503) 정적 호스팅이라 API가 없으면(404 등) 조용히 null.
 */
export class ApiGeocoder {
  constructor({ endpoint = "api/geocode", near, fetchImpl = (...a) => fetch(...a) } = {}) {
    this._endpoint = endpoint;
    this._near = near;
    this._fetch = fetchImpl;
    this.available = true;
  }

  async geocode(address) {
    if (!this.available || !address?.trim()) return null;
    const params = new URLSearchParams({ q: address.trim() });
    if (this._near) params.set("near", `${this._near.lat},${this._near.lng}`);
    try {
      const res = await this._fetch(`${this._endpoint}?${params}`);
      const isJson = (res.headers.get("content-type") ?? "").includes("json");
      if (!res.ok) {
        // JSON 404 = 서버가 "결과 없음"이라고 답한 것. 그 밖의 404/405/503 = API를 쓸 수 없음.
        if (!(res.status === 404 && isJson) && [404, 405, 501, 503].includes(res.status)) {
          this.available = false;
        }
        return null;
      }
      const r = await res.json();
      return Number.isFinite(r?.lat) && Number.isFinite(r?.lng) ? r : null;
    } catch {
      return null;
    }
  }
}

/** 앞에서부터 차례로 시도해 처음 찾은 결과를 쓴다. */
export class ChainGeocoder {
  constructor(geocoders) {
    this._geocoders = geocoders;
  }

  async geocode(address) {
    for (const g of this._geocoders) {
      const hit = await g.geocode(address);
      if (hit) return hit;
    }
    return null;
  }
}
