// UI 배선 (DESIGN.md §6). 데이터는 PlaceSource/Geocoder 인터페이스로만 접근한다.
// 어떤 데이터셋을 쓸지는 data/datasets.json과 ?data= 파라미터로 정한다.
/* global L */

import { computeDensity, interpret, formatDistance } from "./geo.js";
import { DensityBenchmark } from "./benchmark.js";
import { StaticPlaceSource } from "./sources/static.js";
import { SampleGeocoder } from "./sources/sample.js";
import { ApiGeocoder, ChainGeocoder, DatasetGeocoder } from "./sources/geocoders.js";

const NEAREST_LIMIT = 10;
const COMPARE_LIMIT = 10;
const LEVEL_CLASS = { 낮음: "low", 보통: "mid", 높음: "high", 매우높음: "very-high" };

// 주변 평균·히트맵에 쓰는 더 넓은 반경.
const contextRadiusOf = (radiusM) => Math.max(2000, radiusM * 3);

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

async function getJson(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return r.json();
}

async function loadDataset(params) {
  const manifest = await getJson("data/datasets.json");
  const wanted = params.get("data") ?? manifest.default;
  const entry = manifest.datasets.find((d) => d.id === wanted) ?? manifest.datasets[0];
  return { manifest, entry, data: await getJson(entry.file) };
}

function makeGeocoder(meta) {
  if (meta.kind === "sample") {
    const g = new SampleGeocoder();
    return { geocoder: g, suggestions: g.suggestions(), hint: "강남구 일대 지명(강남역, 역삼동, 대치동 …)" };
  }
  const api = new ApiGeocoder({ near: meta.focus });
  return {
    geocoder: new ChainGeocoder([
      new DatasetGeocoder(meta, { mode: "exact" }), // 좌표, "길음2동"
      api, // 카카오: 도로명·지번 주소, 역·건물 이름
      new DatasetGeocoder(meta, { mode: "fuzzy" }), // "길음" → 길음1동/2동
    ]),
    suggestions: new DatasetGeocoder(meta).suggestions(meta.focus?.name),
    api,
    hint: "행정동 이름(예: 길음2동)",
  };
}

/** 업종별 순위로 등급을 바꾼다. 기준점이 부족하면 고정 기준(개/㎢) 등급을 그대로 둔다. */
function withRank(result, benchmark, code, radiusM) {
  const rank = benchmark.rank(code, radiusM, result.count);
  return rank ? { ...result, rank, level: rank.level } : result;
}

function groupByCategory(places) {
  const m = new Map();
  for (const p of places) {
    if (!m.has(p.categoryCode)) m.set(p.categoryCode, []);
    m.get(p.categoryCode).push(p);
  }
  return m;
}

const inBounds = (b, p) => p.lat >= b.south && p.lat <= b.north && p.lng >= b.west && p.lng <= b.east;

