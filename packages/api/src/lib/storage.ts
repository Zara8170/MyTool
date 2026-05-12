// PR 3 — Sync bundle storage 추상화 (integration-plan §6.1, §10a).
//
// `BundleStorage` 는 sync_snapshots.bundleStorageKey 에 저장되는 zip bundle 의
// put/get/delete 를 담당. 셀프호스팅(=local 디스크) 과 SaaS(=Supabase Storage)
// 양쪽을 동일한 인터페이스로 다룬다.
//
// 환경변수:
//   MYTOOL_STORAGE_BACKEND          local | supabase   (기본 local)
//   MYTOOL_STORAGE_LOCAL_DIR        local 의 root path (미설정 시 ~/.mytool/bundles)
//   MYTOOL_STORAGE_SUPABASE_BUCKET  supabase bucket 이름
//   SUPABASE_URL                    supabase project url
//   SUPABASE_SERVICE_ROLE_KEY       signed URL 발급용
//
// signed URL 만료: 5 분 (integration-plan §6.1).

import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { getEnv } from "../env.js";

const SIGNED_URL_TTL_SECONDS = 5 * 60;

export interface BundleStorage {
  /**
   * Bundle zip 을 저장. `key` 는 storage 가 생성·반환한다 (snapshotId 가 적합).
   * 멱등성 보장: 같은 key 로 다시 put 하면 덮어쓴다.
   */
  put(key: string, body: Buffer | NodeJS.ReadableStream): Promise<void>;

  /**
   * cli 가 다운로드할 때 쓸 짧은 만료 URL.
   *
   * - local 백엔드: api 가 직접 stream 응답하는 라우트 URL 을 반환 (`/api/sync/snapshots/:id/bundle?download_token=...`).
   *   local 모드에서도 인증은 일반 라우트 미들웨어가 담당하므로 사실상 redirect 라기보다는
   *   "signed URL 흉내" — `null` 반환이라면 라우트가 직접 stream 하라는 의미로도 사용한다.
   * - supabase 백엔드: Supabase Storage 의 createSignedUrl 결과.
   */
  getSignedUrl(key: string): Promise<string | null>;

  /**
   * 저장된 bundle 을 읽는다. local 백엔드 라우트가 직접 stream 응답할 때 사용.
   * supabase 백엔드는 보통 redirect 로 처리하므로 read 가 호출되지 않을 수도 있다.
   */
  read(key: string): Promise<NodeJS.ReadableStream>;

  /** snapshot 삭제 시 cascade 로 호출. 실패해도 throw 하지 않음 (best-effort). */
  delete(key: string): Promise<void>;

  /** 백엔드 식별 — 디버그·메트릭 용도. */
  readonly kind: "local" | "supabase";
}

// ──────────────────────────────────────────────────────────────
// Local fs 백엔드
// ──────────────────────────────────────────────────────────────

class LocalBundleStorage implements BundleStorage {
  readonly kind = "local" as const;
  constructor(private readonly root: string) {
    if (!existsSync(root)) mkdirSync(root, { recursive: true });
  }

  private resolveKey(key: string): string {
    // path traversal 방지 — key 는 우리가 발급한 cuid 만 들어와야 한다.
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
    // local 백엔드는 라우트가 직접 stream 응답한다. null 을 반환하면 호출자 측에서 직접 read.
    return null;
  }

  async read(key: string): Promise<NodeJS.ReadableStream> {
    const target = this.resolveKey(key);
    if (!existsSync(target)) {
      throw new Error(`bundle not found: ${key}`);
    }
    return createReadStream(target);
  }

  async delete(key: string): Promise<void> {
    try {
      unlinkSync(this.resolveKey(key));
    } catch {
      // best-effort
    }
  }
}

// ──────────────────────────────────────────────────────────────
// Supabase 백엔드
// ──────────────────────────────────────────────────────────────
//
// 의존을 가볍게 가져가기 위해 Supabase Storage REST API 를 직접 호출.
// Service-role key 로 인증하므로 서버에서만 사용해야 한다.

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
      body: buf,
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
      throw new Error(
        `Supabase signed url failed: ${res.status} ${await res.text()}`,
      );
    }
    const json = (await res.json()) as { signedURL?: string; signedUrl?: string };
    const signed = json.signedURL ?? json.signedUrl;
    if (!signed) return null;
    // signedURL 은 보통 "/object/sign/..." 형태. baseUrl 과 합쳐서 절대 URL 로 만든다.
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
      // best-effort
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

// ──────────────────────────────────────────────────────────────
// Singleton (env 기반 선택)
// ──────────────────────────────────────────────────────────────

let cached: BundleStorage | null = null;

export function getBundleStorage(): BundleStorage {
  if (cached) return cached;
  const env = getEnv();

  if (env.MYTOOL_STORAGE_BACKEND === "supabase") {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.MYTOOL_STORAGE_SUPABASE_BUCKET) {
      throw new Error(
        "MYTOOL_STORAGE_BACKEND=supabase requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MYTOOL_STORAGE_SUPABASE_BUCKET",
      );
    }
    cached = new SupabaseBundleStorage(
      env.SUPABASE_URL.replace(/\/$/, ""),
      env.SUPABASE_SERVICE_ROLE_KEY,
      env.MYTOOL_STORAGE_SUPABASE_BUCKET,
    );
    return cached;
  }

  const root = env.MYTOOL_STORAGE_LOCAL_DIR ?? join(homedir(), ".mytool", "bundles");
  cached = new LocalBundleStorage(root);
  return cached;
}

/** 테스트·환경 전환용. */
export function _resetBundleStorageForTests(): void {
  cached = null;
}
