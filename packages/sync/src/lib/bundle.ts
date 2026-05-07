// 백업 패키지(번들) 포맷
//
// 디렉토리 구조:
//   manifest.json
//   global/
//     skills/<name>/...
//     agents/<name>/...
//     commands/<name>/...
//     settings.json
//     CLAUDE.md
//   projects/
//     <projectName>/
//       _meta.json            (원본 절대경로 등 — 현재는 manifest 에서 다룸)
//       CLAUDE.md
//       AGENTS.md
//       .mcp.json
//       .claude/
//         settings.json
//         settings.local.json
//         hookify.*.md
//         skills/<name>/...
//         agents/<name>/...
//         commands/<name>/...
//
// zip 파일은 위 구조를 그대로 압축한 것.
//
// PR 2 흡수: 원본 claude-sync 의 src/lib/bundle.mjs 와 동일 동작 유지.

import fs from "node:fs";
import path from "node:path";

import archiver from "archiver";
import yauzl from "yauzl";

import type {
  BundleMeta,
  BundleWriteOptions,
  ExtractOptions,
  ItemTargetContext,
  SyncItem,
  SyncManifest,
} from "../types.js";

export function itemBundlePath(item: SyncItem): string {
  // 번들 안에서 이 항목이 차지할 상대 경로(폴더 또는 파일).
  if (item.scope === "global") {
    if (item.type === "global:skill") return path.posix.join("global/skills", item.name);
    if (item.type === "global:agent") return path.posix.join("global/agents", item.name);
    if (item.type === "global:command") return path.posix.join("global/commands", item.name);
    if (item.type === "global:settings") return path.posix.join("global", item.name);
    if (item.type === "global:claude-md") return path.posix.join("global", item.name);
  }
  const projectName = sanitizeProjectName(item.project ?? "_unknown_");
  if (item.type === "project:skill")
    return path.posix.join("projects", projectName, ".claude/skills", item.name);
  if (item.type === "project:agent")
    return path.posix.join("projects", projectName, ".claude/agents", item.name);
  if (item.type === "project:command")
    return path.posix.join("projects", projectName, ".claude/commands", item.name);
  if (item.type === "project:settings")
    return path.posix.join("projects", projectName, ".claude", item.name);
  if (item.type === "project:settings-local")
    return path.posix.join("projects", projectName, ".claude", item.name);
  if (item.type === "project:hookify")
    return path.posix.join("projects", projectName, ".claude", item.name);
  if (item.type === "project:claude-doc")
    return path.posix.join("projects", projectName, ".claude", item.name);
  if (item.type === "project:claude-md")
    return path.posix.join("projects", projectName, item.name);
  if (item.type === "project:agents-md")
    return path.posix.join("projects", projectName, item.name);
  if (item.type === "project:mcp") return path.posix.join("projects", projectName, item.name);
  throw new Error(`알 수 없는 항목 타입: ${(item as { type: string }).type}`);
}

export function itemTargetPath(item: SyncItem, ctx: ItemTargetContext): string {
  const { globalRoot, projectRoot } = ctx;
  if (item.scope === "global") {
    if (!globalRoot) throw new Error("globalRoot가 필요합니다");
    if (item.type === "global:skill") return path.join(globalRoot, "skills", item.name);
    if (item.type === "global:agent") return path.join(globalRoot, "agents", item.name);
    if (item.type === "global:command") return path.join(globalRoot, "commands", item.name);
    if (item.type === "global:settings") return path.join(globalRoot, item.name);
    if (item.type === "global:claude-md") return path.join(globalRoot, item.name);
  }
  if (!projectRoot) throw new Error("projectRoot가 필요합니다");
  if (item.type === "project:skill") return path.join(projectRoot, ".claude/skills", item.name);
  if (item.type === "project:agent") return path.join(projectRoot, ".claude/agents", item.name);
  if (item.type === "project:command")
    return path.join(projectRoot, ".claude/commands", item.name);
  if (item.type === "project:settings") return path.join(projectRoot, ".claude", item.name);
  if (item.type === "project:settings-local")
    return path.join(projectRoot, ".claude", item.name);
  if (item.type === "project:hookify") return path.join(projectRoot, ".claude", item.name);
  if (item.type === "project:claude-doc") return path.join(projectRoot, ".claude", item.name);
  if (item.type === "project:claude-md") return path.join(projectRoot, item.name);
  if (item.type === "project:agents-md") return path.join(projectRoot, item.name);
  if (item.type === "project:mcp") return path.join(projectRoot, item.name);
  throw new Error(`알 수 없는 항목 타입: ${(item as { type: string }).type}`);
}

function sanitizeProjectName(name: string): string {
  return String(name).replace(/[^a-zA-Z0-9._-]/g, "_");
}

function applyTransform(
  item: SyncItem,
  buf: Buffer,
  transform: BundleWriteOptions["transformContent"],
): Buffer {
  if (!transform) return buf;
  const replaced = transform(item, buf);
  if (replaced == null) return buf;
  return Buffer.isBuffer(replaced) ? replaced : Buffer.from(replaced);
}

