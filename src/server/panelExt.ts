/**
 * Client-side augmentation injected into the prebuilt panel's index.html at
 * serve time (the bundle has no source, so its rules table can't be edited
 * directly). Adds a "Fix" column after "Action" from the additive `actions`
 * field on /api/rules. Idempotent + MutationObserver-driven so it survives the
 * panel's React re-renders (search, filter, toggle) without re-entrant loops.
 */
export const PANEL_EXT = `(() => {
  const KINDS = ["script", "inferred", "output"];
  let fixesBySlug = {};

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function fixHtml(actions) {
    if (!Array.isArray(actions) || actions.length === 0) {
      return '<span class="co-fix-none">—</span>';
    }
    const items = actions.map((a) => {
      const kind = KINDS.includes(a.kind) ? a.kind : "output";
      const target = a.scriptPath || (a.scriptBody ? "(inline script)" : "");
      const path = target ? ' <span class="co-fix-path">' + esc(target) + "</span>" : "";
      const desc = a.description ? '<div class="co-fix-desc">' + esc(a.description) + "</div>" : "";
      return '<div class="co-fix"><div><span class="co-kind co-kind-' + kind + '">' +
        esc(a.kind) + "</span>" + path + "</div>" + desc + "</div>";
    }).join("");
    const label = actions.length + (actions.length === 1 ? " fix" : " fixes");
    return '<details class="co-fix-dd"><summary class="co-fix-summary">' + label +
      '</summary><div class="co-fix-list">' + items + "</div></details>";
  }

  function decorate() {
    const table = document.querySelector("table");
    if (!table) return;
    const headRow = table.querySelector("thead tr");
    if (headRow && !headRow.querySelector(".co-fix-th")) {
      const th = document.createElement("th");
      th.className = "px-4 py-2.5 font-medium co-fix-th";
      th.textContent = "Fix";
      headRow.appendChild(th);
    }
    for (const tr of table.querySelectorAll("tbody tr")) {
      const slugEl = tr.querySelector(".font-mono");
      const slug = slugEl ? slugEl.textContent.trim() : null;
      let cell = tr.querySelector(".co-fix-td");
      if (!cell) {
        cell = document.createElement("td");
        cell.className = "px-4 py-3 co-fix-td";
        tr.appendChild(cell);
      }
      const html = fixHtml(slug ? fixesBySlug[slug] : null);
      if (cell.getAttribute("data-co") !== html) {
        cell.innerHTML = html;
        cell.setAttribute("data-co", html);
      }
    }
  }

  function injectStyle() {
    const style = document.createElement("style");
    style.textContent =
      ".co-fix{padding:2px 0}.co-fix + .co-fix{margin-top:6px;border-top:1px solid #f1f5f9;padding-top:6px}" +
      ".co-kind{display:inline-block;font-size:11px;font-weight:600;padding:1px 6px;border-radius:4px;text-transform:uppercase;letter-spacing:.03em}" +
      ".co-kind-script{background:#dcfce7;color:#166534}.co-kind-inferred{background:#e0e7ff;color:#3730a3}.co-kind-output{background:#f1f5f9;color:#475569}" +
      ".co-fix-path{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#0f172a}" +
      ".co-fix-desc{color:#64748b;font-size:12px;margin-top:2px}.co-fix-none{color:#cbd5e1}" +
      ".co-fix-dd{display:inline-block}" +
      ".co-fix-summary{cursor:pointer;list-style:none;display:inline-flex;align-items:center;gap:6px;border:1px solid #cbd5e1;border-radius:6px;padding:4px 10px;font-size:13px;color:#334155;background:#fff}" +
      ".co-fix-summary::-webkit-details-marker{display:none}" +
      '.co-fix-summary::before{content:"▸";font-size:10px;color:#94a3b8}' +
      '.co-fix-dd[open] .co-fix-summary::before{content:"▾"}' +
      ".co-fix-list{margin-top:6px}";
    document.head.appendChild(style);
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; decorate(); }, 0);
  }

  async function loadFixes() {
    const res = await fetch("/api/rules");
    if (!res.ok) throw new Error("GET /api/rules -> " + res.status);
    const rules = await res.json();
    fixesBySlug = {};
    for (const r of rules) fixesBySlug[r.slug] = r.actions || [];
  }

  async function start() {
    injectStyle();
    await loadFixes();
    const root = document.getElementById("root") || document.body;
    new MutationObserver(schedule).observe(root, { childList: true, subtree: true });
    decorate();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { start(); });
  } else {
    start();
  }
})();
`;
