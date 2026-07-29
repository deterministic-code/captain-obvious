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
      include: ["src/**", "hooks/**", "lib/**"],
      exclude: [
        "**/__tests__/**",
        "**/*.d.{ts,mts,cts}",
        "**/types.ts", // type-only declarations, no runtime code
        "bin/**", // install/lint process shims (spawn + exit)
        "src/bin/**", // CLI entry: dispatches to already-tested db/* helpers
        "src/server/serve.ts", // HTTP server bootstrap (routing over tested handlers)
        "hooks/git/dispatch.mjs", // git-hook entry shim: imports compiled dist and calls runDispatch (tested in src/rules/dispatch.ts)
        "hooks/git/protected-globs.mjs", // bridge to compiled dist (readProtectedGlobs/matchProtected, tested in src/rules/protectedPaths.ts)
        "hooks/claude/protected-paths-guard.mjs", // PreToolUse I/O shim: stdin+git+db, decision tested in src/rules/claudeGuard.ts
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
