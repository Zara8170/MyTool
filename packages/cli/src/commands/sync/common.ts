// PR 3 — sync 명령 공용 헬퍼.

import { hostname, platform } from "node:os";
import chalk from "chalk";

import { resolveApiUrl, readConfig, type UserConfig } from "../../lib/config.js";

export interface SyncCommandOpts {
  apiUrl?: string;
}

export interface SyncContext {
  apiUrl: string;
  config: UserConfig;
  hostname: string;
  platform: string;
}

/** sync 명령들이 시작 시 공통으로 호출. 로그인 상태 + apiUrl 해석. */
export function bootstrapSync(opts: SyncCommandOpts): SyncContext {
  const config = readConfig();
  if (!config) {
    console.error(
      chalk.red("Not signed in.") +
        " Run " +
        chalk.cyan("mytool") +
        " first to log in.",
    );
    process.exit(1);
  }
  const apiUrl = resolveApiUrl(opts.apiUrl, undefined, config.apiUrl);
  return {
    apiUrl,
    config,
    hostname: hostname(),
    platform: platform(),
  };
}
