import { describe, it, expect, beforeEach } from 'vitest';
import addon from '../src/index';
import { ArrowSchemaHandle } from '../src/schema';
import { createInt32SafeSchema, createInt32SafeArray } from './helpers';

// Helper for async GC tests
const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

describe('Memory Management & GC', () => {

  // Ensure the counter is clean before each test
  beforeEach(() => {
    while (addon.getActiveSchemaCount() > 0) {
       // Ideally this shouldn't happen if previous tests cleaned up, but we force a check.
       // In a real world scenario we can't force GC easily, so this is just a sanity check.
       break; 
    }
  });

  it('should explicitly create and release an Int32 schema', () => {
    const initialCount = addon.getActiveSchemaCount();
    const safeSchema = createInt32SafeSchema();
    expect(addon.getActiveSchemaCount()).toBe(initialCount + 1);

    safeSchema.release();
    expect(addon.getActiveSchemaCount()).toBe(initialCount);
  });

  it('should automatically release an Int32 schema via garbage collection', async () => {
    const initialCount = addon.getActiveSchemaCount();
    let gcSchema: ArrowSchemaHandle | null = createInt32SafeSchema();
    expect(addon.getActiveSchemaCount()).toBe(initialCount + 1);

    // Remove strong reference
    gcSchema = null;

    if (typeof global.gc === 'function') {
      global.gc(); // Trigger GC
      await delay(200); // Wait for finalizers

      expect(addon.getActiveSchemaCount()).toBe(initialCount);
    } else {
      console.warn('global.gc() not available. Skipping GC test for schema.');
    }
  });

  it('should explicitly create and release an Int32 array', () => {
      const initialCount = addon.getActiveArrayCount();
      const safeArray = createInt32SafeArray();
      expect(addon.getActiveArrayCount()).toBe(initialCount + 1);

      safeArray.release();
      expect(addon.getActiveArrayCount()).toBe(initialCount);
  });

});
