import ts from "typescript";

const NORMALIZED_KIND = new Map([
  [ts.SyntaxKind.Identifier, "Id"],
  [ts.SyntaxKind.PrivateIdentifier, "Id"],
  [ts.SyntaxKind.StringLiteral, "Str"],
  [ts.SyntaxKind.NoSubstitutionTemplateLiteral, "Str"],
  [ts.SyntaxKind.NumericLiteral, "Num"],
  [ts.SyntaxKind.BigIntLiteral, "Num"],
  [ts.SyntaxKind.RegularExpressionLiteral, "Regex"],
]);

/**
 * α-normalization: identifiers and literals collapse to their category so two
 * subtrees that differ only in names/values share a fingerprint. Template
 * expressions keep their interpolation structure; the literal chunks never
 * reach here because forEachChild does not descend into template text.
 */
function kindLabel(node) {
  const normalized = NORMALIZED_KIND.get(node.kind);
  if (normalized) return normalized;
  if (ts.isTemplateExpression(node)) return "Tmpl";
  return ts.SyntaxKind[node.kind];
}

function fingerprintNode(node) {
  let count = 1;
  const parts = [];
  node.forEachChild((child) => {
    const sub = fingerprintNode(child);
    count += sub.count;
    parts.push(sub.fp);
  });
  const label = kindLabel(node);
  const fp = parts.length ? `(${label} ${parts.join(" ")})` : label;
  return { fp, count };
}

export function fingerprint(node) {
  return fingerprintNode(node).fp;
}

function isCandidate(node) {
  return (
    ts.isObjectLiteralExpression(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

function lineOf(sf, pos) {
  return sf.getLineAndCharacterOfPosition(pos).line + 1;
}

/** The declared name of a function-like node — its own identifier, or the variable/property it's bound to for expression/arrow forms. `null` for anonymous nodes and object literals. */
export function subtreeName(node) {
  if (
    node.name &&
    (ts.isIdentifier(node.name) || ts.isPrivateIdentifier(node.name))
  ) {
    return node.name.text;
  }
  const p = node.parent;
  if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) {
    return p.name.text;
  }
  if (
    p &&
    (ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p)) &&
    p.name &&
    (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))
  ) {
    return p.name.text;
  }
  return null;
}

export function collectSubtrees(sf, { minNodes = 12 } = {}) {
  const out = [];
  const visit = (node) => {
    if (isCandidate(node)) {
      const { fp, count } = fingerprintNode(node);
      if (count >= minNodes) {
        out.push({
          fp,
          name: subtreeName(node),
          start: lineOf(sf, node.getStart(sf)),
          end: lineOf(sf, node.getEnd()),
          nodeCount: count,
          kind: ts.SyntaxKind[node.kind],
        });
      }
    }
    node.forEachChild(visit);
  };
  visit(sf);
  return out;
}

function propKey(name) {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

/**
 * A "table entry" is a property whose value is an object literal built only from
 * `key: value` pairs — the shape of a per-language convention row. Shorthand,
 * spreads, or computed keys make the row un-analyzable, so we bail to null.
 */
export function objectShape(node) {
  if (!ts.isObjectLiteralExpression(node)) return null;
  const props = [];
  for (const prop of node.properties) {
    if (!ts.isPropertyAssignment(prop)) return null;
    const key = propKey(prop.name);
    if (key === null) return null;
    props.push({ key, valueFp: fingerprint(prop.initializer) });
  }
  if (props.length === 0) return null;
  return { keys: props.map((p) => p.key).sort(), props };
}
