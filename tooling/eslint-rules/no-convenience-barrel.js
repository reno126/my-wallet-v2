function isPublicContractsEntryPoint(filename) {
  const normalizedFilename = filename.replaceAll('\\', '/');

  return normalizedFilename.endsWith('/packages/contracts/src/index.ts');
}

export const noConvenienceBarrel = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow modules that only re-export symbols from other modules',
    },
    messages: {
      convenienceBarrel: 'Avoid re-export-only modules; import directly from the defining module.',
    },
    schema: [],
  },
  create(context) {
    return {
      'Program:exit'(programNode) {
        if (
          programNode.body.length > 0 &&
          programNode.body.every(
            (statement) =>
              (statement.type === 'ExportNamedDeclaration' ||
                statement.type === 'ExportAllDeclaration') &&
              statement.source !== null,
          ) &&
          !isPublicContractsEntryPoint(context.filename)
        ) {
          context.report({
            node: programNode,
            messageId: 'convenienceBarrel',
          });
        }
      },
    };
  },
};
