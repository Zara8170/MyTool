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

/**
 * 활성 프로필 이름 — `MYTOOL_PROFILE` 환경변수로 결정.
 * 미설정 시 `default` (기존 `config.json` 과 동일 경로 유지, 하위호환).
 *
 * 영문/숫자/하이픈/언더스코어만 허용 (경로 트래버설 차단).
 */
export function getActiveProfile(): string {
  const raw = process.env.MYTOOL_PROFILE?.trim();
  if (!raw) return "default";
  if (!/^[a-zA-Z0-9_-]+$/.test(raw)) {
    throw new Error(
      `MYTOOL_PROFILE은 영문/숫자/하이픈/언더스코어만 허용됩니다: ${raw}`,
    );
  }
  return raw;
}

export function getConfigPath(): string {
  const profile = getActiveProfile();
  // default 프로필은 기존 경로 그대로 (하위호환)
  const filename = profile === "default" ? "config.json" : `config.${profile}.json`;
  return join(getConfigDir(), filename);
}

export function getDebugLogPath(): string {
  const profile = getActiveProfile();
  // 환경별 디버그 로그 분리. default 는 기존 경로 유지.
  const filename = profile === "default" ? "hook-debug.log" : `hook-debug.${profile}.log`;
  return join(getConfigDir(), filename);
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
 *   2. MYTOOL_API_URL 환경변수
 *   3. project.json의 apiUrl
 *   4. ~/.mytool/config(.<profile>).json 의 apiUrl
 *   5. DEFAULT_API_URL
 */
export function resolveApiUrl(
  override?: string,
  projectApiUrl?: string,
  configApiUrl?: string,
): string {
  return (
    override ??
    process.env.MYTOOL_API_URL ??
    projectApiUrl ??
    configApiUrl ??
    DEFAULT_API_URL
  );
}
