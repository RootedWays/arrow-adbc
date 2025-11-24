import binding from './index';
import { ArrowSchemaHandle } from './schema';
import { ArrowArrayHandle } from './array';

const streamFinalizationRegistry = new FinalizationRegistry<bigint>(
    (streamPtr) => {
        binding.releaseStream(streamPtr);
    }
);

export class ArrowArrayStreamHandle implements AsyncIterable<ArrowArrayHandle> {
    private readonly streamPtr: bigint;
    private _schema: ArrowSchemaHandle | null = null;

    constructor(streamPtr: bigint) {
        if (streamPtr === 0n) {
            throw new Error("Cannot create ArrowArrayStreamHandle from a null pointer.");
        }
        this.streamPtr = streamPtr;
        streamFinalizationRegistry.register(this, streamPtr, this);
    }

    public get ptr(): bigint {
        return this.streamPtr;
    }

    public getSchema(): ArrowSchemaHandle {
        if (this._schema) return this._schema;
        
        // Note: getStreamSchema creates a new ArrowSchema copy/move from the stream. 
        // We wrap it in ArrowSchemaHandle to manage its lifecycle.
        const schemaPtr = binding.getStreamSchema(this.streamPtr);
        
        this._schema = new ArrowSchemaHandle(schemaPtr);
        return this._schema;
    }

    public getNext(): ArrowArrayHandle | null {
        const arrayPtr = binding.getStreamNext(this.streamPtr);
        if (!arrayPtr) { // End of stream (or strictly null pointer returned)
            return null;
        }
        return new ArrowArrayHandle(arrayPtr);
    }

    public release(): void {
        streamFinalizationRegistry.unregister(this);
        binding.releaseStream(this.streamPtr);
    }

    public async *[Symbol.asyncIterator](): AsyncIterator<ArrowArrayHandle> {
        while (true) {
            const array = this.getNext();
            if (!array) break;
            yield array;
        }
    }
}

export function createEmptyStream(): ArrowArrayStreamHandle {
    const ptr = binding.allocateStream();
    return new ArrowArrayStreamHandle(ptr);
}
