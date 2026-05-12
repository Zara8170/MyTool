// PR 3 — `mytool sync pull`
//
// 자기 device 가 target 인 pending job 을 처리한다.
// --once: 1개만 처리하고 종료 (PR 11 daemon 의 빌딩블록).
// 미지정: 30 초 간격으로 폴링.
//
// 동작:
//   1. GET /api/sync/jobs?deviceId=<me>&status=pending
//   2. 각 job 마다:
//      a. GET /api/sync/jobs/:id  → bundleUrl + manifest
//      b. bundle zip 다운로드 → 임시파일
//      c. itemIds 로 manifest 의 items 필터 → bundlePath/targetPath 매핑 만들기
//      d. overwrite 옵션 (backup|force|skip) 처리 — backup: <target>.bak.<ts>
//      e. extractPaths 로 적용
//      f. POST /api/sync/jobs/:id/result  (status, applied/skipped/errors)

import { existsSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import chalk from "chalk";
import ora from "ora";

import type { SyncJobOptions, SyncJobSummary, SyncJobWork } from "@mytool/shared";
import { extractPaths, itemBundlePath, itemTargetPath } from "@mytool/sync/bundle";
import { defaultGlobalRoot } from "@mytool/sync/scanner";
import type { SyncItem } from "@mytool/sync";

import { api, ApiClientError } from "../../lib/api-client.js";
import { bootstrapSync, type SyncCommandOpts } from "./common.js";

export interface SyncPullOptions extends SyncCommandOpts {
  once?: boolean;
  /** 폴링 간격(ms). 미지정 시 30초. */
  intervalMs?: number;
  /** project scope 항목 적용 시의 project root. job 의 targetProjectId 가 있으면 무시되고 우리가 알아서 한다. */
  projectRoot?: string;
}

const POLL_INTERVAL_MS = 30_000;

export async function syncPullCommand(opts: SyncPullOptions): Promise<void> {
  const ctx = bootstrapSync(opts);

  // 우선 자기 device 식별 — me 로 token 의 deviceId 알 수는 없지만, listDevices 의 첫 매치 hostname 사용.
  const devices = await api.listDevices(ctx.apiUrl, ctx.config.token);
  const me = devices.find((d) => d.hostname === ctx.hostname) ?? devices[0];
  if (!me) {
    console.error(
      chalk.red("No device registered.") +
        " Run " +
        chalk.cyan("mytool sync push") +
        " first.",
    );
    process.exit(1);
  }
  console.log(chalk.dim(`device: ${me.name} (${me.id})`));

  const interval = opts.intervalMs ?? POLL_INTERVAL_MS;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let processed = 0;
    const jobs = await api.listJobs(ctx.apiUrl, ctx.config.token, {
      deviceId: me.id,
      status: "pending",
    });
    for (const job of jobs) {
      try {
        await handleJob(ctx.apiUrl, ctx.config.token, job);
        processed++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`✗ job ${job.id} failed:`), msg);
      }
    }

    if (opts.once) return;

    if (processed === 0) {
      process.stdout.write(chalk.dim(`. (no pending, sleeping ${Math.round(interval / 1000)}s)\n`));
    }
    await sleep(interval);
  }
}

