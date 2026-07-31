import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Vitest's default test-discovery excludes, plus .worktrees/ so test copies
    // inside a git worktree checked out there aren't double-collected.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*",
      ".worktrees/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      // Only the code we own and can exercise in-process. Thin shims are
      // excluded below: their logic lives in the helpers they call, which we
      // test directly.
      include: [
        "core/src/**",
        "core/hooks/**",
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
        "core/hooks/claude/protected-paths-guard.mjs", // PreToolUse I/O shim: stdin+git+db, decision tested in core/src/rules/claudeGuard.ts
        "rules/_kit/config-bridge.mjs", // bridge to core runtime (ruleConfigFromDb, tested in core/src/rules/config.ts)
        "core/src/rules/depProbe.ts", // platform shim (require.resolve + PATH lookup); verifyDependencies tested in deps.ts
      ],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
