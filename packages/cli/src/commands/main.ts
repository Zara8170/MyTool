import { basename } from "node:path";
import { input, password as passwordPrompt, select } from "@inquirer/prompts";
import chalk from "chalk";
import ora from "ora";
import { api, ApiClientError } from "../lib/api-client.js";
import { getActiveProfile, readConfig, resolveApiUrl, writeConfig } from "../lib/config.js";
import { injectHooks } from "../lib/hooks-inject.js";
import { findProjectConfig, writeProjectConfig } from "../lib/project.js";

export interface MainCommandOpts {
  apiUrl?: string;
}

/**
 * mytool (인자 없이 실행) — 컨텍스트를 감지해 필요한 작업을 수행.
 *
 *   상태                            동작
 *   ──────────────────────────────  ──────────────────────────────────────
 *   로그인 X + project.json X       로그인/회원가입 → 프로젝트 생성 → hook 주입
 *   로그인 X + project.json O       로그인/회원가입만 (org 합류는 invite 시스템 후)
 *   로그인 O + project.json X       프로젝트 생성 → hook 주입
 *   로그인 O + project.json O       status 출력
 */
export async function mainCommand(opts: MainCommandOpts): Promise<void> {
  const config = readConfig();
  const projectInfo = findProjectConfig(process.cwd());

  const apiUrl = resolveApiUrl(
    opts.apiUrl,
    projectInfo?.config.apiUrl,
    config?.apiUrl,
  );

  const profile = getActiveProfile();
  const profileTag = profile === "default" ? "" : chalk.yellow(` [${profile}]`);
  console.log(
    chalk.bold.cyan("mytool") + profileTag + chalk.gray(`  →  ${apiUrl}`),
  );
  console.log();

  if (!config && !projectInfo) {
    await fullSetup(apiUrl, opts.apiUrl);
    return;
  }
  if (!config && projectInfo) {
    await loginOnlyFlow(apiUrl, opts.apiUrl);
    console.log();
    console.log(
      chalk.yellow("⚠"),
      "This project belongs to organization",
      chalk.bold(projectInfo.config.orgId),
      "which you may not be a member of.",
    );
    console.log(
      "  Joining requires an invite (not yet implemented). Use your own organization for now.",
    );
    return;
  }
  if (config && !projectInfo) {
    await projectInitFlow(config, apiUrl, opts.apiUrl);
    return;
  }
  // 모두 완료 — status
  await printStatus(config!, projectInfo!.configDir, apiUrl);
}

// ─────────────────────────────────────────
// 전체 셋업: 로그인 → 프로젝트 → hook
// ─────────────────────────────────────────
async function fullSetup(apiUrl: string, explicitApiUrl?: string): Promise<void> {
  console.log(chalk.dim("First time setup. Let's get you started."));
  console.log();
  await loginOnlyFlow(apiUrl, explicitApiUrl);
  const config = readConfig()!;
  await projectInitFlow(config, apiUrl, explicitApiUrl);
}

// ─────────────────────────────────────────
// 로그인 또는 회원가입
// ─────────────────────────────────────────
async function loginOnlyFlow(apiUrl: string, explicitApiUrl?: string): Promise<void> {
  const action = await select({
    message: "Sign in or create a new account?",
    choices: [
      { name: "Sign in", value: "login" as const },
      { name: "Create new account", value: "register" as const },
    ],
  });

  const email = await input({
    message: "Email:",
    validate: (v) => /.+@.+\..+/.test(v) || "Please enter a valid email",
  });
  const pw = await passwordPrompt({
    message: "Password:",
    validate: (v) => v.length >= 8 || "Password must be at least 8 characters",
  });

  let name: string | undefined;
  if (action === "register") {
    name = await input({ message: "Your name (optional):", default: "" });
    if (!name) name = undefined;
  }

  const spinner = ora(action === "login" ? "Signing in..." : "Creating account...").start();
  try {
    const auth =
      action === "login"
        ? await api.login(apiUrl, { email, password: pw })
        : await api.register(apiUrl, { email, password: pw, ...(name ? { name } : {}) });
    writeConfig({
      token: auth.token,
      user: auth.user,
      ...(explicitApiUrl ? { apiUrl: explicitApiUrl } : {}),
    });
    spinner.succeed(`Signed in as ${chalk.bold(auth.user.email)}`);
  } catch (err) {
    spinner.fail(formatError(err, "Authentication failed"));
    process.exit(1);
  }
}

