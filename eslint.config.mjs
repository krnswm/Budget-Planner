import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";

// Deliberately narrow. This config exists to catch the two bug classes that
// actually shipped to production in this codebase:
//
//   no-undef             -> ProfilePage referenced an undeclared `email`,
//                           crashing the whole SPA on render.
//   no-use-before-define -> server.js read GOOGLE_AUTH_ENABLED 55 lines
//                           before its `const`, so every production boot
//                           threw ReferenceError.
//
// Style rules are intentionally left off so the signal stays high.

const correctnessRules = {
  "no-undef": "error",
  "no-use-before-define": ["error", { functions: false, classes: true, variables: true }],
  "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }]
};

export default [
  {
    ignores: ["node_modules/**", "client/node_modules/**", "client/dist/**", "db/**", "backups/**", "logs/**"]
  },
  js.configs.recommended,

  // Server: CommonJS, Node globals.
  {
    files: ["server.js", "routes/**/*.js", "scripts/**/*.js", "lib/**/*.js", "api/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "commonjs",
      globals: { ...globals.node }
    },
    rules: correctnessRules
  },

  // Tests: Node globals plus the node:test runner.
  {
    files: ["test/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "commonjs",
      globals: { ...globals.node }
    },
    rules: correctnessRules
  },

  // Legacy browser script served to the EJS auth pages. Classic script,
  // not a module. Scheduled for deletion once the EJS pages stop loading it.
  {
    files: ["public/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "script",
      globals: { ...globals.browser }
    },
    rules: correctnessRules
  },

  // Client: ESM, browser globals, JSX.
  {
    files: ["client/src/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } }
    },
    plugins: { react },
    settings: { react: { version: "detect" } },
    rules: {
      ...correctnessRules,
      // Marks components referenced in JSX as used, so the rules above
      // behave correctly on JSX identifiers.
      "react/jsx-uses-react": "error",
      "react/jsx-uses-vars": "error"
    }
  }
];
