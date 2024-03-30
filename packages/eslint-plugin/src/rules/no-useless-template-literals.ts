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

    function isTemplateLiteral(
      expression: TSESTree.Expression,
    ): expression is TSESTree.TemplateLiteral {
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

        const fixableExpressions = node.expressions
          .filter(
            expression =>
              isLiteral(expression) ||
              isTemplateLiteral(expression) ||
              isUndefinedIdentifier(expression) ||
              isInfinityIdentifier(expression) ||
              isNaNIdentifier(expression),
          )
          .reverse();

        let nextCharacterIsOpeningCurlyBrace = false;

        fixableExpressions.forEach(expression => {
          const fixers: ((fixer: TSESLint.RuleFixer) => TSESLint.RuleFix[])[] =
            [];
          const index = node.expressions.indexOf(expression);
          const prevQuasi = node.quasis[index];
          const nextQuasi = node.quasis[index + 1];

          const evenNumOfBackslashesRegExp = /(?<!(?:[^\\]|^)(?:\\\\)*\\)/;

          function endsWithEscapedDollarSign(str: string): boolean {
            return new RegExp(`${evenNumOfBackslashesRegExp.source}\\$$`).test(
              str,
            );
          }

          if (nextQuasi.value.raw.length !== 0) {
            nextCharacterIsOpeningCurlyBrace =
              nextQuasi.value.raw.startsWith('{');
          }

          if (isLiteral(expression)) {
            let escapedValue = (
              typeof expression.value === 'string'
                ? expression.raw.slice(1, -1)
                : // 1     -> '1'
                  // /\\/  -> '/\\\\/'
                  String(expression.value).replace(/\\\\/g, '\\\\\\\\')
            ).replace(
              new RegExp(`${evenNumOfBackslashesRegExp.source}(\`|\\\${)`, 'g'),
              '\\$1',
            );

            if (
              nextCharacterIsOpeningCurlyBrace &&
              endsWithEscapedDollarSign(escapedValue)
            ) {
              escapedValue = escapedValue.replaceAll(/\$$/g, '\\$');
            }

            if (escapedValue.length !== 0) {
              nextCharacterIsOpeningCurlyBrace = escapedValue.startsWith('{');
            }

            fixers.push(fixer => [fixer.replaceText(expression, escapedValue)]);
          } else if (isTemplateLiteral(expression)) {
            if (
              nextCharacterIsOpeningCurlyBrace &&
              endsWithEscapedDollarSign(
                expression.quasis[expression.quasis.length - 1].value.raw,
              )
            ) {
              fixers.push(fixer => [
                fixer.replaceTextRange(
                  [expression.range[1] - 2, expression.range[1] - 2],
                  '\\',
                ),
              ]);
            }
            if (
              expression.quasis.length === 1 &&
              expression.quasis[0].value.raw.length !== 0
            ) {
              nextCharacterIsOpeningCurlyBrace =
                expression.quasis[0].value.raw.startsWith('{');
            }

            // Remove the beginning and trailing backtick characters.
            fixers.push(fixer => [
              fixer.removeRange([expression.range[0], expression.range[0] + 1]),
              fixer.removeRange([expression.range[1] - 1, expression.range[1]]),
            ]);
          } else {
            nextCharacterIsOpeningCurlyBrace = false;
          }

          if (
            nextCharacterIsOpeningCurlyBrace &&
            endsWithEscapedDollarSign(prevQuasi.value.raw)
          ) {
            fixers.push(fixer => [
              fixer.replaceTextRange(
                [prevQuasi.range[1] - 3, prevQuasi.range[1] - 2],
                '\\$',
              ),
            ]);
          }

          context.report({
            node: expression,
            messageId: 'noUselessTemplateLiteral',
            fix(fixer): TSESLint.RuleFix[] {
              return [
                // Remove the quasis' parts that are related to the current expression.
                fixer.removeRange([
                  prevQuasi.range[1] - 2,
                  expression.range[0],
                ]),
                fixer.removeRange([
                  expression.range[1],
                  nextQuasi.range[0] + 1,
                ]),

                ...fixers.flatMap(cb => cb(fixer)),
              ];
            },
          });
        });
      },
    };
  },
});
