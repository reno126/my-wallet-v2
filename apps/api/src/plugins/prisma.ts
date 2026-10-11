import { PrismaPg } from '@prisma/adapter-pg';
import type { FastifyPluginAsync } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import { PrismaClient } from '../../generated/prisma/client.js';
import type { ApiPluginOptions } from '../plugin-options.js';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

const prismaPlugin: FastifyPluginAsync<ApiPluginOptions> = async (server, { environment }) => {
  const adapter = new PrismaPg({
    connectionString: environment.DATABASE_URL,
    max: environment.DATABASE_POOL_MAX,
    connectionTimeoutMillis: environment.DATABASE_CONNECT_TIMEOUT_MS,
    idleTimeoutMillis: environment.DATABASE_IDLE_TIMEOUT_MS,
  });
  const prisma = new PrismaClient({ adapter });

  server.decorate('prisma', prisma);
  server.addHook('onClose', async () => prisma.$disconnect());
  await prisma.$connect();
};

export default fastifyPlugin(prismaPlugin, {
  name: 'api-prisma',
  fastify: '5.x',
});
