// 시크릿 마스킹 유틸. .mcp.json / settings.json 안의 흔한 민감 패턴을 ***로 치환.
//
// 보수적으로 동작: JSON 으로 파싱 가능하면 키 이름이 의심스러운 것만 치환,
// 그렇지 않으면 텍스트 정규식 기반으로 치환한다.
//
// PR 2 흡수: 원본 claude-sync 의 src/lib/mask.mjs 와 동일 동작 유지.

import type { SyncItem } from "../types.js";

const SUSPICIOUS_KEYS =
  /^(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|connection[_-]?string)$/i;

interface TextPattern {
  re: RegExp;
  replace: string;
}

const TEXT_PATTERNS: TextPattern[] = [
  // postgres://user:pass@host
  { re: /(postgres(?:ql)?:\/\/[^:\s"]+:)([^@\s"']+)(@)/gi, replace: "$1***$3" },
  { re: /(mysql:\/\/[^:\s"]+:)([^@\s"']+)(@)/gi, replace: "$1***$3" },
  { re: /(mongodb(?:\+srv)?:\/\/[^:\s"]+:)([^@\s"']+)(@)/gi, replace: "$1***$3" },
  { re: /(redis:\/\/[^:\s"]*:)([^@\s"']+)(@)/gi, replace: "$1***$3" },
];

/**
 * 항목별 컨텐츠 마스킹. 변경이 없으면 null 반환 → 호출자는 원본 사용.
 * 원본 시그니처 (item, Buffer) 그대로.
 */
export function maskBuffer(item: SyncItem, buf: Buffer): string | null {
  if (!shouldMask(item)) return null;
  const text = buf.toString("utf8");
  if (item.name.endsWith(".json")) {
    try {
      const obj: unknown = JSON.parse(text);
      const masked = maskJson(obj);
      return JSON.stringify(masked, null, 2);
    } catch {
      /* JSON 깨졌으면 텍스트로 처리 */
    }
  }
  let out = text;
  for (const p of TEXT_PATTERNS) out = out.replace(p.re, p.replace);
  return out === text ? null : out;
}

function shouldMask(item: SyncItem): boolean {
  return (
    item.type === "project:mcp" ||
    item.type === "project:settings" ||
    item.type === "project:settings-local" ||
    item.type === "global:settings"
  );
}

function maskJson(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(maskJson);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (typeof v === "string" && SUSPICIOUS_KEYS.test(k)) {
        out[k] = "***";
      } else {
        out[k] = maskJson(v);
      }
    }
    return out;
  }
  if (typeof node === "string") {
    let masked = node;
    for (const p of TEXT_PATTERNS) masked = masked.replace(p.re, p.replace);
    return masked;
  }
  return node;
}
