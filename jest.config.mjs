// Native-ESM Jest for the standalone engine. The source is pure `.mjs`; there is
// no bundler/transform step. `NODE_OPTIONS=--experimental-vm-modules` (set by the
// `test` script) lets Jest's VM run real ES modules, so `transform: {}` disables
// every transformer — the files are loaded as-is.
export default {
  testEnvironment: "node",
  transform: {},
  moduleFileExtensions: ["mjs", "js", "json"],
  testMatch: ["**/__tests__/**/*.test.js"],
  // Fixtures and helper modules under __tests__ are imported, not run as suites.
  // `/.claude/` keeps agent worktrees nested under `.claude/worktrees/` out of the
  // run: those are checkouts of this same repo, so jest would otherwise glob their
  // `__tests__/` and report stale copies as failures against current source. CI
  // never has them; only local sessions saw the phantom red.
  testPathIgnorePatterns: [
    "/node_modules/",
    "/__tests__/fixtures/",
    "/\\.claude/",
    "/\\.operator/",
  ],
}
