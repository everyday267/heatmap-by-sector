// 샘플 지역(서울 강남구 일대) 랜드마크.
// SampleGeocoder의 주소→좌표 고정표이자, 샘플 업소 생성기의 상권 중심점으로 함께 쓴다.
// aliases: 사용자가 입력할 법한 다른 표현 (공백 제거 후 부분일치).

export const SAMPLE_BOUNDS = {
  south: 37.478,
  west: 127.015,
  north: 37.53,
  east: 127.075,
};

export const LANDMARKS = [
  { id: "gangnam", name: "강남역", dong: "역삼동", lat: 37.4979, lng: 127.0276, aliases: ["강남대로", "강남역사거리"] },
  { id: "sinnonhyeon", name: "신논현역", dong: "논현동", lat: 37.5045, lng: 127.025, aliases: ["신논현"] },
  { id: "nonhyeon", name: "논현역", dong: "논현동", lat: 37.511, lng: 127.0216, aliases: ["논현동", "학동로"] },
  { id: "yeoksam", name: "역삼역", dong: "역삼동", lat: 37.5006, lng: 127.0364, aliases: ["역삼동", "테헤란로"] },
  { id: "seolleung", name: "선릉역", dong: "대치동", lat: 37.5045, lng: 127.049, aliases: ["선릉"] },
  { id: "samseong", name: "삼성역", dong: "삼성동", lat: 37.5088, lng: 127.0631, aliases: ["코엑스", "삼성동", "봉은사로"] },
  { id: "daechi", name: "대치동 학원가", dong: "대치동", lat: 37.4965, lng: 127.061, aliases: ["대치역", "대치동", "은마아파트", "도곡로"] },
  { id: "garosu", name: "신사동 가로수길", dong: "신사동", lat: 37.5205, lng: 127.023, aliases: ["가로수길", "신사동", "신사역"] },
  { id: "apgujeong", name: "압구정로데오", dong: "신사동", lat: 37.5273, lng: 127.0405, aliases: ["압구정", "로데오", "압구정로데오역", "청담"] },
  { id: "gangnamgu-office", name: "강남구청역", dong: "삼성동", lat: 37.5172, lng: 127.0412, aliases: ["강남구청", "학동"] },
  { id: "dogok", name: "도곡동", dong: "도곡동", lat: 37.487, lng: 127.047, aliases: ["매봉역", "도곡", "타워팰리스"] },
  { id: "gaepo", name: "개포동", dong: "개포동", lat: 37.483, lng: 127.065, aliases: ["개포", "개포동역"] },
];
