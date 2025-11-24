import { describe, it, expect, beforeAll } from 'vitest';
import { connect, registerDriver } from '../src/manager';
import path from 'path';
import fs from 'fs';

const DRIVER_PATH = path.resolve(__dirname, '../../../dist/drivers/lib/libadbc_driver_sqlite.dylib');

if (!fs.existsSync(DRIVER_PATH)) {
  throw new Error(`Required ADBC SQLite driver not found at ${DRIVER_PATH}`);
}

describe('ADBC Manager API', () => {

  beforeAll(() => {
    registerDriver('sqlite', DRIVER_PATH);
  });

  it('should connect and execute query returning Arrow Table', async () => {
    const conn = await connect('sqlite', {
      uri: ':memory:',
    });

    const cursor = await conn.cursor();
    await cursor.execute('SELECT 1 as num, "hello" as str');
    const table = await cursor.fetchArrowTable();

    expect(table.numRows).toBe(1);
    const numCol = table.getChild('num');
    const strCol = table.getChild('str');

    expect(strCol).toBeDefined();
    expect(numCol?.get(0)).toBe(1n); // Int64
    expect(strCol?.get(0)).toBe('hello');

    await cursor.close();
    await conn.close();
  });
});
