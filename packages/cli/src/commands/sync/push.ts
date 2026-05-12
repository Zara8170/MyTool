// PR 3 — `mytool sync push`
//
// 1. device 등록·갱신 (api 가 발급한 deviceId 를 토큰에 묶어줌)
// 2. @mytool/sync 의 scanAll 로 현재 PC 자산 스캔
// 3. mask 옵션이 켜져 있으면 시크릿 마스킹
// 4. 임시 zip bundle 생성
// 5. POST /api/sync/snapshots — manifest 업로드 → snapshotId 받음
// 6. POST /api/sync/snapshots/:id/bundle — zip 업로드
// 7. 결과 출력

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import chalk from "chalk";
import ora from "ora";

import type { CreateSnapshotRequest, SyncManifest } from "@mytool/shared";
import { scanAll } from "@mytool/sync/scanner";
import { writeZip } from "@mytool/sync/bundle";
import { maskBuffer } from "@mytool/sync/mask";
import type { SyncItem } from "@mytool/sync";

import { api, ApiClientError } from "../../lib/api-client.js";
import { bootstrapSync, type SyncCommandOpts } from "./common.js";

export interface SyncPushOptions extends SyncCommandOpts {
  device?: string;
  /** 마스킹 적용 여부 (기본 true). */
  mask?: boolean;
  /** project root 추가. */
  roots?: string[];
}

export async function syncPushCommand(opts: SyncPushOptions): Promise<void> {
  const ctx = bootstrapSync(opts);
  const wantMask = opts.mask !== false; // 기본 ON

  // 1) device 등록·갱신
  const deviceSpinner = ora("Registering device...").start();
  let device;
  try {
    device = await api.registerDevice(ctx.apiUrl, ctx.config.token, {
      name: opts.device ?? ctx.hostname,
      hostname: ctx.hostname,
      platform: ctx.platform,
    });
    deviceSpinner.succeed(
      `Device: ${chalk.bold(device.name)} ${chalk.dim(`(${device.id})`)}`,
    );
  } catch (err) {
    deviceSpinner.fail("Device registration failed");
    if (err instanceof ApiClientError) {
      console.error(chalk.red(err.message));
    } else {
      console.error(err instanceof Error ? err.message : String(err));
    }
    process.exit(1);
  }

  // 2) 스캔
  const scanSpinner = ora("Scanning Claude Code assets...").start();
  const items = scanAll({ projectRoots: opts.roots ?? [] });
  scanSpinner.succeed(`Found ${items.length} item(s)`);
  if (items.length === 0) {
    console.log(chalk.dim("Nothing to push. (Tip: --roots <folder> to add project paths)"));
    return;
  }

  // 3) manifest 만들기 — id 부여 (api 가 안정 식별자로 사용)
  const manifestItems = items.map((it) => ({
    id: stableItemId(it),
    type: it.type,
    scope: it.scope,
    name: it.name,
    project: it.project ?? null,
    sourceProjectRoot: it.projectRoot ?? null,
    sourceAbsPath: it.absPath,
    relPath: it.relPath,
    size: it.size,
  }));
  const manifest: SyncManifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    sourceHost: ctx.hostname,
    sourcePlatform: ctx.platform,
    masked: wantMask,
    items: manifestItems,
  };

  // 4) bundle zip 생성
  const tmp = mkdtempSync(join(tmpdir(), "mytool-push-"));
  const zipPath = join(tmp, "bundle.zip");
  const zipSpinner = ora("Building bundle...").start();
  try {
    await writeZip({
      outputPath: zipPath,
      items,
      // bundle 라이브러리는 SyncManifestItem 형태를 받지만, id 필드는 무시되고 sourceAbsPath 만 사용한다.
      manifest: manifest as unknown as Parameters<typeof writeZip>[0]["manifest"],
      transformContent: wantMask
        ? (item: SyncItem, buf: Buffer) => maskBuffer(item, buf)
        : null,
    });
    zipSpinner.succeed("Bundle built");
  } catch (err) {
    zipSpinner.fail("Bundle build failed");
    rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
  const zipBuf = readFileSync(zipPath);
  rmSync(tmp, { recursive: true, force: true });

  // 5) snapshot manifest 업로드 — orgId 결정 필요. user 의 첫 org 사용.
  const me = await api.me(ctx.apiUrl, ctx.config.token);
  const orgId = me.organizations[0]?.id;
  if (!orgId) {
    console.error(chalk.red("No organization found for this user."));
    process.exit(1);
  }

  const uploadSpinner = ora("Uploading manifest...").start();
  let snapshot;
  try {
    const req: CreateSnapshotRequest = { orgId, manifest };
    snapshot = await api.createSnapshot(ctx.apiUrl, ctx.config.token, req);
    uploadSpinner.succeed(`Snapshot ${chalk.dim(snapshot.id)}`);
  } catch (err) {
    uploadSpinner.fail("Manifest upload failed");
    if (err instanceof ApiClientError) console.error(chalk.red(err.message));
    process.exit(1);
  }

  // 6) bundle 업로드
  const bundleSpinner = ora(
    `Uploading bundle (${formatBytes(zipBuf.byteLength)})...`,
  ).start();
  try {
    const res = await api.uploadBundle(
      ctx.apiUrl,
      ctx.config.token,
      snapshot.id,
      zipBuf,
    );
    bundleSpinner.succeed(`Uploaded ${formatBytes(res.size)}`);
  } catch (err) {
    bundleSpinner.fail("Bundle upload failed");
    if (err instanceof ApiClientError) console.error(chalk.red(err.message));
    process.exit(1);
  }

  console.log();
  console.log(chalk.green("✓"), "Push complete.");
  console.log(
    "  ",
    chalk.dim("View on web:"),
    `${ctx.apiUrl.replace(/\/$/, "")}/settings/sync`,
  );
}

/**
 * SyncItem 의 안정 식별자. type + scope + project + name + relPath 를 합쳐 만든다.
 * 같은 파일은 push 마다 같은 id 가 나오도록.
 */
function stableItemId(it: SyncItem): string {
  const parts = [it.type, it.scope, it.project ?? "_", it.name, it.relPath];
  // 사람이 읽을 수 있도록 그대로 join. 충돌 가능성은 낮지만 디버깅 가독성 우선.
  return parts.join("|");
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
