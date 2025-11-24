import { Vector, RecordBatch, Struct, Schema, Data } from 'apache-arrow';
import { ArrowSchemaHandle } from './schema';
import { ArrowArrayHandle } from './array';
import { ArrowBufferExtractor } from './extractor';
import { ArrowVectorBuilder } from './builder';
import { ArrowCStreamReader } from './reader';
import { importSchema } from './schema-adapter';
import { kArrowCDataHandles } from './symbols';

/**
 * Internal helper to import a vector from safe wrappers.
 */
export function importVectorFromSafe(
    schema: ArrowSchemaHandle, 
    array: ArrowArrayHandle
): Vector {
    const extractor = new ArrowBufferExtractor();
    const builder = new ArrowVectorBuilder();

    const info = extractor.extract(schema, array);
    const vector = builder.build(info);

    // Attach handles to prevent GC while the Vector is in use
    (vector as any)[kArrowCDataHandles] = [schema, array];

    return vector;
}

/**
 * Imports a C Data Interface Array as an Apache Arrow JS Vector.
 * This performs a Zero-Copy import.
 * 
 * @param schemaPtr Pointer to the ArrowSchema C struct.
 * @param arrayPtr Pointer to the ArrowArray C struct.
 */
export function importVector(schemaPtr: bigint, arrayPtr: bigint): Vector {
    const schema = new ArrowSchemaHandle(schemaPtr);
    const array = new ArrowArrayHandle(arrayPtr);
    return importVectorFromSafe(schema, array);
}

/**
 * Imports a C Data Interface Array as an Apache Arrow JS RecordBatch.
 * Best suited for Struct arrays representing a table row-set.
 * 
 * @param schemaPtr Pointer to the ArrowSchema C struct.
 * @param arrayPtr Pointer to the ArrowArray C struct.
 */
export function importRecordBatch(schemaPtr: bigint, arrayPtr: bigint): RecordBatch {
    const schema = new ArrowSchemaHandle(schemaPtr);
    const array = new ArrowArrayHandle(arrayPtr);
    
    const vector = importVectorFromSafe(schema, array);
    const arrowSchema = importSchema(schema);

    let batch: RecordBatch;
    if (vector.type instanceof Struct) {
        batch = new RecordBatch(arrowSchema, vector.data[0]);
    } else {
        // Primitive array - treat as single column batch
        // We need to wrap the primitive data in a Struct Data to create a RecordBatch
        const childData = vector.data[0];
        const structData = new Data(new Struct(arrowSchema.fields), 0, vector.length, 0, [null]);
        (structData as any).children = [childData];
        batch = new RecordBatch(arrowSchema, structData);
    }

    // Attach handles to prevent GC while the RecordBatch is in use
    (batch as any)[kArrowCDataHandles] = [schema, array];
    
    return batch;
}

/**
 * Imports a C Data Interface Stream as an Apache Arrow JS RecordBatchReader.
 * 
 * @param streamPtr Pointer to the ArrowArrayStream C struct.
 */
export function importRecordBatchStream(streamPtr: bigint): ArrowCStreamReader {
    return new ArrowCStreamReader(streamPtr);
}