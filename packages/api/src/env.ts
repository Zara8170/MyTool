import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z
    .string()
    .min(32, "JWT_SECRET must be at least 32 characters"),
  WEB_URL: z.string().url().default("http://localhost:18100"),
  PORT: z.coerce.number().int().positive().default(18101),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  // ──── PR 3 — Sync bundle storage (integration-plan §6.1, §10a) ────
  /** local = 디스크에 저장 (셀프호스팅 기본). supabase = Supabase Storage (SaaS). */
  MYTOOL_STORAGE_BACKEND: z.enum(["local", "supabase"]).default("local"),
  /** local 백엔드의 저장 루트. 미설정 시 ~/.mytool/bundles 또는 /tmp/mytool-bundles. */
  MYTOOL_STORAGE_LOCAL_DIR: z.string().optional(),
  /** Supabase Storage bucket 이름 (supabase 백엔드 전용). */
  MYTOOL_STORAGE_SUPABASE_BUCKET: z.string().optional(),
  /** Supabase project URL (예: https://xxx.supabase.co). supabase 백엔드 전용. */
  SUPABASE_URL: z.string().url().optional(),
  /** Supabase service-role key. signed URL 발급에 필요. supabase 백엔드 전용. */
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

let cachedEnv: Env | null = null;

export function getEnv(): Env {
  if (cachedEnv) return cachedEnv;
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    console.error("❌ Invalid environment variables:");
    console.error(result.error.flatten().fieldErrors);
    process.exit(1);
  }
  cachedEnv = result.data;
  return cachedEnv;
}
