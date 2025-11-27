import { defineConfig } from '@kubb/core'
import { pluginOas } from '@kubb/swagger'
import { pluginTs } from '@kubb/swagger-ts'
import { pluginZod } from '@kubb/plugin-zod'

export default defineConfig({
  root: '.',
  input: {
    path: './openapi.yaml',
  },
  output: {
    path: './src/api',
    clean: true,
  },
  plugins: [
    pluginOas({
      output: {
        path: 'operations.json',
      },
    }),
    pluginTs({
      output: {
        path: 'types.ts',
      },
    }),
    pluginZod({
      output: {
        path: 'zod.ts',
      },
    }),
  ],
})
