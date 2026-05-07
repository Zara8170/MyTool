import fs from "node:fs";
import path from "node:path";

import chalk from "chalk";
import { checkbox, select, input, confirm, Separator } from "@inquirer/prompts";

import {
  readBundleMeta,
  extractPaths,
  itemBundlePath,
  itemTargetPath,
} from "../lib/bundle.js";
import { autoDiscoverProjects, defaultGlobalRoot } from "../lib/scanner.js";
import type { SyncManifestItem } from "../types.js";

export interface ImportCommandOptions {
  roots?: string[];
  dryRun?: boolean;
  overwrite?: "ask" | "skip" | "replace" | "backup";
  yesAll?: boolean;
}

type OverwriteAction = "skip" | "replace" | "backup";

export async function importCommand(source: string, opts: ImportCommandOptions): Promise<void> {
  if (!fs.existsSync(source)) throw new Error(`경로를 찾을 수 없습니다: ${source}`);

  const meta = await readBundleMeta(source);
  const items = meta.manifest.items;
  console.log(
    chalk.dim(
      `백업 정보: ${items.length}개 항목, 생성: ${meta.manifest.createdAt}, 소스: ${meta.manifest.sourceHost ?? "?"}`,
    ),
  );
  if (meta.manifest.masked)
    console.log(
      chalk.yellow("⚠️  이 백업은 시크릿이 마스킹되어 있습니다. 가져온 후 직접 채워야 합니다."),
    );

  // 1) 항목 선택
  const chosen = opts.yesAll ? items : await pickImportItems(items);
  if (chosen.length === 0) {
    console.log(chalk.yellow("선택된 항목이 없습니다."));
    return;
  }

  // 2) 프로젝트 항목들을 어느 로컬 프로젝트에 매핑할지
  const projectRootMap = opts.yesAll
    ? autoMapProjects(chosen, opts)
    : await mapProjects(chosen, opts);
  const globalRoot = defaultGlobalRoot();

  // 3) 매핑 결과 보여주고 확인
  type Plan = { item: SyncManifestItem; bundlePath: string; targetPath: string };
  const plan: Plan[] = chosen
    .map((it): Plan | null => {
      const targetProjectRoot =
        it.scope === "project" && it.project ? projectRootMap.get(it.project) : undefined;
      if (it.scope === "project" && !targetProjectRoot) return null;
      const targetPath = itemTargetPath(
        // itemTargetPath 는 SyncItem 시그니처를 받음 — manifest item 의 핵심 필드만 필요해
        // 호환되도록 캐스팅. (type/scope/name/project/projectRoot/absPath/relPath/size)
        {
          type: it.type,
          name: it.name,
          scope: it.scope,
          absPath: it.sourceAbsPath,
          relPath: it.relPath,
          size: it.size,
          ...(it.project ? { project: it.project } : {}),
          ...(it.sourceProjectRoot ? { projectRoot: it.sourceProjectRoot } : {}),
        },
        {
          ...(globalRoot ? { globalRoot } : {}),
          ...(targetProjectRoot ? { projectRoot: targetProjectRoot } : {}),
        },
      );
      return { item: it, bundlePath: itemBundlePath(toSyncItem(it)), targetPath };
    })
    .filter((x): x is Plan => x !== null);

  console.log(chalk.bold.cyan("\n=== 적용 계획 ==="));
  for (const { item, targetPath } of plan) {
    const exists = fs.existsSync(targetPath);
    const flag = exists ? chalk.yellow("[덮어쓰기]") : chalk.green("[새 항목] ");
    console.log(`  ${flag} ${item.type.padEnd(20)} → ${targetPath}`);
  }
  if (opts.dryRun) {
    console.log(chalk.dim("\n--dry-run: 실제 복사하지 않습니다."));
    return;
  }
  const ok = opts.yesAll ? true : await confirm({ message: "이대로 적용할까요?", default: true });
  if (!ok) return;

  // 4) 충돌 처리
  let overwriteMode: ImportCommandOptions["overwrite"] = opts.overwrite ?? "ask";
  if (opts.yesAll && overwriteMode === "ask") overwriteMode = "backup";
  const finalMappings: Array<{ bundlePath: string; targetPath: string }> = [];
  for (const { bundlePath, targetPath } of plan) {
    if (fs.existsSync(targetPath)) {
      const action = await resolveConflict(targetPath, overwriteMode);
      if (action === "skip") {
        console.log(chalk.dim(`  스킵: ${targetPath}`));
        continue;
      }
      if (action === "backup") {
        const bak = targetPath + ".bak." + Date.now();
        fs.renameSync(targetPath, bak);
        console.log(chalk.dim(`  백업: ${bak}`));
      }
      // replace 는 그냥 진행 (덮어쓰기 전 정리)
      if (fs.existsSync(targetPath) && action === "replace") {
        const stat = fs.statSync(targetPath);
        if (stat.isDirectory()) fs.rmSync(targetPath, { recursive: true, force: true });
        else fs.unlinkSync(targetPath);
      }
    }
    finalMappings.push({ bundlePath, targetPath });
  }
  if (finalMappings.length === 0) {
    console.log(chalk.yellow("적용할 항목이 없습니다."));
    return;
  }

  await extractPaths({ source, mappings: finalMappings });
  console.log(chalk.green(`\n${finalMappings.length}개 항목 적용 완료.`));
}