export async function writeZip(opts: BundleWriteOptions): Promise<number> {
  const { outputPath, items, manifest, transformContent } = opts;
  await fs.promises.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
  const out = fs.createWriteStream(outputPath);
  const archive = archiver("zip", { zlib: { level: 9 } });

  const done = new Promise<number>((resolve, reject) => {
    out.on("close", () => resolve(archive.pointer()));
    archive.on("warning", (e: NodeJS.ErrnoException) => {
      if (e.code !== "ENOENT") reject(e);
    });
    archive.on("error", reject);
  });
  archive.pipe(out);

  archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });

  for (const item of items) {
    const inBundle = itemBundlePath(item);
    const stat = fs.statSync(item.absPath);
    if (stat.isDirectory()) {
      archive.directory(item.absPath, inBundle);
    } else {
      const original = fs.readFileSync(item.absPath);
      const buf = applyTransform(item, original, transformContent);
      archive.append(buf, { name: inBundle });
    }
  }

  await archive.finalize();
  return done;
}

export async function writeDir(opts: BundleWriteOptions): Promise<void> {
  const { outputPath, items, manifest, transformContent } = opts;
  await fs.promises.mkdir(outputPath, { recursive: true });
  await fs.promises.writeFile(
    path.join(outputPath, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  for (const item of items) {
    const target = path.join(outputPath, itemBundlePath(item));
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    const stat = fs.statSync(item.absPath);
    if (stat.isDirectory()) {
      await copyDir(item.absPath, target);
    } else {
      const original = await fs.promises.readFile(item.absPath);
      const buf = applyTransform(item, original, transformContent);
      await fs.promises.writeFile(target, buf);
    }
  }
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.promises.mkdir(dest, { recursive: true });
  for (const entry of await fs.promises.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(s, d);
    else if (entry.isFile()) await fs.promises.copyFile(s, d);
  }
}

// 번들(zip 또는 폴더)에서 manifest와 항목 리스트를 읽는다.
export async function readBundleMeta(source: string): Promise<BundleMeta> {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    const manifestPath = path.join(source, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as SyncManifest;
    return { kind: "dir", manifest, source };
  }
  const manifest = await readManifestFromZip(source);
  return { kind: "zip", manifest, source };
}

function readManifestFromZip(zipPath: string): Promise<SyncManifest> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error("zip open 실패"));
      zip.readEntry();
      zip.on("entry", (entry) => {
        if (entry.fileName === "manifest.json") {
          zip.openReadStream(entry, (err2, stream) => {
            if (err2 || !stream) return reject(err2 ?? new Error("manifest stream 실패"));
            const chunks: Buffer[] = [];
            stream.on("data", (c: Buffer) => chunks.push(c));
            stream.on("end", () => {
              try {
                resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as SyncManifest);
              } catch (e) {
                reject(e as Error);
              }
              zip.close();
            });
          });
        } else {
          zip.readEntry();
        }
      });
      zip.on("end", () => reject(new Error("manifest.json 을 찾을 수 없습니다")));
    });
  });
}

// 번들에서 특정 path들을 대상 절대경로에 추출
export async function extractPaths(opts: ExtractOptions): Promise<void> {
  const { source, mappings } = opts;
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    for (const { bundlePath, targetPath } of mappings) {
      const src = path.join(source, bundlePath);
      const sStat = fs.statSync(src);
      await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
      if (sStat.isDirectory()) await copyDir(src, targetPath);
      else await fs.promises.copyFile(src, targetPath);
    }
    return;
  }
  await extractFromZip(source, mappings);
}

interface PrefixMapping {
  prefix: string;
  target: string;
}

function extractFromZip(zipPath: string, mappings: ExtractOptions["mappings"]): Promise<void> {
  // 빠른 매칭을 위해 prefix 기반 매핑 만들기
  const prefixMap: PrefixMapping[] = mappings.map((m) => ({
    prefix: m.bundlePath.replace(/\\/g, "/"),
    target: m.targetPath,
  }));
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error("zip open 실패"));
      zip.readEntry();
      zip.on("entry", (entry) => {
        const fn = entry.fileName.replace(/\\/g, "/");
        let matched: PrefixMapping | null = null;
        for (const m of prefixMap) {
          if (fn === m.prefix || fn.startsWith(m.prefix + "/")) {
            matched = m;
            break;
          }
        }
        if (!matched) {
          zip.readEntry();
          return;
        }
        const rel = fn === matched.prefix ? "" : fn.slice(matched.prefix.length + 1);
        const target = rel ? path.join(matched.target, rel) : matched.target;

        if (/\/$/.test(fn)) {
          fs.promises
            .mkdir(target, { recursive: true })
            .then(() => zip.readEntry())
            .catch(reject);
        } else {
          fs.promises
            .mkdir(path.dirname(target), { recursive: true })
            .catch(() => undefined)
            .then(() => {
              zip.openReadStream(entry, (err2, stream) => {
                if (err2 || !stream) return reject(err2 ?? new Error("entry stream 실패"));
                const ws = fs.createWriteStream(target);
                stream.pipe(ws);
                ws.on("close", () => zip.readEntry());
                ws.on("error", reject);
              });
            });
        }
      });
      zip.on("end", () => resolve());
      zip.on("error", reject);
    });
  });
}
