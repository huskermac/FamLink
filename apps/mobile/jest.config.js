module.exports = {
  preset: "jest-expo",
  passWithNoTests: true,
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)"
  ],
  coverageThreshold: { global: { lines: 80 } },
  collectCoverageFrom: ["src/**/*.{ts,tsx}", "!src/**/__tests__/**"]
};
