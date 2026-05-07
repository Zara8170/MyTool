#!/usr/bin/env node
// mytool-sync CLI — claude-sync 의 src/index.mjs 와 동일 인터페이스.
// PR 2 흡수: 명령어 시그니처 그대로 유지해 사용자가 `mytool-sync` 로 바꿔도 동작.

import { Command } from "commander";
import chalk from "chalk";

import { scanCommand } from "./commands/scan.js";
import { exportCommand } from "./commands/export.js";
import { importCommand } from "./commands/import.js";
import { presetCommand } from "./commands/preset.js";

const program = new Command();

program
  .name("mytool-sync")
  .description("Claude Code 전역/프로젝트 스킬·설정 백업·이전 도구 (claude-sync 흡수)")
  .version("0.1.0");

program
  .command("scan")
  .description("현재 PC의 Claude 관련 설정·스킬을 스캔해서 보여줌")
  .option("-r, --roots <paths...>", "추가로 스캔할 프로젝트 루트(들)")
  .option("-j, --json", "JSON으로 출력")
  .action(async (opts) => {
    await scanCommand(opts);
  });

program
  .command("export")
  .description("스킬·설정을 zip 또는 폴더로 내보내기 (체크박스로 선택)")
  .option("-r, --roots <paths...>", "추가로 스캔할 프로젝트 루트(들)")
  .option("-o, --output <path>", "출력 경로 (zip 파일 또는 폴더)", "./claude-sync-bundle.zip")
  .option("--format <fmt>", "zip 또는 dir", "zip")
  .option("--all", "체크박스 건너뛰고 전부 포함")
  .option("--preset <name>", "저장된 프리셋 사용")
  .option(
    "--mask-secrets",
    ".mcp.json 의 connection string 등 민감값을 ***로 치환",
    false,
  )
  .action(async (opts) => {
    await exportCommand(opts);
  });

program
  .command("import")
  .description("백업 zip/폴더에서 항목을 골라 현재 PC에 적용")
  .argument("<source>", "백업 zip 파일 또는 폴더 경로")
  .option("-r, --roots <paths...>", "대상 프로젝트 루트(들). 미지정 시 자동 탐색")
  .option("--dry-run", "실제 복사 없이 무엇을 할지만 출력")
  .option("--overwrite <mode>", "ask | skip | replace | backup", "ask")
  .option(
    "--yes-all",
    "모든 프롬프트를 자동 승인 (체크박스도 전부 선택, 프로젝트는 동명 자동 매핑)",
  )
  .action(async (source: string, opts) => {
    await importCommand(source, opts);
  });

program
  .command("preset")
  .description("자주 쓰는 조합을 프리셋으로 저장/불러오기")
  .argument("<action>", "save | load | list | delete")
  .argument("[name]", "프리셋 이름")
  .action(async (action: string, name: string | undefined) => {
    await presetCommand(action, name);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(chalk.red("오류:"), message);
  if (process.env.DEBUG && err instanceof Error) console.error(err.stack);
  process.exit(1);
});
