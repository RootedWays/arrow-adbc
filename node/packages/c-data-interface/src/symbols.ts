/**
 * Symbol used to attach native handles to Apache Arrow JS objects
 * to prevent premature garbage collection of the underlying C memory.
 */
export const kArrowCDataHandles = Symbol('ArrowCDataHandles');
