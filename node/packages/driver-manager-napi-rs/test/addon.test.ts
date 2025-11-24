import { describe, expect, it } from 'vitest';
import { crateVersion, defaultAdbcVersion, defaultLoadFlags, sampleIpcStream } from '../src';
import { RecordBatchStreamReader, Int32 } from 'apache-arrow';

describe('driver-manager-napi-rs addon', () => {
  it('exposes metadata helpers', () => {
    expect(crateVersion()).toMatch(/\d+\.\d+\.\d+/);
    expect(defaultAdbcVersion()).toMatch(/^1\.\d\.\d/);
    expect(typeof defaultLoadFlags()).toBe('number');
  });

  it('emits a readable Arrow IPC stream', async () => {
    const buf = sampleIpcStream();
    const reader = RecordBatchStreamReader.from(buf);
    const batches = [];
    for await (const batch of reader) {
      batches.push(batch);
    }
    expect(batches).toHaveLength(1);
    const batch = batches[0];
    expect(batch.numCols).toBe(1);
    const col = batch.getChildAt(0);
    expect(col?.type.typeId).toBe(new Int32().typeId);
    expect(col?.get(0)).toBe(1);
    expect(col?.get(1)).toBeNull();
    expect(col?.get(2)).toBe(3);
  });
});
