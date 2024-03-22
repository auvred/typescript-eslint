import type { TSESLint, TSESTree } from '@typescript-eslint/utils';
import { AST_NODE_TYPES } from '@typescript-eslint/utils';
import * as ts from 'typescript';

import {
  createRule,
  getConstrainedTypeAtLocation,
  getParserServices,
  isTypeFlagSet,
  isUndefinedIdentifier,
} from '../util';

type MessageId = 'noUselessTemplateLiteral';

export default createRule<[], MessageId>({
  name: 'no-useless-template-literals',
  meta: {
    fixable: 'code',
    type: 'suggestion',
    docs: {
      description: 'Disallow unnecessary template literals',
      recommended: 'strict',
      requiresTypeChecking: true,
    },
    messages: {
      noUselessTemplateLiteral:
        'Template literal expression is unnecessary and can be simplified.',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    const services = getParserServices(context);

    function isUnderlyingTypeString(
      expression: TSESTree.Expression,
    ): expression is TSESTree.StringLiteral | TSESTree.Identifier {
      const type = getConstrainedTypeAtLocation(services, expression);

      const isString = (t: ts.Type): boolean => {
        return isTypeFlagSet(t, ts.TypeFlags.StringLike);
      };

      if (type.isUnion()) {
        return type.types.every(isString);
      }

      if (type.isIntersection()) {
        return type.types.some(isString);
      }

      return isString(type);
    }

    function isLiteral(
      expression: TSESTree.Expression,
    ): expression is TSESTree.Literal {
      return expression.type === AST_NODE_TYPES.Literal;
    }

    function isTemplateLiteral(expression: TSESTree.Expression): boolean {
      return expression.type === AST_NODE_TYPES.TemplateLiteral;
    }

    function isInfinityIdentifier(expression: TSESTree.Expression): boolean {
      return (
        expression.type === AST_NODE_TYPES.Identifier &&
        expression.name === 'Infinity'
      );
    }

    function isNaNIdentifier(expression: TSESTree.Expression): boolean {
      return (
        expression.type === AST_NODE_TYPES.Identifier &&
        expression.name === 'NaN'
      );
    }

    return {
      TemplateLiteral(node: TSESTree.TemplateLiteral): void {
        if (node.parent.type === AST_NODE_TYPES.TaggedTemplateExpression) {
          return;
        }

        const hasSingleStringVariable =
          node.quasis.length === 2 &&
          node.quasis[0].value.raw === '' &&
          node.quasis[1].value.raw === '' &&
          node.expressions.length === 1 &&
          isUnderlyingTypeString(node.expressions[0]);

        if (hasSingleStringVariable) {
          context.report({
            node: node.expressions[0],
            messageId: 'noUselessTemplateLiteral',
            fix(fixer): TSESLint.RuleFix[] {
              const [prevQuasi, nextQuasi] = node.quasis;

              // Remove the quasis and backticks.
              return [
                fixer.removeRange([
                  prevQuasi.range[1] - 3,
                  node.expressions[0].range[0],
                ]),

                fixer.removeRange([
                  node.expressions[0].range[1],
                  nextQuasi.range[0] + 2,
                ]),
              ];
            },
          });

          return;
        }

        const fixableExpressions = node.expressions.filter(
          expression =>
            isLiteral(expression) ||
            isTemplateLiteral(expression) ||
            isUndefinedIdentifier(expression) ||
            isInfinityIdentifier(expression) ||
            isNaNIdentifier(expression),
        );

        fixableExpressions.forEach(expression => {
          context.report({
            node: expression,
            messageId: 'noUselessTemplateLiteral',
            fix(fixer): TSESLint.RuleFix[] {
              const index = node.expressions.indexOf(expression);
              const prevQuasi = node.quasis[index];
              const nextQuasi = node.quasis[index + 1];

              // Remove the quasis' parts that are related to the current expression.
              const fixes = [
                fixer.removeRange([
                  prevQuasi.range[1] - 2,
                  expression.range[0],
                ]),

                fixer.removeRange([
                  expression.range[1],
                  nextQuasi.range[0] + 1,
                ]),
              ];

              if (isLiteral(expression)) {
                const escapedValue =
                  typeof expression.value === 'string'
                    ? expression.raw.slice(1, -1).replace(/([`$])/g, '\\$1')
                    : String(expression.value).replace(/([`$\\])/g, '\\$1');

                fixes.push(fixer.replaceText(expression, escapedValue));
              } else if (isTemplateLiteral(expression)) {
                // Note that some template literals get handled in the previous branch too.
                // Remove the beginning and trailing backtick characters.
                fixes.push(
                  fixer.removeRange([
                    expression.range[0],
                    expression.range[0] + 1,
                  ]),
                  fixer.removeRange([
                    expression.range[1] - 1,
                    expression.range[1],
                  ]),
                );
              }

              return fixes;
            },
          });
        });
      },
    };
  },
});
