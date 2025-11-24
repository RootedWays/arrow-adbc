import addon from '../src/index';
import { ArrowArrayHandle } from '../src/array';
import { ArrowSchemaHandle } from '../src/schema';
import { ArrowArrayStreamHandle } from '../src/stream';

// Define fixtures interface locally for tests
interface ArrowNodeAddonFixtures {
    createInt32Schema(): bigint;
    createStringSchema(): bigint;
    createInt64Schema(): bigint;
    createFloat64Schema(): bigint;
    createStructSchema(): bigint;
    createInt32Array(): bigint;
    createStringArray(): bigint;
    createInt64Array(): bigint;
    createFloat64Array(): bigint;
    createStructArray(): bigint;
    createInt32ArrayStream(): bigint;
}

// Cast addon to include fixtures for testing purposes
const testAddon = addon as unknown as ArrowNodeAddonFixtures;

// --- Schema Helpers ---

export function createInt32SafeSchema(): ArrowSchemaHandle {
    const schemaPtr = testAddon.createInt32Schema();
    return new ArrowSchemaHandle(schemaPtr);
}

export function createStringSafeSchema(): ArrowSchemaHandle {
    const schemaPtr = testAddon.createStringSchema();
    return new ArrowSchemaHandle(schemaPtr);
}

export function createInt64SafeSchema(): ArrowSchemaHandle {
    const schemaPtr = testAddon.createInt64Schema();
    return new ArrowSchemaHandle(schemaPtr);
}

export function createFloat64SafeSchema(): ArrowSchemaHandle {
    const schemaPtr = testAddon.createFloat64Schema();
    return new ArrowSchemaHandle(schemaPtr);
}

export function createStructSafeSchema(): ArrowSchemaHandle {
    const schemaPtr = testAddon.createStructSchema();
    return new ArrowSchemaHandle(schemaPtr);
}

// --- Array Helpers ---

export function createInt32SafeArray(): ArrowArrayHandle {
    const ptr = testAddon.createInt32Array();
    return new ArrowArrayHandle(ptr);
}

export function createStringSafeArray(): ArrowArrayHandle {
    const ptr = testAddon.createStringArray();
    return new ArrowArrayHandle(ptr);
}

export function createInt64SafeArray(): ArrowArrayHandle {
    const ptr = testAddon.createInt64Array();
    return new ArrowArrayHandle(ptr);
}

export function createFloat64SafeArray(): ArrowArrayHandle {
    const ptr = testAddon.createFloat64Array();
    return new ArrowArrayHandle(ptr);
}

export function createStructSafeArray(): ArrowArrayHandle {
    const ptr = testAddon.createStructArray();
    return new ArrowArrayHandle(ptr);
}

// --- Stream Helpers ---

export function createInt32SafeArrayStream(): ArrowArrayStreamHandle {
    const ptr = testAddon.createInt32ArrayStream();
    return new ArrowArrayStreamHandle(ptr);
}
