module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/tests/**/*.test.ts', '<rootDir>/tests/**/*.test.tsx'],
  moduleNameMapper: { '^@omnichat/api-client$': '<rootDir>/../../packages/api-client/src/index.ts', '^@omnichat/core$': '<rootDir>/../../packages/core/src/index.ts', '^@omnichat/types$': '<rootDir>/../../packages/types/src/index.ts' },
  cacheDirectory: '<rootDir>/work/jest-cache',
  transformIgnorePatterns: ['node_modules/(?!(?:\\.pnpm/)|(?:react-native(?:/|-)|@react-native/|expo(?:/|-)|@expo/|nativewind/|react-native-css-interop/|moti/))'],
};
