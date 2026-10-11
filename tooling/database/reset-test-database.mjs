import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function getTestDatabaseTarget(environment) {
  if (environment.NODE_ENV !== 'test') {
    throw new Error('Refusing to reset a database unless NODE_ENV is explicitly set to test.');
  }

  const databaseUrlValue = environment.DATABASE_URL;

  if (databaseUrlValue === undefined) {
    throw new Error('Refusing to reset a database without an explicit DATABASE_URL.');
  }

  let databaseUrl;

  try {
    databaseUrl = new URL(databaseUrlValue);
  } catch {
    throw new Error('Refusing to reset a database because DATABASE_URL is invalid.');
  }

  let databaseName;
  let databaseUsername;

  try {
    databaseName = decodeURIComponent(databaseUrl.pathname.slice(1));
    databaseUsername = decodeURIComponent(databaseUrl.username);
  } catch {
    throw new Error('Refusing to reset a database because DATABASE_URL contains invalid encoding.');
  }

  const postgresPort = environment.POSTGRES_PORT ?? '5432';
  const allowedHosts = new Set(['127.0.0.1', 'localhost']);
  const validDatabaseUsername = /^[a-z_][a-z0-9_]{0,62}$/u.test(databaseUsername);

  if (
    databaseUrl.protocol !== 'postgresql:' ||
    databaseName !== 'wallet_test' ||
    !allowedHosts.has(databaseUrl.hostname) ||
    databaseUrl.port !== postgresPort ||
    !validDatabaseUsername
  ) {
    throw new Error(
      'Refusing to reset a database unless DATABASE_URL explicitly targets the local wallet_test database.',
    );
  }

  return { databaseName, databaseUsername };
}

async function resetTestDatabase(environment) {
  const databaseTarget = getTestDatabaseTarget(environment);
  const resetArguments = [
    'compose',
    'exec',
    '--no-TTY',
    'postgres',
    'psql',
    '--no-password',
    '--username',
    databaseTarget.databaseUsername,
    '--dbname',
    databaseTarget.databaseName,
    '--set=ON_ERROR_STOP=1',
    '--command',
    'DROP SCHEMA public CASCADE; CREATE SCHEMA public;',
  ];

  await new Promise((resolveReset, rejectReset) => {
    const dockerProcess = spawn('docker', resetArguments, { stdio: 'inherit' });

    dockerProcess.once('error', rejectReset);
    dockerProcess.once('close', (exitCode) => {
      if (exitCode === 0) {
        resolveReset();
        return;
      }

      rejectReset(
        new Error(`The test database reset exited with status ${exitCode ?? 'unknown'}.`),
      );
    });
  });
}

const scriptPath = process.argv[1];
const isDirectExecution =
  scriptPath !== undefined && resolve(scriptPath) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  try {
    await resetTestDatabase(process.env);
  } catch (resetError) {
    const safeMessage =
      resetError instanceof Error ? resetError.message : 'The test database reset failed.';
    console.error(safeMessage);
    process.exitCode = 1;
  }
}
