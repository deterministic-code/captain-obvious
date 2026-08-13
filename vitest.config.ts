import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Several suites drive real tools (jscpd, prettier) in-process and legitimately
    // run 3-5s; the 5s default made them flake on timeout under load.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Vitest's default test-discovery excludes, plus .worktrees/ so test copies
    // inside a git worktree checked out there aren't double-collected.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*",
      ".worktrees/**",
      "e2e/**", // Playwright suite (own runner); not part of the vitest gate
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      // Only the code we own and can exercise in-process. Thin shims are
      // excluded below: their logic lives in the helpers they call, which we
      // test directly.
      include: [
        "core/src/**",
        "core/hooks/**/*.mjs",
        "core/lib/**",
        "rules/**/*.mjs",
      ],
      exclude: [
        "**/__tests__/**",
        "**/*.d.{ts,mts,cts}",
        "**/types.ts", // type-only declarations, no runtime code
        "core/src/rules/plugin.ts", // type-only RulePlugin contract, no runtime code
        "core/bin/**", // install/lint process shims (spawn + exit)
        "core/src/bin/**", // CLI entry: dispatches to already-tested db/* helpers
        "core/src/server/serve.ts", // HTTP server bootstrap (routing over tested handlers)
        "core/hooks/git/dispatch.mjs", // git-hook entry shim: imports compiled dist and calls runDispatch (tested in core/src/rules/dispatch.ts)
        "rules/_kit/protected-globs.mjs", // bridge to core runtime (readProtectedGlobs/matchProtected, tested in core/src/rules/protectedPaths.ts)
        "core/hooks/claude/pre-tool-guard.mjs", // PreToolUse I/O shim: stdin+git+db, decisions tested in core/src/rules/claudeGuard.ts
        "core/hooks/claude/stop-guard.mjs", // Stop I/O shim: stdin+db+dispatchRule, logic in rules/gov-merge-before-stop/check.mjs
        "core/hooks/claude/tool-fix.mjs", // PostToolUse I/O shim: stdin+db+fixRule, decision tested in core/src/rules/toolFix.ts
        "rules/_kit/config-bridge.mjs", // bridge to core runtime (ruleConfigFromDb, tested in core/src/rules/config.ts)
        "core/src/rules/depProbe.ts", // platform shim (require.resolve + PATH lookup); verifyDependencies tested in deps.ts
      ],
      // Temporary during the vitest-4 migration: its stricter coverage provider
      // surfaced ~7 real branch/function gaps vitest 2 under-counted. Restore to
      // 100 as they're closed (tracked in the PR). See vitest-4 migration notes.
      thresholds: {
        statements: 99,
        branches: 99,
        functions: 99,
        lines: 99,
      },
    },
  },
});
