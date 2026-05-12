// PR 3 — `mytool sync status`
//
// 자기 device 목록, 가장 최근 push 시각, pending job 수를 보여준다.

import chalk from "chalk";

import { api } from "../../lib/api-client.js";
import { bootstrapSync, type SyncCommandOpts } from "./common.js";

export async function syncStatusCommand(opts: SyncCommandOpts): Promise<void> {
  const ctx = bootstrapSync(opts);

  const [devices, snapshots, jobs] = await Promise.all([
    api.listDevices(ctx.apiUrl, ctx.config.token),
    api.listSnapshots(ctx.apiUrl, ctx.config.token),
    api.listJobs(ctx.apiUrl, ctx.config.token, { status: "pending" }),
  ]);

  if (devices.length === 0) {
    console.log(chalk.yellow("No devices registered yet."));
    console.log("Run " + chalk.cyan("mytool sync push") + " to register this PC.");
    return;
  }

  console.log(chalk.bold("\nDevices:"));
  for (const d of devices) {
    const last = snapshots.find((s) => s.deviceId === d.id);
    const pending = jobs.filter((j) => j.targetDeviceId === d.id).length;
    const isMe = d.hostname === ctx.hostname;
    const dot = isMe ? chalk.green("●") : chalk.dim("○");

    console.log(
      "  " +
        dot +
        " " +
        chalk.bold(d.name) +
        chalk.dim(`  (${d.platform}, ${d.hostname})`),
    );
    if (last) {
      const ago = formatAgo(new Date(last.createdAt));
      console.log(
        "      " +
          chalk.dim(
            `last push ${ago} · ${last.itemCount} items${last.masked ? " · masked" : ""}`,
          ),
      );
    } else {
      console.log("      " + chalk.dim("(no snapshots yet)"));
    }
    if (pending > 0) {
      console.log("      " + chalk.yellow(`${pending} pending job(s) inbound`));
    }
  }

  console.log();
  if (jobs.length > 0) {
    console.log(
      chalk.dim(
        `Tip: run \`mytool sync pull --once\` on the target PC to apply pending jobs.`,
      ),
    );
  }
}

function formatAgo(d: Date): string {
  const ms = Date.now() - d.getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}
