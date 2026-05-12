#!/usr/bin/env node
import { Command } from "commander";
import { mainCommand } from "./commands/main.js";
import { hookCommand } from "./commands/hook.js";
import { logoutCommand, statusCommand } from "./commands/status.js";
import { syncPushCommand } from "./commands/sync/push.js";
import { syncPullCommand } from "./commands/sync/pull.js";
import { syncStatusCommand } from "./commands/sync/status.js";

const program = new Command();

program
  .name("mytool")
  .description("Claude Code observability for individuals and small teams")
  .version("0.1.0")
  .option("--api-url <url>", "Override API URL (for self-hosting)");

// 메인 (인자 없이 호출): mytool
program.action(async (opts) => {
  await mainCommand({ apiUrl: opts.apiUrl });
});

// mytool hook (Claude Code가 호출, 사용자가 직접 쓰지 않음)
program
  .command("hook")
  .description("[internal] Process Claude Code hook event from stdin")
  .action(async () => {
    await hookCommand();
  });

// mytool status
program
  .command("status")
  .description("Show current authentication and project status")
  .action(async (_, cmd) => {
    const opts = cmd.optsWithGlobals();
    await statusCommand({ apiUrl: opts.apiUrl });
  });

// mytool logout
program
  .command("logout")
  .description("Log out and remove local credentials")
  .action(async (_, cmd) => {
    const opts = cmd.optsWithGlobals();
    await logoutCommand({ apiUrl: opts.apiUrl });
  });

// ─── PR 3 — sync (push/pull/status) ───────────────────────────
const sync = program
  .command("sync")
  .description("Sync Claude Code skills/settings between your devices");

sync
  .command("push")
  .description("Scan this PC and upload a snapshot to mytool")
  .option("--device <name>", "Device name (default: hostname)")
  .option("--no-mask", "Disable secret masking (not recommended)")
  .option(
    "--roots <paths...>",
    "Extra project roots to include in the scan",
  )
  .action(async (opts, cmd) => {
    const globals = cmd.optsWithGlobals();
    await syncPushCommand({
      apiUrl: globals.apiUrl,
      device: opts.device,
      mask: opts.mask,
      roots: opts.roots,
    });
  });

sync
  .command("pull")
  .description("Apply pending sync jobs targeting this device")
  .option("--once", "Process pending jobs once and exit (no polling)")
  .option(
    "--interval <ms>",
    "Polling interval in milliseconds (default 30000)",
    (v) => parseInt(v, 10),
  )
  .action(async (opts, cmd) => {
    const globals = cmd.optsWithGlobals();
    await syncPullCommand({
      apiUrl: globals.apiUrl,
      once: opts.once,
      ...(typeof opts.interval === "number" && !Number.isNaN(opts.interval)
        ? { intervalMs: opts.interval }
        : {}),
    });
  });

sync
  .command("status")
  .description("Show your devices, last push, and pending jobs")
  .action(async (_, cmd) => {
    const opts = cmd.optsWithGlobals();
    await syncStatusCommand({ apiUrl: opts.apiUrl });
  });

program
  .parseAsync(process.argv)
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
