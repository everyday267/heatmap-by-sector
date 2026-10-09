// 저장소 루트의 .env를 process.env로 읽어 온다 (이미 설정된 환경변수는 덮어쓰지 않음).
// 클라우드 환경에서는 환경 설정의 환경변수/시크릿으로, 로컬에서는 .env 파일로 키를 넣는다.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function loadEnv(path = fileURLToPath(new URL("../../.env", import.meta.url))) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trimStart().startsWith("#")) continue;
    const [, key, raw] = m;
    const value = raw.replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
