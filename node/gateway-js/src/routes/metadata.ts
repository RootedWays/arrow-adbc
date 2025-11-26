import { FastifyPluginAsync } from 'fastify';
import { Readable } from 'stream';
import { Buffer } from 'buffer';
import { Table, tableToIPC } from 'apache-arrow';

const metadataRoutes: FastifyPluginAsync = async (fastify) => {
  
  fastify.post('/objects', async (request, reply) => {
    const body = request.body as any; // GetObjectsOptions
    
    return fastify.adbc.withConnection(async (conn) => {
      const iterator = await conn.getObjectsWithBuffers(body);
      reply.header('Content-Type', 'application/vnd.apache.arrow.stream');
      return reply.send(Readable.from(iterator));
    });
  });

  fastify.post<{ Body: { catalog?: string; dbSchema?: string; tableName: string } }>('/table-schema', async (request, reply) => {
    const { catalog, dbSchema, tableName } = request.body;
    if (!tableName) {
      return reply.code(400).send({ error: "Missing tableName" });
    }

    return fastify.adbc.withConnection(async (conn) => {
      const schema = await conn.getTableSchema({ catalog, dbSchema, tableName });
      
      // Create an empty Table with the schema to serialize just the schema message
      // Pass empty array for batches to avoid "Vector constructor" error
      const table = new Table(schema, []);
      const ipcStream = tableToIPC(table, "stream");

      reply.header('Content-Type', 'application/vnd.apache.arrow.stream');
      return reply.send(Buffer.from(ipcStream));
    });
  });

  fastify.post('/table-types', async (request, reply) => {
    return fastify.adbc.withConnection(async (conn) => {
      const iterator = await conn.getTableTypesWithBuffers();
      reply.header('Content-Type', 'application/vnd.apache.arrow.stream');
      return reply.send(Readable.from(iterator));
    });
  });

  fastify.post<{ Body: { infoCodes?: number[] } }>('/info', async (request, reply) => {
    const { infoCodes } = request.body;
    
    return fastify.adbc.withConnection(async (conn) => {
      const iterator = await conn.getInfoWithBuffers(infoCodes);
      reply.header('Content-Type', 'application/vnd.apache.arrow.stream');
      return reply.send(Readable.from(iterator));
    });
  });
};

export default metadataRoutes;
