// UI 배선 (DESIGN.md §6, Phase 3). 데이터는 PlaceSource/Geocoder 인터페이스로만 접근한다.
/* global L */

import { computeDensity, interpret, formatDistance } from "./geo.js";
import { SamplePlaceSource, SampleGeocoder } from "./sources/sample.js";
import { SAMPLE_BOUNDS } from "./sources/sample-landmarks.js";

const DEFAULTS = { cat: "cafe", q: "강남역", r: 500 };
const NEAREST_LIMIT = 10;
const LEVEL_CLASS = { 낮음: "low", 보통: "mid", 높음: "high", 매우높음: "very-high" };

// 주변 평균·히트맵에 쓰는 더 넓은 반경.
const contextRadiusOf = (radiusM) => Math.max(2000, radiusM * 3);

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

async function main() {
  const data = await fetch("data/sample.json").then((r) => {
    if (!r.ok) throw new Error(`data/sample.json ${r.status}`);
    return r.json();
  });
  const source = new SamplePlaceSource(data);
  const geocoder = new SampleGeocoder();
  const categories = await source.categories();
  const categoryByCode = new Map(categories.map((c) => [c.code, c]));

  // --- 컨트롤 채우기 ---
  const select = $("category");
  const groups = new Map();
  for (const c of categories) {
    if (!groups.has(c.major)) groups.set(c.major, el("optgroup", { label: c.major }));
    groups.get(c.major).append(el("option", { value: c.code, textContent: c.name }));
  }
  select.append(...groups.values());
  $("address-suggestions").append(...geocoder.suggestions().map((s) => el("option", { value: s })));

  const radiusInput = $("radius");
  const syncRadiusLabel = () => {
    $("radius-label").value = formatDistance(Number(radiusInput.value));
  };
  radiusInput.addEventListener("input", syncRadiusLabel);

  // --- 지도 ---
  const map = L.map("map", { zoomControl: true }).setView([37.5045, 127.045], 14);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  L.rectangle(
    [[SAMPLE_BOUNDS.south, SAMPLE_BOUNDS.west], [SAMPLE_BOUNDS.north, SAMPLE_BOUNDS.east]],
    { className: "sample-bounds", interactive: false, fill: false },
  ).addTo(map);

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
    const p = new URLSearchParams(location.search);
    const cat = categoryByCode.has(p.get("cat")) ? p.get("cat") : DEFAULTS.cat;
    const r = Number(p.get("r"));
    return {
      cat,
      q: p.get("q") || DEFAULTS.q,
      r: r >= 100 && r <= 2000 ? Math.round(r / 100) * 100 : DEFAULTS.r,
    };
  }

  function writeUrl() {
    const p = new URLSearchParams({ cat: select.value, q: $("address").value.trim(), r: radiusInput.value });
    history.replaceState(null, "", `?${p}`);
  }

  async function geocodeAndRun({ fit }) {
    const q = $("address").value;
    const hit = await geocoder.geocode(q);
    if (!hit) {
      showMessage(
        `"${q.trim()}" 위치를 찾지 못했습니다. 샘플 단계에서는 강남구 일대 지명(예: ${geocoder
          .suggestions()
          .slice(0, 4)
          .join(", ")})이나 "위도, 경도", 또는 지도 클릭을 사용하세요.`,
      );
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

    const contextPlaces = await source.query(center, contextM, code);
    if (seq !== state.seq) return;
    const result = computeDensity(contextPlaces, center, radiusM, contextM);

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
    const inSample =
      center.lat >= SAMPLE_BOUNDS.south && center.lat <= SAMPLE_BOUNDS.north &&
      center.lng >= SAMPLE_BOUNDS.west && center.lng <= SAMPLE_BOUNDS.east;
    showMessage(inSample ? "" : "샘플 데이터 범위(점선 사각형) 밖입니다. 업소가 없거나 적게 나옵니다.");

    $("result").hidden = false;
    $("place-label").textContent = `📍 ${state.label}`;
    $("stat-count").textContent = result.count.toLocaleString("ko-KR");
    $("stat-density").textContent = result.perKm2.toFixed(1);
    const levelEl = $("stat-level");
    levelEl.textContent = result.level;
    levelEl.className = `level level-${LEVEL_CLASS[result.level]}`;
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

    await renderComparison(center, radiusM, contextM, code, seq);
    writeUrl();
  }

  async function renderComparison(center, radiusM, contextM, selectedCode, seq) {
    const rows = await Promise.all(
      categories.map(async (c) => {
        const places = await source.query(center, contextM, c.code);
        const r = computeDensity(places, center, radiusM, contextM);
        return { c, count: r.count, relative: r.relative, level: r.level };
      }),
    );
    if (seq !== state.seq) return;
    rows.sort((a, b) => b.count - a.count || (b.relative ?? 0) - (a.relative ?? 0));
    const max = Math.max(1, ...rows.map((r) => r.count));

    $("compare").replaceChildren(
      ...rows.map(({ c, count, relative, level }) => {
        const btn = el(
          "button",
          {
            type: "button",
            className: `compare-row${c.code === selectedCode ? " is-selected" : ""}`,
            title: `${c.name}로 분석`,
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
  await geocodeAndRun({ fit: true });
}

main().catch((err) => {
  console.error(err);
  const msg = $("message");
  msg.textContent = `불러오기 실패: ${err.message}. file://이 아니라 로컬 서버(npm start)로 열어주세요.`;
  msg.hidden = false;
});
