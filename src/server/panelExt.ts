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
  let runRoot = "";
  let runnableSlugs = [];
  let slugList = [];
  const selectedSlugs = new Set();
  let runActive = false;
  let running = false;

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
    injectRunTab();
    syncRunView();
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
      ".co-filter-cats,.co-filter-langs{margin-left:8px;vertical-align:middle}" +
      ".co-run-tab{cursor:pointer}.co-run-tab-active{font-weight:700}" +
      "#co-run-overlay{padding:24px 28px;font-family:inherit}" +
      ".co-run-wrap{max-width:1000px;margin:0 auto}" +
      ".co-run-head{display:flex;align-items:center;gap:12px;margin-bottom:18px}" +
      ".co-run-back{cursor:pointer;font-size:13px;font-weight:600;padding:5px 12px;border-radius:6px;border:1px solid #cbd5e1;background:#fff;color:#334155}" +
      ".co-run-back:hover{background:#f1f5f9}" +
      ".co-run-title{font-size:20px;font-weight:700;color:#0f172a}" +
      ".co-run-field{margin-bottom:16px}" +
      ".co-run-field label{display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px}" +
      ".co-run-path{width:100%;box-sizing:border-box;padding:7px 10px;font-size:13px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;border:1px solid #cbd5e1;border-radius:6px;outline:none}" +
      ".co-run-path:focus{border-color:#94a3b8}" +
      ".co-run-picker{border:1px solid #e2e8f0;border-radius:8px;margin-bottom:16px}" +
      ".co-run-picker-head{display:flex;align-items:center;gap:12px;padding:8px;border-bottom:1px solid #f1f5f9}" +
      ".co-run-search{flex:1}" +
      ".co-run-picker-list{max-height:320px;overflow:auto;padding:6px}" +
      ".co-run-group{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#94a3b8;padding:8px 8px 4px}" +
      ".co-run-rule-item span{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}" +
      ".co-run-actions{display:flex;align-items:center;gap:12px;margin-bottom:18px}" +
      ".co-run-btn{cursor:pointer;font-size:14px;font-weight:600;padding:8px 20px;border-radius:6px;border:1px solid #0f172a;background:#0f172a;color:#fff}" +
      ".co-run-btn:hover{background:#1e293b}.co-run-btn:disabled{cursor:not-allowed;opacity:.45}" +
      ".co-run-status{font-size:13px;color:#64748b}" +
      ".co-run-results{display:flex;flex-direction:column;gap:14px}" +
      ".co-run-rule{border:1px solid #e2e8f0;border-radius:8px;overflow:hidden}" +
      ".co-run-rule-head{display:flex;align-items:center;gap:10px;padding:10px 14px;background:#f8fafc;border-bottom:1px solid #f1f5f9}" +
      ".co-run-slug{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;font-weight:600;color:#0f172a}" +
      ".co-run-pill{font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px}" +
      ".co-run-pill-ok{background:#dcfce7;color:#166534}.co-run-pill-n{background:#fee2e2;color:#991b1b}.co-run-pill-err{background:#fef3c7;color:#92400e}" +
      ".co-run-file{padding:8px 14px}.co-run-file + .co-run-file{border-top:1px solid #f8fafc}" +
      ".co-run-file-name{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#475569;margin-bottom:4px}" +
      ".co-run-vio{font-size:13px;padding:2px 0 2px 12px;display:flex;gap:8px;align-items:baseline}" +
      ".co-run-loc{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#94a3b8;min-width:44px}" +
      ".co-run-detail{color:#334155}" +
      ".co-run-empty,.co-run-error{font-size:13px;color:#64748b;padding:8px}.co-run-error{color:#991b1b}";
    document.head.appendChild(style);
  }

  async function loadRunMeta() {
    const res = await fetch("/api/run/meta");
    if (!res.ok) throw new Error("GET /api/run/meta -> " + res.status);
    const meta = await res.json();
    runRoot = meta.root || "";
    runnableSlugs = meta.runnableSlugs || [];
  }

  function runnableRules() {
    const ok = new Set(runnableSlugs);
    return slugList.filter((r) => ok.has(r.slug));
  }

  // The panel bundle owns the nav; we locate it by a leaf element whose text is a
  // known tab ("Rules"/"Profiling"), clone it into a "Run" tab, and re-inject
  // idempotently on every observer tick (a native tab click re-renders it away).
  // Anchor on the "Rules" tab when present (so Run sits right beside it); fall
  // back to the first known tab if the panel ever renames it.
  function findNav() {
    const wanted = ["rules", "profiling"];
    let fallback = null;
    for (const el of document.querySelectorAll("button, a, [role=tab], nav *")) {
      if (el.children.length !== 0) continue;
      const txt = (el.textContent || "").trim().toLowerCase();
      if (txt === "rules") return { nav: el.parentElement, anchor: el };
      if (wanted.indexOf(txt) !== -1 && !fallback) fallback = el;
    }
    if (fallback && fallback.parentElement) {
      return { nav: fallback.parentElement, anchor: fallback };
    }
    return null;
  }

  function injectRunTab() {
    const found = findNav();
    if (!found || !found.nav || found.nav.querySelector(".co-run-tab")) return;
    const tab = found.anchor.cloneNode(true);
    tab.classList.add("co-run-tab");
    tab.textContent = "Run";
    tab.removeAttribute("aria-selected");
    // The panel's tabs are router <a href> links; without preventDefault the
    // clone would navigate to the Rules route instead of opening our overlay.
    tab.removeAttribute("href");
    tab.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      runActive = true;
      syncRunView();
    });
    found.anchor.insertAdjacentElement("afterend", tab);
  }

  // The overlay lives OUTSIDE #root so React never reconciles it away; showing it
  // hides #root wholesale (nav included) and a Back button returns to the panel.
  function syncRunView() {
    const root = document.getElementById("root");
    const overlay = document.getElementById("co-run-overlay");
    if (!root || !overlay) return;
    overlay.style.display = runActive ? "block" : "none";
    root.style.display = runActive ? "none" : "";
    const tab = document.querySelector(".co-run-tab");
    if (tab) tab.classList.toggle("co-run-tab-active", runActive);
  }

  function updateRunGate() {
    const btn = document.getElementById("co-run-btn");
    if (btn) btn.disabled = running || selectedSlugs.size === 0;
    const status = document.getElementById("co-run-status");
    if (status && !running) {
      status.textContent = selectedSlugs.size ? selectedSlugs.size + " selected" : "";
    }
  }

  function buildRulePicker(container) {
    container.innerHTML = "";
    const rules = runnableRules();

    const head = document.createElement("div");
    head.className = "co-run-picker-head";
    const search = document.createElement("input");
    search.type = "text";
    search.className = "co-dd-search co-run-search";
    search.placeholder = "Search rules…";
    head.appendChild(search);
    const allLabel = document.createElement("label");
    allLabel.className = "co-dd-item co-dd-all-item";
    const allBox = document.createElement("input");
    allBox.type = "checkbox";
    allBox.className = "co-run-all";
    allLabel.appendChild(allBox);
    const allSpan = document.createElement("span");
    allSpan.textContent = "All " + rules.length + " rules";
    allLabel.appendChild(allSpan);
    head.appendChild(allLabel);
    container.appendChild(head);

    const list = document.createElement("div");
    list.className = "co-run-picker-list";
    container.appendChild(list);

    const rows = [];
    const byCat = {};
    for (const r of rules) {
      const cat = r.categories[0] || "other";
      (byCat[cat] = byCat[cat] || []).push(r);
    }
    for (const cat of Object.keys(byCat).sort()) {
      const group = document.createElement("div");
      group.className = "co-run-group";
      group.textContent = cat;
      list.appendChild(group);
      for (const r of byCat[cat]) {
        const label = document.createElement("label");
        label.className = "co-dd-item co-run-rule-item";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.className = "co-run-opt";
        cb.value = r.slug;
        cb.checked = selectedSlugs.has(r.slug);
        label.appendChild(cb);
        const span = document.createElement("span");
        span.textContent = r.slug;
        label.appendChild(span);
        list.appendChild(label);
        rows.push({ label, box: cb, text: (r.slug + " " + r.name).toLowerCase() });
      }
    }

    function syncAll() {
      allBox.checked = rows.length > 0 && selectedSlugs.size === rows.length;
    }
    syncAll();

    list.addEventListener("change", (e) => {
      if (!e.target.classList.contains("co-run-opt")) return;
      if (e.target.checked) selectedSlugs.add(e.target.value);
      else selectedSlugs.delete(e.target.value);
      syncAll();
      updateRunGate();
    });
    allBox.addEventListener("change", () => {
      selectedSlugs.clear();
      if (allBox.checked) for (const r of rows) selectedSlugs.add(r.box.value);
      for (const r of rows) r.box.checked = allBox.checked;
      updateRunGate();
    });
    search.addEventListener("input", () => {
      const q = search.value.trim().toLowerCase();
      for (const r of rows) {
        r.label.style.display = !q || r.text.indexOf(q) !== -1 ? "" : "none";
      }
    });
  }

  function buildRunView() {
    if (document.getElementById("co-run-overlay")) return;
    const root = document.getElementById("root");
    if (!root || !root.parentElement) return;

    const overlay = document.createElement("div");
    overlay.id = "co-run-overlay";
    overlay.style.display = "none";
    const wrap = document.createElement("div");
    wrap.className = "co-run-wrap";
    overlay.appendChild(wrap);

    const head = document.createElement("div");
    head.className = "co-run-head";
    const back = document.createElement("button");
    back.type = "button";
    back.className = "co-run-back";
    back.textContent = "← Back";
    back.addEventListener("click", () => {
      runActive = false;
      syncRunView();
    });
    const title = document.createElement("span");
    title.className = "co-run-title";
    title.textContent = "Run rules";
    head.appendChild(back);
    head.appendChild(title);
    wrap.appendChild(head);

    const field = document.createElement("div");
    field.className = "co-run-field";
    const flabel = document.createElement("label");
    flabel.textContent = "Target folder";
    const pathInput = document.createElement("input");
    pathInput.className = "co-run-path";
    pathInput.id = "co-run-path";
    pathInput.value = runRoot;
    field.appendChild(flabel);
    field.appendChild(pathInput);
    wrap.appendChild(field);

    const picker = document.createElement("div");
    picker.className = "co-run-picker";
    wrap.appendChild(picker);
    buildRulePicker(picker);

    const actions = document.createElement("div");
    actions.className = "co-run-actions";
    const runBtn = document.createElement("button");
    runBtn.type = "button";
    runBtn.className = "co-run-btn";
    runBtn.id = "co-run-btn";
    runBtn.textContent = "Run";
    runBtn.disabled = true;
    runBtn.addEventListener("click", () => { doRun(); });
    const status = document.createElement("span");
    status.className = "co-run-status";
    status.id = "co-run-status";
    actions.appendChild(runBtn);
    actions.appendChild(status);
    wrap.appendChild(actions);

    const results = document.createElement("div");
    results.className = "co-run-results";
    results.id = "co-run-results";
    wrap.appendChild(results);

    root.parentElement.insertBefore(overlay, root.nextSibling);
  }

  function renderViolations(violations) {
    const byFile = {};
    for (const v of violations) {
      const p = v.path || "(unknown)";
      (byFile[p] = byFile[p] || []).push(v);
    }
    let html = "";
    for (const path of Object.keys(byFile).sort()) {
      html += '<div class="co-run-file"><div class="co-run-file-name">' +
        esc(path) + "</div>";
      for (const v of byFile[path]) {
        html += '<div class="co-run-vio"><span class="co-run-loc">' +
          esc(v.line + ":" + v.col) +
          '</span> <span class="co-kind co-kind-output">' + esc(v.kind) +
          '</span> <span class="co-run-detail">' + esc(v.detail) + "</span></div>";
      }
      html += "</div>";
    }
    return html;
  }

  function renderResults(data) {
    const results = document.getElementById("co-run-results");
    if (!results) return;
    if (!Array.isArray(data) || data.length === 0) {
      results.innerHTML = '<div class="co-run-empty">No results.</div>';
      return;
    }
    let html = "";
    for (const r of data) {
      const count = (r.violations || []).length;
      html += '<div class="co-run-rule"><div class="co-run-rule-head">' +
        '<span class="co-run-slug">' + esc(r.slug) + "</span>";
      if (!r.ok) {
        html += '<span class="co-run-pill co-run-pill-err">' +
          esc(r.error || "error") + "</span>";
      } else if (count === 0) {
        html += '<span class="co-run-pill co-run-pill-ok">no violations</span>';
      } else {
        html += '<span class="co-run-pill co-run-pill-n">' + count +
          (count === 1 ? " violation" : " violations") + "</span>";
      }
      html += "</div>";
      if (r.ok && count > 0) html += renderViolations(r.violations);
      html += "</div>";
    }
    results.innerHTML = html;
  }

  async function doRun() {
    if (running || selectedSlugs.size === 0) return;
    const pathInput = document.getElementById("co-run-path");
    const status = document.getElementById("co-run-status");
    const results = document.getElementById("co-run-results");
    running = true;
    updateRunGate();
    if (status) status.textContent = "Running " + selectedSlugs.size + " rule(s)…";
    if (results) results.innerHTML = "";
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slugs: Array.from(selectedSlugs),
          path: pathInput ? pathInput.value.trim() : "",
        }),
      });
      if (!res.ok) {
        const msg = await res.json().then((b) => b.error, () => "");
        throw new Error(msg || "POST /api/run -> " + res.status);
      }
      renderResults(await res.json());
      if (status) status.textContent = "";
    } catch (err) {
      if (results) {
        results.innerHTML = '<div class="co-run-error">' + esc(err.message) + "</div>";
      }
      if (status) status.textContent = "";
    } finally {
      running = false;
      updateRunGate();
    }
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
    slugList = rules.map((r) => ({
      slug: r.slug,
      name: r.name,
      categories: r.categories || [],
    }));
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
    await loadRunMeta();
    buildRunView();
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
