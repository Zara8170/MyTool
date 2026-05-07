# @mytool/sync

Claude Code 전역/프로젝트 스킬·설정을 스캔·번들·복원하는 라이브러리 + CLI.

원래 별도 도구 `claude-sync` 로 만들어졌고, mytool 통합 설계 PR 2 에서
이 모노레포로 흡수됐다. mytool web/api 가 라이브러리로 import 해서
사용하고, 사용자는 `mytool-sync` CLI 로 직접 쓸 수도 있다.

## 라이브러리 사용

```ts
import { scanAll } from "@mytool/sync/scanner";
import { writeZip } from "@mytool/sync/bundle";
import { maskBuffer } from "@mytool/sync/mask";

const items = scanAll();
await writeZip({
  outputPath: "./bundle.zip",
  items,
  manifest: { version: 1, items: [], createdAt: new Date().toISOString() },
  transformContent: maskBuffer,
});
```

## CLI

```
pnpm --filter @mytool/sync start scan
pnpm --filter @mytool/sync start export --all -o bundle.zip --mask-secrets
pnpm --filter @mytool/sync start import bundle.zip --dry-run
```

빌드 후 글로벌 사용:

```
pnpm --filter @mytool/sync build
node packages/sync/dist/cli.js scan
```

## 핵심 모듈

| 모듈 | 책임 |
| --- | --- |
| `scanner` | `~/.claude` 와 프로젝트 루트들에서 스킬·설정·hookify 를 자동 발견 |
| `bundle` | 발견된 항목을 zip / 디렉토리 번들로 직렬화 + 역직렬화 |
| `mask` | `.mcp.json` / `settings.json` 의 connection string·token 을 `***` 로 치환 |
| `preset` | 자주 쓰는 항목 조합을 `~/.claude-sync/presets/<name>.json` 으로 저장 |

## 호환성 메모

PR 2 시점에서는 **원본 `claude-sync` v0.1.0 과 결과 동일성** 을 1순위로
한다. SyncItem / Manifest 스키마 변경은 PR 3 (api 라우트) 와 함께
`@mytool/shared` 로 이전될 때 정리한다.
