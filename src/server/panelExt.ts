/**
 * Client-side augmentation injected into the prebuilt panel's index.html at
 * serve time (the bundle has no source, so its rules table can't be edited
 * directly). On top of the panel it adds, all from additive /api fields:
 *   - a "Fix" column (the rule's `actions`),
 *   - an editable "Languages" column (per-rule `languages`, PATCHed on change),
 *     placed right after the native Category column,
 *   - multiselect Category + Language filters that replace the panel's native
 *     single-select category dropdown and drive row visibility.
 * Every multiselect shares one dropdown: a search box, a leading "All" toggle,
 * the checkbox options, and a Clear/Close footer.
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
  // A <details> multiselect that owns its selection state. The dropdown panel
  // carries a search box, a leading "All" toggle, the option checkboxes, and a
  // Clear/Close footer. opts.summaryFn(values)->text drives the closed label;
  // opts.onChange(values) fires on every selection change.
  function checkboxDropdown(opts) {
    const items = opts.items;
    const allValues = items.map((it) => it.value);
    const selected = new Set(opts.selected || []);

    const details = document.createElement("details");
    details.className = "co-dd";
    const summary = document.createElement("summary");
    summary.className = "co-dd-summary";
    details.appendChild(summary);

    const panel = document.createElement("div");
    panel.className = "co-dd-panel";

    const search = document.createElement("input");
    search.type = "text";
    search.className = "co-dd-search";
    search.placeholder = "Search…";
    panel.appendChild(search);

    const list = document.createElement("div");
    list.className = "co-dd-list";

    const allLabel = document.createElement("label");
    allLabel.className = "co-dd-item co-dd-all-item";
    const allBox = document.createElement("input");
    allBox.type = "checkbox";
    allBox.className = "co-dd-all";
    allLabel.appendChild(allBox);
    const allSpan = document.createElement("span");
    allSpan.textContent = "All";
    allLabel.appendChild(allSpan);
    list.appendChild(allLabel);

    const optItems = [];
    for (const it of items) {
      const label = document.createElement("label");
      label.className = "co-dd-item";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "co-dd-opt";
      cb.value = it.value;
      cb.checked = selected.has(it.value);
      label.appendChild(cb);
      const span = document.createElement("span");
      span.textContent = it.label;
      label.appendChild(span);
      list.appendChild(label);
      optItems.push({ label, box: cb, text: it.label.toLowerCase() });
    }
    panel.appendChild(list);

    const foot = document.createElement("div");
    foot.className = "co-dd-foot";
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "co-dd-clear";
    clearBtn.textContent = "Clear";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "co-dd-close";
    closeBtn.textContent = "Close";
    foot.appendChild(clearBtn);
    foot.appendChild(closeBtn);
    panel.appendChild(foot);
    details.appendChild(panel);

    function syncAll() {
      allBox.checked = allValues.length > 0 && selected.size === allValues.length;
    }
    function emit() {
      summary.textContent = opts.summaryFn(Array.from(selected));
      opts.onChange(Array.from(selected));
    }
    syncAll();
    summary.textContent = opts.summaryFn(Array.from(selected));

    list.addEventListener("change", (e) => {
      const t = e.target;
      if (t === allBox) {
        selected.clear();
        if (t.checked) for (const v of allValues) selected.add(v);
        for (const o of optItems) o.box.checked = t.checked;
      } else if (t.classList.contains("co-dd-opt")) {
        if (t.checked) selected.add(t.value);
        else selected.delete(t.value);
        syncAll();
      } else {
        return;
      }
      emit();
    });
    clearBtn.addEventListener("click", () => {
      selected.clear();
      for (const o of optItems) o.box.checked = false;
      syncAll();
      emit();
    });
    closeBtn.addEventListener("click", () => { details.open = false; });
    search.addEventListener("input", () => {
      const q = search.value.trim().toLowerCase();
      for (const o of optItems) {
        o.label.style.display = !q || o.text.indexOf(q) !== -1 ? "" : "none";
      }
    });

    return { details, summary };
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
    const dd = checkboxDropdown({
      items: supportedLangs.map((l) => ({ value: l.slug, label: l.name })),
      selected: current,
      summaryFn: (vals) => langLabel(vals),
      onChange: async (vals) => {
        try {
          await patchLanguages(slug, vals);
        } catch (err) {
          window.alert("Failed to update languages for " + slug + ": " + err.message);
          buildLangCell(cell, slug);
          return;
        }
        langsBySlug[slug] = vals;
        cell.setAttribute("data-langs", vals.slice().sort().join(","));
        applyFilter();
      },
    });
    dd.details.classList.add("co-lang-dd");
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

  function filterLabel(base, count, total) {
    if (count === total) return base + ": all";
    if (count === 0) return base + ": none";
    return base + " (" + count + ")";
  }

  function buildFilterDropdown(base, options, set) {
    return checkboxDropdown({
      items: options,
      selected: Array.from(set),
      summaryFn: (vals) => filterLabel(base, vals.length, options.length),
      onChange: (vals) => {
        set.clear();
        for (const v of vals) set.add(v);
        applyFilter();
      },
    });
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
      // The selection drives the filter: a row passes when one of its
      // categories/languages is checked. A row with none of that metadata isn't
      // something the filter can exclude, so it always passes.
      const okCat = cats.length === 0 || cats.some((c) => selectedCats.has(c));
      const okLang = langs.length === 0 || langs.some((l) => selectedLangs.has(l));
      tr.style.display = okCat && okLang ? "" : "none";
    }
  }

  function addHeader(headRow, cls, text, ref) {
    if (headRow.querySelector("." + cls)) return;
    const th = document.createElement("th");
    th.className = "px-4 py-2.5 font-medium " + cls;
    th.textContent = text;
    if (ref) ref.insertAdjacentElement("afterend", th);
    else headRow.appendChild(th);
  }

  function decorate() {
    const table = document.querySelector("table");
    if (!table) return;
    const headRow = table.querySelector("thead tr");
    if (headRow) {
      addHeader(headRow, "co-fix-th", "Fix");
      // Languages sits right after the native Category column (index 1).
      addHeader(headRow, "co-lang-th", "Languages", headRow.children[1]);
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
        const catCell = tr.children[1];
        if (catCell) catCell.insertAdjacentElement("afterend", lcell);
        else tr.appendChild(lcell);
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
      ".co-dd-panel{position:absolute;z-index:30;margin-top:4px;min-width:190px;background:#fff;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 8px 24px rgba(15,23,42,.12);padding:6px}" +
      ".co-dd-search{width:100%;box-sizing:border-box;margin-bottom:6px;padding:5px 8px;font-size:13px;border:1px solid #cbd5e1;border-radius:6px;outline:none}" +
      ".co-dd-search:focus{border-color:#94a3b8}" +
      ".co-dd-list{max-height:220px;overflow:auto}" +
      ".co-dd-item{display:flex;align-items:center;gap:8px;padding:4px 8px;font-size:13px;color:#334155;border-radius:6px;cursor:pointer;white-space:nowrap}" +
      ".co-dd-item:hover{background:#f1f5f9}" +
      ".co-dd-all-item{font-weight:600;border-bottom:1px solid #f1f5f9;border-radius:0;margin-bottom:2px}" +
      ".co-dd-foot{display:flex;justify-content:space-between;gap:8px;margin-top:6px;border-top:1px solid #f1f5f9;padding-top:6px}" +
      ".co-dd-foot button{cursor:pointer;font-size:12px;font-weight:600;padding:4px 10px;border-radius:6px;border:1px solid #cbd5e1;background:#fff;color:#334155}" +
      ".co-dd-foot button:hover{background:#f1f5f9}" +
      ".co-dd-close{background:#0f172a;color:#fff;border-color:#0f172a}" +
      ".co-dd-close:hover{background:#1e293b}" +
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
    // Filters start with everything selected ("All"), so they show all rows
    // until the user narrows. The selection set IS the filter.
    selectedCats.clear();
    for (const c of allCategories) selectedCats.add(c);
    selectedLangs.clear();
    for (const l of supportedLangs) selectedLangs.add(l.slug);
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
