import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { getTestDatabaseTarget } from './reset-test-database.mjs';

const testEnvironment = {
  NODE_ENV: 'test',
  POSTGRES_PORT: '5432',
  DATABASE_URL:
    'postgresql://wallet_local:wallet_local_only@127.0.0.1:5432/wallet_test?schema=public',
};

describe('test database reset guard', () => {
  it('accepts only the explicitly named local test database', () => {
    assert.deepEqual(getTestDatabaseTarget(testEnvironment), {
      databaseName: 'wallet_test',
      databaseUsername: 'wallet_local',
    });
  });

  it('refuses to reset unless NODE_ENV identifies a test run', () => {
    assert.throws(
      () => getTestDatabaseTarget({ ...testEnvironment, NODE_ENV: 'development' }),
      /NODE_ENV is explicitly set to test/u,
    );
  });

  it('refuses the development database and non-loopback hosts', () => {
    assert.throws(
      () =>
        getTestDatabaseTarget({
          ...testEnvironment,
          DATABASE_URL:
            'postgresql://wallet_local:wallet_local_only@127.0.0.1:5432/wallet_dev?schema=public',
        }),
      /local wallet_test database/u,
    );
    assert.throws(
      () =>
        getTestDatabaseTarget({
          ...testEnvironment,
          DATABASE_URL:
            'postgresql://wallet_local:wallet_local_only@example.com:5432/wallet_test?schema=public',
        }),
      /local wallet_test database/u,
    );
  });
});
