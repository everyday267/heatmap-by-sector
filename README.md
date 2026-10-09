# heatmap-by-sector — 업종 밀도 지도

업종과 주소를 넣으면, 그 주소 주변에 **같은 업종이 얼마나 밀집해 있는지** 지도 위에 히트맵과 수치로 보여줍니다.
광고 반경 설정, 입점 후보지 검토, 경쟁 분석의 첫 장을 공공데이터로 만들기 위한 도구입니다. 설계는 [DESIGN.md](DESIGN.md)에 있습니다.

데이터셋은 화면 왼쪽 위에서 고릅니다.

| 데이터셋 | 내용 |
|---|---|
| **서울 성북구 길음2동** | 소상공인시장진흥공단 상가(상권)정보 실데이터. 길음2동 중심 ±3km (성북구·강북구 수집). 인증키를 넣고 `npm run fetch:gileum2`를 한 번 돌리면 생깁니다 |
| 샘플 · 서울 강남구 일대 | 가짜 데이터 (업종 10종, 2,120곳). 키 없이 동작 확인용 |

## 실행

Node.js 22 이상(LTS)만 있으면 됩니다. 설치할 패키지는 없습니다.

```bash
npm start          # http://localhost:8000
npm test           # 단위 테스트
```

`index.html`을 파일로 바로 열면(file://) 브라우저 보안 정책 때문에 동작하지 않습니다. 반드시 `npm start`로 여세요.

## 인증키 넣기

| 변수 | 어디서 받나 | 용도 | 필수 |
|---|---|---|---|
| `DATA_GO_KR_SERVICE_KEY` | [공공데이터포털](https://www.data.go.kr/data/15012005/openapi.do) › 소상공인시장진흥공단_상가(상권)정보 › 활용신청 › 마이페이지의 **일반 인증키(Decoding)** | 상가 업소 수집 | ✅ |
| `KAKAO_REST_API_KEY` | [카카오 developers](https://developers.kakao.com) › 내 애플리케이션 › 앱 키 › **REST API 키** (+ 제품 설정에서 카카오맵/로컬 사용 설정) | 도로명·지번 주소, 역·건물 이름 검색 | 선택 |

키는 **채팅이나 코드에 붙여 넣지 말고** 아래 중 한 곳에 넣습니다. 둘 다 git에 올라가지 않습니다.

- **내 컴퓨터**: `.env.example`을 `.env`로 복사해 값을 채웁니다.
- **GitHub Actions** (권장): 저장소 Settings › Secrets and variables › Actions › New repository secret에 `DATA_GO_KR_SERVICE_KEY`를 등록하고, Actions 탭 › "Fetch sangga data" › Run workflow. Actions가 수집해 `data/gileum2.json`을 커밋하므로, 이후엔 pull만 받으면 됩니다. 분기마다 자동으로 다시 수집합니다. 카카오 키는 화면을 띄우는 쪽(로컬 서버)에서 쓰므로 GitHub Secrets가 아니라 `.env`에 넣습니다.
- **Claude Code 클라우드 세션**: 세션 상단의 클라우드 환경 메뉴 › Edit › 환경변수(또는 Network secrets)에 같은 이름으로 넣고, Network access의 허용 도메인에 `apis.data.go.kr`, `dapi.kakao.com`을 추가합니다. 새 세션부터 적용됩니다.

카카오 키는 `npm start`의 로컬 서버만 쓰고 브라우저로는 보내지 않습니다(`/api/geocode` 프록시). 키가 없어도 행정동 이름(`길음2동`), 좌표, 지도 클릭으로 분석할 수 있습니다.

## 실데이터 수집

```bash
npm run fetch:gileum2
```

성북구(11290)·강북구(11305) 상가업소를 전부 받아, 길음2동 업소들의 중심점에서 ±3km 사각형 안만 `data/gileum2.json`에 저장하고 `data/datasets.json`의 기본 데이터셋으로 등록합니다. 길음2동은 강북구 미아동과 맞닿아 있어, 성북구만 받으면 경계 쪽 밀도와 "주변 평균"이 실제보다 낮게 나오기 때문에 두 구를 함께 받습니다.

다른 동으로 만들려면:

```bash
node scripts/fetch-sangga.mjs --id jongam --label "서울 성북구 종암동" \
  --sigungu 11290:성북구,11230:동대문구 --focus 종암동 --box-km 3
```

- 받은 원본은 `data/raw/<id>.json`에 남습니다(git 제외). `--offline`을 붙이면 API를 다시 부르지 않고 원본으로 다시 빌드합니다.
- 응답 컬럼이 예상과 다르면 실제 컬럼 목록을 출력하고 멈춥니다. 그때 `scripts/lib/sangga.mjs`의 `mapStoreItem`을 맞추면 됩니다.

## 사용법

1. **업종** 선택 — 실데이터는 상가정보 소분류(카페, 백반/한식, 편의점, 입시·교과학원 …), 괄호 안은 데이터 범위 안 업소 수
2. **주소** 입력 — 행정동 이름(`길음2동`), 카카오 키가 있으면 도로명·지번 주소나 `길음역`, 또는 `37.6033, 127.0251` 같은 좌표
3. **반경** 조절 (100m–2km) 후 **분석**

결과:

- **반경 내 업소 수 / 밀도(개/㎢) / 경쟁 강도 등급** — 등급은 같은 업종끼리 비교한 이 지역 안 순위입니다. 상가가 있는 100m 칸들에서 같은 반경 안 같은 업종 수를 세어, 지금 위치가 상위 10%면 매우높음 · 10–30% 높음 · 30–70% 보통 · 하위 30% 낮음
- **주변 평균 대비 배수** — 같은 업종의 더 넓은 반경(기본 2km) 평균 밀도와 비교
- **반경 안에 많은 업종 상위 10** — 같은 지점의 업종별 밀집도. 행을 누르면 그 업종으로 전환
- **히트맵** — 주변 넓은 반경의 동일 업종 분포
- 지도를 클릭하면 그 지점을 중심으로 다시 분석
- 분석 조건은 URL에 남아 그대로 공유할 수 있습니다 (`?data=gileum2&cat=I21201&q=길음2동&r=500`)

## 구조

```
index.html                  화면
src/
  app.js                    UI 배선 (데이터셋 선택·지도·패널·이벤트)
  geo.js                    밀도 계산 순수 함수 (Haversine, 개/㎢, 해석 문구)
  benchmark.js              경쟁 강도 등급 — 같은 업종끼리 이 지역 안 순위
  styles.css
  sources/
    static.js               StaticPlaceSource — data/*.json을 메모리에서 반경 질의
    geocoders.js            DatasetGeocoder(동 이름·좌표) / ApiGeocoder(카카오 프록시) / ChainGeocoder
    sample.js               SampleGeocoder (샘플 랜드마크)
    sample-landmarks.js
data/
  datasets.json             화면에 보이는 데이터셋 목록과 기본값
  sample.json               샘플 데이터
  <id>.json                 실데이터 스냅샷 (fetch-sangga.mjs가 생성)
scripts/
  fetch-sangga.mjs          상가정보 수집 → 데이터셋 빌드
  lib/sangga.mjs            상가정보 API 클라이언트·매핑·빌더
  lib/kakao.mjs             카카오 로컬 API 지오코딩
  lib/env.mjs               .env 로더
  serve.mjs                 정적 서버 + /api/geocode (점 파일·data/raw는 내주지 않음)
  generate-sample.mjs       샘플 데이터 생성기
test/                       node:test 단위 테스트
vendor/                     Leaflet 1.9.4, Leaflet.heat 0.2.0 (CDN 없이 동작하도록 동봉)
```

## 다음 단계

- 인구(KOSIS)를 붙여 "경쟁 대비 수요" 해석
- 지역을 넓힐 때: 데이터셋을 지역별로 나누거나 서버 반경 질의로 전환

## 라이선스 고지

- 상가 데이터: 소상공인시장진흥공단 상가(상권)정보 (공공데이터포털)
- 지도 타일: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors
- [Leaflet](https://leafletjs.com) — BSD-2-Clause (`vendor/leaflet/LICENSE`)
- [Leaflet.heat](https://github.com/Leaflet/Leaflet.heat) — BSD-2-Clause (`vendor/leaflet-heat/LICENSE`)
