/**
 * Client-side augmentation injected into the prebuilt panel's index.html at
 * serve time (the bundle has no source, so its rules table can't be edited
 * directly). On top of the panel it adds, all from additive /api fields:
 *   - a "Fix" column (the rule's `actions`),
 *   - an editable "Languages" column (per-rule `languages`, PATCHed on change),
 *   - multiselect Category + Language filters that replace the panel's native
 *     single-select category dropdown and drive row visibility.
 * Idempotent + MutationObserver-driven so it survives the panel's React
 * re-renders (search, filter, toggle) without re-entrant loops. Uses string
 * concatenation (no nested template literals) since it lives in one.
 */
export const PANEL_EXT = `(() => {
  const KINDS = ["script", "inferred", "output"];
  let fixesBySlug = {};
  let langsBySlug = {};
  let catsBySlug = {};
  let supportedLangs = [];
  let nameBySlug = {};
  let allCategories = [];
  const selectedCats = new Set();
  const selectedLangs = new Set();

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function rowSlug(tr) {
    const el = tr.querySelector(".font-mono");
    return el ? el.textContent.trim() : null;
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

  // A <details> dropdown of checkbox items. Returns the parts so callers can
  // wire their own change handler (filters re-filter; the row editor PATCHes).
  function checkboxDropdown(summaryText, items) {
    const details = document.createElement("details");
    details.className = "co-dd";
    const summary = document.createElement("summary");
    summary.className = "co-dd-summary";
    summary.textContent = summaryText;
    details.appendChild(summary);
    const list = document.createElement("div");
    list.className = "co-dd-list";
    for (const it of items) {
      const label = document.createElement("label");
      label.className = "co-dd-item";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = it.value;
      cb.checked = it.checked;
      label.appendChild(cb);
      const span = document.createElement("span");
      span.textContent = it.label;
      label.appendChild(span);
      list.appendChild(label);
    }
    details.appendChild(list);
    return { details, summary, list };
  }

  function langLabel(slugs) {
    return slugs.length ? slugs.map((s) => nameBySlug[s] || s).join(", ") : "—";
  }

  async function patchLanguages(slug, languages) {
    const res = await fetch("/api/rules/" + encodeURIComponent(slug), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ languages }),
    });
    if (!res.ok) throw new Error("PATCH /api/rules/" + slug + " -> " + res.status);
  }

  function buildLangCell(cell, slug) {
    const current = langsBySlug[slug] || [];
    const items = supportedLangs.map((l) => ({
      value: l.slug,
      label: l.name,
      checked: current.indexOf(l.slug) !== -1,
    }));
    const dd = checkboxDropdown(langLabel(current), items);
    dd.details.classList.add("co-lang-dd");
    dd.list.addEventListener("change", async () => {
      const checked = Array.prototype.slice
        .call(dd.list.querySelectorAll("input:checked"))
        .map((i) => i.value);
      try {
        await patchLanguages(slug, checked);
      } catch (err) {
        window.alert("Failed to update languages for " + slug + ": " + err.message);
        buildLangCell(cell, slug);
        return;
      }
      langsBySlug[slug] = checked;
      dd.summary.textContent = langLabel(checked);
      cell.setAttribute("data-langs", checked.slice().sort().join(","));
      applyFilter();
    });
    cell.innerHTML = "";
    cell.appendChild(dd.details);
    cell.setAttribute("data-langs", current.slice().sort().join(","));
  }

  function findCategorySelect() {
    for (const s of document.querySelectorAll("select")) {
      for (const o of s.options) {
        if (o.textContent.trim() === "All categories") return s;
      }
    }
    return null;
  }

  function filterLabel(base, set) {
    return set.size ? base + " (" + set.size + ")" : base + ": all";
  }

  function buildFilterDropdown(base, options, set) {
    const dd = checkboxDropdown(
      filterLabel(base, set),
      options.map((o) => ({ value: o.value, label: o.label, checked: set.has(o.value) })),
    );
    dd.list.addEventListener("change", (e) => {
      if (e.target.checked) set.add(e.target.value);
      else set.delete(e.target.value);
      dd.summary.textContent = filterLabel(base, set);
      applyFilter();
    });
    return dd;
  }

  // The panel's own category <select> filters its React list; we hide it (so it
  // stays on "all") and inject multiselect Category + Language dropdowns beside
  // it, then do the actual row filtering ourselves in applyFilter().
  function setupFilters() {
    const nativeSel = findCategorySelect();
    if (!nativeSel || !nativeSel.parentElement) return;
    nativeSel.style.display = "none";
    if (nativeSel.parentElement.querySelector(".co-filter-cats")) return;
    const catDd = buildFilterDropdown(
      "Categories",
      allCategories.map((c) => ({ value: c, label: c })),
      selectedCats,
    );
    catDd.details.classList.add("co-filter-cats");
    const langDd = buildFilterDropdown(
      "Languages",
      supportedLangs.map((l) => ({ value: l.slug, label: l.name })),
      selectedLangs,
    );
    langDd.details.classList.add("co-filter-langs");
    nativeSel.insertAdjacentElement("afterend", catDd.details);
    catDd.details.insertAdjacentElement("afterend", langDd.details);
  }

  function applyFilter() {
    const table = document.querySelector("table");
    if (!table) return;
    for (const tr of table.querySelectorAll("tbody tr")) {
      const slug = rowSlug(tr);
      const cats = (slug && catsBySlug[slug]) || [];
      const langs = (slug && langsBySlug[slug]) || [];
      const okCat = selectedCats.size === 0 || cats.some((c) => selectedCats.has(c));
      const okLang = selectedLangs.size === 0 || langs.some((l) => selectedLangs.has(l));
      tr.style.display = okCat && okLang ? "" : "none";
    }
  }

  function addHeader(headRow, cls, text) {
    if (headRow.querySelector("." + cls)) return;
    const th = document.createElement("th");
    th.className = "px-4 py-2.5 font-medium " + cls;
    th.textContent = text;
    headRow.appendChild(th);
  }

  function decorate() {
    const table = document.querySelector("table");
    if (!table) return;
    const headRow = table.querySelector("thead tr");
    if (headRow) {
      addHeader(headRow, "co-fix-th", "Fix");
      addHeader(headRow, "co-lang-th", "Languages");
    }
    for (const tr of table.querySelectorAll("tbody tr")) {
      const slug = rowSlug(tr);
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
      let lcell = tr.querySelector(".co-lang-td");
      if (!lcell) {
        lcell = document.createElement("td");
        lcell.className = "px-4 py-3 co-lang-td";
        tr.appendChild(lcell);
      }
      const sig = ((slug ? langsBySlug[slug] : null) || []).slice().sort().join(",");
      if (slug && lcell.getAttribute("data-langs") !== sig) buildLangCell(lcell, slug);
    }
    setupFilters();
    applyFilter();
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
      ".co-fix-list{margin-top:6px}" +
      ".co-dd{display:inline-block;position:relative}" +
      ".co-dd-summary{cursor:pointer;list-style:none;display:inline-flex;align-items:center;gap:6px;max-width:16rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:1px solid #cbd5e1;border-radius:6px;padding:4px 10px;font-size:13px;color:#334155;background:#fff}" +
      ".co-dd-summary::-webkit-details-marker{display:none}" +
      '.co-dd-summary::after{content:"▾";font-size:10px;color:#94a3b8;margin-left:auto}' +
      ".co-dd-list{position:absolute;z-index:30;margin-top:4px;min-width:170px;max-height:260px;overflow:auto;background:#fff;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 8px 24px rgba(15,23,42,.12);padding:6px}" +
      ".co-dd-item{display:flex;align-items:center;gap:8px;padding:4px 8px;font-size:13px;color:#334155;border-radius:6px;cursor:pointer;white-space:nowrap}" +
      ".co-dd-item:hover{background:#f1f5f9}" +
      ".co-filter-cats,.co-filter-langs{margin-left:8px;vertical-align:middle}";
    document.head.appendChild(style);
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; decorate(); }, 0);
  }

  async function loadData() {
    const rulesRes = await fetch("/api/rules");
    if (!rulesRes.ok) throw new Error("GET /api/rules -> " + rulesRes.status);
    const metaRes = await fetch("/api/meta");
    if (!metaRes.ok) throw new Error("GET /api/meta -> " + metaRes.status);
    const rules = await rulesRes.json();
    const meta = await metaRes.json();
    fixesBySlug = {};
    langsBySlug = {};
    catsBySlug = {};
    const cats = new Set();
    for (const r of rules) {
      fixesBySlug[r.slug] = r.actions || [];
      langsBySlug[r.slug] = r.languages || [];
      catsBySlug[r.slug] = r.categories || [];
      for (const c of r.categories || []) cats.add(c);
    }
    allCategories = Array.from(cats).sort();
    supportedLangs = meta.languages || [];
    nameBySlug = {};
    for (const l of supportedLangs) nameBySlug[l.slug] = l.name;
  }

  async function start() {
    injectStyle();
    await loadData();
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
