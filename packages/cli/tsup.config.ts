import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: false,
  clean: true,
  noExternal: ["@mytool/shared", "zod"],
  banner: {
    js: "#!/usr/bin/env node",
  },
});
