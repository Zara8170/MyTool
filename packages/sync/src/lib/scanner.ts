// 현재 PC에서 Claude Code 관련 자산을 발견·분류한다.
//
// 발견 단위 (=item):
//   - global:skill           전역 ~/.claude/skills/<name>
//   - global:agent           전역 ~/.claude/agents/<name>
//   - global:command         전역 ~/.claude/commands/<name>
//   - global:settings        전역 ~/.claude/settings.json (있으면)
//   - global:claude-md       전역 ~/.claude/CLAUDE.md (있으면)
//   - project:skill          <root>/.claude/skills/<name>
//   - project:agent          <root>/.claude/agents/<name>
//   - project:command        <root>/.claude/commands/<name>
//   - project:hookify        <root>/.claude/hookify.*.md (개별 파일)
//   - project:settings       <root>/.claude/settings.json
//   - project:settings-local <root>/.claude/settings.local.json
//   - project:claude-md      <root>/CLAUDE.md
//   - project:agents-md      <root>/AGENTS.md
//   - project:mcp            <root>/.mcp.json
//
// PR 2 흡수: 원본 claude-sync 의 src/lib/scanner.mjs 와 동일 동작 유지.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import type { GlobalItemType, ProjectItemType, ScanAllOptions, SyncItem } from "../types.js";

const HOME = os.homedir();

export function defaultGlobalRoot(): string {
  return path.join(HOME, ".claude");
}

/**
 * 일반적인 작업 폴더에서 프로젝트 루트(=.claude 또는 CLAUDE.md를 가진 폴더)를 찾는다.
 * 너무 깊이 들어가면 느려서 maxDepth로 제한.
 */
export function autoDiscoverProjects(
  searchRoots: string[] = defaultProjectSearchRoots(),
  maxDepth = 3,
): string[] {
  const found = new Set<string>();
  for (const root of searchRoots) {
    if (!safeExistsDir(root)) continue;
    walk(root, 0);
  }
  return [...found];

  function walk(dir: string, depth: number): void {
    if (depth > maxDepth) return;
    if (looksLikeProjectRoot(dir)) {
      found.add(dir);
      // 프로젝트를 찾으면 그 안쪽은 더 안 들어감
      return;
    }
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith(".") && e.name !== ".claude") continue;
      if (e.name === "node_modules") continue;
      walk(path.join(dir, e.name), depth + 1);
    }
  }
}

function defaultProjectSearchRoots(): string[] {
  const candidates = [
    path.join(HOME, "git"),
    path.join(HOME, "work"),
    path.join(HOME, "projects"),
    path.join(HOME, "Projects"),
    path.join(HOME, "Documents"),
  ];
  // Windows 의 G:, D: 같은 곳까지는 자동 탐색하지 않음 — 필요하면 --roots 로 명시
  if (process.platform === "win32") {
    candidates.push("C:\\git", "D:\\git");
  }
  return candidates.filter(safeExistsDir);
}

function looksLikeProjectRoot(dir: string): boolean {
  return (
    safeExistsDir(path.join(dir, ".claude")) ||
    safeExistsFile(path.join(dir, "CLAUDE.md")) ||
    safeExistsFile(path.join(dir, "AGENTS.md")) ||
    safeExistsFile(path.join(dir, ".mcp.json"))
  );
}

