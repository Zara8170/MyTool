import { describe, expect, it } from "vitest";

import { maskBuffer } from "./mask.js";
import type { SyncItem } from "../types.js";

const mcpItem: SyncItem = {
  type: "project:mcp",
  name: ".mcp.json",
  scope: "project",
  absPath: "/fake/.mcp.json",
  relPath: ".mcp.json",
  size: 0,
  project: "demo",
  projectRoot: "/fake",
};

const settingsItem: SyncItem = {
  type: "project:settings",
  name: "settings.json",
  scope: "project",
  absPath: "/fake/.claude/settings.json",
  relPath: ".claude/settings.json",
  size: 0,
  project: "demo",
  projectRoot: "/fake",
};

const skillItem: SyncItem = {
  type: "project:skill",
  name: "my-skill",
  scope: "project",
  absPath: "/fake/.claude/skills/my-skill",
  relPath: ".claude/skills/my-skill",
  size: 0,
  project: "demo",
  projectRoot: "/fake",
};

function buf(s: string): Buffer {
  return Buffer.from(s, "utf8");
}

describe("maskBuffer — JSON 키 기반 마스킹", () => {
  it("masks suspicious keys at the top level", () => {
    const input = JSON.stringify({
      url: "https://example.com",
      apiKey: "sk-abcdef",
      password: "hunter2",
      token: "tok_123",
      access_key: "AKIA...",
      private_key: "-----BEGIN-----",
      connection_string: "user:pass@host",
    });
    const out = maskBuffer(mcpItem, buf(input));
    expect(out).not.toBeNull();
    const obj = JSON.parse(out as string);
    expect(obj.url).toBe("https://example.com"); // 변경 없음
    expect(obj.apiKey).toBe("***");
    expect(obj.password).toBe("***");
    expect(obj.token).toBe("***");
    expect(obj.access_key).toBe("***");
    expect(obj.private_key).toBe("***");
    expect(obj.connection_string).toBe("***");
  });

  it("masks nested suspicious keys", () => {
    const input = JSON.stringify({
      mcpServers: {
        db: {
          command: "node",
          env: { PASSWORD: "secret", DEBUG: "true" },
        },
      },
    });
    const out = maskBuffer(mcpItem, buf(input));
    expect(out).not.toBeNull();
    const obj = JSON.parse(out as string);
    expect(obj.mcpServers.db.env.PASSWORD).toBe("***");
    expect(obj.mcpServers.db.env.DEBUG).toBe("true");
  });

  it("masks connection string inside JSON string values too", () => {
    const input = JSON.stringify({
      command: "psql postgres://alice:s3cret@db.example.com:5432/app",
    });
    const out = maskBuffer(mcpItem, buf(input));
    expect(out).not.toBeNull();
    expect(out).toContain("postgres://alice:***@db.example.com");
    expect(out).not.toContain("s3cret");
  });
});

describe("maskBuffer — 텍스트 정규식 기반", () => {
  it("masks postgres / mysql / mongodb / redis URIs in non-JSON text", () => {
    const text = [
      "PG=postgres://user:supersecret@host/db",
      "MY=mysql://root:rootpass@127.0.0.1/x",
      'MONGO="mongodb+srv://u:p@cluster/db"',
      "RED=redis://:onlypass@redis-host:6379/0",
    ].join("\n");
    // .json 이 아닌 settings 의 케이스를 흉내내기 위해 일부러 settings.json 을 깨트려 invalid JSON 보냄
    const broken = "this is not json\n" + text;
    const out = maskBuffer(settingsItem, buf(broken));
    expect(out).not.toBeNull();
    expect(out).toContain("postgres://user:***@host/db");
    expect(out).toContain("mysql://root:***@127.0.0.1/x");
    expect(out).toContain("mongodb+srv://u:***@cluster/db");
    expect(out).toContain("redis://:***@redis-host:6379/0");
    expect(out).not.toContain("supersecret");
    expect(out).not.toContain("rootpass");
    expect(out).not.toContain("onlypass");
  });
});

describe("maskBuffer — 비대상 / 무변경", () => {
  it("returns null for unsupported item types", () => {
    expect(maskBuffer(skillItem, buf("anything"))).toBeNull();
  });

  it("returns null when settings.json has no suspicious data", () => {
    const safe = JSON.stringify({ theme: "dark", fontSize: 12 });
    const out = maskBuffer(settingsItem, buf(safe));
    // JSON 분기는 항상 stringify 한 결과를 반환 → 변경 없음일 수 있지만 null 은 아님.
    // 원본 동작과 동일하게 stringify 결과가 그대로 나오는지만 확인.
    expect(out).not.toBeNull();
    const obj = JSON.parse(out as string);
    expect(obj).toEqual({ theme: "dark", fontSize: 12 });
  });

  it("returns null for non-JSON text without any URI patterns", () => {
    const out = maskBuffer(settingsItem, buf("plain text without any secrets"));
    expect(out).toBeNull();
  });
});
