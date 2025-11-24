import { describe, it, expect } from 'vitest';
import addon from '../../src/index';
import { createInt32SafeArrayStream } from '../helpers';
import { ArrowCStreamReader } from '../../src/reader';
import { RecordBatch, Vector, RecordBatchReader } from 'apache-arrow';
import { importVector, importRecordBatchStream } from '../../src/import';

describe('ArrowArrayStream Integration', () => {

  it('should consume a stream of Int32 arrays using importVector', async () => {
    const stream = createInt32SafeArrayStream();
    const schema = stream.getSchema();

    expect(schema.format).toBe('i');

    let count = 0;
    for await (const array of stream) {
        const vector = importVector(schema.ptr, array.ptr);
        count++;
        expect(vector.length).toBe(1);
        // The fixture yields [1], [2], [3]
        expect(vector.get(0)).toBe(count);
    }

    expect(count).toBe(3);
    stream.release();
  });

  it('should consume a stream using importRecordBatchStream (ArrowCStreamReader)', async () => {
      // Manually call the fixture directly to get a raw pointer
      const rawStreamPtr = (addon as any).createInt32ArrayStream();
      
      // importRecordBatchStream returns an ArrowCStreamReader instance
      const reader = importRecordBatchStream(rawStreamPtr);
      
      expect(reader).toBeInstanceOf(RecordBatchReader);
      expect(reader).toBeInstanceOf(ArrowCStreamReader);
      
      // Schema should be available immediately
      expect(reader.schema.fields.length).toBe(1);
      
      let count = 0;
      for await (const batch of reader) {
          count++;
          expect(batch).toBeInstanceOf(RecordBatch);
          expect(batch.numCols).toBe(1);
          const vector = batch.getChildAt(0);
          expect(vector!.get(0)).toBe(count);
      }
      
      expect(count).toBe(3);
      reader.release();
  });

  it('should track stream memory', () => {
      const initialCount = addon.getActiveStreamCount();
      const stream = createInt32SafeArrayStream();
      expect(addon.getActiveStreamCount()).toBe(initialCount + 1);
      stream.release();
      expect(addon.getActiveStreamCount()).toBe(initialCount);
  });
});
