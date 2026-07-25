import { describe, expect, test } from "vitest";
import {
  findViolations,
  isEmitterFile,
  FORBIDDEN,
} from "../lint-emitter-casing.mjs";

const imp = (names) =>
  `import { ${names} } from "@deterministic-code/emitter-sdk/case";\n`;

describe("isEmitterFile", () => {
  test("emit-*.mjs and *-emit.mjs under scripts/codegen/lib are in the fence", () => {
    for (const p of [
      "scripts/codegen/lib/emit-services-typescript.mjs",
      "scripts/codegen/lib/services-emit.mjs",
      "scripts/codegen/lib/emit-service-tests-rust.mjs",
    ])
      expect(isEmitterFile(p)).toBe(true);
  });

  test("colocated __tests__, non-lib, and non-mjs files are outside the fence", () => {
    for (const p of [
      "scripts/codegen/lib/__tests__/emit-routes-rust.test.mjs",
      "scripts/codegen/build-performance-plan.mjs",
      "scripts/codegen/lib/emit-services-typescript.ts",
      "emitter-sdk/src/codegen-naming.mjs",
    ])
      expect(isEmitterFile(p)).toBe(false);
  });
});

describe("findViolations", () => {
  test("flags a forbidden helper call imported from the case module", () => {
    const src = imp("toCase") + `const x = toCase(name, "Pascal");\n`;
    const v = findViolations(src);
    expect(v).toHaveLength(1);
    expect(v[0].kind).toContain("toCase");
    expect(v[0].line).toBe(2);
  });

  test("does not flag helpers that are not imported from the case module", () => {
    const src =
      `import { toCase } from "./local-helper.mjs";\n` +
      `const x = toCase(name, "Pascal");\n`;
    expect(findViolations(src)).toHaveLength(0);
  });

  test("respects `as` aliases — flags the local name", () => {
    const src =
      imp("snakeToPascal as toPascal") + `const c = toPascal(entity);\n`;
    const v = findViolations(src);
    expect(v).toHaveLength(1);
    expect(v[0].kind).toContain("snakeToPascal");
  });

  test("ignores the import line itself and matches only call sites", () => {
    const src = imp("kebabPlural");
    expect(findViolations(src)).toHaveLength(0);
  });

  test("same-line allow directive suppresses the violation", () => {
    const src =
      imp("camelPlural") +
      `const r = \`\${camelPlural(name)}Router\`; // lint-emitter-casing-allow: camelPlural\n`;
    expect(findViolations(src)).toHaveLength(0);
  });

  test("allow directive on the line above suppresses the violation", () => {
    const src =
      imp("toCase") +
      `// lint-emitter-casing-allow: toCase\n` +
      `const s = \`\${toCase(name, "Camel")}Schema\`;\n`;
    expect(findViolations(src)).toHaveLength(0);
  });

  test("allow directive naming a different ident does not suppress", () => {
    const src =
      imp("toCase") +
      `const s = toCase(name, "Camel"); // lint-emitter-casing-allow: camelPlural\n`;
    expect(findViolations(src)).toHaveLength(1);
  });

  test("bare allow directive (no ident) suppresses any helper on that line", () => {
    const src =
      imp("toCase") +
      `const s = toCase(name, "Camel"); // lint-emitter-casing-allow:\n`;
    expect(findViolations(src)).toHaveLength(0);
  });

  test("does not match a forbidden name inside a string literal", () => {
    const src = imp("toCase") + `const s = "call toCase(x) somewhere";\n`;
    expect(findViolations(src)).toHaveLength(0);
  });

  test("detects a forbidden call inside a template interpolation", () => {
    const src =
      imp("snakeToPascal") + "const c = `${snakeToPascal(name)}Service`;\n";
    const v = findViolations(src);
    expect(v).toHaveLength(1);
    expect(v[0].kind).toContain("snakeToPascal");
  });

  test("detects a forbidden call in an interpolation nested in a route path", () => {
    const src = imp("kebabPlural") + "const p = `/api/${kebabPlural(e)}`;\n";
    expect(findViolations(src)).toHaveLength(1);
  });

  test("ignores template literal TEXT that merely mentions a helper name", () => {
    const src = imp("toCase") + "const t = `see toCase(x) in docs`;\n";
    expect(findViolations(src)).toHaveLength(0);
  });

  test("a regex literal inside an interpolation does not corrupt detection", () => {
    const src =
      imp("kebabPlural") +
      'const p = `/api/${kebabPlural(e).replace(/_/g, "-")}`;\n';
    expect(findViolations(src)).toHaveLength(1);
  });

  test("string literals inside an interpolation do not hide a sibling call", () => {
    const src =
      imp("toCase") + 'const s = `${cond ? "x" : toCase(name, "Camel")}`;\n';
    expect(findViolations(src)).toHaveLength(1);
  });

  test("every forbidden identifier is detected", () => {
    for (const id of FORBIDDEN) {
      const src = imp(id) + `const x = ${id}(name);\n`;
      expect(findViolations(src).length).toBeGreaterThan(0);
    }
  });
});
