// PR 3 — Sync bundle storage (web/Vercel 측 구현).
// packages/api/src/lib/storage.ts 와 동일 인터페이스. Next.js / Vercel 환경에서 사용.
//
// 환경변수:
//   MYTOOL_STORAGE_BACKEND          local | supabase   (기본 local)
//   MYTOOL_STORAGE_LOCAL_DIR        local 의 root path (Vercel 에서는 /tmp 권장)
//   MYTOOL_STORAGE_SUPABASE_BUCKET  supabase bucket 이름
//   SUPABASE_URL                    supabase project url
//   SUPABASE_SERVICE_ROLE_KEY       signed URL 발급용

import "server-only";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  unlinkSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const SIGNED_URL_TTL_SECONDS = 5 * 60;

export interface BundleStorage {
  put(key: string, body: Buffer | NodeJS.ReadableStream): Promise<void>;
  getSignedUrl(key: string): Promise<string | null>;
  read(key: string): Promise<NodeJS.ReadableStream>;
  delete(key: string): Promise<void>;
  readonly kind: "local" | "supabase";
}

class LocalBundleStorage implements BundleStorage {
  readonly kind = "local" as const;
  constructor(private readonly root: string) {
    if (!existsSync(root)) mkdirSync(root, { recursive: true });
  }
  private resolveKey(key: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(key)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return resolve(this.root, `${key}.zip`);
  }
  async put(key: string, body: Buffer | NodeJS.ReadableStream): Promise<void> {
    const target = this.resolveKey(key);
    if (!existsSync(dirname(target))) {
      mkdirSync(dirname(target), { recursive: true });
    }
    if (Buffer.isBuffer(body)) {
      await pipeline(Readable.from(body), createWriteStream(target));
    } else {
      await pipeline(body, createWriteStream(target));
    }
  }
  async getSignedUrl(_key: string): Promise<string | null> {
    return null;
  }
  async read(key: string): Promise<NodeJS.ReadableStream> {
    const target = this.resolveKey(key);
    if (!existsSync(target)) throw new Error(`bundle not found: ${key}`);
    return createReadStream(target);
  }
  async delete(key: string): Promise<void> {
    try {
      unlinkSync(this.resolveKey(key));
    } catch {
      /* best-effort */
    }
  }
}

class SupabaseBundleStorage implements BundleStorage {
  readonly kind = "supabase" as const;
  constructor(
    private readonly baseUrl: string,
    private readonly serviceKey: string,
    private readonly bucket: string,
  ) {}
  private objectPath(key: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(key)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return `${key}.zip`;
  }
  async put(key: string, body: Buffer | NodeJS.ReadableStream): Promise<void> {
    const buf = Buffer.isBuffer(body) ? body : await streamToBuffer(body);
    const url = `${this.baseUrl}/storage/v1/object/${encodeURIComponent(this.bucket)}/${this.objectPath(key)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.serviceKey}`,
        "Content-Type": "application/zip",
        "x-upsert": "true",
      },
      // Node fetch 는 Buffer 를 직접 받지만 lib.dom 의 BodyInit 에는 안 맞아 캐스트.
      body: buf as unknown as BodyInit,
    });
    if (!res.ok) {
      throw new Error(`Supabase put failed: ${res.status} ${await res.text()}`);
    }
  }
  async getSignedUrl(key: string): Promise<string | null> {
    const url = `${this.baseUrl}/storage/v1/object/sign/${encodeURIComponent(this.bucket)}/${this.objectPath(key)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expiresIn: SIGNED_URL_TTL_SECONDS }),
    });
    if (!res.ok) {
      throw new Error(`Supabase signed url failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { signedURL?: string; signedUrl?: string };
    const signed = json.signedURL ?? json.signedUrl;
    if (!signed) return null;
    if (signed.startsWith("http")) return signed;
    return `${this.baseUrl}/storage/v1${signed.startsWith("/") ? "" : "/"}${signed}`;
  }
  async read(key: string): Promise<NodeJS.ReadableStream> {
    const url = `${this.baseUrl}/storage/v1/object/${encodeURIComponent(this.bucket)}/${this.objectPath(key)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.serviceKey}` },
    });
    if (!res.ok || !res.body) {
      throw new Error(`Supabase read failed: ${res.status}`);
    }
    return Readable.fromWeb(res.body as never);
  }
  async delete(key: string): Promise<void> {
    const url = `${this.baseUrl}/storage/v1/object/${encodeURIComponent(this.bucket)}/${this.objectPath(key)}`;
    try {
      await fetch(url, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${this.serviceKey}` },
      });
    } catch {
      /* best-effort */
    }
  }
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks);
}

let cached: BundleStorage | null = null;

export function getBundleStorage(): BundleStorage {
  if (cached) return cached;
  const backend = process.env.MYTOOL_STORAGE_BACKEND ?? "local";
  if (backend === "supabase") {
    const baseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const bucket = process.env.MYTOOL_STORAGE_SUPABASE_BUCKET;
    if (!baseUrl || !serviceKey || !bucket) {
      throw new Error(
        "MYTOOL_STORAGE_BACKEND=supabase requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MYTOOL_STORAGE_SUPABASE_BUCKET",
      );
    }
    cached = new SupabaseBundleStorage(baseUrl.replace(/\/$/, ""), serviceKey, bucket);
    return cached;
  }
  // Vercel 의 read-only 파일시스템 환경에서는 /tmp 만 쓸 수 있다.
  // 사용자 PC 에서는 ~/.mytool/bundles 가 자연스럽다.
  const root =
    process.env.MYTOOL_STORAGE_LOCAL_DIR ??
    (process.env.VERCEL ? join(tmpdir(), "mytool-bundles") : join(homedir(), ".mytool", "bundles"));
  cached = new LocalBundleStorage(root);
  return cached;
}
