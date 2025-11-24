import { Vector, RecordBatch, RecordBatchReader, Schema, Struct, Data } from 'apache-arrow';
import { ArrowArrayStreamHandle } from './stream';
import { importVectorFromSafe } from './import';
import { importSchema } from './schema-adapter';

/**
 * Internal implementation for the ArrowCStreamReader.
 * Mimics the AsyncRecordBatchStreamReaderImpl interface expected by RecordBatchReader.
 */
class ArrowCStreamReaderImpl {
    public schema: Schema;
    private stream: ArrowArrayStreamHandle;

    constructor(stream: ArrowArrayStreamHandle, schema: Schema) {
        this.stream = stream;
        this.schema = schema;
    }

    async next(): Promise<IteratorResult<RecordBatch>> {
        const array = this.stream.getNext();
        if (!array) {
            return { done: true, value: null };
        }

        // The C stream's schema is constant, but we need the safe wrapper for importVector
        // We can get it from the stream (it caches the wrapper)
        const safeSchema = this.stream.getSchema();
        const vector = importVectorFromSafe(safeSchema, array);

        // Convert to RecordBatch
        let batch: RecordBatch;
        if (vector.type instanceof Struct) {
            batch = new RecordBatch(this.schema, vector.data[0]);
        } else {
            const childData = vector.data[0];
            const structData = new Data(new Struct(this.schema.fields), 0, vector.length, 0, [null]);
            (structData as any).children = [childData];
            batch = new RecordBatch(this.schema, structData);
        }

        return { done: false, value: batch };
    }

    async cancel(): Promise<void> {
        this.stream.release();
    }
    
    // Stubs for other potential calls
    async close() { this.stream.release(); }
    async throw() { return { done: true, value: null }; }
    async return() { this.stream.release(); return { done: true, value: null }; }
}

/**
 * A high-level reader for consuming Arrow C Data Interface streams.
 * This class is designed to work with streams produced by ADBC drivers.
 */
export class ArrowCStreamReader extends RecordBatchReader {
    private readonly streamHandle: ArrowArrayStreamHandle;

    constructor(streamPtr: bigint) {
        const stream = new ArrowArrayStreamHandle(streamPtr);
        const schema = importSchema(stream.getSchema());
        
        // Cast to any to satisfy the protected constructor's complex type requirements
        // We only need to satisfy the methods RecordBatchReader actually calls (next, schema, cancel)
        const impl = new ArrowCStreamReaderImpl(stream, schema);
        super(impl as any);
        
        this.streamHandle = stream;
    }

    /**
     * Releases the underlying stream resource.
     */
    public release(): void {
        this.streamHandle.release();
    }
    
    /**
     * Returns the underlying ArrowArrayStreamHandle.
     */
    public get unsafeStream(): ArrowArrayStreamHandle {
        return this.streamHandle;
    }

    public async *[Symbol.asyncIterator]() {
        while (true) {
            const result = await this.next();
            if (result.done) break;
            yield result.value;
        }
    }
}
