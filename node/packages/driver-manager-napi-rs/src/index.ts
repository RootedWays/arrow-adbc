/* eslint-disable @typescript-eslint/no-var-requires */
// Thin TypeScript wrapper that loads the built native addon.

import { RecordBatchStreamReader } from 'apache-arrow'

let native: {
  crateVersion: () => string;
  defaultAdbcVersion: () => string;
  defaultLoadFlags: () => number;
  sampleIpcStream: () => Buffer;
  connect: (opts: AdbcConnectOptions) => any;
};

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  native = require('../native/index.node');
} catch (err: any) {
  const hint =
    'driver-manager-napi-rs native addon is not built yet. Run `npm run build:native` in packages/driver-manager-napi-rs to compile the napi module.';
  err.message = `${err.message}\n\n${hint}`;
  throw err;
}

export const crateVersion = (): string => native.crateVersion();
export const defaultAdbcVersion = (): string => native.defaultAdbcVersion();
export const defaultLoadFlags = (): number => native.defaultLoadFlags();
export const sampleIpcStream = (): Buffer => native.sampleIpcStream();

// --- Proposed ADBC client surface (stubbed) ---
export type AdbcConnectOptions = {
  driver: string;
  entrypoint?: string;
  searchPaths?: string[];
  loadFlags?: number;
  databaseOptions?: Record<string, string>;
  connectionOptions?: Record<string, string>;
};

export type AdbcQueryOptions = {
  params?: unknown[];
  statementOptions?: Record<string, string>;
};

export interface AdbcClient {
  query(sql: string, opts?: AdbcQueryOptions): Promise<import('apache-arrow').RecordBatchReader>;
  close(): Promise<void>;
}

export async function connect(_opts: AdbcConnectOptions): Promise<AdbcClient> {
  const handle = native.connect(_opts);

  return {
    query: async (sql: string, _opts?: AdbcQueryOptions) => {
      const buf: Buffer = await handle.query(sql, _opts);
      return RecordBatchStreamReader.from(buf);
    },
    close: () => handle.close(),
  };
}
