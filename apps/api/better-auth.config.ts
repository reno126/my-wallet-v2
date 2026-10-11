import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from './generated/prisma/client.js';
import { apiEnvironment } from './src/config/environment.js';
import { createBetterAuth } from './src/plugins/better-auth.js';

const adapter = new PrismaPg({
  connectionString: apiEnvironment.DATABASE_URL,
  max: apiEnvironment.DATABASE_POOL_MAX,
  connectionTimeoutMillis: apiEnvironment.DATABASE_CONNECT_TIMEOUT_MS,
  idleTimeoutMillis: apiEnvironment.DATABASE_IDLE_TIMEOUT_MS,
});
const prisma = new PrismaClient({ adapter });

export const auth = createBetterAuth(prisma, apiEnvironment);
