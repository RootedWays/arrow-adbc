import { describe, it, expect } from 'vitest';
import { createStringSafeSchema, createStringSafeArray } from '../helpers';
import { importVector } from '../../src/import';

describe('Binary/String Types Integration', () => {

  it('should import a String Array ["foo", "bar", "baz"] as an Arrow Vector', () => {
    const schema = createStringSafeSchema();
    const array = createStringSafeArray();

    const vector = importVector(schema.ptr, array.ptr);

    expect(vector.length).toBe(3);
    expect(vector.get(0)).toBe('foo');
    expect(vector.get(1)).toBe('bar');
    expect(vector.get(2)).toBe('baz');
    expect(vector.nullCount).toBe(0);
  });

});
