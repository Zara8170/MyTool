import chalk from "chalk";

import { scanAll, formatItem } from "../lib/scanner.js";
import type { SyncItem } from "../types.js";

export interface ScanCommandOptions {
  roots?: string[];
  json?: boolean;
}

export async function scanCommand(opts: ScanCommandOptions): Promise<void> {
  const items = scanAll({ projectRoots: opts.roots ?? [] });
  if (opts.json) {
    console.log(JSON.stringify(items, null, 2));
    return;
  }

  const globals = items.filter((i) => i.scope === "global");
  const byProject = new Map<string, SyncItem[]>();
  for (const it of items.filter((i) => i.scope === "project")) {
    const key = it.project ?? "<unknown>";
    const list = byProject.get(key) ?? [];
    list.push(it);
    byProject.set(key, list);
  }

  console.log(chalk.bold.cyan("\n=== 전역 (~/.claude) ==="));
  if (globals.length === 0) console.log(chalk.dim("  없음"));
  for (const it of globals) console.log("  " + formatItem(it));

  console.log(chalk.bold.cyan("\n=== 프로젝트별 ==="));
  if (byProject.size === 0)
    console.log(
      chalk.dim("  발견된 프로젝트 없음. --roots <폴더> 로 직접 지정해보세요."),
    );
  for (const [project, list] of byProject) {
    const root = list[0]?.projectRoot ?? "?";
    console.log(chalk.bold(`\n  [${project}] ${chalk.dim(root)}`));
    for (const it of list) console.log("    " + formatItem(it));
  }

  console.log(chalk.bold.green(`\n총 ${items.length}개 항목 발견.\n`));
}
