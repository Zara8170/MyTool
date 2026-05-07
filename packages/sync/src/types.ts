// PR 2: claude-sync 의 lib 들이 공통으로 다루는 형식. 정확한 동일성 유지를 위해
// 원본의 객체 구조를 그대로 옮긴다 (필드명·optional 여부 모두 보존).
//
// PR 3 에서 @mytool/shared 로 옮길 가능성 있음. 그때 zod 스키마로 강화.

export type ItemScope = "global" | "project";

export type GlobalItemType =
  | "global:skill"
  | "global:agent"
  | "global:command"
  | "global:settings"
  | "global:claude-md";

export type ProjectItemType =
  | "project:skill"
  | "project:agent"
  | "project:command"
  | "project:hookify"
  | "project:settings"
  | "project:settings-local"
  | "project:claude-md"
  | "project:agents-md"
  | "project:claude-doc"
  | "project:mcp";

export type ItemType = GlobalItemType | ProjectItemType;

export interface SyncItem {
  type: ItemType;
  name: string;
  scope: ItemScope;
  absPath: string;
  relPath: string;
  size: number;
  // project scope 에서만 채워짐
  project?: string;
  projectRoot?: string;
}

export interface SyncManifestItem {
  type: ItemType;
  scope: ItemScope;
  name: string;
  project: string | null;
  sourceProjectRoot: string | null;
  sourceAbsPath: string;
  relPath: string;
  size: number;
}

export interface SyncManifest {
  version: number;
  createdAt: string;
  sourceHost?: string;
  sourcePlatform?: string;
  masked?: boolean;
  items: SyncManifestItem[];
}

export interface ScanAllOptions {
  globalRoot?: string;
  projectRoots?: string[];
  autoDiscover?: boolean;
}

export interface BundleWriteOptions {
  outputPath: string;
  items: SyncItem[];
  manifest: SyncManifest;
  /**
   * 파일 컨텐츠를 가공할 훅. mask 통과 시 사용. null/undefined 반환하면 원본 유지.
   * Buffer 또는 string 반환 시 그것으로 대체.
   */
  transformContent?: ((item: SyncItem, buf: Buffer) => Buffer | string | null | undefined) | null;
}

export interface BundleMeta {
  kind: "dir" | "zip";
  manifest: SyncManifest;
  source: string;
}

export interface ExtractMapping {
  bundlePath: string;
  targetPath: string;
}

export interface ExtractOptions {
  source: string;
  mappings: ExtractMapping[];
}

export interface ItemTargetContext {
  globalRoot?: string;
  projectRoot?: string;
}
