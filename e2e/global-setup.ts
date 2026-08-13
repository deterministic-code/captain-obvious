import type { ChildProcess } from "node:child_process";
import {
  buildSandbox,
  fireClaudeHooks,
  fireGitHooks,
  startServe,
} from "./fixtures";

/**
 * Arrange the whole world once, before any spec: build the sandbox repo with the
 * real hooks attached, fire every hook type with a real event (git ops for the
 * git hooks, a real `claude -p` for the Claude hooks), then serve the panel over
 * the sandbox DBs. The returned function is the global teardown that stops serve.
 */
export default async function globalSetup(): Promise<() => void> {
  await buildSandbox();
  await fireGitHooks();
  await fireClaudeHooks();
  const server: ChildProcess = await startServe();
  return () => {
    server.kill();
  };
}