// ─────────────────────────────────────────
// 프로젝트 생성 + hook 주입
// ─────────────────────────────────────────
async function projectInitFlow(
  config: NonNullable<ReturnType<typeof readConfig>>,
  apiUrl: string,
  explicitApiUrl?: string,
): Promise<void> {
  // 사용자의 organizations 조회
  let me;
  try {
    me = await api.me(apiUrl, config.token);
  } catch (err) {
    console.error(chalk.red("Failed to fetch user info:"), formatError(err));
    process.exit(1);
  }

  let orgId: string;
  if (me.organizations.length === 0) {
    console.error(chalk.red("No organizations found for your account."));
    console.error(
      "  This shouldn't happen — please re-register or contact support.",
    );
    process.exit(1);
  } else if (me.organizations.length === 1) {
    orgId = me.organizations[0]!.id;
    console.log(
      chalk.dim("Using organization:"),
      chalk.bold(me.organizations[0]!.name),
    );
  } else {
    orgId = await select({
      message: "Select an organization:",
      choices: me.organizations.map((o) => ({
        name: `${o.name} (${o.role.toLowerCase()})`,
        value: o.id,
      })),
    });
  }

  const dirName = basename(process.cwd());
  const projectName = await input({
    message: "Project name:",
    default: dirName,
  });
  const projectSlug = await input({
    message: "Project slug:",
    default: dirName.toLowerCase().replace(/[^a-z0-9-]+/g, "-"),
    validate: (v) =>
      /^[a-z0-9][a-z0-9-]*$/.test(v) ||
      "Slug must be lowercase alphanumeric with hyphens",
  });

  const spinner = ora("Creating project...").start();
  let project;
  try {
    project = await api.createProject(apiUrl, config.token, {
      orgId,
      name: projectName,
      slug: projectSlug,
    });
    spinner.succeed(`Project created: ${chalk.bold(project.name)}`);
  } catch (err) {
    spinner.fail(formatError(err, "Failed to create project"));
    process.exit(1);
  }

  // .mytool/project.json 작성
  const projectJsonPath = writeProjectConfig(process.cwd(), {
    projectId: project.id,
    orgId,
    ...(explicitApiUrl ? { apiUrl: explicitApiUrl } : {}),
  });
  console.log(chalk.dim("Wrote"), projectJsonPath);

  // .claude/settings.json hook 주입
  try {
    const result = injectHooks(process.cwd());
    if (result.result === "already_present") {
      console.log(chalk.dim("Hooks already installed in"), result.settingsPath);
    } else {
      console.log(
        chalk.green("✓"),
        `Installed hooks in ${result.settingsPath} (${result.addedEvents.length} events)`,
      );
    }
  } catch (err) {
    console.error(chalk.red("Hook injection failed:"), formatError(err));
    console.error(
      chalk.yellow("  You can manually add the hooks later by re-running mytool."),
    );
    // 치명적이지 않으니 계속 진행
  }

  console.log();
  console.log(chalk.green.bold("✓ Setup complete!"));
  console.log();
  console.log("Next steps:");
  console.log(`  1. ${chalk.bold("git add")} .mytool/project.json .claude/settings.json`);
  console.log(`  2. ${chalk.bold("git commit -m")} "chore: add mytool tracking"`);
  console.log(`  3. Use Claude Code as usual — events will be tracked automatically.`);
}

// ─────────────────────────────────────────
// 상태 출력
// ─────────────────────────────────────────
async function printStatus(
  config: NonNullable<ReturnType<typeof readConfig>>,
  projectRoot: string,
  apiUrl: string,
): Promise<void> {
  const profile = getActiveProfile();
  console.log(chalk.bold("Status"));
  console.log("  Profile:     ", chalk.cyan(profile));
  console.log("  User:        ", chalk.cyan(config.user.email));
  console.log("  Project root:", chalk.cyan(projectRoot));
  console.log("  API:         ", chalk.cyan(apiUrl));
  console.log();
  console.log(chalk.dim("Use") + " mytool status " + chalk.dim("for detailed status."));
}

function formatError(err: unknown, fallback?: string): string {
  if (err instanceof ApiClientError) {
    return `${err.message} (${err.code})`;
  }
  if (err instanceof Error) return err.message;
  return fallback ?? "Unknown error";
}