export function scanGlobal(globalRoot: string = defaultGlobalRoot()): SyncItem[] {
  const items: SyncItem[] = [];
  if (!safeExistsDir(globalRoot)) return items;

  // skills, agents, commands : 폴더 단위
  const kinds: Array<["skills" | "agents" | "commands", GlobalItemType]> = [
    ["skills", "global:skill"],
    ["agents", "global:agent"],
    ["commands", "global:command"],
  ];

  for (const [kind, type] of kinds) {
    const dir = path.join(globalRoot, kind);
    if (!safeExistsDir(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const itemPath = path.join(dir, entry.name);
      items.push({
        type,
        name: entry.name,
        scope: "global",
        absPath: itemPath,
        relPath: path.relative(globalRoot, itemPath),
        size: dirSize(itemPath),
      });
    }
  }

  // 단일 파일들
  const singles: Array<[string, GlobalItemType]> = [
    ["settings.json", "global:settings"],
    ["CLAUDE.md", "global:claude-md"],
  ];
  for (const [filename, type] of singles) {
    const p = path.join(globalRoot, filename);
    if (safeExistsFile(p)) {
      items.push({
        type,
        name: filename,
        scope: "global",
        absPath: p,
        relPath: filename,
        size: fs.statSync(p).size,
      });
    }
  }
  return items;
}

export function scanProject(root: string): SyncItem[] {
  const items: SyncItem[] = [];
  if (!safeExistsDir(root)) return items;
  const projectName = path.basename(root);
  const claudeDir = path.join(root, ".claude");

  // .claude 안의 skills/agents/commands (폴더 단위)
  if (safeExistsDir(claudeDir)) {
    const kinds: Array<["skills" | "agents" | "commands", ProjectItemType]> = [
      ["skills", "project:skill"],
      ["agents", "project:agent"],
      ["commands", "project:command"],
    ];
    for (const [kind, type] of kinds) {
      const dir = path.join(claudeDir, kind);
      if (!safeExistsDir(dir)) continue;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const itemPath = path.join(dir, entry.name);
        items.push({
          type,
          name: entry.name,
          scope: "project",
          project: projectName,
          projectRoot: root,
          absPath: itemPath,
          relPath: path.relative(root, itemPath),
          size: dirSize(itemPath),
        });
      }
    }

    // .claude 바로 아래의 hookify.*.md / settings.json / settings.local.json / 기타 .md
    for (const entry of fs.readdirSync(claudeDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const filename = entry.name;
      const itemPath = path.join(claudeDir, filename);
      let type: ProjectItemType | null = null;
      if (filename === "settings.json") type = "project:settings";
      else if (filename === "settings.local.json") type = "project:settings-local";
      else if (filename.startsWith("hookify.") && filename.endsWith(".md")) type = "project:hookify";
      else if (filename === "scheduled_tasks.lock") continue; // 락 파일 제외
      else if (filename.endsWith(".md")) type = "project:claude-doc";
      if (!type) continue;
      items.push({
        type,
        name: filename,
        scope: "project",
        project: projectName,
        projectRoot: root,
        absPath: itemPath,
        relPath: path.relative(root, itemPath),
        size: fs.statSync(itemPath).size,
      });
    }
  }

  // 루트의 CLAUDE.md / AGENTS.md / .mcp.json
  const rootSingles: Array<[string, ProjectItemType]> = [
    ["CLAUDE.md", "project:claude-md"],
    ["AGENTS.md", "project:agents-md"],
    [".mcp.json", "project:mcp"],
  ];
  for (const [filename, type] of rootSingles) {
    const p = path.join(root, filename);
    if (safeExistsFile(p)) {
      items.push({
        type,
        name: filename,
        scope: "project",
        project: projectName,
        projectRoot: root,
        absPath: p,
        relPath: filename,
        size: fs.statSync(p).size,
      });
    }
  }

  return items;
}

export function scanAll(opts: ScanAllOptions = {}): SyncItem[] {
  const { globalRoot, projectRoots = [], autoDiscover = true } = opts;
  const items: SyncItem[] = [];
  items.push(...scanGlobal(globalRoot));
  const roots = new Set<string>(projectRoots);
  if (autoDiscover) {
    for (const r of autoDiscoverProjects()) roots.add(r);
  }
  for (const r of roots) items.push(...scanProject(r));
  return items;
}

function safeExistsDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
function safeExistsFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}
function dirSize(dir: string): number {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) total += dirSize(p);
      else if (entry.isFile()) total += fs.statSync(p).size;
    }
  } catch {
    /* ignore */
  }
  return total;
}

export function formatItem(item: SyncItem): string {
  const sizeKb = (item.size / 1024).toFixed(1).padStart(7);
  if (item.scope === "global") {
    return `[전역] ${item.type.padEnd(18)} ${item.name.padEnd(30)} ${sizeKb} KB`;
  }
  const projectLabel = item.project ?? "?";
  return `[${projectLabel}] ${item.type.padEnd(20)} ${item.name.padEnd(30)} ${sizeKb} KB`;
}
