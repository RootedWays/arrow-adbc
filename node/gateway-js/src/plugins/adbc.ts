import fp from 'fastify-plugin';
import { FastifyPluginAsync } from 'fastify';
import { AdbcDatabase, AdbcConnection } from 'adbc-node';

// Ensure Symbol.asyncDispose is defined globally for the runtime
if (!(Symbol as any).asyncDispose) {
  (Symbol as any).asyncDispose = Symbol('Symbol.asyncDispose');
}

export interface AdbcPluginOptions {
  driverPath: string;
  entrypoint: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    adbc: {
      db: AdbcDatabase;
      withConnection<T>(callback: (conn: AdbcConnection) => Promise<T>): Promise<T>;
    };
  }
}

const adbcPlugin: FastifyPluginAsync<AdbcPluginOptions> = async (fastify, options) => {
  const db = new AdbcDatabase({
    driver: options.driverPath,
    entrypoint: options.entrypoint,
  });

  // Ensure database is closed when server closes
  fastify.addHook('onClose', async () => {
    await db.close();
  });

  fastify.decorate('adbc', {
    db,
    withConnection: async <T>(callback: (conn: AdbcConnection) => Promise<T>): Promise<T> => {
      await using conn = await db.connect();
      return await callback(conn);
    },
  });
};

export default fp(adbcPlugin);