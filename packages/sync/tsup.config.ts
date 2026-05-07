import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  dts: false,
  clean: true,
  // Library code is consumed as TS via `exports` field (mirrors @mytool/shared);
  // only the CLI bundle ships in dist/.
  noExternal: ["zod"],
});
