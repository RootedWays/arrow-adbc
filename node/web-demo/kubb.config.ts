import { defineConfig } from "@kubb/core";
import { pluginOas } from "@kubb/plugin-oas";
import { pluginTs } from "@kubb/plugin-ts";
import { pluginZod } from "@kubb/plugin-zod";

export default defineConfig({
  root: ".",
  input: {
    path: "./openapi.json",
  },
  output: {
    path: "./src/api",
    clean: true,
  },
  plugins: [
    pluginOas({
      output: {
        path: "operations.json",
      },
    }),
    pluginTs({
      output: {
        path: "types.ts",
      },
    }),
    pluginZod({
      output: {
        path: "zod.ts",
      },
    }),
  ],
});
