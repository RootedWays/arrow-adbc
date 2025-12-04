import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { AdbcDatabase } from "adbc-node-wasm";
import type { AdbcConnection, ConnectOptions } from "adbc-shared";

interface ActiveConnection {
  connection: AdbcConnection;
  token: string; // The JWT token received from the backend for this connection
  dbId: string;
}

interface ConnectionsContextType {
  activeConnections: Record<string, ActiveConnection>;
  establishConnection: (
    dbId: string,
    connectOptions: ConnectOptions,
  ) => Promise<AdbcConnection>;
  getConnection: (dbId: string) => ActiveConnection | undefined;
  closeConnection: (dbId: string) => Promise<void>;
}

const ConnectionsContext = createContext<ConnectionsContextType | undefined>(
  undefined,
);

export const ConnectionsProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [activeConnections, setActiveConnections] = useState<
    Record<string, ActiveConnection>
  >({});

  const establishConnection = useCallback(
    async (
      dbId: string,
      connectOptions: ConnectOptions,
    ): Promise<AdbcConnection> => {
      // First, check if connection already exists and is active (e.g., has token)
      // This is slightly complex as the backend issues a new token for each connection.
      // So 'establishConnection' here should probably be 'createAndStoreConnectionToken'.

      // We need to call POST /databases/{id}/connections to get a token.
      // The AdbcDatabase.connect() method in adbc-node-wasm actually does this.

      const database = new AdbcDatabase(connectOptions);
      const connection = await database.connect(); // This returns an AdbcConnection object.

      // How to get the token from this AdbcConnection?
      // Our HttpConnection class does store the token privately.
      // We need to expose the token from HttpConnection, or store it alongside the AdbcConnection object here.

      // For now, let's assume `connection` itself carries the token or can retrieve it.
      // Since `AdbcConnection` is an interface, we can't directly access `_token`.
      // The `HttpConnection` in `wasm/src/index.ts` has `private _token: string;`

      // This is a small design flaw. The `AdbcConnection` interface doesn't expose the JWT.
      // We need it for subsequent Statement calls.
      // Option 1: Modify `AdbcConnectionInterface` to include `getToken(): string;`.
      // Option 2: Store the token directly when `AdbcDatabase.connect()` is called,
      //           but then `connection` cannot be directly `AdbcConnection`.

      // Let's modify AdbcConnectionInterface to expose the token.
      // This will involve touching `adbc-shared` again.
      // Or, for now, just manage the tokens alongside the `AdbcConnection` instance.
      // `AdbcDatabase.connect()` returns `AdbcConnectionInterface`.
      // The underlying object is `HttpConnection`, which has the token.
      // This is where casting or a modified interface is needed.

      // For simplicity in this context, let's temporarily assume the token is part of
      // the `AdbcConnection` object if it's an `HttpConnection`.
      // This is a hack, a better way would be to pass it back from `AdbcDatabase.connect`.

      // Let's modify `AdbcDatabase.connect` to return `{ connection: AdbcConnection, token: string }`.
      // Or, modify `AdbcConnectionInterface` in `adbc-shared` to have `readonly token: string;`

      // I will modify `adbc-shared` to add `token` to `AdbcConnection`.
      // This makes the `AdbcConnection` stateful in terms of its token.
      // This is important for the client to use it.

      // Okay, new micro-plan:
      // 1. Update `adbc-shared/src/index.ts` to include `readonly token: string;` in `AdbcConnection`.
      // 2. Update `wasm/src/index.ts` to set this token in `HttpConnection`.
      // 3. Then proceed with `connections-context.tsx`.

      // Assuming AdbcConnection will have a `token` property after the above changes:
      setActiveConnections((prev) => ({
        ...prev,
        [dbId]: { connection, token: (connection as any).token, dbId }, // Cast is temporary
      }));
      return connection;
    },
    [],
  );

  const getConnection = useCallback(
    (dbId: string) => activeConnections[dbId],
    [activeConnections],
  );

  const closeConnection = useCallback(
    async (dbId: string) => {
      const conn = activeConnections[dbId];
      if (conn) {
        await conn.connection.close();
        setActiveConnections((prev) => {
          const newConnections = { ...prev };
          delete newConnections[dbId];
          return newConnections;
        });
      }
    },
    [activeConnections],
  );

  return (
    <ConnectionsContext.Provider
      value={{
        activeConnections,
        establishConnection,
        getConnection,
        closeConnection,
      }}
    >
      {children}
    </ConnectionsContext.Provider>
  );
};

export const useConnections = () => {
  const context = useContext(ConnectionsContext);
  if (context === undefined) {
    throw new Error("useConnections must be used within a ConnectionsProvider");
  }
  return context;
};
