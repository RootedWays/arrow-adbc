import { create } from 'zustand'
import { AdbcDatabase } from 'adbc-node-wasm'
import type { AdbcConnection, ConnectOptions } from 'adbc-shared'
import { Table, Schema, RecordBatch } from 'apache-arrow'
import { arrowCache } from './arrow-cache'

export interface ActiveConnection {
  connection: AdbcConnection
  token: string
  dbId: string
}

interface AppState {
  // Registry of active connections
  connections: Record<string, ActiveConnection>

  // Selected database in Query view
  activeDbId: string | null

  // Query State
  queryResults: Table | null
  querySchema: Schema | null
  isQueryRunning: boolean
  queryError: string | null

  // Actions
  setActiveDbId: (id: string | null) => void

  // Connect to a database
  establishConnection: (dbId: string, options: ConnectOptions) => Promise<ActiveConnection>

  // Disconnect
  closeConnection: (dbId: string) => Promise<void>

  // Run Query
  runQuery: (dbId: string, sql: string) => Promise<void>

  // Selector helper
  getConnection: (dbId: string | null) => ActiveConnection | undefined
}

export const useAppStore = create<AppState>((set, get) => ({
  connections: {},
  activeDbId: null,
  queryResults: null,
  querySchema: null,
  isQueryRunning: false,
  queryError: null,

  setActiveDbId: (id) => set({ activeDbId: id }),

  getConnection: (dbId) => {
    if (!dbId) return undefined
    return get().connections[dbId]
  },

  runQuery: async (dbId, sql) => {
    const conn = get().connections[dbId]
    if (!conn) {
      set({ queryError: "No active connection" })
      return
    }

    set({
      isQueryRunning: true,
      queryError: null,
      queryResults: null,
      querySchema: null
    })

    let statement;
    try {
      statement = await conn.connection.createStatement()
      await statement.setSqlQuery(sql)
      const reader = await statement.executeQuery()

      if (reader.schema) {
        set({ querySchema: reader.schema })
      }

      let lastUpdate = 0;
      const UPDATE_INTERVAL_MS = 100; // Throttle UI updates to 10fps

      let isFirstBatch = true;

      for await (const batch of reader) {
        console.log(`RECEIVED BATCH of ${batch.numRows}`)
        if (isFirstBatch) {
          arrowCache.getState().initTable(dbId, batch);
          isFirstBatch = false;
        } else {
          arrowCache.getState().streamBatch(dbId, batch);
        }

        const now = Date.now();
        if (now - lastUpdate > UPDATE_INTERVAL_MS) {
          console.time("store.ts: getView");
          const viewTable = arrowCache.getState().getView(dbId);
          console.timeEnd("store.ts: getView");

          if (viewTable) {
            console.time("store.ts: set state");
            set({
              queryResults: viewTable,
              querySchema: batch.schema
            });
            console.timeEnd("store.ts: set state");
          }
          lastUpdate = now;
        }
      }

      // Final update
      console.time("store.ts: final update");
      const viewTable = arrowCache.getState().getView(dbId);
      if (viewTable) {
        set({
          queryResults: viewTable,
          // schema might need fallback if reader was empty, but here we assume at least one batch or schema read
        });
      }
      console.timeEnd("store.ts: final update");

      console.timeEnd("store.ts: final update");
    } catch (e: any) {
      console.error(e)
      set({ queryError: e.message || "Query Failed" })
    } finally {
      set({ isQueryRunning: false })
      if (statement) await statement.close()
    }
  },

  establishConnection: async (dbId, options) => {
    const existing = get().connections[dbId]
    if (existing) return existing

    const database = new AdbcDatabase(options)
    const connection = await database.connect()

    // Token should be available on the connection object
    const token = connection.token || ""

    const activeConn: ActiveConnection = {
      connection,
      token,
      dbId
    }

    set((state) => ({
      connections: {
        ...state.connections,
        [dbId]: activeConn
      }
    }))

    return activeConn
  },

  closeConnection: async (dbId) => {
    const conn = get().connections[dbId]
    if (conn) {
      await conn.connection.close()
      set((state) => {
        const newConnections = { ...state.connections }
        delete newConnections[dbId]
        return { connections: newConnections }
      })
    }
  }
}))
