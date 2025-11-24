export interface NativeBufferInfo {
    format: string;
    length: number;
    nullCount: number;
    buffers: ArrayBuffer[];
    children?: NativeBufferInfo[];
    fieldName?: string;
}

export interface SchemaInfo {
    typeId: number;
    storageTypeId: number;
    fixedSize?: number;
    decimalBitwidth?: number;
    decimalScale?: number;
    decimalPrecision?: number;
    timeUnit?: number;
    timezone?: string;
    extensionName?: string;
    extensionMetadata?: string;
    unionTypeIds?: string;
}

export enum NanoarrowType {
  UNINITIALIZED = 0,
  NA = 1,
  BOOL = 2,
  UINT8 = 3,
  INT8 = 4,
  UINT16 = 5,
  INT16 = 6,
  UINT32 = 7,
  INT32 = 8,
  UINT64 = 9,
  INT64 = 10,
  HALF_FLOAT = 11,
  FLOAT = 12,
  DOUBLE = 13,
  STRING = 14,
  BINARY = 15,
  FIXED_SIZE_BINARY = 16,
  DATE32 = 17,
  DATE64 = 18,
  TIMESTAMP = 19,
  TIME32 = 20,
  TIME64 = 21,
  INTERVAL_MONTHS = 22,
  INTERVAL_DAY_TIME = 23,
  DECIMAL128 = 24,
  DECIMAL256 = 25,
  LIST = 26,
  STRUCT = 27,
  SPARSE_UNION = 28,
  DENSE_UNION = 29,
  DICTIONARY = 30,
  MAP = 31,
  EXTENSION = 32,
  FIXED_SIZE_LIST = 33,
  DURATION = 34,
  LARGE_STRING = 35,
  LARGE_BINARY = 36,
  LARGE_LIST = 37,
  INTERVAL_MONTH_DAY_NANO = 38,
  RUN_END_ENCODED = 39,
  BINARY_VIEW = 40,
  STRING_VIEW = 41
}
