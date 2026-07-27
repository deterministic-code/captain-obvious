/**
 * A standalone page (served at GET /fixes) that renders each rule's remediation
 * actions from the `fixes` table — the `actions` array on /api/rules that the
 * prebuilt panel ignores. Self-contained HTML/CSS/JS so it needs no bundle
 * source and ships in `dist` like the rest of the server.
 */
export const FIXES_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Captain Obvious — Fixes</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #1f2937; background: #f8fafc;
  }
  header {
    display: flex; align-items: baseline; gap: 12px;
    padding: 20px 28px; border-bottom: 1px solid #e5e7eb; background: #fff;
  }
  header h1 { font-size: 18px; margin: 0; }
  header .tag {
    font-size: 12px; color: #6b7280; background: #f1f5f9;
    padding: 2px 8px; border-radius: 999px;
  }
  header a { margin-left: auto; color: #059669; text-decoration: none; font-size: 13px; }
  header a:hover { text-decoration: underline; }
  main { padding: 24px 28px; }
  .count { color: #6b7280; margin: 0 0 16px; }
  table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
  th { text-align: left; font-size: 11px; letter-spacing: .04em; text-transform: uppercase; color: #6b7280; padding: 12px 16px; border-bottom: 1px solid #e5e7eb; }
  td { padding: 14px 16px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  .rule-name { font-weight: 600; }
  .slug { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #6b7280; }
  .stage { font-size: 12px; color: #6b7280; }
  .fix { display: flex; flex-direction: column; gap: 3px; padding: 6px 0; }
  .fix + .fix { border-top: 1px solid #f1f5f9; margin-top: 6px; }
  .kind {
    display: inline-block; font-size: 11px; font-weight: 600; padding: 1px 7px;
    border-radius: 4px; text-transform: uppercase; letter-spacing: .03em;
  }
  .kind.script { background: #dcfce7; color: #166534; }
  .kind.inferred { background: #e0e7ff; color: #3730a3; }
  .kind.output { background: #f1f5f9; color: #475569; }
  .script-path { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #0f172a; }
  .fix-desc { color: #475569; }
  .error { color: #b91c1c; padding: 16px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; }
</style>
</head>
<body>
<header>
  <h1>Captain Obvious</h1>
  <span class="tag">fixes</span>
  <a href="/">&larr; control panel</a>
</header>
<main>
  <p class="count" id="count">Loading…</p>
  <div id="content"></div>
</main>
<script>
  const KINDS = ["script", "inferred", "output"];
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function renderFix(action) {
    const wrap = el("div", "fix");
    const head = el("div");
    const kind = KINDS.includes(action.kind) ? action.kind : "output";
    head.appendChild(el("span", "kind " + kind, action.kind));
    if (action.scriptPath) {
      head.appendChild(document.createTextNode(" "));
      head.appendChild(el("span", "script-path", action.scriptPath));
    } else if (action.scriptBody) {
      head.appendChild(document.createTextNode(" "));
      head.appendChild(el("span", "script-path", "(inline script)"));
    }
    wrap.appendChild(head);
    if (action.description) wrap.appendChild(el("div", "fix-desc", action.description));
    return wrap;
  }
  async function load() {
    const res = await fetch("/api/rules");
    if (!res.ok) throw new Error("GET /api/rules -> " + res.status);
    const rules = await res.json();
    const withFix = rules.filter((r) => Array.isArray(r.actions) && r.actions.length > 0);
    const count = document.getElementById("count");
    count.textContent =
      withFix.length + " of " + rules.length + " rules have a fix action" +
      (withFix.length < rules.length ? " (the rest detect only)" : "");
    const content = document.getElementById("content");
    content.textContent = "";
    if (withFix.length === 0) return;
    const table = el("table");
    const thead = el("thead");
    const hrow = el("tr");
    ["Rule", "Stage", "Fix"].forEach((h) => hrow.appendChild(el("th", null, h)));
    thead.appendChild(hrow);
    table.appendChild(thead);
    const tbody = el("tbody");
    for (const r of withFix) {
      const tr = el("tr");
      const ruleCell = el("td");
      ruleCell.appendChild(el("div", "rule-name", r.name));
      ruleCell.appendChild(el("div", "slug", r.slug));
      tr.appendChild(ruleCell);
      tr.appendChild(el("td", "stage", r.stage || "—"));
      const fixCell = el("td");
      for (const a of r.actions) fixCell.appendChild(renderFix(a));
      tr.appendChild(fixCell);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    content.appendChild(table);
  }
  load().catch((err) => {
    document.getElementById("count").textContent = "";
    const content = document.getElementById("content");
    content.textContent = "";
    content.appendChild(el("div", "error", "Failed to load fixes: " + (err && err.message ? err.message : err)));
  });
</script>
</body>
</html>
`;
