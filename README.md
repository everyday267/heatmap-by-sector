# heatmap-by-sector — 업종 밀도 지도

업종과 주소를 넣으면, 그 주소 주변에 **같은 업종이 얼마나 밀집해 있는지** 지도 위에 히트맵과 수치로 보여줍니다.
광고 반경 설정, 입점 후보지 검토, 경쟁 분석의 첫 장을 공공데이터로 만들기 위한 도구입니다. 설계는 [DESIGN.md](DESIGN.md)에 있습니다.

> ⚠️ 현재는 **샘플(가짜) 데이터**로 동작하는 프로토타입입니다. 서울 강남구 일대에 업종 10종, 업소 2,120곳을 무작위로 생성해 두었습니다.

## 실행

Node.js 18+만 있으면 됩니다. 설치할 패키지·API 키는 없습니다.

```bash
npm start          # http://localhost:8000
npm test           # 단위 테스트
```

`index.html`을 파일로 바로 열면(file://) 브라우저 보안 정책 때문에 동작하지 않습니다. 반드시 로컬 서버로 여세요. (`python3 -m http.server`도 됩니다.)

## 사용법

1. **업종** 선택 (카페, 한식, 학원, 의원 등 10종)
2. **주소** 입력 — 샘플 단계에서는 강남구 일대 지명(`강남역`, `역삼동 123`, `코엑스`, `대치동` …)이나 `37.4979, 127.0276` 같은 좌표
3. **반경** 조절 (100m–2km) 후 **분석**

결과:

- **반경 내 업소 수 / 밀도(개/㎢) / 경쟁 강도 등급**
- **주변 평균 대비 배수** — 같은 업종의 더 넓은 반경(기본 2km) 평균 밀도와 비교
- **이 위치의 업종별 비교** — 같은 지점에서 10개 업종의 밀집도를 한눈에. 행을 누르면 그 업종으로 전환
- **히트맵** — 주변 넓은 반경의 동일 업종 분포
- 지도를 클릭하면 그 지점을 중심으로 다시 분석
- 분석 조건은 URL에 남아 그대로 공유할 수 있습니다 (`?cat=academy&q=대치동&r=500`)

## 구조

```
index.html                  화면
src/
  app.js                    UI 배선 (지도·패널·이벤트)
  geo.js                    밀도 계산 순수 함수 (Haversine, 개/㎢, 등급, 해석 문구)
  styles.css
  sources/
    sample.js               SamplePlaceSource / SampleGeocoder  ← 실데이터 연동 시 교체 지점
    sample-landmarks.js     샘플 지역 랜드마크 (지오코딩 고정표 겸 상권 중심)
data/sample.json            생성된 샘플 업소 데이터
scripts/
  generate-sample.mjs       샘플 데이터 생성기 (시드 고정, npm run generate:sample)
  serve.mjs                 의존성 없는 정적 서버
test/                       node:test 단위 테스트
vendor/                     Leaflet 1.9.4, Leaflet.heat 0.2.0 (CDN 없이 동작하도록 동봉)
```

## 다음 단계 (DESIGN.md Phase 4)

- `LocalDataPlaceSource`: 소상공인시장진흥공단 상가(상권)정보 → `Place` 매핑
- `KakaoGeocoder`: 카카오 로컬 API로 실제 주소 지오코딩
- 전국 데이터(200만+ 행)를 위한 서버 반경 질의 또는 지역 분할 + 공간 인덱스
- 업종별 분포에 맞춘 등급 기준(분위수) 자동 산출

## 라이선스 고지

- 지도 타일: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors
- [Leaflet](https://leafletjs.com) — BSD-2-Clause (`vendor/leaflet/LICENSE`)
- [Leaflet.heat](https://github.com/Leaflet/Leaflet.heat) — BSD-2-Clause (`vendor/leaflet-heat/LICENSE`)
