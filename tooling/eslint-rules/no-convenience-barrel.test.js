import { describe, it } from 'node:test';

import { RuleTester } from 'eslint';

import { noConvenienceBarrel } from './no-convenience-barrel.js';

describe('no-convenience-barrel', () => {
  it('allows modules with implementation and the public contracts entry point', () => {
    const ruleTester = new RuleTester({
      languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    });

    ruleTester.run('no-convenience-barrel', noConvenienceBarrel, {
      valid: [
        "export { walletSchema } from './wallet.js';\nexport const reportingCurrency = 'USD';",
        {
          code: "export { walletSchema } from './wallet.js';",
          filename: 'C:/repo/packages/contracts/src/index.ts',
        },
      ],
      invalid: [],
    });
  });

  it('rejects re-export-only modules', () => {
    const ruleTester = new RuleTester({
      languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    });

    ruleTester.run('no-convenience-barrel', noConvenienceBarrel, {
      valid: [],
      invalid: [
        {
          code: "export { walletSchema } from './wallet.js';",
          errors: [{ messageId: 'convenienceBarrel' }],
        },
        {
          code: "export * from './wallet.js';\nexport * from './instrument.js';",
          errors: [{ messageId: 'convenienceBarrel' }],
        },
      ],
    });
  });
});
