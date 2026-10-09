// 카카오 로컬 API로 주소/장소명 → 좌표. REST API 키는 서버(serve.mjs)에서만 쓴다.
// https://developers.kakao.com/docs/latest/ko/local/dev-guide

const BASE = "https://dapi.kakao.com/v2/local/search";

/**
 * 1) 주소 검색("성북구 길음동 1287")  2) 실패하면 키워드 검색("길음역", "길음뉴타운")
 * @param {{ lat, lng }} [near]  키워드 검색을 이 근처(20km)로 좁힌다.
 * @returns {{ lat, lng, label } | null}
 */
export async function kakaoGeocode(query, { key, near, fetchImpl = fetch } = {}) {
  if (!key) throw new Error("KAKAO_REST_API_KEY가 설정되지 않았습니다.");
  const headers = { Authorization: `KakaoAK ${key}` };

  const get = async (path, params) => {
    const res = await fetchImpl(`${BASE}/${path}?${new URLSearchParams(params)}`, { headers });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`카카오 API ${res.status}: ${body.slice(0, 200)}`);
    }
    return res.json();
  };

  const addr = await get("address.json", { query, size: "1" });
  const a = addr.documents?.[0];
  if (a) return { lat: Number(a.y), lng: Number(a.x), label: a.address_name };

  const kwParams = { query, size: "1" };
  if (near) Object.assign(kwParams, { y: String(near.lat), x: String(near.lng), radius: "20000", sort: "accuracy" });
  const kw = await get("keyword.json", kwParams);
  const k = kw.documents?.[0];
  if (k) {
    const where = k.road_address_name || k.address_name;
    return { lat: Number(k.y), lng: Number(k.x), label: where ? `${k.place_name} (${where})` : k.place_name };
  }
  return null;
}
