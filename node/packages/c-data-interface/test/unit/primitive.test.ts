import { describe, it, expect } from 'vitest';
import { createInt32SafeSchema, createInt32SafeArray, createInt64SafeSchema, createInt64SafeArray, createFloat64SafeSchema, createFloat64SafeArray } from '../helpers';
import { importVector } from '../../src/import';

describe('Primitive Types Integration', () => {

  it('should import an Int32 Array [1, 2, 3] as an Arrow Vector', () => {
    const schema = createInt32SafeSchema();
    const array = createInt32SafeArray();

    const vector = importVector(schema.ptr, array.ptr);

    expect(vector.length).toBe(3);
    expect(vector.get(0)).toBe(1);
    expect(vector.get(1)).toBe(2);
    expect(vector.get(2)).toBe(3);
    expect(vector.nullCount).toBe(0);
  });

  it('should import an Int64 Array [10000000000n, 20000000000n, 30000000000n] as an Arrow Vector', () => {
    const schema = createInt64SafeSchema();
    const array = createInt64SafeArray();

    const vector = importVector(schema.ptr, array.ptr);

    expect(vector.length).toBe(3);
    expect(vector.get(0)).toBe(10000000000n);
    expect(vector.get(1)).toBe(20000000000n);
    expect(vector.get(2)).toBe(30000000000n);
    expect(vector.nullCount).toBe(0);
  });

  it('should import a Float64 Array [1.1, 2.2, 3.3] as an Arrow Vector', () => {
    const schema = createFloat64SafeSchema();
    const array = createFloat64SafeArray();

    const vector = importVector(schema.ptr, array.ptr);

    expect(vector.length).toBe(3);
    expect(vector.get(0)).toBe(1.1);
    expect(vector.get(1)).toBe(2.2);
    expect(vector.get(2)).toBe(3.3);
    expect(vector.nullCount).toBe(0);
  });

});
