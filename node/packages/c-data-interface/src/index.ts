import { SchemaInfo } from './types';

export interface ArrowNodeBinding {
    // Schema
    getSchemaFormat(ptr: bigint): string;
    releaseSchema(ptr: bigint): void;
    getActiveSchemaCount(): number;
    getSchemaChild(ptr: bigint, index: number): bigint | null;
    getSchemaChildrenCount(ptr: bigint): number;
    getSchemaName(ptr: bigint): string | null;
    getSchemaFlags(ptr: bigint): bigint;
    getSchemaInfo(ptr: bigint): SchemaInfo;
    // Array
    getArrayBuffer(schemaPtr: bigint, arrayPtr: bigint, index: number): ArrayBuffer;
    getArrayLength(schemaPtr: bigint, arrayPtr: bigint): number;
    getArrayNullCount(schemaPtr: bigint, arrayPtr: bigint): number;
    getArrayChild(ptr: bigint, index: number): bigint | null;
    releaseArray(ptr: bigint): void;
    getActiveArrayCount(): number;
    // Stream
    allocateStream(): bigint;
    releaseStream(ptr: bigint): void;
    getActiveStreamCount(): number;
    getStreamSchema(ptr: bigint): bigint;
    getStreamNext(ptr: bigint): bigint | null;
}

const bindings = require('bindings');
const binding = bindings('node_arrow_c_data') as ArrowNodeBinding;

export * from './schema';
export * from './array';
export * from './stream';
export * from './reader';
export * from './schema-adapter';
export * from './import';
export default binding;