async function handleJob(
  apiUrl: string,
  token: string,
  jobSummary: SyncJobSummary,
): Promise<void> {
  const spinner = ora(`Job ${jobSummary.id} — fetching...`).start();

  let work: SyncJobWork;
  try {
    work = await api.getJob(apiUrl, token, jobSummary.id);
  } catch (err) {
    spinner.fail(`Job ${jobSummary.id} fetch failed`);
    if (err instanceof ApiClientError) console.error(chalk.red(err.message));
    throw err;
  }

  // 1) bundle zip 다운로드
  spinner.text = `Job ${jobSummary.id} — downloading bundle...`;
  const tmpDir = mkdtempSync(join(tmpdir(), "mytool-pull-"));
  const zipPath = join(tmpDir, "bundle.zip");
  try {
    const buf = await api.downloadBundle(work.bundleUrl, token);
    writeFileSync(zipPath, buf);
  } catch (err) {
    spinner.fail(`Bundle download failed`);
    rmSync(tmpDir, { recursive: true, force: true });
    throw err;
  }

  // 2) manifest 의 items 중 itemIds 에 매칭되는 것만
  const wantIds = new Set(jobSummary.itemIds);
  const matched = work.manifest.items.filter((it) => wantIds.has(it.id));
  if (matched.length === 0) {
    spinner.warn(`No items matched for job ${jobSummary.id}`);
    rmSync(tmpDir, { recursive: true, force: true });
    await reportResult(apiUrl, token, jobSummary.id, {
      status: "done",
      result: { applied: [], skipped: [], errors: [] },
    });
    return;
  }

  // 3) target context 만들기 — 전역은 ~/.claude, 프로젝트는 어디?
  // 여기서는 옵션으로 받지 않은 한 cwd 사용. global 항목만 있으면 무관.
  const globalRoot = defaultGlobalRoot();
  const projectRoot = process.cwd();
  const options: SyncJobOptions = jobSummary.options;

  const applied: string[] = [];
  const skipped: string[] = [];
  const errors: { itemId: string; message: string }[] = [];

  // 4) extractPaths 로 한꺼번에 — 단, overwrite 옵션은 사전 처리.
  const mappings: { bundlePath: string; targetPath: string; itemId: string }[] = [];
  for (const it of matched) {
    try {
      // SyncItem 형태로 변환 (bundlePath/targetPath 만 필요)
      const stub: SyncItem = {
        type: it.type,
        scope: it.scope,
        name: it.name,
        absPath: it.sourceAbsPath,
        relPath: it.relPath,
        size: it.size,
        ...(it.project ? { project: it.project } : {}),
        ...(it.sourceProjectRoot ? { projectRoot: it.sourceProjectRoot } : {}),
      };
      const bundlePath = itemBundlePath(stub);
      const targetPath = itemTargetPath(stub, { globalRoot, projectRoot });

      // overwrite 옵션 처리
      if (existsSync(targetPath)) {
        if (options.overwrite === "skip") {
          skipped.push(it.id);
          continue;
        }
        if (options.overwrite === "backup") {
          const backup = `${targetPath}.bak.${Date.now()}`;
          renameSync(targetPath, backup);
        }
        // "force" 면 그대로 두고 extractPaths 가 덮어씀
      }

      mappings.push({ bundlePath, targetPath, itemId: it.id });
    } catch (err) {
      errors.push({
        itemId: it.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 5) 적용
  spinner.text = `Job ${jobSummary.id} — applying ${mappings.length} item(s)...`;
  try {
    if (mappings.length > 0) {
      await extractPaths({
        source: zipPath,
        mappings: mappings.map((m) => ({
          bundlePath: m.bundlePath,
          targetPath: m.targetPath,
        })),
      });
      for (const m of mappings) applied.push(m.itemId);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    for (const m of mappings) errors.push({ itemId: m.itemId, message: msg });
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  // 6) 결과 보고
  const status = errors.length === 0
    ? "done"
    : applied.length > 0
      ? "partial"
      : "failed";

  await reportResult(apiUrl, token, jobSummary.id, {
    status,
    result: { applied, skipped, errors },
  });

  if (status === "done") {
    spinner.succeed(
      `Job ${jobSummary.id}: applied ${applied.length}` +
        (skipped.length ? `, skipped ${skipped.length}` : ""),
    );
  } else if (status === "partial") {
    spinner.warn(
      `Job ${jobSummary.id}: partial — ${applied.length} ok, ${errors.length} errors`,
    );
  } else {
    spinner.fail(`Job ${jobSummary.id}: failed (${errors.length} errors)`);
  }
}

async function reportResult(
  apiUrl: string,
  token: string,
  jobId: string,
  body: { status: "done" | "failed" | "partial"; result: { applied: string[]; skipped: string[]; errors: { itemId: string; message: string }[] } },
): Promise<void> {
  try {
    await api.reportJobResult(apiUrl, token, jobId, body);
  } catch (err) {
    console.error(
      chalk.yellow("Result report failed:"),
      err instanceof Error ? err.message : String(err),
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
