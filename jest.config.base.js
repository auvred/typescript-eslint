'use strict';

// @ts-check
/** @type {import('@jest/types').Config.InitialOptions} */
module.exports = {
  collectCoverage: true,
  collectCoverageFrom: ['src/**/*.{js,jsx,ts,tsx}'],
  coverageReporters: ['lcov'],
  moduleFileExtensions: [
    'ts',
    'tsx',
    'mts',
    'mtsx',
    'cjs',
    'js',
    'jsx',
    'mjs',
    'mjsx',
    'json',
    'node',
  ],
  setupFilesAfterEnv: ['console-fail-test/setup.js'],
  testRegex: ['./tests/.+\\.test\\.m?ts$', './tests/.+\\.spec\\.ts$'],
  extensionsToTreatAsEsm: ['.mts'],
  moduleNameMapper: {
    '(.+)\\.js': '$1',
  },
  transform: {
    '^.+\\.m?(t|j)sx?$': [
      '@swc/jest',
      {
        jsc: {
          target: 'es2019',
          parser: {
            syntax: 'typescript',
          },
          transform: {
            react: {
              runtime: 'automatic',
            },
          },
        },
      },
    ],
  },
  workerIdleMemoryLimit: '300MB',
};
