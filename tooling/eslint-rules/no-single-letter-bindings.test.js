import { describe, it } from 'node:test';

import typescriptParser from '@typescript-eslint/parser';
import { RuleTester } from 'eslint';

import { noSingleLetterBindings } from './no-single-letter-bindings.js';

describe('no-single-letter-bindings', () => {
  it('allows descriptive bindings and a conventional numeric for-loop counter', () => {
    const ruleTester = new RuleTester({
      languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    });

    ruleTester.run('no-single-letter-bindings', noSingleLetterBindings, {
      valid: [
        'const savedDraft = {};',
        'function selectAsset(asset) { return asset; }',
        'for (let i = 0; i < assets.length; i++) { visit(assets[i]); }',
        'const { wallet: selectedWallet } = account;',
      ],
      invalid: [],
    });
  });

  it('rejects short variables, parameters, destructured names, and imports', () => {
    const ruleTester = new RuleTester({
      languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    });

    ruleTester.run('no-single-letter-bindings', noSingleLetterBindings, {
      valid: [],
      invalid: [
        {
          code: 'const x = 1;',
          errors: [{ messageId: 'singleLetterBinding', data: { name: 'x' } }],
        },
        {
          code: 'function selectAsset(e) { return e; }',
          errors: [{ messageId: 'singleLetterBinding', data: { name: 'e' } }],
        },
        {
          code: 'const [a] = assets;',
          errors: [{ messageId: 'singleLetterBinding', data: { name: 'a' } }],
        },
        {
          code: "import { walletSchema as w } from './wallet.js';",
          errors: [{ messageId: 'singleLetterBinding', data: { name: 'w' } }],
        },
        {
          code: 'for (let i = 1; i < assets.length; i++) { visit(assets[i]); }',
          errors: [{ messageId: 'singleLetterBinding', data: { name: 'i' } }],
        },
      ],
    });
  });

  it('rejects one-letter TypeScript constructor parameter properties', () => {
    const ruleTester = new RuleTester({
      languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        parser: typescriptParser,
      },
    });

    ruleTester.run('no-single-letter-bindings', noSingleLetterBindings, {
      valid: [],
      invalid: [
        {
          code: 'class WalletService { constructor(private e: Engine) {} }',
          errors: [{ messageId: 'singleLetterBinding', data: { name: 'e' } }],
        },
      ],
    });
  });
});
