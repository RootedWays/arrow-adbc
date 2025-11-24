import { describe, it, expect, beforeAll } from 'vitest';
import { AdbcDatabase } from '../src/adbc';
import path from 'path';
import fs from 'fs';

const DRIVER_PATH = path.resolve(__dirname, '../../../dist/drivers/lib/libadbc_driver_sqlite.dylib');

if (!fs.existsSync(DRIVER_PATH)) {
  throw new Error(`Required ADBC SQLite driver not found at ${DRIVER_PATH}`);
}

describe('ADBC Node.js Wrapper', () => {
  
  it('should load the driver and create a database', async () => {
    const db = new AdbcDatabase(DRIVER_PATH);
    expect(db).toBeDefined();
    await db.close();
  });

  it('should connect to the database', async () => {
    const db = new AdbcDatabase(DRIVER_PATH);
    const conn = await db.connect();
    expect(conn).toBeDefined();
    await conn.close();
    await db.close();
  });

  it('should execute a simple query', async () => {
    const db = new AdbcDatabase(DRIVER_PATH, 'AdbcDriverInit', {
        'uri': ':memory:'
    });
    const conn = await db.connect();
    const stmt = await conn.createStatement();
    
    await stmt.setSqlQuery('SELECT 1 as num');
    const result = await stmt.executeQuery();
    
    expect(result).toBeDefined();
    expect(result.stream).toBeDefined();
    
    let count = 0;
    for await (const batch of result.stream) {
        count++;
        expect(batch.numRows).toBeGreaterThan(0);
        expect(batch.numCols).toBeGreaterThan(0);
        
        // Check content of SELECT 1
        const col = batch.getChildAt(0);
        expect(col).toBeDefined();
        expect(col?.get(0)).toBe(1n); // Int64 returns BigInt in JS
    }
    expect(count).toBeGreaterThan(0);

    await stmt.close();
    await conn.close();
    await db.close();
  });
});
