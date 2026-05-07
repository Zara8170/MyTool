import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  autoDiscoverProjects,
  scanGlobal,
  scanProject,
  scanAll,
} from "./scanner.js";

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "mytool-sync-scanner-"));
});
afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function makeFile(p: string, contents = "x"): void {
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, contents);
}

describe("scanGlobal", () => {
  it("returns empty when global root is missing", () => {
    expect(scanGlobal(join(workDir, "missing"))).toEqual([]);
  });

  it("finds skills, agents, commands, settings.json, CLAUDE.md", () => {
    const root = join(workDir, "fake-claude");
    mkdirSync(join(root, "skills", "alpha"), { recursive: true });
    makeFile(join(root, "skills", "alpha", "SKILL.md"), "# alpha\n");
    mkdirSync(join(root, "agents", "bravo"), { recursive: true });
    makeFile(join(root, "agents", "bravo", "agent.md"));
    mkdirSync(join(root, "commands", "charlie"), { recursive: true });
    makeFile(join(root, "commands", "charlie", "cmd.md"));
    makeFile(join(root, "settings.json"), '{"theme":"dark"}');
    makeFile(join(root, "CLAUDE.md"), "# global memo\n");

    const items = scanGlobal(root);
    const types = items.map((i) => i.type).sort();
    expect(types).toEqual(
      [
        "global:skill",
        "global:agent",
        "global:command",
        "global:settings",
        "global:claude-md",
      ].sort(),
    );

    const skill = items.find((i) => i.type === "global:skill");
    expect(skill?.name).toBe("alpha");
    expect(skill?.scope).toBe("global");
    expect(skill?.size).toBeGreaterThan(0);
  });

  it("ignores files under skills/ (only directories count)", () => {
    const root = join(workDir, "fake-claude");
    mkdirSync(join(root, "skills"), { recursive: true });
    makeFile(join(root, "skills", "rogue.md"), "loose file");
    expect(scanGlobal(root)).toEqual([]);
  });
});

describe("scanProject", () => {
  it("finds .claude subdirs, hookify files, settings, CLAUDE.md, AGENTS.md, .mcp.json", () => {
    const root = join(workDir, "demo-project");
    mkdirSync(join(root, ".claude", "skills", "s1"), { recursive: true });
    makeFile(join(root, ".claude", "skills", "s1", "SKILL.md"));
    mkdirSync(join(root, ".claude", "agents", "a1"), { recursive: true });
    makeFile(join(root, ".claude", "agents", "a1", "agent.md"));
    mkdirSync(join(root, ".claude", "commands", "c1"), { recursive: true });
    makeFile(join(root, ".claude", "commands", "c1", "cmd.md"));
    makeFile(join(root, ".claude", "settings.json"), "{}");
    makeFile(join(root, ".claude", "settings.local.json"), "{}");
    makeFile(join(root, ".claude", "hookify.preface.md"), "# hookify");
    makeFile(join(root, ".claude", "extra.md"), "# claude-doc");
    makeFile(join(root, "CLAUDE.md"), "# project memo");
    makeFile(join(root, "AGENTS.md"), "# agents");
    makeFile(join(root, ".mcp.json"), "{}");

    const items = scanProject(root);
    const types = items.map((i) => i.type).sort();
    expect(types).toEqual(
      [
        "project:skill",
        "project:agent",
        "project:command",
        "project:settings",
        "project:settings-local",
        "project:hookify",
        "project:claude-doc",
        "project:claude-md",
        "project:agents-md",
        "project:mcp",
      ].sort(),
    );

    // project / projectRoot 가 모두 채워졌는지
    for (const it of items) {
      expect(it.scope).toBe("project");
      expect(it.project).toBe("demo-project");
      expect(it.projectRoot).toBe(root);
    }
  });

  it("skips scheduled_tasks.lock", () => {
    const root = join(workDir, "demo-project");
    mkdirSync(join(root, ".claude"), { recursive: true });
    makeFile(join(root, ".claude", "scheduled_tasks.lock"), "lock");
    expect(scanProject(root)).toEqual([]);
  });

  it("returns empty when root does not exist", () => {
    expect(scanProject(join(workDir, "ghost"))).toEqual([]);
  });
});

describe("autoDiscoverProjects", () => {
  it("finds folders that have .claude/ or CLAUDE.md / AGENTS.md / .mcp.json", () => {
    const r1 = join(workDir, "p1");
    mkdirSync(join(r1, ".claude"), { recursive: true });
    const r2 = join(workDir, "p2");
    mkdirSync(r2, { recursive: true });
    makeFile(join(r2, "CLAUDE.md"));
    const r3 = join(workDir, "p3");
    mkdirSync(r3, { recursive: true });
    makeFile(join(r3, "AGENTS.md"));
    const r4 = join(workDir, "p4");
    mkdirSync(r4, { recursive: true });
    makeFile(join(r4, ".mcp.json"));
    // 무관한 폴더
    mkdirSync(join(workDir, "not-a-project", "node_modules"), { recursive: true });

    const found = autoDiscoverProjects([workDir], 2);
    const sorted = [...found].sort();
    expect(sorted).toEqual([r1, r2, r3, r4].sort());
  });

  it("does not descend into node_modules or hidden dirs", () => {
    const root = join(workDir, "outer");
    mkdirSync(join(root, "node_modules", "fake-pkg", ".claude"), { recursive: true });
    mkdirSync(join(root, ".cache", "x", ".claude"), { recursive: true });
    expect(autoDiscoverProjects([root], 5)).toEqual([]);
  });

  it("does not descend into a project once detected (treats found root as terminal)", () => {
    const outer = join(workDir, "outer");
    mkdirSync(join(outer, ".claude"), { recursive: true });
    mkdirSync(join(outer, "subpkg", ".claude"), { recursive: true });
    const found = autoDiscoverProjects([workDir], 5);
    // outer 는 발견, subpkg 는 안 들어감 (중첩 .claude 무시)
    expect(found).toContain(outer);
    expect(found).not.toContain(join(outer, "subpkg"));
  });
});

describe("scanAll", () => {
  it("combines global + provided project roots, autoDiscover off", () => {
    const globalRoot = join(workDir, "g");
    mkdirSync(join(globalRoot, "skills", "g1"), { recursive: true });
    makeFile(join(globalRoot, "skills", "g1", "SKILL.md"));

    const projectRoot = join(workDir, "p");
    mkdirSync(join(projectRoot, ".claude", "skills", "p1"), { recursive: true });
    makeFile(join(projectRoot, ".claude", "skills", "p1", "SKILL.md"));

    const items = scanAll({
      globalRoot,
      projectRoots: [projectRoot],
      autoDiscover: false,
    });
    const names = items.map((i) => `${i.scope}:${i.name}`).sort();
    expect(names).toEqual(["global:g1", "project:p1"]);
  });
});
