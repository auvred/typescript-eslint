import 'jest-specific-snapshot';

import { parseForESLint } from '@typescript-eslint/parser';
import * as tseslintParser from '@typescript-eslint/parser';
import { Linter } from '@typescript-eslint/utils/ts-eslint';
import fs from 'fs';
import { marked } from 'marked';
import path from 'path';
import { titleCase } from 'title-case';

import rules from '../src/rules';
import { getFixturesRootDir } from './RuleTester';

const docsRoot = path.resolve(__dirname, '../docs/rules');
const rulesData = Object.entries(rules);

interface ParsedMarkdownFile {
  fullText: string;
  tokens: marked.TokensList;
}

function parseMarkdownFile(filePath: string): ParsedMarkdownFile {
  const fullText = fs.readFileSync(filePath, 'utf-8');

  const tokens = marked.lexer(fullText, {
    gfm: true,
    silent: false,
  });

  return { fullText, tokens };
}

type TokenType = marked.Token['type'];

function tokenIs<Type extends TokenType>(
  token: marked.Token,
  type: Type,
): token is marked.Token & { type: Type } {
  return token.type === type;
}

function tokenIsHeading(token: marked.Token): token is marked.Tokens.Heading {
  return tokenIs(token, 'heading');
}

function tokenIsH2(
  token: marked.Token,
): token is marked.Tokens.Heading & { depth: 2 } {
  return (
    tokenIsHeading(token) && token.depth === 2 && !/[a-z]+: /.test(token.text)
  );
}

function renderLintResults(code: string, errors: Linter.LintMessage[]): string {
  const output: string[] = [];
  const lines = code.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    output.push(line);

    for (const error of errors) {
      const startLine = error.line - 1;
      const endLine =
        error.endLine === undefined ? startLine : error.endLine - 1;
      const startColumn = error.column - 1;
      const endColumn =
        error.endColumn === undefined ? startColumn : error.endColumn - 1;
      if (i < startLine || i > endLine) {
        continue;
      }
      if (i === startLine) {
        const squiggle = '~'.repeat(Math.max(1, endColumn - startColumn));
        const squiggleWithIndent = ' '.repeat(startColumn) + squiggle + ' ';
        const errorMessageIndent = ' '.repeat(squiggleWithIndent.length);
        output.push(
          squiggleWithIndent +
            error.message.split('\n').join('\n' + errorMessageIndent),
        );
      } else {
        const squiggle = '~'.repeat(Math.max(1, line.length - startColumn));
        output.push(squiggle);
      }
    }
  }

  return output.join('\n').trim() + '\n';
}

const linter = new Linter();
linter.defineParser('@typescript-eslint/parser', tseslintParser);

const eslintOutputSnapshotFolder = path.resolve(
  __dirname,
  'docs-eslint-output-snapshots',
);
fs.mkdirSync(eslintOutputSnapshotFolder, { recursive: true });