function toSyncItem(it: SyncManifestItem): import("../types.js").SyncItem {
  return {
    type: it.type,
    name: it.name,
    scope: it.scope,
    absPath: it.sourceAbsPath,
    relPath: it.relPath,
    size: it.size,
    ...(it.project ? { project: it.project } : {}),
    ...(it.sourceProjectRoot ? { projectRoot: it.sourceProjectRoot } : {}),
  };
}

async function pickImportItems(items: SyncManifestItem[]): Promise<SyncManifestItem[]> {
  const choices: Array<Separator | { name: string; value: string; checked: boolean }> = [];
  const globals = items.filter((i) => i.scope === "global");
  const byProject = new Map<string, SyncManifestItem[]>();
  for (const it of items.filter((i) => i.scope === "project")) {
    const key = it.project ?? "<unknown>";
    const list = byProject.get(key) ?? [];
    list.push(it);
    byProject.set(key, list);
  }
  if (globals.length) {
    choices.push(new Separator(chalk.cyan("── 전역 (~/.claude) ──")));
    for (const it of globals) {
      choices.push({ name: `${it.type.padEnd(20)} ${it.name}`, value: idOf(it), checked: true });
    }
  }
  for (const [project, list] of byProject) {
    choices.push(new Separator(chalk.cyan(`── 원본 프로젝트: ${project} ──`)));
    for (const it of list) {
      choices.push({ name: `${it.type.padEnd(20)} ${it.name}`, value: idOf(it), checked: true });
    }
  }
  const selected = await checkbox({
    message: "가져올 항목 선택 (기본 전부 체크됨)",
    choices,
    pageSize: 20,
    loop: false,
  });
  const set = new Set(selected);
  return items.filter((it) => set.has(idOf(it)));
}

function idOf(it: SyncManifestItem): string {
  return it.scope === "global"
    ? `${it.type}::${it.name}`
    : `${it.type}::${it.project}::${it.name}`;
}

async function mapProjects(
  chosen: SyncManifestItem[],
  opts: ImportCommandOptions,
): Promise<Map<string, string>> {
  const projectsInBundle = [
    ...new Set(
      chosen.filter((i) => i.scope === "project").map((i) => i.project ?? "<unknown>"),
    ),
  ];
  const map = new Map<string, string>();
  if (projectsInBundle.length === 0) return map;

  const candidates = new Set<string>(opts.roots ?? []);
  for (const p of autoDiscoverProjects()) candidates.add(p);
  const candidatesArr = [...candidates];

  console.log(chalk.bold.cyan("\n=== 프로젝트 매핑 ==="));
  console.log(chalk.dim("백업의 각 프로젝트를 이 PC의 어느 프로젝트에 적용할지 선택하세요."));

  for (const project of projectsInBundle) {
    const auto = candidatesArr.find((c) => path.basename(c) === project);
    const choices = [
      ...candidatesArr.map((c) => ({
        name: `${path.basename(c).padEnd(20)} (${c})`,
        value: c,
      })),
      { name: chalk.dim("직접 경로 입력..."), value: "__custom__" },
      { name: chalk.dim("이 프로젝트 항목들 건너뛰기"), value: "__skip__" },
    ];
    const choice = await select({
      message:
        `백업의 [${project}] 를 어느 프로젝트로 가져올까요?` +
        (auto ? chalk.dim(` (자동 추천: ${auto})`) : ""),
      choices,
      default: auto ?? choices[0]?.value,
    });
    if (choice === "__skip__") continue;
    if (choice === "__custom__") {
      const p = await input({ message: `[${project}] 의 대상 폴더 절대경로:` });
      if (!fs.existsSync(p)) {
        const make = await confirm({ message: `${p} 가 없습니다. 만들까요?`, default: false });
        if (make) fs.mkdirSync(p, { recursive: true });
        else continue;
      }
      map.set(project, p);
    } else {
      map.set(project, choice);
    }
  }
  return map;
}

function autoMapProjects(
  chosen: SyncManifestItem[],
  opts: ImportCommandOptions,
): Map<string, string> {
  const projectsInBundle = [
    ...new Set(
      chosen.filter((i) => i.scope === "project").map((i) => i.project ?? "<unknown>"),
    ),
  ];
  const candidates = new Set<string>(opts.roots ?? []);
  for (const p of autoDiscoverProjects()) candidates.add(p);
  const arr = [...candidates];
  const map = new Map<string, string>();
  for (const project of projectsInBundle) {
    const auto = arr.find((c) => path.basename(c) === project);
    if (auto) map.set(project, auto);
    else console.log(chalk.yellow(`  [yes-all] [${project}] 매칭 후보 없음 → 스킵`));
  }
  return map;
}

async function resolveConflict(
  targetPath: string,
  mode: ImportCommandOptions["overwrite"],
): Promise<OverwriteAction> {
  if (mode === "skip") return "skip";
  if (mode === "replace") return "replace";
  if (mode === "backup") return "backup";
  return await select<OverwriteAction>({
    message: `이미 존재함: ${targetPath}`,
    choices: [
      { name: "덮어쓰기 (.bak 백업 후)", value: "backup" },
      { name: "강제 덮어쓰기", value: "replace" },
      { name: "건너뛰기", value: "skip" },
    ],
    default: "backup",
  });
}
