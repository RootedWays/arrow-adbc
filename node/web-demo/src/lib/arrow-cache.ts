import { createStore } from 'zustand/vanilla';
import { Table, RecordBatch } from 'apache-arrow';

// CONFIGURATION
const FLUSH_THRESHOLD_ROWS = 65000; // Optimal size for DuckDB/Vectorization

interface CacheEntry {
  id: string;
  // The optimized, consolidated table (Good for DuckDB ingestion)
  committedTable: Table;
  // The incoming buffer (Good for "live" tail updates)
  stagingBatches: RecordBatch[];
  // Metadata for quick lookups without calculating on the fly
  totalRows: number;
  lastUpdated: number;
}

interface CacheState {
  entries: Map<string, CacheEntry>;

  // Actions
  initTable: (id: string, schemaBatch: RecordBatch) => void;
  streamBatch: (id: string, batch: RecordBatch) => void;
  forceFlush: (id: string) => void;
  getView: (id: string) => Table | null;
  getEntry: (id: string) => CacheEntry | undefined;
}

export const arrowCache = createStore<CacheState>((set, get) => ({
  entries: new Map(),

  initTable: (id, initialBatch) => {
    set((state) => {
      const nextMap = new Map(state.entries);
      // Initialize with the first batch committed immediately so we have a base Table
      nextMap.set(id, {
        id,
        committedTable: new Table(initialBatch),
        stagingBatches: [],
        totalRows: initialBatch.numRows,
        lastUpdated: Date.now(),
      });
      return { entries: nextMap };
    });
  },

  streamBatch: (id, batch) => {
    set((state) => {
      console.time(`streamBatch total for ${id}`);

      const entry = state.entries.get(id);

      const nextMap = new Map(state.entries);

      // Auto-initialize if it doesn't exist
      if (!entry) {
        nextMap.set(id, {
          id,
          committedTable: new Table(batch),
          stagingBatches: [],
          totalRows: batch.numRows,
          lastUpdated: Date.now(),
        });
        console.timeEnd(`streamBatch total for ${id}`);
        return { entries: nextMap };
      }

      const newStaging = [...entry.stagingBatches, batch];

      console.time(`streamBatch stagingRowCount for ${id}`);
      // Calculate total pending rows in staging
      const stagingRowCount = newStaging.reduce((acc, b) => acc + b.numRows, 0);
      console.timeEnd(`streamBatch stagingRowCount for ${id}`);

      // DECISION: Buffer or Flush?
      if (stagingRowCount >= FLUSH_THRESHOLD_ROWS) {
        console.time(`streamBatch FLUSH for ${id}`);
        // FLUSH: Merge batches into a new Table structure efficiently
        // We access the underlying batches of the committed table
        const allBatches = [...entry.committedTable.batches, ...newStaging];
        const newCommitted = new Table(allBatches);

        nextMap.set(id, {
          ...entry,
          committedTable: newCommitted,
          stagingBatches: [], // Clear buffer
          totalRows: newCommitted.numRows,
          lastUpdated: Date.now()
        });
        console.timeEnd(`streamBatch FLUSH for ${id}`);
      } else {
        console.time(`streamBatch BUFFER for ${id}`);
        // BUFFER: Just add to staging array (Very cheap)
        nextMap.set(id, {
          ...entry,
          stagingBatches: newStaging,
          totalRows: entry.committedTable.numRows + stagingRowCount,
          lastUpdated: Date.now()
        });
        console.timeEnd(`streamBatch BUFFER for ${id}`);
      }

      console.timeEnd(`streamBatch total for ${id}`);
      return { entries: nextMap };
    });
  },

  forceFlush: (id) => {
    set((state) => {
      const entry = state.entries.get(id);
      if (!entry || entry.stagingBatches.length === 0) return state;

      const nextMap = new Map(state.entries);
      const allBatches = [...entry.committedTable.batches, ...entry.stagingBatches];
      const newCommitted = new Table(allBatches);

      nextMap.set(id, {
        ...entry,
        committedTable: newCommitted,
        stagingBatches: [],
        totalRows: newCommitted.numRows,
        lastUpdated: Date.now()
      });
      return { entries: nextMap };
    });
  },

  getView: (id) => {
    const entry = get().entries.get(id);
    if (!entry) return null;
    // Return a lightweight view over all data (committed + staging)
    return new Table([...entry.committedTable.batches, ...entry.stagingBatches]);
  },

  getEntry: (id) => get().entries.get(id)
}));
