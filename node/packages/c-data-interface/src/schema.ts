import binding from './index';

// A registry to automatically call binding.releaseSchema when ArrowSchemaHandle objects are garbage collected
const schemaFinalizationRegistry = new FinalizationRegistry<bigint>(
    (schemaPtr) => {
        // console.log(`[FinalizationRegistry] Releasing ArrowSchema at ${schemaPtr}`); // For debugging
        binding.releaseSchema(schemaPtr);
    }
);

/**
 * Represents a managed wrapper for the C ArrowSchema struct.
 * When an instance of this class is garbage collected, the underlying native
 * ArrowSchema resource is automatically released via the FinalizationRegistry.
 */
export class ArrowSchemaHandle {
    // The native pointer to the ArrowSchema struct
    private readonly schemaPtr: bigint;
    // Keep-alive reference to the parent schema (if any)
    // This ensures the parent is not garbage collected while this child is in use.
    private readonly _parent?: ArrowSchemaHandle;

    constructor(schemaPtr: bigint, parent?: ArrowSchemaHandle) {
        if (schemaPtr === 0n) {
            throw new Error("Cannot create ArrowSchemaHandle from a null pointer.");
        }
        this.schemaPtr = schemaPtr;
        this._parent = parent;

        // Only register for finalization if we own this schema (i.e., no parent).
        // If we have a parent, the parent's release callback will handle freeing this schema.
        if (!this._parent) {
            schemaFinalizationRegistry.register(this, schemaPtr, this);
        }
    }

    /**
     * Returns the native pointer to the ArrowSchema.
     * Use with caution, as direct manipulation bypasses safety mechanisms.
     */
    public get ptr(): bigint {
        return this.schemaPtr;
    }

    /**
     * Returns the format string of the native schema.
     */
    public get format(): string {
        return binding.getSchemaFormat(this.schemaPtr);
    }

    /**
     * Manually releases the native ArrowSchema resource.
     * After calling this, the ArrowSchemaHandle instance becomes invalid and should not be used.
     * This is useful for explicit cleanup if memory needs to be freed before GC.
     */
    public release(): void {
        if (!this._parent) {
            // Deregister from finalization registry to prevent double-free
            schemaFinalizationRegistry.unregister(this);
            binding.releaseSchema(this.schemaPtr);
        }
        // If we have a parent, we generally shouldn't manually release a child
        // as the parent manages the lifecycle. But if needed, we'd just let the parent handle it.
    }
}
