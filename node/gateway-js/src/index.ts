// Licensed to the Apache Software Foundation (ASF) under one
// or more contributor license agreements.  See the NOTICE file
// distributed with this work for additional information
// regarding copyright ownership.  The ASF licenses this file
// to you under the Apache License, Version 2.0 (the
// "License"); you may not use this file except in compliance
// with the License.  You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';

import adbcPlugin, { AdbcPluginOptions } from './plugins/adbc.js';
import queryRoutes from './routes/query.js';
import metadataRoutes from './routes/metadata.js';

export { AdbcPluginOptions as GatewayOptions };

export function buildServer(options: AdbcPluginOptions): FastifyInstance {
  const server = Fastify({
    logger: true
  });

  server.register(cors, { origin: true });

  // Register raw body parser for binary uploads (bind)
  server.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, async (req: any, body: Buffer) => {
    console.log('BUFFER')
    console.log(body)
    req.log.info({ bodyLength: body?.length, type: typeof body }, "ContentTypeParser: octet-stream");
    return body;
  });

  // Global Error Handler
  server.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    reply.status(500).send({ error: error.message });
  });

  // Plugins
  server.register(adbcPlugin, options);

  // Routes
  server.register(queryRoutes);
  server.register(metadataRoutes, { prefix: '/metadata' });

  return server;
}

// Start server if run directly
if (require.main === module) {
  const DRIVER_PATH = process.env.ADBC_DRIVER_PATH;
  const DRIVER_ENTRYPOINT = process.env.ADBC_ENTRYPOINT || "AdbcDriverSQLiteInit";

  if (!DRIVER_PATH) {
    console.error("Error: ADBC_DRIVER_PATH environment variable must be set.");
    process.exit(1);
  }

  const server = buildServer({ driverPath: DRIVER_PATH, entrypoint: DRIVER_ENTRYPOINT });
  server.listen({ port: 8080, host: '0.0.0.0' }, (err) => {
    if (err) {
      server.log.error(err);
      process.exit(1);
    }
  });
}
