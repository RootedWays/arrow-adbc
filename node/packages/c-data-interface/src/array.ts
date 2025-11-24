import binding from './index';

// Registry for automatic cleanup of ArrowArrays
const arrayFinalizationRegistry = new FinalizationRegistry<bigint>(
    (arrayPtr) => {
        binding.releaseArray(arrayPtr);
    }
);

/**
 * Represents a managed wrapper for the C ArrowArray struct.
 * When this object is garbage collected, the underlying native
 * ArrowArray resource is automatically released via the FinalizationRegistry.
 */
export class ArrowArrayHandle {
    private readonly arrayPtr: bigint;
    private readonly _parent?: ArrowArrayHandle;

    constructor(arrayPtr: bigint, parent?: ArrowArrayHandle) {
        if (arrayPtr === 0n) {
            throw new Error("Cannot create ArrowArrayHandle from a null pointer.");
        }
        this.arrayPtr = arrayPtr;
        this._parent = parent;

        // Only register for finalization if we own this array (i.e., no parent).
        // If we have a parent, the parent's release callback will handle freeing this array.
        if (!this._parent) {
            arrayFinalizationRegistry.register(this, arrayPtr, this);
        }
    }

    public get ptr(): bigint {
        return this.arrayPtr;
    }

    /**
     * Manually releases the native ArrowArray.
     */
    public release(): void {
        if (!this._parent) {
            arrayFinalizationRegistry.unregister(this);
            binding.releaseArray(this.arrayPtr);
        }
    }
}