async function main() {
  const params = new URLSearchParams(location.search);
  const { manifest, entry, data } = await loadDataset(params);
  const { meta } = data;
  const source = new StaticPlaceSource(data);
  const benchmark = new DensityBenchmark(data.places, meta.bounds);
  const { geocoder, suggestions, api, hint } = makeGeocoder(meta);
  const categories = await source.categories();
  const categoryByCode = new Map(categories.map((c) => [c.code, c]));

  // --- 데이터셋 표시·전환 ---
  $("dataset-badge").textContent =
    meta.kind === "sample"
      ? "샘플 데이터 (가짜 업소)"
      : `실데이터 · 상가정보${meta.stdrYm ? ` ${String(meta.stdrYm).replace(/^(\d{4})(\d{2})$/, "$1.$2")} 기준` : ""}`;
  $("dataset-badge").classList.toggle("is-real", meta.kind !== "sample");
  $("dataset-badge").title = meta.note ?? "";
  const datasetSelect = $("dataset");
  datasetSelect.append(
    ...manifest.datasets.map((d) => el("option", { value: d.id, textContent: d.label, selected: d.id === entry.id })),
  );
  datasetSelect.addEventListener("change", () => {
    location.search = `?${new URLSearchParams({ data: datasetSelect.value })}`;
  });
  $("data-source").textContent = meta.source
    ? `데이터: ${meta.source.name}${meta.coverage?.length ? ` (${meta.coverage.join("·")} 수집)` : ""}`
    : "데이터: scripts/generate-sample.mjs로 만든 가짜 샘플";

  // --- 컨트롤 채우기: 대분류별 묶음, 업소가 많은 업종 먼저 ---
  const select = $("category");
  const groups = new Map();
  for (const c of [...categories].sort((a, b) => b.count - a.count)) {
    if (!groups.has(c.major)) groups.set(c.major, { total: 0, node: el("optgroup", { label: c.major || "기타" }) });
    const g = groups.get(c.major);
    g.total += c.count;
    g.node.append(el("option", { value: c.code, textContent: `${c.name} (${c.count.toLocaleString("ko-KR")})` }));
  }
  select.append(...[...groups.values()].sort((a, b) => b.total - a.total).map((g) => g.node));
  $("address-suggestions").append(...suggestions.map((s) => el("option", { value: s })));

  const radiusInput = $("radius");
  const syncRadiusLabel = () => {
    $("radius-label").value = formatDistance(Number(radiusInput.value));
  };
  radiusInput.addEventListener("input", syncRadiusLabel);

  // --- 지도 ---
  const b = meta.bounds;
  const map = L.map("map", { zoomControl: true }).fitBounds([[b.south, b.west], [b.north, b.east]]);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  L.rectangle([[b.south, b.west], [b.north, b.east]], {
    className: "data-bounds",
    interactive: false,
    fill: false,
  }).addTo(map);

  // max: 업소 몇 곳이 겹쳐야 최고 강도(빨강)가 되는지. 1곳짜리 점은 옅게, 군집만 붉게.
  const heat = L.heatLayer([], {
    radius: 24,
    blur: 20,
    max: 2,
    minOpacity: 0.2,
    maxZoom: 15,
    gradient: { 0.2: "#2b83ba", 0.45: "#abdda4", 0.65: "#ffffbf", 0.8: "#fdae61", 1: "#d7191c" },
  }).addTo(map);
  const radiusCircle = L.circle([0, 0], { radius: 0, className: "radius-circle", interactive: false });
  const placeLayer = L.layerGroup().addTo(map);
  const centerMarker = L.marker([0, 0], { keyboard: false, title: "분석 중심" });

  // --- 상태 ---
  // seq: 연속 입력 시 늦게 끝난 이전 분석이 최신 결과를 덮어쓰지 않도록.
  const state = { center: null, label: "", seq: 0 };

  function showMessage(text) {
    $("message").textContent = text;
    $("message").hidden = !text;
  }

  function readUrl() {
    const fallbackCat =
      meta.defaults?.cat ?? categories.find((c) => c.name === "카페")?.code ?? categories[0]?.code;
    const cat = categoryByCode.has(params.get("cat")) ? params.get("cat") : fallbackCat;
    const r = Number(params.get("r"));
    return {
      cat,
      q: params.get("q") || meta.defaults?.q || "",
      r: r >= 100 && r <= 2000 ? Math.round(r / 100) * 100 : 500,
    };
  }

  function writeUrl() {
    const p = new URLSearchParams({
      data: entry.id,
      cat: select.value,
      q: $("address").value.trim(),
      r: radiusInput.value,
    });
    history.replaceState(null, "", `?${p}`);
  }

  async function geocodeAndRun({ fit }) {
    const q = $("address").value;
    const hit = await geocoder.geocode(q);
    if (!hit) {
      const apiNote = api && !api.available ? " (카카오 주소 검색이 꺼져 있어 도로명·지번 주소는 아직 못 찾습니다)" : "";
      showMessage(`"${q.trim()}" 위치를 찾지 못했습니다. ${hint}, "위도, 경도", 또는 지도 클릭을 사용하세요.${apiNote}`);
      return;
    }
    state.center = { lat: hit.lat, lng: hit.lng };
    state.label = hit.label;
    await run({ fit });
  }

  async function run({ fit }) {
    if (!state.center) return;
    const code = select.value;
    const category = categoryByCode.get(code);
    const radiusM = Number(radiusInput.value);
    const contextM = contextRadiusOf(radiusM);
    const { center } = state;
    const seq = ++state.seq;

    // 넓은 반경의 전 업종을 한 번만 가져와 선택 업종 분석과 업종별 비교에 같이 쓴다.
    const nearby = await source.query(center, contextM);
    if (seq !== state.seq) return;
    const byCode = groupByCategory(nearby);
    const result = withRank(computeDensity(byCode.get(code) ?? [], center, radiusM, contextM), benchmark, code, radiusM);

    // 지도
    heat.setLatLngs(result.heatPoints);
    radiusCircle.setLatLng(center).setRadius(radiusM).addTo(map);
    centerMarker.setLatLng(center).addTo(map);
    placeLayer.clearLayers();
    for (const p of result.places) {
      L.circleMarker([p.lat, p.lng], { radius: 5, className: "place-dot" })
        .bindPopup(() =>
          el(
            "div",
            { className: "popup" },
            el("b", { textContent: p.name }),
            el("br"),
            `${p.categoryName} · 중심에서 ${formatDistance(p.distanceM)}`,
            el("br"),
            el("span", { className: "muted", textContent: p.address ?? "" }),
          ),
        )
        .addTo(placeLayer);
    }
    if (fit) map.fitBounds(radiusCircle.getBounds(), { padding: [40, 40], maxZoom: 17 });

    // 패널
    showMessage(
      inBounds(b, center) ? "" : "데이터 범위(점선 사각형) 밖입니다. 업소가 없거나 실제보다 적게 나옵니다.",
    );

    $("result").hidden = false;
    $("place-label").textContent = `📍 ${state.label}`;
    $("stat-count").textContent = result.count.toLocaleString("ko-KR");
    $("stat-density").textContent = result.perKm2.toFixed(1);
    const levelEl = $("stat-level");
    levelEl.textContent = result.level;
    levelEl.className = `level level-${LEVEL_CLASS[result.level]}`;
    $("stat-rank").textContent = result.rank ? `이 지역 ${result.rank.label}` : "고정 기준(개/㎢)";
    const text = interpret(result, category.name, radiusM);
    $("headline").textContent = text.headline;
    $("advice").textContent = text.advice;
    $("context-label").value = formatDistance(contextM);

    $("nearest-count").textContent = result.count
      ? `${Math.min(NEAREST_LIMIT, result.count)} / ${result.count}곳`
      : "";
    $("nearest").replaceChildren(
      ...(result.count
        ? result.places.slice(0, NEAREST_LIMIT).map((p) =>
            el(
              "li",
              {},
              el("span", { className: "nearest-name", textContent: p.name }),
              el("span", { className: "nearest-dist", textContent: formatDistance(p.distanceM) }),
            ),
          )
        : [el("li", { className: "muted", textContent: "반경 안에 해당 업종이 없습니다." })]),
    );

    renderComparison(byCode, center, radiusM, contextM, code);
    writeUrl();
  }

  // 반경 안에 많은 업종 상위 N개 (+ 선택 업종이 빠졌으면 맨 아래에 추가).
  function renderComparison(byCode, center, radiusM, contextM, selectedCode) {
    const rows = [...byCode.entries()].map(([code, places]) => {
      const r = withRank(computeDensity(places, center, radiusM, contextM), benchmark, code, radiusM);
      return { c: categoryByCode.get(code), count: r.count, relative: r.relative, level: r.level, rank: r.rank };
    });
    rows.sort((a, b) => b.count - a.count || (b.relative ?? 0) - (a.relative ?? 0));
    const shown = rows.filter((r) => r.count > 0).slice(0, COMPARE_LIMIT);
    if (!shown.some((r) => r.c.code === selectedCode)) {
      shown.push(rows.find((r) => r.c.code === selectedCode) ?? {
        c: categoryByCode.get(selectedCode), count: 0, relative: null, level: "낮음",
      });
    }
    const max = Math.max(1, ...shown.map((r) => r.count));
    $("compare-title").textContent =
      categories.length > COMPARE_LIMIT ? `반경 안에 많은 업종 상위 ${COMPARE_LIMIT}` : "이 위치의 업종별 비교";

    $("compare").replaceChildren(
      ...shown.map(({ c, count, relative, level, rank }) => {
        const btn = el(
          "button",
          {
            type: "button",
            className: `compare-row${c.code === selectedCode ? " is-selected" : ""}`,
            title: `${c.name}로 분석 · 경쟁 강도 ${level}${rank ? ` (이 지역 ${rank.label})` : ""}`,
          },
          el("span", { className: "compare-name", textContent: c.name }),
          el(
            "span",
            { className: "compare-track" },
            el("span", {
              className: `compare-bar level-${LEVEL_CLASS[level]}`,
              style: `width:${(count / max) * 100}%`,
            }),
          ),
          el("span", { className: "compare-count", textContent: `${count}곳` }),
          el("span", {
            className: "compare-rel",
            textContent: relative == null ? "–" : `${relative.toFixed(1)}×`,
          }),
        );
        btn.addEventListener("click", () => {
          select.value = c.code;
          run({ fit: false });
        });
        return el("li", {}, btn);
      }),
    );
  }

  // --- 이벤트 ---
  $("query-form").addEventListener("submit", (e) => {
    e.preventDefault();
    geocodeAndRun({ fit: true });
  });
  select.addEventListener("change", () => run({ fit: false }));
  radiusInput.addEventListener("change", () => run({ fit: true }));
  map.on("click", (e) => {
    const { lat, lng } = e.latlng;
    $("address").value = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    state.center = { lat, lng };
    state.label = `지도에서 선택한 지점 (${lat.toFixed(5)}, ${lng.toFixed(5)})`;
    run({ fit: false });
  });

  // --- 초기 실행 ---
  const init = readUrl();
  select.value = init.cat;
  $("address").value = init.q;
  radiusInput.value = init.r;
  syncRadiusLabel();
  if (init.q) await geocodeAndRun({ fit: true });
}

main().catch((err) => {
  console.error(err);
  const msg = $("message");
  msg.textContent = `불러오기 실패: ${err.message}. file://이 아니라 로컬 서버(npm start)로 열어주세요.`;
  msg.hidden = false;
});
