import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    execArgv: ['--expose-gc'],
  },
});
