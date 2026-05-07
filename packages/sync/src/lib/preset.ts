// 프리셋: 자주 쓰는 항목 조합을 이름으로 저장. ~/.claude-sync/presets/<name>.json 에 저장.
//
// PR 2 흡수: 원본 claude-sync 의 src/lib/preset.mjs 와 동일 동작 유지.
// 호환을 위해 디렉토리 이름은 그대로 ~/.claude-sync 사용 (사용자가 기존 프리셋을
// 다시 import 하지 않아도 됨).

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface Preset {
  name: string;
  savedAt: string;
  itemIds: string[];
}

export function presetDir(): string {
  return path.join(os.homedir(), ".claude-sync", "presets");
}

export async function savePreset(name: string, itemIds: string[]): Promise<string> {
  const dir = presetDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.json`);
  const data: Preset = { name, savedAt: new Date().toISOString(), itemIds };
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}

export async function loadPreset(name: string): Promise<Preset> {
  const file = path.join(presetDir(), `${name}.json`);
  if (!fs.existsSync(file)) throw new Error(`프리셋 '${name}' 을 찾을 수 없습니다`);
  return JSON.parse(fs.readFileSync(file, "utf8")) as Preset;
}

export async function listPresets(): Promise<string[]> {
  const dir = presetDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

export async function deletePreset(name: string): Promise<void> {
  const file = path.join(presetDir(), `${name}.json`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}
