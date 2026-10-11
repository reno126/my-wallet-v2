import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { addRateLimitContract } from './openapi-document.js';
import { buildServer } from './server.js';

const server = buildServer({ logger: false });

try {
  await server.ready();

  const openApiDocument = addRateLimitContract(server.swagger());
  const outputPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../packages/contracts/openapi.json',
  );

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(openApiDocument, null, 2)}\n`);
} finally {
  await server.close();
}
