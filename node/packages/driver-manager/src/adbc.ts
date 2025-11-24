import { native, NativeAdbcDatabase, NativeAdbcConnection, NativeAdbcStatement, NativeAdbcStream } from './native';
import { importRecordBatchStream } from 'node-arrow-c-data';
import * as arrow from 'apache-arrow';

export class AdbcDatabase {
  private nativeDb: NativeAdbcDatabase;

  constructor(driverPath: string, entrypoint?: string, options?: Record<string, string>) {
    this.nativeDb = new native.AdbcDatabase(driverPath, entrypoint, options);
  }

  async connect(): Promise<AdbcConnection> {
    const nativeConn = new native.AdbcConnection(this.nativeDb);
    return new AdbcConnection(nativeConn);
  }

  async close(): Promise<void> {
    // Resource management handled by GC/C++ destructors
  }
}

export class AdbcConnection {
  private nativeConn: NativeAdbcConnection;

  constructor(nativeConn: NativeAdbcConnection) {
    this.nativeConn = nativeConn;
  }

  async createStatement(): Promise<AdbcStatement> {
    const nativeStmt = new native.AdbcStatement(this.nativeConn);
    return new AdbcStatement(nativeStmt);
  }

  async getInfo(): Promise<any> {
    return null;
  }

  async close(): Promise<void> {
  }
}

export class AdbcStatement {
  private nativeStmt: NativeAdbcStatement;

  constructor(nativeStmt: NativeAdbcStatement) {
    this.nativeStmt = nativeStmt;
  }

  async setSqlQuery(query: string): Promise<void> {
    this.nativeStmt.setSqlQuery(query);
  }

  async executeQuery(): Promise<{ schema: bigint, stream: arrow.RecordBatchReader, rowsAffected: bigint }> {
    const result = this.nativeStmt.executeQuery();
    const ptr = result.stream.getPointer();

    if (!ptr) {
      throw new Error("Failed to obtain stream pointer");
    }

    const cStreamReader = importRecordBatchStream(ptr);

    return {
      schema: result.schema,
      stream: cStreamReader,
      rowsAffected: result.rowsAffected,
    };
  }

  async close(): Promise<void> {
  }
}
