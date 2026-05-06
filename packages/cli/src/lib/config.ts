import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const DEFAULT_API_URL = "https://claudemytool.vercel.app";

export interface UserConfig {
  /** API JWT 토큰 */
  token: string;
  /** 사용자 정보 */
  user: {
    id: string;
    email: string;
    name: string | null;
  };
  /** API URL (선택, 기본값은 DEFAULT_API_URL) */
  apiUrl?: string;
}

export function getConfigDir(): string {
  return join(homedir(), ".mytool");
}

export function getConfigPath(): string {
  return join(getConfigDir(), "config.json");
}

export function getDebugLogPath(): string {
  return join(getConfigDir(), "hook-debug.log");
}

export function readConfig(): UserConfig | null {
  const path = getConfigPath();
  if (!existsSync(path)) return null;
  try {
    const content = readFileSync(path, "utf-8");
    const parsed = JSON.parse(content) as UserConfig;
    if (!parsed.token || !parsed.user?.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeConfig(config: UserConfig): void {
  const path = getConfigPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function clearConfig(): void {
  const path = getConfigPath();
  if (existsSync(path)) {
    writeFileSync(path, "", { mode: 0o600 });
  }
}

/**
 * API URL 우선순위:
 *   1. 명시적 override (CLI flag)
 *   2. project.json의 apiUrl
 *   3. ~/.mytool/config.json의 apiUrl
 *   4. DEFAULT_API_URL
 */
export function resolveApiUrl(
  override?: string,
  projectApiUrl?: string,
  configApiUrl?: string,
): string {
  return override ?? projectApiUrl ?? configApiUrl ?? DEFAULT_API_URL;
}
