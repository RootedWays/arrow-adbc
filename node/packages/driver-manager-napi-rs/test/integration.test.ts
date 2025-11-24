import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { connect } from '../src';

describe('Sqlite via ADBC driver manager', () => {
  it('executes a simple query', async () => {
    const driverLibDir = path.resolve(__dirname, '..', '..', '..', 'dist', 'drivers', 'lib');
    const driverPath = path.join(driverLibDir, 'libadbc_driver_sqlite.dylib');

    const client = await connect({
      driver: driverPath,
      databaseOptions: { uri: ':memory:' },
    });

    const stream = await client.query(`
      WITH nums(n) AS (VALUES (1), (2), (3))
      SELECT n AS a, n * 2 AS b FROM nums WHERE n >= 2 ORDER BY n DESC
    `);
    const batches = [];
    for await (const batch of stream) {
      batches.push(batch);
    }

    expect(batches).toHaveLength(1);
    const batch = batches[0];
    expect(batch.numCols).toBe(2);
    const colA = batch.getChildAt(0);
    const colB = batch.getChildAt(1);
    expect(colA?.get(0) === 3 || colA?.get(0) === 3n).toBe(true);
    expect(colB?.get(0) === 6 || colB?.get(0) === 6n).toBe(true);
    expect(colA?.get(1) === 2 || colA?.get(1) === 2n).toBe(true);
    expect(colB?.get(1) === 4 || colB?.get(1) === 4n).toBe(true);

    await client.close();
  }, 10_000);
});
