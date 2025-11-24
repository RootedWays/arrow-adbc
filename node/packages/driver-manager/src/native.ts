import path from 'path';

// Dynamically load the native addon built by cmake-js
const nativePath = path.resolve(__dirname, '..', 'build', 'Release', 'arrow_node_native.node');
// eslint-disable-next-line @typescript-eslint/no-var-requires
export const native = require(nativePath);

// Define TypeScript interfaces for the native addon's exports
// The C++ classes are exposed under these names.
export interface NativeAdbcDatabase {
  new (driverPath: string, entrypoint?: string, options?: Record<string, string>): NativeAdbcDatabase;
  // Methods of the native database class, if needed directly
  connect(): NativeAdbcConnection;
}

export interface NativeAdbcConnection {
  new (database: NativeAdbcDatabase): NativeAdbcConnection;
  createStatement(): NativeAdbcStatement;
}

export interface NativeAdbcStatement {
  new (connection: NativeAdbcConnection): NativeAdbcStatement;
  setSqlQuery(query: string): void;
  executeQuery(): { schema: bigint, stream: NativeAdbcStream, rowsAffected: bigint };
}

export interface NativeAdbcStream {
  readNext(): bigint | null;
  getPointer(): bigint | null;
  release(): void;
}
