import chalk from "chalk";
import { checkbox, Separator, input } from "@inquirer/prompts";

import { scanAll, formatItem } from "../lib/scanner.js";
import { savePreset, loadPreset, listPresets, deletePreset } from "../lib/preset.js";
import type { SyncItem } from "../types.js";

export type PresetAction = "save" | "load" | "list" | "delete";

export async function presetCommand(action: string, name?: string): Promise<void> {
  switch (action as PresetAction) {
    case "list": {
      const names = await listPresets();
      if (names.length === 0) console.log(chalk.dim("저장된 프리셋이 없습니다."));
      else for (const n of names) console.log("  - " + n);
      return;
    }
    case "delete": {
      if (!name) throw new Error("이름이 필요합니다: mytool-sync preset delete <name>");
      await deletePreset(name);
      console.log(chalk.green(`프리셋 '${name}' 삭제됨`));
      return;
    }
    case "load": {
      if (!name) throw new Error("이름이 필요합니다: mytool-sync preset load <name>");
      const p = await loadPreset(name);
      console.log(JSON.stringify(p, null, 2));
      return;
    }
    case "save": {
      const presetName = name || (await input({ message: "프리셋 이름:" }));
      const items = scanAll();
      if (items.length === 0) {
        console.log(chalk.yellow("스캔된 항목이 없습니다."));
        return;
      }
      const choices: Array<Separator | { name: string; value: string }> = [];
      const globals = items.filter((i) => i.scope === "global");
      const byProject = new Map<string, SyncItem[]>();
      for (const it of items.filter((i) => i.scope === "project")) {
        const key = it.project ?? "<unknown>";
        const list = byProject.get(key) ?? [];
        list.push(it);
        byProject.set(key, list);
      }
      if (globals.length) {
        choices.push(new Separator(chalk.cyan("── 전역 ──")));
        for (const it of globals) choices.push({ name: formatItem(it), value: idOf(it) });
      }
      for (const [project, list] of byProject) {
        choices.push(new Separator(chalk.cyan(`── [${project}] ──`)));
        for (const it of list) choices.push({ name: formatItem(it), value: idOf(it) });
      }
      const ids = await checkbox({
        message: "프리셋에 포함할 항목 선택",
        choices,
        pageSize: 20,
      });
      const file = await savePreset(presetName, ids);
      console.log(chalk.green(`프리셋 저장됨: ${file}`));
      console.log(chalk.dim(`  → 나중에: mytool-sync export --preset ${presetName}`));
      return;
    }
    default:
      throw new Error(`알 수 없는 액션: ${action}. (save | load | list | delete)`);
  }
}

function idOf(it: SyncItem): string {
  return it.scope === "global"
    ? `${it.type}::${it.name}`
    : `${it.type}::${it.project}::${it.name}`;
}
