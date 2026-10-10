function getBindingIdentifiers(bindingPattern) {
  if (bindingPattern === null) {
    return [];
  }

  if (bindingPattern.type === 'Identifier') {
    return [bindingPattern];
  }

  if (bindingPattern.type === 'TSParameterProperty') {
    return getBindingIdentifiers(bindingPattern.parameter);
  }

  if (bindingPattern.type === 'RestElement') {
    return getBindingIdentifiers(bindingPattern.argument);
  }

  if (bindingPattern.type === 'AssignmentPattern') {
    return getBindingIdentifiers(bindingPattern.left);
  }

  if (bindingPattern.type === 'ArrayPattern') {
    return bindingPattern.elements.flatMap(getBindingIdentifiers);
  }

  if (bindingPattern.type === 'ObjectPattern') {
    return bindingPattern.properties.flatMap((property) =>
      property.type === 'RestElement'
        ? getBindingIdentifiers(property.argument)
        : getBindingIdentifiers(property.value),
    );
  }

  return [];
}

function isNumericForLoopCounter(variableDeclarator, bindingIdentifier) {
  const variableDeclaration = variableDeclarator.parent;
  const forStatement = variableDeclaration?.parent;
  const counterTest = forStatement?.test;
  const counterUpdate = forStatement?.update;
  const initializedAtZero =
    variableDeclarator.init?.type === 'Literal' && variableDeclarator.init.value === 0;
  const testUsesCounter =
    counterTest?.type === 'BinaryExpression' &&
    ['<', '<=', '>', '>='].includes(counterTest.operator) &&
    (counterTest.left.name === bindingIdentifier.name ||
      counterTest.right.name === bindingIdentifier.name);
  const updateUsesCounter =
    (counterUpdate?.type === 'UpdateExpression' &&
      counterUpdate.argument.name === bindingIdentifier.name) ||
    (counterUpdate?.type === 'AssignmentExpression' &&
      ['+=', '-='].includes(counterUpdate.operator) &&
      counterUpdate.left.name === bindingIdentifier.name &&
      counterUpdate.right.type === 'Literal' &&
      typeof counterUpdate.right.value === 'number');

  return (
    bindingIdentifier.name === 'i' &&
    variableDeclaration?.type === 'VariableDeclaration' &&
    variableDeclaration.kind === 'let' &&
    forStatement?.type === 'ForStatement' &&
    forStatement.init === variableDeclaration &&
    initializedAtZero &&
    testUsesCounter &&
    updateUsesCounter
  );
}

export const noSingleLetterBindings = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require descriptive names for all bindings except a conventional numeric loop counter',
    },
    messages: {
      singleLetterBinding:
        "Use a descriptive name instead of the single-letter binding '{{name}}'.",
    },
    schema: [],
  },
  create(context) {
    function reportShortBindings(bindingPattern, options = {}) {
      for (const bindingIdentifier of getBindingIdentifiers(bindingPattern)) {
        if (bindingIdentifier.name.length === 1 && !options.allowCounter) {
          context.report({
            node: bindingIdentifier,
            messageId: 'singleLetterBinding',
            data: { name: bindingIdentifier.name },
          });
        }
      }
    }

    return {
      VariableDeclarator(node) {
        const bindingIdentifier = node.id;
        const allowCounter =
          bindingIdentifier.type === 'Identifier' &&
          isNumericForLoopCounter(node, bindingIdentifier);

        reportShortBindings(node.id, { allowCounter });
      },
      FunctionDeclaration(node) {
        reportShortBindings(node.id);
        node.params.forEach((parameterPattern) => reportShortBindings(parameterPattern));
      },
      FunctionExpression(node) {
        reportShortBindings(node.id);
        node.params.forEach((parameterPattern) => reportShortBindings(parameterPattern));
      },
      ArrowFunctionExpression(node) {
        node.params.forEach((parameterPattern) => reportShortBindings(parameterPattern));
      },
      ClassDeclaration(node) {
        reportShortBindings(node.id);
      },
      ClassExpression(node) {
        reportShortBindings(node.id);
      },
      CatchClause(node) {
        reportShortBindings(node.param);
      },
      ImportDeclaration(node) {
        node.specifiers.forEach((specifier) => reportShortBindings(specifier.local));
      },
    };
  },
};
