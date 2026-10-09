// 의존성 없는 정적 파일 서버 + 지오코딩 프록시.
// ES 모듈과 fetch는 file://에서 동작하지 않으므로 필요하다.
//   node scripts/serve.mjs [port]   → http://localhost:8000
//
//   GET /api/geocode?q=주소[&near=lat,lng]  → 카카오 로컬 API (KAKAO_REST_API_KEY 필요)
//     200 { lat, lng, label } · 404 { error } 결과 없음 · 503 { error } 키 미설정

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./lib/env.mjs";
import { kakaoGeocode } from "./lib/kakao.mjs";

loadEnv();

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8000);
// 기본은 이 컴퓨터에서만 접속. 같은 네트워크의 다른 기기에서 보려면 HOST=0.0.0.0
const HOST = process.env.HOST ?? "127.0.0.1";
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};

async function handleGeocode(url, res) {
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) return json(res, 503, { error: "KAKAO_REST_API_KEY가 설정되지 않았습니다." });
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  if (!q) return json(res, 400, { error: "q가 비어 있습니다." });
  const [lat, lng] = (url.searchParams.get("near") ?? "").split(",").map(Number);
  const near = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : undefined;
  try {
    const hit = await kakaoGeocode(q, { key, near });
    return hit ? json(res, 200, hit) : json(res, 404, { error: "결과 없음" });
  } catch (err) {
    console.error(err.message);
    return json(res, 502, { error: "지오코딩 실패" });
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/api/geocode") return handleGeocode(url, res);
  const path = decodeURIComponent(url.pathname);
  const file = normalize(join(ROOT, path.endsWith("/") ? path + "index.html" : path));
  // 저장소 밖, 그리고 .env·.git 같은 점 파일과 수집 원본(data/raw)은 내주지 않는다.
  const rel = file.slice(ROOT.length);
  if (
    !file.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep) ||
    rel.split(sep).some((seg) => seg.startsWith(".")) ||
    rel.startsWith(`data${sep}raw${sep}`)
  ) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(PORT, HOST, () => {
  console.log(`http://localhost:${PORT}`);
  console.log(`카카오 주소 검색: ${process.env.KAKAO_REST_API_KEY ? "켜짐" : "꺼짐 (KAKAO_REST_API_KEY 없음 → 동 이름·좌표·지도 클릭만)"}`);
});
