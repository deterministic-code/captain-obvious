#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import {
  formatViolation,
  isInvokedAsScript,
  isLintable,
  listStagedFiles,
} from "../_kit/lint-shared.mjs";

function stripStrings(line) {
  // Replace string contents with placeholders so `//` or `/*` inside single/double/backtick quotes don't trip the scanner (escapes handled loosely; good enough for comment detection).
  let out = "";
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      out += q;
      i++;
      while (i < line.length && line[i] !== q) {
        if (line[i] === "\\" && i + 1 < line.length) {
          i += 2;
          continue;
        }
        i++;
      }
      if (i < line.length) {
        out += q;
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function classifyCommentOpen(line, idx) {
  // Returns { kind, contentStart } where kind is "doc", "line", "block-doc", "block", or null.
  if (line.startsWith("///", idx))
    return { kind: "doc-line", contentStart: idx + 3 };
  if (line.startsWith("//!", idx))
    return { kind: "doc-line", contentStart: idx + 3 };
  if (line.startsWith("//", idx))
    return { kind: "line", contentStart: idx + 2 };
  if (line.startsWith("/**", idx) && line[idx + 3] !== "/")
    return { kind: "doc-block", contentStart: idx + 3 };
  if (line.startsWith("/*", idx))
    return { kind: "block", contentStart: idx + 2 };
  return null;
}

function* iterateComments(src) {
  // Yields { kind, leading, startLine, startCol, endLine, endCol, body } per comment. `leading` is true when the comment starts the line (only whitespace before it) — trailing comments after code do NOT count toward consecutive-run detection.
  const lines = src.split("\n");
  let lineNo = 0;
  let inBlock = null;
  for (; lineNo < lines.length; lineNo++) {
    const raw = lines[lineNo];
    if (inBlock) {
      const closeIdx = raw.indexOf("*/");
      if (closeIdx === -1) {
        inBlock.body.push(raw);
        continue;
      }
      inBlock.body.push(raw.slice(0, closeIdx));
      yield {
        kind: inBlock.kind,
        leading: inBlock.leading,
        startLine: inBlock.startLine,
        startCol: inBlock.startCol,
        endLine: lineNo + 1,
        endCol: closeIdx + 3,
        body: inBlock.body,
      };
      inBlock = null;
      continue;
    }
    const stripped = stripStrings(raw);
    let col = 0;
    while (col < stripped.length) {
      const idx = (() => {
        const slash = stripped.indexOf("/", col);
        return slash === -1 ? -1 : slash;
      })();
      if (idx === -1) break;
      const open = classifyCommentOpen(stripped, idx);
      if (!open) {
        col = idx + 1;
        continue;
      }
      const leading = /^\s*$/.test(raw.slice(0, idx));
      if (open.kind === "line" || open.kind === "doc-line") {
        yield {
          kind: open.kind,
          leading,
          startLine: lineNo + 1,
          startCol: idx + 1,
          endLine: lineNo + 1,
          endCol: raw.length + 1,
          body: [raw.slice(open.contentStart)],
        };
        col = raw.length;
        break;
      }
      const closeIdx = raw.indexOf("*/", open.contentStart);
      if (closeIdx !== -1) {
        yield {
          kind: open.kind,
          leading,
          startLine: lineNo + 1,
          startCol: idx + 1,
          endLine: lineNo + 1,
          endCol: closeIdx + 3,
          body: [raw.slice(open.contentStart, closeIdx)],
        };
        col = closeIdx + 2;
        continue;
      }
      inBlock = {
        kind: open.kind,
        leading,
        startLine: lineNo + 1,
        startCol: idx + 1,
        body: [raw.slice(open.contentStart)],
      };
      break;
    }
  }
}

export function findViolations(src) {
  const violations = [];
  const comments = [...iterateComments(src)];
  let i = 0;
  while (i < comments.length) {
    const c = comments[i];
    if (c.kind === "block") {
      if (c.startLine !== c.endLine) {
        violations.push({
          line: c.startLine,
          col: c.startCol,
          kind: "multi-line block comment",
          detail: `block comment spans lines ${c.startLine}-${c.endLine}; convert to a single short \`// …\` line or rewrite as one block on one line. Doc comments (\`/** */\`, \`///\`, \`//!\`) are exempt.`,
        });
      }
      i++;
      continue;
    }
    if (c.kind === "line") {
      if (!c.leading) {
        i++;
        continue;
      }
      let runStart = i;
      let runEnd = i;
      while (
        runEnd + 1 < comments.length &&
        comments[runEnd + 1].kind === "line" &&
        comments[runEnd + 1].leading &&
        comments[runEnd + 1].startLine === comments[runEnd].startLine + 1
      ) {
        runEnd++;
      }
      const runSize = runEnd - runStart + 1;
      if (runSize > 1) {
        violations.push({
          line: comments[runStart].startLine,
          col: comments[runStart].startCol,
          kind: `${runSize}-line consecutive comment block`,
          detail: `${runSize} consecutive leading \`// …\` lines starting at line ${comments[runStart].startLine}; rewrite as ONE concise line. If the comment is genuinely needed beyond one line, the explanation belongs in a PR description or a memory, not the source. Trailing comments after code don't count toward this run.`,
        });
      }
      i = runEnd + 1;
      continue;
    }
    i++;
  }
  return violations;
}

async function lintFile(path) {
  let src;
  try {
    src = await readFile(path, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  return findViolations(src).map((v) => ({ ...v, path }));
}

export async function main(argv) {
  const args = argv.slice(2);
  const mode = args[0];
  let files;
  if (mode === "--staged") {
    files = await listStagedFiles();
  } else if (mode === "--files") {
    files = args.slice(1);
  } else {
    process.stderr.write(
      "Usage:\n  node scripts/hooks/lint-comments.mjs --staged\n  node scripts/hooks/lint-comments.mjs --files <path> [...]\n",
    );
    process.exit(2);
  }
  const targets = files.filter(isLintable);
  const violations = (await Promise.all(targets.map(lintFile))).flat();
  if (violations.length === 0) {
    if (mode === "--staged")
      process.stdout.write(
        "lint-comments: no multi-line comments in staged diff.\n",
      );
    return;
  }
  for (const v of violations) process.stderr.write(`${formatViolation(v)}\n`);
  process.stderr.write(
    `\nlint-comments: ${violations.length} violation(s). Rule: comments must be one line; doc comments (/** */, ///, //!) are exempt.\n`,
  );
  process.exit(1);
}

/* v8 ignore next 6 */
if (isInvokedAsScript(import.meta.url)) {
  main(process.argv).catch((err) => {
    process.stderr.write(`lint-comments: ${err.message ?? err}\n`);
    process.exit(2);
  });
}
