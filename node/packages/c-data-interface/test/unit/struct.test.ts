import { describe, it, expect } from 'vitest';
import { createStructSafeSchema, createStructSafeArray } from '../helpers';
import { importVector, importRecordBatch } from '../../src/import';
import { Struct, RecordBatch } from 'apache-arrow';

describe('Struct Type Integration', () => {

  it('should import a Struct Array as Vector', () => {
    const schema = createStructSafeSchema();
    const array = createStructSafeArray();

    const vector = importVector(schema.ptr, array.ptr);

    expect(vector.length).toBe(2);
    expect(vector.type).toBeInstanceOf(Struct);
    
    const json = vector.toJSON();
    expect(json[0]['id']).toBe(1);
    expect(json[0]['name']).toBe('test1');
  });

  it('should import a Struct Array as RecordBatch', () => {
    const schema = createStructSafeSchema();
    const array = createStructSafeArray();

    const batch = importRecordBatch(schema.ptr, array.ptr);

    expect(batch).toBeInstanceOf(RecordBatch);
    expect(batch.numRows).toBe(2);
    expect(batch.numCols).toBe(2);
    
    const idVector = batch.getChildAt(0);
    expect(idVector?.get(0)).toBe(1);
  });

});
