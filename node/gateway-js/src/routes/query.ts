import { FastifyPluginAsync } from 'fastify';
import { Readable } from 'stream';
import { Buffer } from 'buffer';
import { tableFromIPC, Table } from 'apache-arrow';

const queryRoutes: FastifyPluginAsync = async (fastify) => {
  
  // Query
  fastify.post<{ Body: { query?: string } }>('/query', async (request, reply) => {
    const { query } = request.body;
    if (!query) {
      return reply.code(400).send({ error: "Missing 'query' field in body" });
    }

    return fastify.adbc.withConnection(async (conn) => {
      await using statement = await conn.createStatement();
      await statement.setSqlQuery(query);
      const iterator = await statement.executeQueryWithBuffers();
      
      reply.header('Content-Type', 'application/vnd.apache.arrow.stream');
      return reply.send(Readable.from(iterator));
    });
  });

  // Update
  fastify.post<{ Body: { query?: string } }>('/update', async (request, reply) => {
    const { query } = request.body;
    if (!query) {
      return reply.code(400).send({ error: "Missing query" });
    }

    return fastify.adbc.withConnection(async (conn) => {
      await using statement = await conn.createStatement();
      await statement.setSqlQuery(query);
      const rows = await statement.executeUpdate();
      return { rowsAffected: Number(rows) };
    });
  });

  // Bind (Ingestion)
  fastify.post('/bind', async (request, reply) => {
    const query = request.headers['x-adbc-query'] as string;
    if (!query) {
      return reply.code(400).send({ error: "Missing x-adbc-query header" });
    }

    const buffer = request.body as Buffer;
    if (!buffer || !(buffer instanceof Uint8Array)) {
      request.log.error({ body: request.body, type: typeof request.body, isBuffer: Buffer.isBuffer(request.body) }, "Invalid body for bind");
      return reply.code(400).send({ error: "Body must be octet-stream buffer" });
    }

    return fastify.adbc.withConnection(async (conn) => {
      const table = tableFromIPC(buffer);

      await using statement = await conn.createStatement();
      try {
        await statement.bind(table);
      } catch (err) {
        request.log.error({ err }, 'bind failed');
        throw err;
      }

      await statement.setSqlQuery(query);
      const rows = await statement.executeUpdate();
      return { rowsAffected: Number(rows) };
    });
  });
};

export default queryRoutes;