describe('Validating rule docs', () => {
  const ignoredFiles = new Set([
    'README.md',
    'TEMPLATE.md',
    // These rule docs were left behind on purpose for legacy reasons. See the
    // comments in the files for more information.
    'camelcase.md',
    'no-duplicate-imports.md',
    'no-parameter-properties.md',
  ]);

  const rulesWithComplexOptions = new Set(['array-type', 'member-ordering']);

  it('All rules must have a corresponding rule doc', () => {
    const files = fs
      .readdirSync(docsRoot)
      .filter(rule => !ignoredFiles.has(rule));
    const ruleFiles = Object.keys(rules)
      .map(rule => `${rule}.md`)
      .sort();

    expect(files.sort()).toEqual(ruleFiles);
  });

  for (const [ruleName, rule] of rulesData) {
    if (ruleName !== 'consistent-type-assertions') {
      // continue;
    }
    const { description } = rule.meta.docs!;

    describe(`${ruleName}.md`, () => {
      const filePath = path.join(docsRoot, `${ruleName}.md`);
      const { fullText, tokens } = parseMarkdownFile(filePath);

      test(`${ruleName}.md must start with frontmatter description`, () => {
        expect(tokens[0]).toMatchObject({
          raw: '---\n',
          type: 'hr',
        });
        expect(tokens[1]).toMatchObject({
          text: description.includes("'")
            ? `description: "${description}."`
            : `description: '${description}.'`,
          depth: 2,
          type: 'heading',
        });
      });

      test(`${ruleName}.md must next have a blockquote directing to website`, () => {
        expect(tokens[2]).toMatchObject({
          text: [
            `🛑 This file is source code, not the primary documentation location! 🛑`,
            ``,
            `See **https://typescript-eslint.io/rules/${ruleName}** for documentation.`,
            ``,
          ].join('\n'),
          type: 'blockquote',
        });
      });

      test(`headings must be title-cased`, () => {
        // Get all H2 headings objects as the other levels are variable by design.
        const headings = tokens.filter(tokenIsH2);

        headings.forEach(heading =>
          expect(heading.text).toBe(titleCase(heading.text)),
        );
      });

      const headings = tokens.filter(tokenIsHeading);

      const requiredHeadings = ['When Not To Use It'];

      const importantHeadings = new Set([
        ...requiredHeadings,
        'How to Use',
        'Options',
        'Related To',
        'When Not To Use It',
      ]);

      test('important headings must be h2s', () => {
        for (const heading of headings) {
          if (importantHeadings.has(heading.raw.replace(/#/g, '').trim())) {
            expect(heading.depth).toBe(2);
          }
        }
      });

      if (!rules[ruleName as keyof typeof rules].meta.docs?.extendsBaseRule) {
        test('must include required headings', () => {
          const headingTexts = new Set(
            tokens.filter(tokenIsH2).map(token => token.text),
          );

          for (const requiredHeading of requiredHeadings) {
            const omissionComment = `<!-- Intentionally Omitted: ${requiredHeading} -->`;

            if (
              !headingTexts.has(requiredHeading) &&
              !fullText.includes(omissionComment)
            ) {
              throw new Error(
                `Expected a '${requiredHeading}' heading or comment like ${omissionComment}.`,
              );
            }
          }
        });
      }

      const { schema } = rule.meta;
      if (
        !rulesWithComplexOptions.has(ruleName) &&
        Array.isArray(schema) &&
        !rule.meta.docs?.extendsBaseRule &&
        rule.meta.type !== 'layout'
      ) {
        test('each rule option should be mentioned in a heading', () => {
          const headingTextAfterOptions = headings
            .slice(headings.findIndex(header => header.text === 'Options'))
            .map(header => header.text)
            .join('\n');

          for (const schemaItem of schema) {
            if (schemaItem.type === 'object') {
              for (const property of Object.keys(
                schemaItem.properties as object,
              )) {
                if (!headingTextAfterOptions.includes(`\`${property}\``)) {
                  throw new Error(
                    `At least one header should include \`${property}\`.`,
                  );
                }
              }
            }
          }
        });
      }

      test('must include only valid code samples', () => {
        for (const token of tokens) {
          if (token.type !== 'code') {
            continue;
          }

          const lang = token.lang?.trim();
          if (!lang || !/^tsx?\b/i.test(lang)) {
            continue;
          }

          try {
            parseForESLint(token.text, {
              ecmaFeatures: {
                jsx: /^tsx\b/i.test(lang),
              },
              ecmaVersion: 'latest',
              sourceType: 'module',
              range: true,
            });
          } catch {
            throw new Error(`Parsing error:\n\n${token.text}`);
          }
        }
      });

      describe('code examples ESLint output', () => {
        if (
          [
            'prefer-readonly-parameter-types', // https://github.com/typescript-eslint/typescript-eslint/pull/8461
            'prefer-optional-chain', // https://github.com/typescript-eslint/typescript-eslint/issues/8487
          ].includes(ruleName)
        ) {
          return;
        }

        // TypeScript can't infer type arguments unless we provide them explicitly
        linter.defineRule<
          keyof (typeof rule)['meta']['messages'],
          (typeof rule)['defaultOptions']
        >(ruleName, rule);

        type Context =
          | {
              type: 'outside-the-tabs';
            }
          | {
              type: 'entered-tabs';
            }
          | {
              type: 'under-tab-heading';
              headingsDepth: number;
              sectionType: 'incorrect' | 'correct' | 'unknown';
            };
        let currentContext: Context = {
          type: 'outside-the-tabs',
        };

        for (const token of tokens) {
          if (token.type === 'html') {
            const isOpeningTabsComment = /^<!--\s*tabs\s*-->$/.test(
              token.text.trim(),
            );
            const isClosingTabsComment = /^<!--\s*\/tabs\s*-->$/.test(
              token.text.trim(),
            );

            if (isOpeningTabsComment) {
              currentContext = { type: 'entered-tabs' };
            } else if (isClosingTabsComment) {
              currentContext = { type: 'outside-the-tabs' };
            }
          } else if (token.type === 'heading') {
            if (
              currentContext.type === 'under-tab-heading' &&
              token.depth < currentContext.headingsDepth
            ) {
              currentContext = { type: 'outside-the-tabs' };
            } else if (
              currentContext.type === 'entered-tabs' ||
              (currentContext.type === 'under-tab-heading' &&
                token.depth === currentContext.headingsDepth)
            ) {
              const heading = token.text.trim();
              currentContext = {
                type: 'under-tab-heading',
                headingsDepth: token.depth,
                sectionType: heading.startsWith('❌ Incorrect')
                  ? 'incorrect'
                  : heading.startsWith('✅ Correct')
                    ? 'correct'
                    : 'unknown',
              };
            }
          }

          if (
            token.type !== 'code' ||
            (currentContext.type !== 'under-tab-heading' &&
              !token.lang?.includes('showPlaygroundButton'))
          ) {
            continue;
          }

          const lang = token.lang?.trim();
          if (!lang || !/^tsx?\b/i.test(lang)) {
            continue;
          }

          const optionRegex = /option='(?<option>.*?)'/;

          const option = lang.match(optionRegex)?.groups?.option;
          const ruleConfig: Linter.RuleEntry = option
            ? JSON.parse(`["error", ${option}]`)
            : 'error';
          const rootPath = getFixturesRootDir();

          const messages = linter.verify(
            token.text,
            {
              parser: '@typescript-eslint/parser',
              parserOptions: {
                tsconfigRootDir: rootPath,
                project: './tsconfig.json',
              },
              rules: {
                [ruleName]: ruleConfig,
              },
            },
            /^tsx\b/i.test(lang) ? 'react.tsx' : 'file.ts',
          );

          expect(
            renderLintResults(token.text, messages),
          ).toMatchSpecificSnapshot(
            path.join(eslintOutputSnapshotFolder, `${ruleName}.shot`),
          );

          if (currentContext.type === 'under-tab-heading') {
            if (currentContext.sectionType === 'incorrect') {
              expect(messages).not.toHaveLength(0);
            } else if (currentContext.sectionType === 'correct') {
              expect(messages).toHaveLength(0);
            }
          }
        }
      });
    });
  }
});

test('There should be no obsolete ESLint output snapshots', () => {
  const files = fs.readdirSync(eslintOutputSnapshotFolder);
  const names = new Set(Object.keys(rules).map(k => `${k}.shot`));

  for (const file of files) {
    expect(names).toContain(file);
  }
});

describe('Validating rule metadata', () => {
  const rulesThatRequireTypeInformationInAWayThatsHardToDetect = new Set([
    // the core rule file doesn't use type information, instead it's used in `src/rules/naming-convention-utils/validator.ts`
    'naming-convention',
  ]);
  function requiresFullTypeInformation(content: string): boolean {
    return /getParserServices(\(\s*[^,\s)]+)\s*(,\s*false\s*)?\)/.test(content);
  }

  for (const [ruleName, rule] of rulesData) {
    describe(ruleName, () => {
      it('`name` field in rule must match the filename', () => {
        // validate if rule name is same as url
        // there is no way to access this field but its used only in generation of docs url
        expect(rule.meta.docs?.url).toBe(
          `https://typescript-eslint.io/rules/${ruleName}`,
        );
      });

      it('`requiresTypeChecking` should be set if the rule uses type information', () => {
        if (
          rulesThatRequireTypeInformationInAWayThatsHardToDetect.has(ruleName)
        ) {
          expect(true).toEqual(rule.meta.docs?.requiresTypeChecking ?? false);
          return;
        }

        // quick-and-dirty check to see if it uses parserServices
        // not perfect but should be good enough
        const ruleFileContents = fs.readFileSync(
          path.resolve(__dirname, `../src/rules/${ruleName}.ts`),
          'utf-8',
        );

        expect(requiresFullTypeInformation(ruleFileContents)).toEqual(
          rule.meta.docs?.requiresTypeChecking ?? false,
        );
      });
    });
  }
});
