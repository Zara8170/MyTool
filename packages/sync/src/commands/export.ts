import path from "node:path";
import os from "node:os";

import chalk from "chalk";
import { checkbox, Separator } from "@inquirer/prompts";

import { scanAll, formatItem } from "../lib/scanner.js";
import { writeZip, writeDir } from "../lib/bundle.js";
import { maskBuffer } from "../lib/mask.js";
import { loadPreset } from "../lib/preset.js";
import type { SyncItem, SyncManifest, SyncManifestItem } from "../types.js";

export interface ExportCommandOptions {
  roots?: string[];
  output: string;
  format: string;
  all?: boolean;
  preset?: string;
  maskSecrets?: boolean;
}

export async function exportCommand(opts: ExportCommandOptions): Promise<void> {
  const items = scanAll({ projectRoots: opts.roots ?? [] });
  if (items.length === 0) {
    console.log(
      chalk.yellow("내보낼 항목이 없습니다. --roots 로 프로젝트 루트를 지정해보세요."),
    );
    return;
  }

  let chosen: SyncItem[];
  if (opts.preset) {
    const preset = await loadPreset(opts.preset);
    const set = new Set(preset.itemIds);
    chosen = items.filter((it) => set.has(itemId(it)));
    console.log(chalk.dim(`프리셋 '${opts.preset}' 적용: ${chosen.length}개 항목`));
  } else if (opts.all) {
    chosen = items;
  } else {
    chosen = await pickItems(items);
  }

  if (chosen.length === 0) {
    console.log(chalk.yellow("선택된 항목이 없습니다."));
    return;
  }

  const manifest = buildManifest(chosen, opts);
  const transform = opts.maskSecrets ? maskBuffer : null;

  if (opts.format === "dir") {
    await writeDir({
      outputPath: opts.output,
      items: chosen,
      manifest,
      transformContent: transform,
    });
    console.log(chalk.green(`\n폴더로 내보내기 완료: ${path.resolve(opts.output)}`));
    console.log(
      chalk.dim(
        `  → git 저장소로 사용하려면: cd ${opts.output} && git init && git add . && git commit -m "init"`,
      ),
    );
  } else {
    let output = opts.output;
    if (!output.endsWith(".zip")) output += ".zip";
    await writeZip({
      outputPath: output,
      items: chosen,
      manifest,
      transformContent: transform,
    });
    console.log(chalk.green(`\nzip 으로 내보내기 완료: ${path.resolve(output)}`));
    console.log(chalk.dim(`  → 다른 PC에서: mytool-sync import ${path.basename(output)}`));
  }
}

async function pickItems(items: SyncItem[]): Promise<SyncItem[]> {
  const choices: Array<Separator | { name: string; value: string; checked: boolean }> = [];
  const globals = items.filter((i) => i.scope === "global");
  const byProject = new Map<string, SyncItem[]>();
  for (const it of items.filter((i) => i.scope === "project")) {
    const key = it.project ?? "<unknown>";
    const list = byProject.get(key) ?? [];
    list.push(it);
    byProject.set(key, list);
  }

  if (globals.length) {
    choices.push(new Separator(chalk.cyan("── 전역 (~/.claude) ──")));
    for (const it of globals) {
      choices.push({ name: formatItem(it), value: itemId(it), checked: false });
    }
  }
  for (const [project, list] of byProject) {
    const root = list[0]?.projectRoot ?? "?";
    choices.push(new Separator(chalk.cyan(`── [${project}] ${root} ──`)));
    for (const it of list) {
      choices.push({ name: formatItem(it), value: itemId(it), checked: false });
    }
  }

  const selectedIds = await checkbox({
    message: "내보낼 항목을 선택하세요 (스페이스=토글, A=전체, I=반전, Enter=확정)",
    choices,
    pageSize: 20,
    loop: false,
  });
  const set = new Set(selectedIds);
  return items.filter((it) => set.has(itemId(it)));
}

function itemId(it: SyncItem): string {
  return it.scope === "global"
    ? `${it.type}::${it.name}`
    : `${it.type}::${it.project}::${it.name}`;
}

function buildManifest(items: SyncItem[], opts: ExportCommandOptions): SyncManifest {
  const manifestItems: SyncManifestItem[] = items.map((it) => ({
    type: it.type,
    scope: it.scope,
    name: it.name,
    project: it.project ?? null,
    sourceProjectRoot: it.projectRoot ?? null,
    sourceAbsPath: it.absPath,
    relPath: it.relPath,
    size: it.size,
  }));
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    sourceHost: os.hostname(),
    sourcePlatform: process.platform,
    masked: !!opts.maskSecrets,
    items: manifestItems,
  };
}
