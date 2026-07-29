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
  let langIndependentBySlug = {};
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
  let browsePath = "";
  let violationsByPath = {};
  // Activity overlay: a global (not project-scoped) view of hook runs + config
  // changes. activityKeys drives the rule multiselect; activitySelectedRules is
  // the current filter; activityWindow is the time span.
  let activityActive = false;
  let activityKeys = [];
  const activitySelectedRules = new Set();
  let activityWindow = "7d";
  // Projects overlay the global catalog with their own enabled + language set;
  // the header selector switches which project the rules table reflects/edits.
  let projects = [];
  let currentProjectId = null;
  let enabledBySlug = {};
  // Column sort: sortKey names the active column (null = the catalog's natural
  // category/slug order); sortDir is 1 asc / -1 desc. The sort is re-applied on
  // every decorate() tick so a React re-render can't drop it.
  let sortKey = null;
  let sortDir = 1;
  // The full project-scoped rule view per slug (config, severity, languages) —
  // the source the Settings dialog reads. Severity selects pull env/action lists.
  let ruleBySlug = {};
  let environments = [];
  let actionTypes = [];
  const EXT_LANG = {
    ts: "typescript", tsx: "typescript",
    js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  };

  // Lucide (MIT) icons, inline so the column needs no font or network fetch.
  const svgIcon = (body) =>
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"' +
    ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"' +
    ' stroke-linejoin="round" aria-hidden="true">' + body + "</svg>";
  const ICON_RUN = svgIcon('<polygon points="6 3 20 12 6 21 6 3"/>');
  const ICON_ACTIVITY = svgIcon('<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>');
  const ICON_SETTINGS = svgIcon(
    '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  );
  const ICON_THEME_AUTO = svgIcon(
    '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
  );
  const ICON_THEME_LIGHT = svgIcon(
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  );
  const ICON_THEME_DARK = svgIcon('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>');
  const THEME_ICONS = { auto: ICON_THEME_AUTO, light: ICON_THEME_LIGHT, dark: ICON_THEME_DARK };
  const THEME_TITLES = { auto: "System theme", light: "Light theme", dark: "Dark theme" };
  const ICON_COPY = svgIcon(
    '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>' +
    '<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  );
  const ACTIONS_HTML =
    '<button type="button" class="co-act-btn" data-act="run" title="Run this rule" aria-label="Run this rule">' + ICON_RUN + "</button>" +
    '<button type="button" class="co-act-btn" data-act="activity" title="Open activity" aria-label="Open activity">' + ICON_ACTIVITY + "</button>" +
    '<button type="button" class="co-act-btn" data-act="settings" title="Project settings" aria-label="Project settings">' + ICON_SETTINGS + "</button>" +
    '<button type="button" class="co-act-btn" data-act="copy" title="Copy rule slug" aria-label="Copy rule slug">' + ICON_COPY + "</button>";

  // Transient status toasts (bottom-right), stacked and self-dismissing. Used for
  // the small config mutations the panel makes inline (enable, languages, save,
  // copy) that otherwise give no visible confirmation.
  const TOAST_ICONS = {
    success: svgIcon('<path d="M20 6 9 17l-5-5"/>'),
    error: svgIcon('<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>'),
    info: svgIcon('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'),
  };

  function toast(message, kind) {
    const k = TOAST_ICONS[kind] ? kind : "success";
    let region = document.getElementById("co-toast-region");
    if (!region) {
      region = document.createElement("div");
      region.id = "co-toast-region";
      document.body.appendChild(region);
    }
    const el = document.createElement("div");
    el.className = "co-toast co-toast-" + k;
    el.innerHTML = '<span class="co-toast-icon">' + TOAST_ICONS[k] + "</span>" +
      '<span class="co-toast-msg"></span>';
    el.querySelector(".co-toast-msg").textContent = message;
    let dismissed = false;
    const dismiss = () => {
      if (dismissed) return;
      dismissed = true;
      el.classList.add("co-toast-out");
      setTimeout(() => el.remove(), 200);
    };
    el.addEventListener("click", dismiss);
    region.appendChild(el);
    setTimeout(dismiss, 3200);
    return el;
  }

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

  // Rule edits are project-scoped: they write project_rules / project_rule_languages
  // for the selected project, never the global catalog.
  async function patchProjectRule(slug, patch) {
    const url =
      "/api/projects/" + currentProjectId + "/rules/" + encodeURIComponent(slug);
    const res = await fetch(url, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error("PATCH " + url + " -> " + res.status);
  }

  async function patchLanguages(slug, languages) {
    await patchProjectRule(slug, { languages });
  }

  function fixedLangDropdown(label) {
    const details = document.createElement("details");
    details.className = "co-dd co-lang-dd co-lang-independent";
    const summary = document.createElement("summary");
    summary.className = "co-dd-summary";
    summary.textContent = label;
    details.appendChild(summary);
    const panel = document.createElement("div");
    panel.className = "co-dd-panel";
    const item = document.createElement("div");
    item.className = "co-dd-item co-lang-independent-item";
    item.textContent = label;
    panel.appendChild(item);
    details.appendChild(panel);
    return details;
  }

  function buildLangCell(cell, slug) {
    if (langIndependentBySlug[slug]) {
      cell.innerHTML = "";
      cell.appendChild(fixedLangDropdown("Language independent"));
      cell.setAttribute("data-langs", "");
      return;
    }
    const current = langsBySlug[slug] || [];
    const dd = checkboxDropdown({
      items: supportedLangs.map((l) => ({ value: l.slug, label: l.name })),
      selected: current,
      summaryFn: (vals) => langLabel(vals),
      onChange: async (vals) => {
        try {
          await patchLanguages(slug, vals);
        } catch (err) {
          toast("Couldn't update languages for " + slug + ": " + err.message, "error");
          buildLangCell(cell, slug);
          return;
        }
        langsBySlug[slug] = vals;
        cell.setAttribute("data-langs", vals.slice().sort().join(","));
        applyFilter();
        toast("Updated languages for " + slug);
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

  // Maps a header cell to its sort key, or null when the column can't be sorted
  // (the actions column and the native Action text). Injected columns key off
  // their marker class; native ones off their label, so React re-renders that
  // recreate the <th> still resolve to the same key.
  const NUMERIC_SORT = { fix: 1, enabled: 1 };
  function headerSortKey(th) {
    if (th.classList.contains("co-fix-th")) return "fix";
    if (th.classList.contains("co-lang-th")) return "lang";
    if (th.classList.contains("co-act-th")) return null;
    const label = th.textContent.trim().toLowerCase();
    if (label === "rule") return "rule";
    if (label === "category") return "category";
    if (label === "stage") return "stage";
    if (label === "enabled") return "enabled";
    return null;
  }

  function sortValue(slug, key) {
    const rule = slug ? ruleBySlug[slug] : null;
    if (key === "fix") return ((slug && fixesBySlug[slug]) || []).length;
    if (key === "enabled") return slug && enabledBySlug[slug] ? 1 : 0;
    if (key === "lang") return ((slug && langsBySlug[slug]) || []).slice().sort().join(",");
    if (key === "category") return ((slug && catsBySlug[slug]) || [])[0] || "";
    if (key === "stage") return (rule && rule.stage) || "";
    return (rule && rule.name) || slug || "";
  }

  // Reorders the tbody rows in place; the filter's display:none is untouched, so
  // hidden rows just sort among themselves. Stable for equal keys because
  // Array.sort is stable and appendChild preserves the pre-sort DOM order.
  // Idempotent: decorate() re-runs this on every re-render tick, so when the DOM
  // is already sorted it must NOT re-append — detaching the row that holds an
  // open dropdown blurs its focused summary and scrolls the page to the top.
  function applySort() {
    if (!sortKey) return;
    const table = document.querySelector("table");
    const tbody = table && table.querySelector("tbody");
    if (!tbody) return;
    const numeric = !!NUMERIC_SORT[sortKey];
    const current = [...tbody.querySelectorAll("tr")];
    const rows = current.slice().sort((a, b) => {
      const av = sortValue(rowSlug(a), sortKey);
      const bv = sortValue(rowSlug(b), sortKey);
      const cmp = numeric ? av - bv : String(av).localeCompare(String(bv));
      return cmp * sortDir;
    });
    if (rows.every((tr, i) => tr === current[i])) return;
    for (const tr of rows) tbody.appendChild(tr);
  }

  // Marks every sortable header and flags the active one; the arrow itself is a
  // CSS ::after so it never lands in th.textContent (headerSortKey reads that).
  function updateSortIndicators() {
    const table = document.querySelector("table");
    const headRow = table && table.querySelector("thead tr");
    if (!headRow) return;
    for (const th of headRow.children) {
      th.classList.remove("co-sort-asc", "co-sort-desc");
      const key = headerSortKey(th);
      if (!key) continue;
      th.classList.add("co-sortable");
      if (sortKey === key) th.classList.add(sortDir === 1 ? "co-sort-asc" : "co-sort-desc");
    }
  }

  function onHeaderClick(e) {
    const th = e.target.closest && e.target.closest("thead th");
    if (!th || th.closest("table") !== document.querySelector("table")) return;
    const key = headerSortKey(th);
    if (!key) return;
    if (sortKey === key) sortDir = -sortDir;
    else { sortKey = key; sortDir = 1; }
    updateSortIndicators();
    applySort();
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
    injectActivityTab();
    hideNativeTab("Advanced");
    hideNativeTab("Reporting");
    syncOverlays();
    ensureProjectSelect();
    const table = document.querySelector("table");
    if (!table) return;
    if (table.parentElement) table.parentElement.classList.add("co-table-wrap");
    const headRow = table.querySelector("thead tr");
    if (headRow) {
      addHeader(headRow, "co-fix-th", "Fix");
      // Languages sits right after the native Category column (index 1).
      addHeader(headRow, "co-lang-th", "Languages", headRow.children[1]);
      addHeader(headRow, "co-act-th", "");
      updateSortIndicators();
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

      // The native enabled cell (the only text-center td) toggles the GLOBAL
      // catalog; hide it and render our project-scoped toggle in its place.
      const nativeEn = tr.querySelector("td.text-center");
      if (nativeEn) nativeEn.style.display = "none";
      let encell = tr.querySelector(".co-enabled-td");
      if (!encell) {
        encell = document.createElement("td");
        encell.className = "px-4 py-3 co-enabled-td";
        if (nativeEn) nativeEn.insertAdjacentElement("beforebegin", encell);
        else tr.appendChild(encell);
      }
      const ensig = slug ? (enabledBySlug[slug] ? "1" : "0") : "";
      if (slug && encell.getAttribute("data-en") !== ensig) buildEnabledCell(encell, slug);

      let acell = tr.querySelector(".co-act-td");
      if (!acell) {
        acell = document.createElement("td");
        acell.className = "px-4 py-3 co-act-td";
        tr.appendChild(acell);
      }
      if (acell.getAttribute("data-co") !== ACTIONS_HTML) {
        acell.innerHTML = ACTIONS_HTML;
        acell.setAttribute("data-co", ACTIONS_HTML);
      }
    }
    setupFilters();
    applyFilter();
    applySort();
  }

  // The Run icon opens the overlay with just this rule preselected — but only if
  // it's runnable (--all mode); other rules stay as-is so we never queue a rule
  // the runner can't execute.
  function openRunForRule(slug) {
    if (runnableRules().some((r) => r.slug === slug)) {
      selectedSlugs.clear();
      selectedSlugs.add(slug);
      const overlay = document.getElementById("co-run-overlay");
      if (overlay) {
        for (const cb of overlay.querySelectorAll(".co-run-opt")) {
          cb.checked = cb.value === slug;
        }
        const allBox = overlay.querySelector(".co-run-all");
        if (allBox) allBox.checked = false;
      }
    }
    runActive = true;
    syncOverlays();
    updateRunGate();
  }

  function onActionClick(e) {
    const btn = e.target.closest && e.target.closest(".co-act-btn");
    if (!btn) return;
    const tr = btn.closest("tr");
    const slug = tr ? rowSlug(tr) : null;
    if (!slug) return;
    const act = btn.getAttribute("data-act");
    if (act === "run") openRunForRule(slug);
    else if (act === "activity") openActivityForRule(slug);
    else if (act === "settings") openRuleSettingsModal(slug);
    else if (act === "copy") copySlug(slug);
  }

  function copySlug(slug) {
    const clip = navigator.clipboard;
    if (!clip || !clip.writeText) {
      toast("Clipboard unavailable in this browser", "error");
      return;
    }
    clip.writeText(slug).then(
      () => toast("Copied " + slug + " to clipboard"),
      (err) => toast("Couldn't copy " + slug + ": " + err.message, "error"),
    );
  }

  function injectStyle() {
    const style = document.createElement("style");
    // Descendant prefix for the dark overrides: every rule keys off the
    // data-co-theme="dark" attribute the theme controller sets on <html>.
    const D = "html[data-co-theme=dark] ";
    style.textContent =
      // Fluid full-width layout: drop the panel's centered max-width cap so the
      // header and tables span the window. The rules table wrapper ships as
      // overflow-hidden (clips columns on narrow widths); co-table-wrap turns
      // that into a horizontal scroll so no column is lost.
      ".max-w-6xl{max-width:100%!important}" +
      ".co-table-wrap{overflow-x:auto!important}" +
      ".co-table-wrap table{min-width:760px}" +
      // Sortable headers: a dim ↕ affordance that resolves to a solid ↑/↓ on the
      // active column. The arrow is ::after content so it stays out of textContent.
      "th.co-sortable{cursor:pointer;user-select:none;white-space:nowrap}" +
      'th.co-sortable::after{content:"↕";margin-left:5px;font-size:11px;opacity:.35}' +
      'th.co-sort-asc::after{content:"↑";opacity:.9}' +
      'th.co-sort-desc::after{content:"↓";opacity:.9}' +
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
      ":is(#co-run-overlay,#co-activity-overlay){position:fixed;inset:0;display:none;flex-direction:column;background:#fff;font-family:inherit;z-index:20}" +
      // Branded top bar mirroring the panel's own header, so the Run page keeps
      // the same nav chrome (its tabs route back into the panel).
      ".co-run-navbar{display:flex;align-items:center;gap:24px;padding:12px 24px;border-bottom:1px solid #e2e8f0;background:#fff}" +
      ".co-run-brand{display:flex;align-items:center;gap:8px}" +
      ".co-run-brand-mark{font-size:18px}" +
      ".co-run-brand-name{font-weight:600;letter-spacing:-.01em;color:#0f172a}" +
      ".co-run-badge{border-radius:4px;background:#f1f5f9;padding:2px 6px;font-size:12px;color:#64748b}" +
      ".co-run-nav{display:flex;gap:4px}" +
      ".co-run-nav-tab{cursor:pointer;border:0;background:none;border-radius:6px;padding:6px 12px;font-size:14px;font-weight:500;color:#475569}" +
      ".co-run-nav-tab:hover{background:#f1f5f9}" +
      ".co-run-nav-active,.co-run-nav-active:hover{background:#0f172a;color:#fff}" +
      ".co-run-subbar{position:relative;display:flex;align-items:center;gap:8px;padding:10px 24px;border-bottom:1px solid #e2e8f0;background:#f8fafc}" +
      ".co-run-target-label{font-size:12px;font-weight:600;color:#64748b}" +
      ".co-run-path{flex:1;box-sizing:border-box;padding:6px 10px;font-size:13px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;border:1px solid #cbd5e1;border-radius:6px;outline:none}" +
      ".co-run-path:focus{border-color:#94a3b8}" +
      ".co-run-browse-btn{cursor:pointer;white-space:nowrap;font-size:13px;font-weight:600;padding:6px 14px;border-radius:6px;border:1px solid #cbd5e1;background:#fff;color:#334155}" +
      ".co-run-browse-btn:hover{background:#f1f5f9}" +
      ".co-run-browser{position:absolute;top:calc(100% + 4px);left:0;right:0;z-index:40;background:#fff;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 8px 24px rgba(15,23,42,.12);overflow:hidden}" +
      ".co-run-browser-loading{padding:10px 12px;font-size:13px;color:#94a3b8}" +
      ".co-run-browser-head{display:flex;align-items:center;gap:10px;padding:8px 12px;background:#f8fafc;border-bottom:1px solid #f1f5f9}" +
      ".co-run-browser-path{flex:1;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#475569;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".co-run-use{cursor:pointer;white-space:nowrap;font-size:12px;font-weight:600;padding:4px 10px;border-radius:6px;border:1px solid #0f172a;background:#0f172a;color:#fff}" +
      ".co-run-use:hover{background:#1e293b}" +
      ".co-run-browser-list{max-height:320px;overflow:auto;padding:4px}" +
      ".co-run-entry{padding:5px 10px;font-size:13px;border-radius:6px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".co-run-entry:hover{background:#f1f5f9}" +
      ".co-run-file{color:#334155}.co-run-dir,.co-run-updir{color:#0f172a;font-weight:500}" +
      ".co-run-body{flex:1;display:flex;min-height:0}" +
      ".co-run-sidebar{width:280px;flex-shrink:0;display:flex;flex-direction:column;border-right:1px solid #e2e8f0;min-height:0}" +
      ".co-run-picker-head{display:flex;align-items:center;gap:8px;padding:10px;border-bottom:1px solid #f1f5f9}" +
      ".co-run-search{flex:1}" +
      ".co-run-picker-list{flex:1;min-height:0;overflow:auto;padding:6px}" +
      ".co-run-group{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#94a3b8;padding:8px 8px 4px}" +
      ".co-run-rule-item span{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}" +
      ".co-run-sidebar-foot{display:flex;align-items:center;gap:10px;padding:10px;border-top:1px solid #e2e8f0}" +
      ".co-run-btn{cursor:pointer;font-size:14px;font-weight:600;padding:8px 20px;border-radius:6px;border:1px solid #0f172a;background:#0f172a;color:#fff}" +
      ".co-run-btn:hover{background:#1e293b}.co-run-btn:disabled{cursor:not-allowed;opacity:.45}" +
      ".co-run-status{font-size:12px;color:#64748b}" +
      ".co-run-main{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0}" +
      ".co-run-editor{flex:1;min-height:0;overflow:auto;background:#fff}" +
      ".co-ed-empty{padding:16px;font-size:13px;color:#94a3b8}" +
      ".co-ed-loading{padding:12px;font-size:13px;color:#94a3b8}" +
      ".co-ed-head{position:sticky;top:0;padding:6px 12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#475569;background:#f8fafc;border-bottom:1px solid #e2e8f0}" +
      ".co-code{border-collapse:collapse;width:100%;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.55}" +
      ".co-gutter{width:1%;text-align:right;padding:0 12px;color:#cbd5e1;user-select:none;white-space:nowrap;vertical-align:top}" +
      ".co-line{white-space:pre;padding:0 12px;color:#0f172a}" +
      ".co-ln-issue .co-gutter{color:#b91c1c;font-weight:700}.co-ln-issue .co-line{background:#fef2f2}" +
      ".co-ln-active .co-line{background:#fee2e2}" +
      ".co-caret .co-line{background:#fff5f5}" +
      ".co-caret-mark{color:#ef4444;font-weight:700}.co-caret-msg{color:#b91c1c}" +
      ".co-run-results{height:38%;flex-shrink:0;overflow:auto;border-top:1px solid #e2e8f0;padding:12px;display:flex;flex-direction:column;gap:12px}" +
      ".co-run-rule{flex-shrink:0;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden}" +
      ".co-run-rule-head{display:flex;align-items:center;gap:10px;padding:8px 12px;background:#f8fafc;border-bottom:1px solid #f1f5f9}" +
      ".co-run-slug{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;font-weight:600;color:#0f172a}" +
      ".co-run-pill{font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px}" +
      ".co-run-pill-ok{background:#dcfce7;color:#166534}.co-run-pill-n{background:#fee2e2;color:#991b1b}.co-run-pill-err{background:#fef3c7;color:#92400e}" +
      ".co-run-resfile{padding:6px 12px}.co-run-resfile + .co-run-resfile{border-top:1px solid #f8fafc}" +
      ".co-run-file-name{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#475569;margin-bottom:4px}" +
      ".co-run-vio{font-size:13px;padding:3px 6px;display:flex;gap:8px;align-items:baseline;border-radius:6px;cursor:pointer}" +
      ".co-run-vio:hover{background:#f1f5f9}" +
      ".co-run-loc{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#94a3b8;min-width:44px}" +
      ".co-run-detail{color:#334155}" +
      ".co-run-empty,.co-run-error{font-size:13px;color:#64748b;padding:8px}.co-run-error{color:#991b1b}" +
      ".co-analyze{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px 16px;background:#fef3c7;border-bottom:1px solid #fde68a;font-size:13px;color:#92400e}" +
      ".co-analyze-done{background:#dcfce7;border-bottom-color:#bbf7d0;color:#166534}" +
      ".co-analyze-msg{flex:1}" +
      ".co-analyze-actions{display:flex;gap:8px;flex-shrink:0}" +
      ".co-analyze-run{cursor:pointer;font-size:13px;font-weight:600;padding:5px 12px;border-radius:6px;border:1px solid #0f172a;background:#0f172a;color:#fff}" +
      ".co-analyze-run:hover{background:#1e293b}.co-analyze-run:disabled{opacity:.5;cursor:not-allowed}" +
      ".co-analyze-ignore{cursor:pointer;font-size:13px;font-weight:600;padding:5px 12px;border-radius:6px;border:1px solid #cbd5e1;background:#fff;color:#334155}" +
      ".co-analyze-ignore:hover{background:#f8fafc}" +
      // Header project selector (top-right).
      ".co-project-wrap{display:flex;align-items:center;gap:8px;margin-left:auto}" +
      ".co-project-label{font-size:12px;font-weight:600;color:#64748b}" +
      ".co-project-select{font-size:13px;padding:5px 10px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;color:#0f172a;cursor:pointer;outline:none}" +
      ".co-project-select:focus{border-color:#94a3b8}" +
      // Titleless segmented theme control (System / Light / Dark).
      ".co-theme-seg{display:inline-flex;align-items:center;margin-right:6px;border:1px solid #cbd5e1;border-radius:6px;overflow:hidden;background:#fff}" +
      ".co-theme-btn{cursor:pointer;border:0;background:none;padding:4px 7px;color:#64748b;display:inline-flex;align-items:center}" +
      ".co-theme-btn + .co-theme-btn{border-left:1px solid #e2e8f0}" +
      ".co-theme-btn svg{width:16px;height:16px}" +
      ".co-theme-btn:hover{background:#f1f5f9;color:#0f172a}" +
      ".co-theme-btn-active,.co-theme-btn-active:hover{background:#0f172a;color:#fff}" +
      ".co-enabled-td{text-align:center}" +
      ".co-enabled{display:inline-flex;align-items:center;cursor:pointer}" +
      ".co-enabled-box{width:16px;height:16px;cursor:pointer;accent-color:#0f172a}" +
      // New-project modal.
      ".co-modal{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,.45)}" +
      ".co-modal-card{width:520px;max-width:calc(100vw - 32px);background:#fff;border-radius:12px;box-shadow:0 20px 60px rgba(15,23,42,.3);padding:20px;display:flex;flex-direction:column;gap:10px}" +
      ".co-modal-title{font-size:16px;font-weight:700;color:#0f172a}" +
      ".co-modal-input{box-sizing:border-box;width:100%;padding:8px 10px;font-size:14px;border:1px solid #cbd5e1;border-radius:6px;outline:none}" +
      ".co-modal-input:focus{border-color:#94a3b8}" +
      ".co-modal-dirs{font-size:13px;color:#334155}" +
      ".co-modal-hint{color:#94a3b8}" +
      ".co-modal-browser{border:1px solid #e2e8f0;border-radius:8px;overflow:hidden}" +
      ".co-modal-browser-head{display:flex;align-items:center;gap:10px;padding:8px 12px;background:#f8fafc;border-bottom:1px solid #f1f5f9}" +
      ".co-modal-browser-path{flex:1;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#475569;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".co-modal-use{cursor:pointer;white-space:nowrap;font-size:12px;font-weight:600;padding:4px 10px;border-radius:6px;border:1px solid #0f172a;background:#0f172a;color:#fff}" +
      ".co-modal-use:hover{background:#1e293b}" +
      ".co-modal-browser-list{max-height:240px;overflow:auto;padding:4px}" +
      ".co-modal-entry{padding:5px 10px;font-size:13px;border-radius:6px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".co-modal-entry:hover{background:#f1f5f9}" +
      ".co-modal-dir,.co-modal-updir{color:#0f172a;font-weight:500}" +
      ".co-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}" +
      ".co-modal-btn{cursor:pointer;font-size:13px;font-weight:600;padding:7px 16px;border-radius:6px;border:1px solid #cbd5e1;background:#fff;color:#334155}" +
      ".co-modal-btn:hover{background:#f8fafc}" +
      ".co-modal-btn-primary{background:#0f172a;color:#fff;border-color:#0f172a}" +
      ".co-modal-btn-primary:hover{background:#1e293b}" +
      // Rules table actions column (Run / Report / Settings icons).
      ".co-act-td{white-space:nowrap;text-align:right}" +
      ".co-act-btn{cursor:pointer;border:0;background:none;border-radius:6px;padding:5px;margin-left:2px;color:#64748b;display:inline-flex;align-items:center;vertical-align:middle}" +
      ".co-act-btn:hover{background:#f1f5f9;color:#0f172a}" +
      // Project settings dialog.
      ".co-set-card{gap:14px;max-height:calc(100vh - 48px);overflow:auto}" +
      ".co-set-sub{margin-top:-6px}" +
      ".co-set-section{display:flex;flex-direction:column;gap:8px;border-top:1px solid #f1f5f9;padding-top:12px}" +
      ".co-set-heading{font-size:13px;font-weight:700;color:#0f172a}" +
      ".co-set-row{display:flex;align-items:center;gap:10px}" +
      ".co-set-label{flex:0 0 120px;font-size:13px;color:#475569}" +
      ".co-set-enabled{cursor:pointer;font-size:14px;font-weight:500;color:#0f172a}" +
      ".co-set-check{width:16px;height:16px;cursor:pointer;accent-color:#0f172a}" +
      ".co-set-select{flex:1;padding:6px 10px;font-size:13px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;color:#0f172a}" +
      ".co-set-delay{flex:0 0 110px}" +
      ".co-set-num{flex:1}" +
      ".co-set-json{flex:1;min-height:72px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}" +
      ".co-set-lang{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:#334155;margin-right:14px}" +
      ".co-set-list{flex:1;display:flex;flex-direction:column;gap:6px}" +
      ".co-set-chips{display:flex;flex-wrap:wrap;gap:6px}" +
      ".co-set-chip{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#f1f5f9;border-radius:6px;padding:3px 8px;color:#0f172a}" +
      ".co-set-chip-x{cursor:pointer;border:0;background:none;color:#94a3b8;font-size:14px;line-height:1;padding:0}" +
      ".co-set-chip-x:hover{color:#ef4444}" +
      ".co-set-add-row{display:flex;gap:6px}" +
      ".co-set-add{flex:0 0 auto}" +
      // Activity overlay (reuses the co-run-* navbar chrome).
      ".co-act-subbar{gap:12px}" +
      ".co-act-windows{display:inline-flex;gap:4px}" +
      ".co-act-win{cursor:pointer;border:1px solid #cbd5e1;background:#fff;color:#475569;border-radius:6px;padding:4px 10px;font-size:12px;font-weight:600}" +
      ".co-act-win:hover{background:#f1f5f9}" +
      ".co-act-win-active,.co-act-win-active:hover{background:#0f172a;color:#fff;border-color:#0f172a}" +
      ".co-act-body{flex:1;display:flex;flex-direction:column;min-height:0;overflow:auto}" +
      ".co-act-top{display:flex;gap:16px;padding:16px 24px;border-bottom:1px solid #e2e8f0}" +
      ".co-act-toplist{flex:0 0 300px;display:flex;flex-direction:column;gap:4px}" +
      ".co-act-toplist-head,.co-act-bottom-title{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#94a3b8}" +
      ".co-act-toprow{display:flex;align-items:center;gap:8px;cursor:pointer;border:0;background:none;padding:3px 4px;border-radius:6px;text-align:left}" +
      ".co-act-toprow:hover{background:#f1f5f9}" +
      ".co-act-toprow-key{flex:0 0 120px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#0f172a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".co-act-toprow-bar{flex:1;height:8px;background:#f1f5f9;border-radius:4px;overflow:hidden}" +
      ".co-act-toprow-fill{display:block;height:100%;background:#0f172a}" +
      ".co-act-toprow-n{flex:0 0 auto;font-size:12px;color:#64748b;min-width:56px;text-align:right}" +
      ".co-act-chart{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}" +
      ".co-act-svg{width:100%;height:150px;display:block}" +
      ".co-act-bar{fill:#cbd5e1}.co-act-bar-fail{fill:#ef4444}" +
      ".co-act-chart-cap{font-size:12px;color:#94a3b8}" +
      ".co-act-bottom{flex:1;display:flex;flex-direction:column;min-height:0;padding:12px 24px}" +
      ".co-act-bottom-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px}" +
      ".co-act-feed{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:2px}" +
      ".co-act-row{display:flex;align-items:baseline;gap:10px;padding:5px 6px;border-radius:6px;font-size:13px}" +
      ".co-act-row:hover{background:#f8fafc}" +
      ".co-act-time{flex:0 0 auto;font-size:12px;color:#94a3b8;min-width:150px}" +
      ".co-act-src{flex:0 0 auto;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.03em;border-radius:4px;padding:1px 6px}" +
      ".co-act-src-hook{background:#e0e7ff;color:#3730a3}.co-act-src-log{background:#f1f5f9;color:#475569}" +
      ".co-act-key{flex:0 0 auto;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#0f172a}" +
      ".co-act-detail{flex:1;color:#475569;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".co-act-empty{padding:12px 4px;font-size:13px;color:#94a3b8}" +
      // Toasts.
      "#co-toast-region{position:fixed;z-index:60;bottom:20px;right:20px;display:flex;flex-direction:column;gap:8px;pointer-events:none}" +
      ".co-toast{pointer-events:auto;display:flex;align-items:center;gap:10px;min-width:220px;max-width:360px;padding:10px 14px;border-radius:8px;background:#fff;border:1px solid #e2e8f0;box-shadow:0 8px 24px rgba(15,23,42,.16);font-size:13px;color:#0f172a;cursor:pointer;animation:co-toast-in .18s ease-out}" +
      ".co-toast-icon{display:inline-flex;flex:0 0 auto}.co-toast-icon svg{width:18px;height:18px}" +
      ".co-toast-msg{flex:1;line-height:1.35}" +
      ".co-toast-success .co-toast-icon{color:#16a34a}" +
      ".co-toast-error .co-toast-icon{color:#ef4444}" +
      ".co-toast-info .co-toast-icon{color:#0ea5e9}" +
      ".co-toast-out{opacity:0;transform:translateY(6px);transition:opacity .18s,transform .18s}" +
      "@keyframes co-toast-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}" +
      // --- Dark theme -------------------------------------------------------
      // Two layers: (1) remap the prebuilt panel's own Tailwind utility classes
      // (bg-white, text-slate-*, border-slate-*, …) since the bundle has no dark
      // styles; (2) restyle our injected co-* components. Light mode is untouched
      // (these rules only match under data-co-theme="dark"), so it stays exact.
      "html[data-co-theme=dark]{color-scheme:dark}" +
      "html[data-co-theme=light]{color-scheme:light}" +
      D + "body{background:#0b1220}" +
      // Native panel utilities.
      D + ".bg-white{background-color:#0f172a}" +
      D + ".bg-slate-50{background-color:#1e293b}" +
      D + ".bg-slate-100{background-color:#334155}" +
      D + ".bg-slate-300{background-color:#475569}" +
      D + ".bg-slate-900{background-color:#475569}" +
      D + ".bg-red-50{background-color:#3f1d1d}" +
      D + ".text-slate-900{color:#f1f5f9}" +
      D + ":is(.text-slate-700,.text-slate-600){color:#cbd5e1}" +
      D + ".text-slate-500{color:#94a3b8}" +
      D + ".text-slate-400{color:#64748b}" +
      D + ".text-red-600{color:#f87171}" +
      D + ".text-red-700{color:#fca5a5}" +
      D + ".text-amber-600{color:#fbbf24}" +
      D + ".text-emerald-600{color:#34d399}" +
      D + ".border-slate-200{border-color:#334155}" +
      D + ".border-slate-300{border-color:#475569}" +
      D + ".border-red-200{border-color:#7f1d1d}" +
      D + ".divide-slate-100 > :not([hidden]) ~ :not([hidden]){border-color:#334155}" +
      // Our co-* components: surfaces.
      D + ":is(#co-run-overlay,#co-activity-overlay){background:#0b1220}" +
      D + ".co-run-editor{background:#0f172a}" +
      D + ".co-modal{background:rgba(0,0,0,.6)}" +
      D + ":is(.co-dd-panel,.co-run-browser,.co-modal-card,.co-modal-browser){background:#1e293b;border-color:#334155}" +
      D + ":is(.co-run-navbar,.co-run-subbar,.co-run-browser-head,.co-run-rule-head,.co-ed-head,.co-modal-browser-head){background:#0f172a}" +
      D + ":is(.co-dd-search,.co-run-path,.co-modal-input,.co-set-select,.co-project-select){background:#0f172a;border-color:#475569;color:#e2e8f0}" +
      D + ".co-theme-seg{background:#1e293b;border-color:#475569}" +
      D + ".co-theme-btn + .co-theme-btn{border-left-color:#475569}" +
      D + ".co-theme-btn-active,.co-theme-btn-active:hover{background:#475569;color:#fff}" +
      D + ":is(.co-fix-summary,.co-dd-summary,.co-dd-foot button,.co-run-browse-btn,.co-modal-btn,.co-analyze-ignore){background:#1e293b;border-color:#475569;color:#cbd5e1}" +
      // Primary (accent) buttons and the active nav pill.
      D + ":is(.co-dd-close,.co-run-use,.co-run-btn,.co-run-nav-active,.co-modal-use,.co-modal-btn-primary,.co-analyze-run){background:#475569;border-color:#475569;color:#fff}" +
      D + ":is(.co-dd-close,.co-run-use,.co-run-btn,.co-modal-use,.co-modal-btn-primary,.co-analyze-run):hover{background:#334155}" +
      // Hover surfaces for list items, entries, tabs, action icons.
      D + ":is(.co-dd-item,.co-run-entry,.co-modal-entry,.co-run-vio,.co-run-nav-tab):hover{background:#334155}" +
      D + ":is(.co-dd-foot button,.co-run-browse-btn,.co-modal-btn,.co-analyze-ignore):hover{background:#334155}" +
      D + ":is(.co-act-btn,.co-theme-btn):hover{background:#334155;color:#f1f5f9}" +
      // Borders.
      D + ":is(.co-run-navbar,.co-run-subbar,.co-run-browser-head,.co-run-rule-head,.co-ed-head,.co-modal-browser-head,.co-run-picker-head,.co-dd-all-item,.co-dd-foot,.co-run-rule,.co-run-results,.co-run-sidebar,.co-run-sidebar-foot,.co-set-section){border-color:#334155}" +
      D + ".co-fix + .co-fix{border-color:#334155}" +
      D + ".co-run-resfile + .co-run-resfile{border-color:#334155}" +
      // Text.
      D + ":is(.co-run-brand-name,.co-run-slug,.co-modal-title,.co-set-heading,.co-set-enabled){color:#f1f5f9}" +
      D + ":is(.co-line,.co-fix-path,.co-run-dir,.co-run-updir,.co-modal-dir,.co-modal-updir,.co-set-chip){color:#e2e8f0}" +
      D + ":is(.co-dd-item,.co-run-file,.co-run-browser-path,.co-run-file-name,.co-run-detail,.co-run-nav-tab,.co-set-label,.co-set-lang,.co-modal-dirs,.co-ed-head){color:#cbd5e1}" +
      D + ":is(.co-fix-desc,.co-run-target-label,.co-run-status,.co-project-label,.co-act-btn,.co-theme-btn,.co-run-empty){color:#94a3b8}" +
      D + ":is(.co-fix-none,.co-gutter){color:#475569}" +
      D + ".co-run-error{color:#fca5a5}" +
      // Badges, pills, chips.
      D + ".co-kind-script{background:#064e3b;color:#6ee7b7}" +
      D + ".co-kind-inferred{background:#312e81;color:#c7d2fe}" +
      D + ".co-kind-output{background:#334155;color:#cbd5e1}" +
      D + ".co-run-pill-ok{background:#064e3b;color:#6ee7b7}" +
      D + ".co-run-pill-n{background:#7f1d1d;color:#fecaca}" +
      D + ".co-run-pill-err{background:#78350f;color:#fde68a}" +
      D + ".co-run-badge{background:#334155;color:#94a3b8}" +
      D + ".co-set-chip{background:#334155}" +
      // Code viewer issue lines and carets.
      D + ".co-ln-issue .co-gutter{color:#f87171}" +
      D + ".co-ln-issue .co-line{background:#450a0a}" +
      D + ".co-ln-active .co-line{background:#7f1d1d}" +
      D + ".co-caret .co-line{background:#450a0a}" +
      D + ".co-caret-msg{color:#fca5a5}" +
      // Analyze banners.
      D + ".co-analyze{background:#78350f;border-bottom-color:#92400e;color:#fde68a}" +
      D + ".co-analyze-done{background:#064e3b;border-bottom-color:#166534;color:#6ee7b7}" +
      // Checkbox accents.
      D + ":is(.co-enabled-box,.co-set-check){accent-color:#818cf8}" +
      // Activity overlay.
      D + ".co-act-top{border-bottom-color:#334155}" +
      D + ".co-act-win{background:#1e293b;border-color:#475569;color:#cbd5e1}" +
      D + ".co-act-win:hover{background:#334155}" +
      D + ":is(.co-act-win-active,.co-act-win-active:hover){background:#475569;border-color:#475569;color:#fff}" +
      D + ":is(.co-act-toprow-key,.co-act-key){color:#e2e8f0}" +
      D + ":is(.co-act-toplist-head,.co-act-bottom-title,.co-act-chart-cap,.co-act-time,.co-act-empty){color:#94a3b8}" +
      D + ".co-act-toprow-n{color:#94a3b8}" +
      D + ".co-act-detail{color:#cbd5e1}" +
      D + ":is(.co-act-toprow:hover,.co-act-row:hover){background:#334155}" +
      D + ":is(.co-act-toprow-bar){background:#334155}" +
      D + ".co-act-toprow-fill{background:#818cf8}" +
      D + ".co-act-bar{fill:#475569}" +
      D + ".co-act-src-hook{background:#312e81;color:#c7d2fe}" +
      D + ".co-act-src-log{background:#334155;color:#cbd5e1}" +
      D + ".co-toast{background:#1e293b;border-color:#334155;color:#e2e8f0}";
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

  // Leaf nav elements are the tab labels; match by text so a route rename in the
  // bundle just no-ops rather than throwing.
  function forEachNavLeaf(fn) {
    for (const el of document.querySelectorAll("#root a, #root button, #root [role=tab], #root nav *")) {
      if (el.children.length !== 0) continue;
      fn(el, (el.textContent || "").trim());
    }
  }

  // The bundle owns the /advanced route; with no source we can't drop it, so we
  // hide its nav tab (idempotently, since React re-renders it back).
  function hideNativeTab(label) {
    forEachNavLeaf((el, txt) => {
      if (txt === label) el.style.display = "none";
    });
  }

  // The Run overlay's branded nav routes back into the panel by driving the real
  // NavLink: close the overlay (revealing #root), then click the native tab.
  function gotoNative(label) {
    runActive = false;
    activityActive = false;
    syncOverlays();
    forEachNavLeaf((el, txt) => {
      if (txt === label) el.click();
    });
  }

  // Clone a native nav leaf into an injected overlay tab (idempotent — a native
  // tab click re-renders it away, so decorate() re-injects on each tick).
  function injectNavTab(cls, label, onOpen) {
    const found = findNav();
    if (!found || !found.nav || found.nav.querySelector("." + cls)) return;
    const tab = found.anchor.cloneNode(true);
    tab.classList.add(cls);
    tab.textContent = label;
    tab.removeAttribute("aria-selected");
    // The panel's tabs are router <a href> links; without preventDefault the
    // clone would navigate to the Rules route instead of opening our overlay.
    tab.removeAttribute("href");
    tab.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onOpen();
    });
    // Insert after the last injected tab (or Rules) so decorate()'s Run-then-
    // Activity order yields Rules · Run · Activity.
    const ref =
      found.nav.querySelector(".co-activity-tab") ||
      found.nav.querySelector(".co-run-tab") ||
      found.anchor;
    ref.insertAdjacentElement("afterend", tab);
  }

  function injectRunTab() {
    injectNavTab("co-run-tab", "Run", () => {
      runActive = true;
      activityActive = false;
      syncOverlays();
    });
  }

  function injectActivityTab() {
    injectNavTab("co-activity-tab", "Activity", () => openActivity());
  }

  function openRun() {
    runActive = true;
    activityActive = false;
    syncOverlays();
  }

  // The branded header shared by the Run and Activity overlays. Rules routes back
  // to the native panel; Run/Activity switch between the two injected overlays.
  function buildOverlayNav(active) {
    const navbar = document.createElement("div");
    navbar.className = "co-run-navbar";
    const brand = document.createElement("div");
    brand.className = "co-run-brand";
    brand.innerHTML =
      '<span class="co-run-brand-mark">🧭</span>' +
      '<span class="co-run-brand-name">Captain Obvious</span>' +
      '<span class="co-run-badge">control panel</span>';
    const nav = document.createElement("div");
    nav.className = "co-run-nav";
    for (const label of ["Rules", "Run", "Activity"]) {
      const navTab = document.createElement("button");
      navTab.type = "button";
      navTab.className =
        "co-run-nav-tab" + (label === active ? " co-run-nav-active" : "");
      navTab.setAttribute("data-nav", label);
      navTab.textContent = label;
      nav.appendChild(navTab);
    }
    nav.addEventListener("click", (e) => {
      const t = e.target.closest(".co-run-nav-tab[data-nav]");
      if (!t) return;
      const label = t.getAttribute("data-nav");
      if (label === active) return;
      if (label === "Run") openRun();
      else if (label === "Activity") openActivity();
      else gotoNative(label);
    });
    navbar.appendChild(brand);
    navbar.appendChild(nav);
    return navbar;
  }

  // Both overlays live OUTSIDE #root so React never reconciles them away. At most
  // one shows at a time; whichever is active hides #root wholesale (nav included),
  // and its branded nav returns to the panel or the sibling overlay.
  function syncOverlays() {
    const root = document.getElementById("root");
    const runOverlay = document.getElementById("co-run-overlay");
    const actOverlay = document.getElementById("co-activity-overlay");
    if (!root) return;
    if (runOverlay) runOverlay.style.display = runActive ? "flex" : "none";
    if (actOverlay) actOverlay.style.display = activityActive ? "flex" : "none";
    root.style.display = runActive || activityActive ? "none" : "";
    const runTab = document.querySelector(".co-run-tab");
    if (runTab) runTab.classList.toggle("co-run-tab-active", runActive);
    const actTab = document.querySelector(".co-activity-tab");
    if (actTab) actTab.classList.toggle("co-run-tab-active", activityActive);
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

  async function loadBrowse(path) {
    const q = path ? "?path=" + encodeURIComponent(path) : "";
    const res = await fetch("/api/run/browse" + q);
    if (!res.ok) {
      const msg = await res.json().then((b) => b.error, () => "");
      throw new Error(msg || "GET /api/run/browse -> " + res.status);
    }
    return res.json();
  }

  function toggleBrowser() {
    const el = document.getElementById("co-run-browser");
    if (!el) return;
    if (el.style.display === "none") {
      el.style.display = "block";
      const start =
        (document.getElementById("co-run-path").value || "").trim() || runRoot;
      renderBrowser(start);
    } else {
      el.style.display = "none";
    }
  }

  function selectTarget(path) {
    const input = document.getElementById("co-run-path");
    if (input) input.value = path;
    const el = document.getElementById("co-run-browser");
    if (el) el.style.display = "none";
  }

  async function renderBrowser(path) {
    const el = document.getElementById("co-run-browser");
    if (!el) return;
    el.innerHTML = '<div class="co-run-browser-loading">Loading…</div>';
    let view;
    try {
      view = await loadBrowse(path);
    } catch (err) {
      el.innerHTML = '<div class="co-run-error">' + esc(err.message) + "</div>";
      return;
    }
    browsePath = view.path;
    let html = '<div class="co-run-browser-head">';
    html += '<span class="co-run-browser-path">' + esc(view.path) + "</span>";
    html +=
      '<button type="button" class="co-run-use" data-use="' +
      esc(view.path) +
      '">Use this folder</button></div>';
    html += '<div class="co-run-browser-list">';
    if (view.parent) {
      html +=
        '<div class="co-run-entry co-run-updir" data-dir="' +
        esc(view.parent) +
        '">📁 ..</div>';
    }
    for (const e of view.entries) {
      if (e.type === "dir") {
        html +=
          '<div class="co-run-entry co-run-dir" data-dir="' +
          esc(e.path) +
          '">📁 ' +
          esc(e.name) +
          "</div>";
      } else {
        html +=
          '<div class="co-run-entry co-run-file" data-file="' +
          esc(e.path) +
          '">📄 ' +
          esc(e.name) +
          "</div>";
      }
    }
    el.innerHTML = html + "</div>";
  }

  function langFor(path) {
    return EXT_LANG[path.split(".").pop().toLowerCase()];
  }

  // Colour one line with highlight.js when it's loaded and knows the language;
  // fall back to escaped text so the viewer still renders before the CDN script
  // arrives (or offline).
  function highlightLine(code, lang) {
    const hl = window.hljs;
    if (hl && hl.getLanguage(lang)) {
      return hl.highlight(code, { language: lang, ignoreIllegals: true }).value;
    }
    return esc(code);
  }

  async function loadFile(path) {
    const res = await fetch("/api/run/file?path=" + encodeURIComponent(path));
    if (!res.ok) {
      const msg = await res.json().then((b) => b.error, () => "");
      throw new Error(msg || "GET /api/run/file -> " + res.status);
    }
    return res.json();
  }

  // Render the file as a gutter+code table; each violation line gets a caret row
  // pointing at the exact column, and the clicked line is tagged for scrolling.
  function renderCode(markerPath, displayPath, text, activeLine) {
    const lang = langFor(displayPath);
    const byLine = {};
    for (const v of violationsByPath[markerPath] || []) {
      (byLine[v.line] = byLine[v.line] || []).push(v);
    }
    const lines = text.split("\\n");
    let rows = "";
    for (let i = 0; i < lines.length; i++) {
      const ln = i + 1;
      const vios = byLine[ln];
      let cls = "co-ln";
      if (vios) cls += " co-ln-issue";
      const active = ln === activeLine;
      if (active) cls += " co-ln-active";
      rows += '<tr class="' + cls + '"' + (active ? ' id="co-ed-active"' : "") +
        '><td class="co-gutter">' + ln + '</td><td class="co-line">' +
        highlightLine(lines[i], lang) + "</td></tr>";
      for (const v of vios || []) {
        const pad = " ".repeat(Math.max(0, v.col - 1));
        rows += '<tr class="co-caret"><td class="co-gutter"></td>' +
          '<td class="co-line"><span class="co-caret-mark">' + pad +
          '^</span><span class="co-caret-msg">  ' + esc(v.slug) + ": " +
          esc(v.detail) + "</span></td></tr>";
      }
    }
    return '<div class="co-ed-head">' + esc(displayPath) + "</div>" +
      '<table class="co-code"><tbody>' + rows + "</tbody></table>";
  }

  async function openInEditor(path, line) {
    const ed = document.getElementById("co-run-editor");
    if (!ed) return;
    ed.innerHTML = '<div class="co-ed-loading">Loading…</div>';
    let view;
    try {
      view = await loadFile(path);
    } catch (err) {
      ed.innerHTML = '<div class="co-run-error">' + esc(err.message) + "</div>";
      return;
    }
    ed.innerHTML = renderCode(path, view.path, view.text, line);
    const active = document.getElementById("co-ed-active");
    if (active) active.scrollIntoView({ block: "center" });
  }

  // Full token colouring comes from highlight.js loaded lazily off a CDN; the
  // viewer degrades to plain escaped text until (or unless) it arrives.
  function loadHighlighter() {
    const base = "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/";
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = base + "styles/github.min.css";
    document.head.appendChild(link);
    const script = document.createElement("script");
    script.src = base + "highlight.min.js";
    document.head.appendChild(script);
  }

  function buildRunView() {
    if (document.getElementById("co-run-overlay")) return;
    const root = document.getElementById("root");
    if (!root || !root.parentElement) return;

    const overlay = document.createElement("div");
    overlay.id = "co-run-overlay";
    overlay.style.display = "none";

    overlay.appendChild(buildOverlayNav("Run"));

    const subbar = document.createElement("div");
    subbar.className = "co-run-subbar";
    const tlabel = document.createElement("span");
    tlabel.className = "co-run-target-label";
    tlabel.textContent = "Target";
    const pathInput = document.createElement("input");
    pathInput.className = "co-run-path";
    pathInput.id = "co-run-path";
    pathInput.value = runRoot;
    const browseBtn = document.createElement("button");
    browseBtn.type = "button";
    browseBtn.className = "co-run-browse-btn";
    browseBtn.textContent = "Browse…";
    browseBtn.addEventListener("click", () => { toggleBrowser(); });
    const browser = document.createElement("div");
    browser.className = "co-run-browser";
    browser.id = "co-run-browser";
    browser.style.display = "none";
    browser.addEventListener("click", (e) => {
      const t = e.target.closest("[data-dir], [data-file], [data-use]");
      if (!t) return;
      if (t.getAttribute("data-dir")) renderBrowser(t.getAttribute("data-dir"));
      else if (t.getAttribute("data-file")) selectTarget(t.getAttribute("data-file"));
      else selectTarget(t.getAttribute("data-use"));
    });
    subbar.appendChild(tlabel);
    subbar.appendChild(pathInput);
    subbar.appendChild(browseBtn);
    subbar.appendChild(browser);
    overlay.appendChild(subbar);

    const body = document.createElement("div");
    body.className = "co-run-body";

    const sidebar = document.createElement("div");
    sidebar.className = "co-run-sidebar";
    buildRulePicker(sidebar);
    const foot = document.createElement("div");
    foot.className = "co-run-sidebar-foot";
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
    foot.appendChild(runBtn);
    foot.appendChild(status);
    sidebar.appendChild(foot);
    body.appendChild(sidebar);

    const main = document.createElement("div");
    main.className = "co-run-main";
    const editor = document.createElement("div");
    editor.className = "co-run-editor";
    editor.id = "co-run-editor";
    editor.innerHTML =
      '<div class="co-ed-empty">Select a result below to open the file here.</div>';
    const results = document.createElement("div");
    results.className = "co-run-results";
    results.id = "co-run-results";
    results.addEventListener("click", (e) => {
      const t = e.target.closest(".co-run-vio[data-path]");
      if (!t) return;
      openInEditor(t.getAttribute("data-path"), Number(t.getAttribute("data-line")));
    });
    main.appendChild(editor);
    main.appendChild(results);
    body.appendChild(main);

    overlay.appendChild(body);
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
      html += '<div class="co-run-resfile"><div class="co-run-file-name">' +
        esc(path) + "</div>";
      for (const v of byFile[path]) {
        html += '<div class="co-run-vio" data-path="' + esc(path) +
          '" data-line="' + esc(v.line) + '"><span class="co-run-loc">' +
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
    violationsByPath = {};
    if (!Array.isArray(data) || data.length === 0) {
      results.innerHTML = '<div class="co-run-empty">No results.</div>';
      return;
    }
    let html = "";
    for (const r of data) {
      const vios = r.violations || [];
      const count = vios.length;
      for (const v of vios) {
        const p = v.path || "(unknown)";
        (violationsByPath[p] = violationsByPath[p] || []).push({
          line: v.line, col: v.col, detail: v.detail, slug: r.slug,
        });
      }
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
      if (r.ok && count > 0) html += renderViolations(vios);
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

  function removeAnalyzeBanner() {
    const el = document.getElementById("co-analyze");
    if (el) el.remove();
  }

  function analyzeSummary(data) {
    const langs = data.languages || [];
    if (langs.length === 0) return "No recognized source files found.";
    return "Detected " + langs.map((l) => l.name + " (" + l.files + ")").join(", ") + ".";
  }

  function showAnalyzeResult(data) {
    const banner = document.getElementById("co-analyze");
    if (!banner) return;
    banner.className = "co-analyze co-analyze-done";
    banner.innerHTML = "";
    const msg = document.createElement("span");
    msg.className = "co-analyze-msg";
    msg.textContent = analyzeSummary(data);
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "co-analyze-ignore";
    dismiss.textContent = "Dismiss";
    dismiss.addEventListener("click", removeAnalyzeBanner);
    banner.appendChild(msg);
    banner.appendChild(dismiss);
  }

  async function doAnalyze() {
    const banner = document.getElementById("co-analyze");
    if (!banner) return;
    const runBtn = document.getElementById("co-analyze-run");
    const msg = banner.querySelector(".co-analyze-msg");
    if (runBtn) runBtn.disabled = true;
    if (msg) msg.textContent = "Analyzing…";
    let data;
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!res.ok) {
        const m = await res.json().then((b) => b.error, () => "");
        throw new Error(m || "POST /api/analyze -> " + res.status);
      }
      data = await res.json();
    } catch (err) {
      if (msg) msg.textContent = err.message;
      if (runBtn) runBtn.disabled = false;
      return;
    }
    showAnalyzeResult(data);
  }

  function buildAnalyzeBanner() {
    const banner = document.createElement("div");
    banner.id = "co-analyze";
    banner.className = "co-analyze";
    const msg = document.createElement("span");
    msg.className = "co-analyze-msg";
    msg.textContent =
      "This project hasn't been analyzed yet — detect its languages before configuring rules.";
    const actions = document.createElement("div");
    actions.className = "co-analyze-actions";
    const runBtn = document.createElement("button");
    runBtn.type = "button";
    runBtn.className = "co-analyze-run";
    runBtn.id = "co-analyze-run";
    runBtn.textContent = "Analyze project";
    runBtn.addEventListener("click", () => { doAnalyze(); });
    const ignoreBtn = document.createElement("button");
    ignoreBtn.type = "button";
    ignoreBtn.className = "co-analyze-ignore";
    ignoreBtn.textContent = "Ignore";
    ignoreBtn.addEventListener("click", () => {
      localStorage.setItem("co-analyze-ignored", "1");
      removeAnalyzeBanner();
    });
    actions.appendChild(runBtn);
    actions.appendChild(ignoreBtn);
    banner.appendChild(msg);
    banner.appendChild(actions);
    document.body.insertBefore(banner, document.body.firstChild);
  }

  // Server-driven: prompt to analyze until a project.analyzed event exists, unless
  // this browser has chosen to Ignore it.
  async function maybeShowAnalyzeBanner() {
    if (document.getElementById("co-analyze")) return;
    if (localStorage.getItem("co-analyze-ignored") === "1") return;
    const res = await fetch("/api/analyze/status");
    if (!res.ok) throw new Error("GET /api/analyze/status -> " + res.status);
    const status = await res.json();
    if (status.analyzed) return;
    buildAnalyzeBanner();
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; decorate(); }, 0);
  }

  // The project-scoped Enabled toggle. The native panel's toggle writes the
  // global catalog, so we hide its column (decorate) and render this in its place.
  function buildEnabledCell(cell, slug) {
    const wrap = document.createElement("label");
    wrap.className = "co-enabled";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "co-enabled-box";
    box.checked = !!enabledBySlug[slug];
    box.addEventListener("change", async () => {
      const next = box.checked;
      try {
        await patchProjectRule(slug, { enabled: next });
      } catch (err) {
        toast("Couldn't update " + slug + ": " + err.message, "error");
        box.checked = !next;
        return;
      }
      enabledBySlug[slug] = next;
      cell.setAttribute("data-en", next ? "1" : "0");
      toast((next ? "Enabled " : "Disabled ") + slug);
    });
    wrap.appendChild(box);
    cell.innerHTML = "";
    cell.appendChild(wrap);
    cell.setAttribute("data-en", box.checked ? "1" : "0");
  }

  function pickCurrentProject() {
    const stored = localStorage.getItem("co-project");
    let current = null;
    if (stored) {
      const n = Number(stored);
      if (projects.some((p) => p.id === n)) current = n;
    }
    if (current === null) {
      const def = projects.find((p) => p.isDefault);
      current = def ? def.id : projects.length ? projects[0].id : null;
    }
    currentProjectId = current;
  }

  function applyProjectRunRoot() {
    const proj = projects.find((p) => p.id === currentProjectId);
    if (proj && proj.directories && proj.directories.length) {
      runRoot = proj.directories[0];
    }
  }

  // decorate() runs on every panel re-render (a MutationObserver tick), so this
  // must NOT rebuild the <select> unless the project set or selection actually
  // changed — clobbering options while the native dropdown is open dismisses it,
  // leaving it "stuck" so a pick (e.g. "New project") never registers.
  function renderProjectOptions() {
    const sel = document.querySelector(".co-project-select");
    if (!sel) return;
    const sig =
      projects.map((p) => p.id + ":" + p.name + ":" + (p.isDefault ? 1 : 0)).join("|") +
      "#" + currentProjectId;
    if (sel.getAttribute("data-sig") === sig) return;
    sel.innerHTML = "";
    for (const p of projects) {
      const o = document.createElement("option");
      o.value = String(p.id);
      o.textContent = p.name + (p.isDefault ? " (default)" : "");
      sel.appendChild(o);
    }
    const nw = document.createElement("option");
    nw.value = "__new__";
    nw.textContent = "＋ New project…";
    sel.appendChild(nw);
    if (currentProjectId !== null) sel.value = String(currentProjectId);
    sel.setAttribute("data-sig", sig);
  }

  async function selectProject(id) {
    currentProjectId = id;
    localStorage.setItem("co-project", String(id));
    await loadData();
    applyProjectRunRoot();
    decorate();
  }

  // Injected into the panel's header bar (top-right). Idempotent: React re-renders
  // the header, so we re-attach on every decorate tick.
  function ensureProjectSelect() {
    const found = findNav();
    if (!found || !found.nav) return;
    const bar = found.nav.parentElement || found.nav;
    if (bar.querySelector(".co-project-wrap")) {
      renderProjectOptions();
      return;
    }
    const wrap = document.createElement("div");
    wrap.className = "co-project-wrap";
    wrap.appendChild(buildThemeControl());
    const label = document.createElement("span");
    label.className = "co-project-label";
    label.textContent = "Project";
    const sel = document.createElement("select");
    sel.className = "co-project-select";
    sel.addEventListener("change", () => {
      if (sel.value === "__new__") {
        sel.value = currentProjectId !== null ? String(currentProjectId) : "";
        openCreateProjectModal();
        return;
      }
      selectProject(Number(sel.value));
    });
    wrap.appendChild(label);
    wrap.appendChild(sel);
    bar.appendChild(wrap);
    renderProjectOptions();
  }

  async function createProjectReq(body) {
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || "POST /api/projects -> " + res.status);
    }
    return res.json();
  }

  // A modal to create a project: name, description, and directories picked from
  // the server filesystem via /api/run/browse (the same tree the Run tab walks).
  function openCreateProjectModal() {
    if (document.getElementById("co-project-modal")) return;
    const dirs = [];
    let path = runRoot || "";

    const overlay = document.createElement("div");
    overlay.id = "co-project-modal";
    overlay.className = "co-modal";
    const card = document.createElement("div");
    card.className = "co-modal-card";
    card.innerHTML =
      '<div class="co-modal-title">New project</div>' +
      '<input class="co-modal-input co-modal-name" placeholder="Name" />' +
      '<input class="co-modal-input co-modal-desc" placeholder="Description (optional)" />' +
      '<div class="co-modal-dirs"></div>' +
      '<div class="co-modal-browser"></div>' +
      '<div class="co-modal-actions">' +
      '<button type="button" class="co-modal-btn co-modal-cancel">Cancel</button>' +
      '<button type="button" class="co-modal-btn co-modal-btn-primary co-modal-create">Create</button>' +
      "</div>";
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const dirsEl = card.querySelector(".co-modal-dirs");
    const browserEl = card.querySelector(".co-modal-browser");

    function renderDirs() {
      dirsEl.innerHTML = dirs.length
        ? "Directories: " + dirs.map((d) => esc(d)).join(", ")
        : '<span class="co-modal-hint">No directories chosen — the whole repo is used.</span>';
    }

    async function renderBrowser() {
      browserEl.textContent = "Loading…";
      const res = await fetch("/api/run/browse?path=" + encodeURIComponent(path));
      if (!res.ok) {
        browserEl.textContent = "Cannot browse " + path;
        return;
      }
      const view = await res.json();
      path = view.path;
      browserEl.innerHTML = "";
      const head = document.createElement("div");
      head.className = "co-modal-browser-head";
      head.innerHTML =
        '<span class="co-modal-browser-path">' + esc(path) + "</span>";
      const useBtn = document.createElement("button");
      useBtn.type = "button";
      useBtn.className = "co-modal-use";
      useBtn.textContent = "Add this folder";
      useBtn.addEventListener("click", () => {
        if (dirs.indexOf(path) === -1) dirs.push(path);
        renderDirs();
      });
      head.appendChild(useBtn);
      browserEl.appendChild(head);
      const list = document.createElement("div");
      list.className = "co-modal-browser-list";
      if (view.parent) {
        const up = document.createElement("div");
        up.className = "co-modal-entry co-modal-updir";
        up.textContent = "../";
        up.addEventListener("click", () => {
          path = view.parent;
          renderBrowser();
        });
        list.appendChild(up);
      }
      for (const e of view.entries) {
        if (e.type !== "dir") continue;
        const row = document.createElement("div");
        row.className = "co-modal-entry co-modal-dir";
        row.textContent = e.name + "/";
        row.addEventListener("click", () => {
          path = e.path;
          renderBrowser();
        });
        list.appendChild(row);
      }
      browserEl.appendChild(list);
    }

    function close() {
      overlay.remove();
    }
    card.querySelector(".co-modal-cancel").addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    card.querySelector(".co-modal-create").addEventListener("click", async () => {
      const name = card.querySelector(".co-modal-name").value.trim();
      if (!name) {
        window.alert("A project name is required.");
        return;
      }
      const description = card.querySelector(".co-modal-desc").value.trim();
      let created;
      try {
        created = await createProjectReq({
          name,
          description: description || undefined,
          directories: dirs,
        });
      } catch (err) {
        toast("Couldn't create project: " + err.message, "error");
        return;
      }
      close();
      await selectProject(created.id);
      toast("Created project " + created.name);
    });

    renderDirs();
    renderBrowser();
  }

  // An add/remove editor for an array config value (e.g. an exclude glob list).
  // Returns the element plus a read() that yields the current entries.
  function buildListEditor(values) {
    const wrap = document.createElement("div");
    wrap.className = "co-set-list";
    const chips = document.createElement("div");
    chips.className = "co-set-chips";
    const items = Array.isArray(values) ? values.slice() : [];
    function render() {
      chips.innerHTML = "";
      items.forEach((v, i) => {
        const chip = document.createElement("span");
        chip.className = "co-set-chip";
        chip.textContent = String(v);
        const x = document.createElement("button");
        x.type = "button";
        x.className = "co-set-chip-x";
        x.textContent = "×";
        x.addEventListener("click", () => {
          items.splice(i, 1);
          render();
        });
        chip.appendChild(x);
        chips.appendChild(chip);
      });
    }
    render();
    const row = document.createElement("div");
    row.className = "co-set-add-row";
    const input = document.createElement("input");
    input.className = "co-modal-input co-set-add-input";
    input.placeholder = "Add entry…";
    const add = document.createElement("button");
    add.type = "button";
    add.className = "co-modal-btn co-set-add";
    add.textContent = "Add";
    function commit() {
      const v = input.value.trim();
      if (!v) return;
      items.push(v);
      input.value = "";
      render();
    }
    add.addEventListener("click", commit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commit(); }
    });
    row.appendChild(input);
    row.appendChild(add);
    wrap.appendChild(chips);
    wrap.appendChild(row);
    return { el: wrap, read: () => items.slice() };
  }

  // One control per config key, typed from the current value. Arrays become a
  // list editor (the common exclude-list pattern); objects fall back to JSON.
  function buildConfigField(key, value) {
    const row = document.createElement("div");
    row.className = "co-set-row";
    const label = document.createElement("label");
    label.className = "co-set-label";
    label.textContent = key;
    row.appendChild(label);
    if (Array.isArray(value)) {
      const ed = buildListEditor(value);
      row.appendChild(ed.el);
      return { row, read: ed.read };
    }
    if (typeof value === "boolean") {
      const box = document.createElement("input");
      box.type = "checkbox";
      box.className = "co-set-check";
      box.checked = value;
      row.appendChild(box);
      return { row, read: () => box.checked };
    }
    if (typeof value === "number") {
      const input = document.createElement("input");
      input.type = "number";
      input.className = "co-modal-input co-set-num";
      input.value = String(value);
      row.appendChild(input);
      return { row, read: () => Number(input.value) };
    }
    if (value !== null && typeof value === "object") {
      const ta = document.createElement("textarea");
      ta.className = "co-modal-input co-set-json";
      ta.value = JSON.stringify(value, null, 2);
      row.appendChild(ta);
      return { row, read: () => JSON.parse(ta.value) };
    }
    const input = document.createElement("input");
    input.className = "co-modal-input";
    input.value = value == null ? "" : String(value);
    row.appendChild(input);
    return { row, read: () => input.value };
  }

  function severitySelect(current, inheritLabel) {
    const sel = document.createElement("select");
    sel.className = "co-set-select";
    const none = document.createElement("option");
    none.value = "";
    none.textContent = inheritLabel;
    sel.appendChild(none);
    for (const at of actionTypes) {
      const opt = document.createElement("option");
      opt.value = at.slug;
      opt.textContent = at.name;
      sel.appendChild(opt);
    }
    sel.value = current || "";
    return sel;
  }

  // Project-scoped rule settings: enabled, languages, severity, and the rule's
  // own config knobs. Saving materialises the shown severity as project bindings
  // (any project binding fully replaces the global set), so the dialog is WYSIWYG.
  function openRuleSettingsModal(slug) {
    if (document.getElementById("co-set-modal")) return;
    const rule = ruleBySlug[slug];
    if (!rule) return;
    const project = projects.find((p) => p.id === currentProjectId);

    const overlay = document.createElement("div");
    overlay.id = "co-set-modal";
    overlay.className = "co-modal";
    const card = document.createElement("div");
    card.className = "co-modal-card co-set-card";
    overlay.appendChild(card);

    const title = document.createElement("div");
    title.className = "co-modal-title";
    title.textContent = "Settings — " + slug;
    card.appendChild(title);
    const sub = document.createElement("div");
    sub.className = "co-modal-hint co-set-sub";
    sub.textContent = "Project: " + (project ? project.name : "—");
    card.appendChild(sub);

    const enRow = document.createElement("label");
    enRow.className = "co-set-row co-set-enabled";
    const enBox = document.createElement("input");
    enBox.type = "checkbox";
    enBox.className = "co-set-check";
    enBox.checked = !!enabledBySlug[slug];
    const enLabel = document.createElement("span");
    enLabel.textContent = "Enabled";
    enRow.appendChild(enBox);
    enRow.appendChild(enLabel);
    card.appendChild(enRow);

    let readLanguages = null;
    if (!langIndependentBySlug[slug]) {
      const section = document.createElement("div");
      section.className = "co-set-section";
      const heading = document.createElement("div");
      heading.className = "co-set-heading";
      heading.textContent = "Languages";
      section.appendChild(heading);
      const boxes = [];
      const current = new Set(langsBySlug[slug] || []);
      for (const l of supportedLangs) {
        const lab = document.createElement("label");
        lab.className = "co-set-lang";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.value = l.slug;
        cb.checked = current.has(l.slug);
        const span = document.createElement("span");
        span.textContent = l.name;
        lab.appendChild(cb);
        lab.appendChild(span);
        section.appendChild(lab);
        boxes.push(cb);
      }
      card.appendChild(section);
      readLanguages = () => boxes.filter((b) => b.checked).map((b) => b.value);
    }

    const sevSection = document.createElement("div");
    sevSection.className = "co-set-section";
    const sevHeading = document.createElement("div");
    sevHeading.className = "co-set-heading";
    sevHeading.textContent = "Severity";
    sevSection.appendChild(sevHeading);
    const defRow = document.createElement("div");
    defRow.className = "co-set-row";
    const defLabel = document.createElement("label");
    defLabel.className = "co-set-label";
    defLabel.textContent = "Default";
    const defSel = severitySelect(
      rule.defaultAction ? rule.defaultAction.type : "",
      "No default binding",
    );
    const delayInput = document.createElement("input");
    delayInput.type = "number";
    delayInput.className = "co-modal-input co-set-delay";
    delayInput.placeholder = "delay ms";
    delayInput.value =
      rule.defaultAction && rule.defaultAction.delayMs != null
        ? String(rule.defaultAction.delayMs)
        : "";
    function syncDelay() {
      delayInput.style.display = defSel.value === "delay_halt" ? "" : "none";
    }
    syncDelay();
    defSel.addEventListener("change", syncDelay);
    defRow.appendChild(defLabel);
    defRow.appendChild(defSel);
    defRow.appendChild(delayInput);
    sevSection.appendChild(defRow);
    const envSels = {};
    const envByName = {};
    for (const a of rule.envActions || []) envByName[a.environment] = a.type;
    for (const env of environments) {
      const row = document.createElement("div");
      row.className = "co-set-row";
      const label = document.createElement("label");
      label.className = "co-set-label";
      label.textContent = env.name;
      const sel = severitySelect(envByName[env.slug] || "", "Inherit default");
      row.appendChild(label);
      row.appendChild(sel);
      sevSection.appendChild(row);
      envSels[env.slug] = sel;
    }
    card.appendChild(sevSection);

    const configFields = [];
    const config = rule.config && typeof rule.config === "object" ? rule.config : {};
    const configKeys = Object.keys(config);
    if (configKeys.length) {
      const section = document.createElement("div");
      section.className = "co-set-section";
      const heading = document.createElement("div");
      heading.className = "co-set-heading";
      heading.textContent = "Config";
      section.appendChild(heading);
      for (const key of configKeys) {
        const field = buildConfigField(key, config[key]);
        section.appendChild(field.row);
        configFields.push({ key, read: field.read });
      }
      card.appendChild(section);
    }

    const actions = document.createElement("div");
    actions.className = "co-modal-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "co-modal-btn co-set-cancel";
    cancel.textContent = "Cancel";
    const save = document.createElement("button");
    save.type = "button";
    save.className = "co-modal-btn co-modal-btn-primary co-set-save";
    save.textContent = "Save";
    actions.appendChild(cancel);
    actions.appendChild(save);
    card.appendChild(actions);

    document.body.appendChild(overlay);

    function close() {
      overlay.remove();
    }
    cancel.addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });

    save.addEventListener("click", async () => {
      const enabled = enBox.checked;
      const languages = readLanguages ? readLanguages() : undefined;
      let config2;
      if (configFields.length) {
        config2 = {};
        for (const f of configFields) config2[f.key] = f.read();
      }
      const base = { enabled, removeAction: "all" };
      if (languages !== undefined) base.languages = languages;
      if (config2 !== undefined) base.config = config2;
      const ops = [];
      if (defSel.value) {
        ops.push({
          setAction: {
            type: defSel.value,
            delayMs: defSel.value === "delay_halt" ? Number(delayInput.value) || 0 : null,
          },
        });
      }
      for (const env of environments) {
        const v = envSels[env.slug].value;
        if (v) ops.push({ setAction: { type: v, environment: env.slug } });
      }
      try {
        await patchProjectRule(slug, base);
        for (const op of ops) await patchProjectRule(slug, op);
      } catch (err) {
        toast("Couldn't save settings for " + slug + ": " + err.message, "error");
        return;
      }
      enabledBySlug[slug] = enabled;
      if (languages !== undefined) langsBySlug[slug] = languages;
      if (config2 !== undefined) rule.config = config2;
      rule.defaultAction = defSel.value
        ? {
            type: defSel.value,
            delayMs: defSel.value === "delay_halt" ? Number(delayInput.value) || 0 : null,
          }
        : null;
      rule.envActions = environments
        .filter((env) => envSels[env.slug].value)
        .map((env) => ({ environment: env.slug, type: envSels[env.slug].value }));
      close();
      decorate();
      toast("Saved settings for " + slug);
    });
  }

  async function loadData() {
    const projRes = await fetch("/api/projects");
    if (!projRes.ok) throw new Error("GET /api/projects -> " + projRes.status);
    projects = await projRes.json();
    pickCurrentProject();
    const rulesUrl =
      currentProjectId !== null
        ? "/api/projects/" + currentProjectId + "/rules"
        : "/api/rules";
    const rulesRes = await fetch(rulesUrl);
    if (!rulesRes.ok) throw new Error("GET " + rulesUrl + " -> " + rulesRes.status);
    const metaRes = await fetch("/api/meta");
    if (!metaRes.ok) throw new Error("GET /api/meta -> " + metaRes.status);
    const rules = await rulesRes.json();
    const meta = await metaRes.json();
    fixesBySlug = {};
    langsBySlug = {};
    catsBySlug = {};
    enabledBySlug = {};
    ruleBySlug = {};
    const cats = new Set();
    for (const r of rules) {
      fixesBySlug[r.slug] = r.actions || [];
      langsBySlug[r.slug] = r.languages || [];
      langIndependentBySlug[r.slug] = !!r.languageIndependent;
      catsBySlug[r.slug] = r.categories || [];
      enabledBySlug[r.slug] = !!r.enabled;
      ruleBySlug[r.slug] = r;
      for (const c of r.categories || []) cats.add(c);
    }
    environments = meta.environments || [];
    actionTypes = meta.actionTypes || [];
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
    applyProjectRunRoot();
  }

  // Theme (Auto/Light/Dark). "auto" tracks the OS via prefers-color-scheme; the
  // choice persists per browser. We only set data-co-theme on <html> — the dark
  // stylesheet keys off it. The prebuilt panel ships no dark styles, so this
  // graft is the only place theming can live. matchMedia is guarded because the
  // happy-dom test env doesn't provide it; a real browser always does.
  const THEME_KEY = "co-theme";
  const THEMES = ["auto", "light", "dark"];
  const darkMedia = () =>
    window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  function storedTheme() {
    const v = localStorage.getItem(THEME_KEY);
    return THEMES.indexOf(v) !== -1 ? v : "auto";
  }
  function effectiveTheme(pref) {
    if (pref !== "auto") return pref;
    const mq = darkMedia();
    return mq && mq.matches ? "dark" : "light";
  }
  function applyTheme() {
    document.documentElement.setAttribute("data-co-theme", effectiveTheme(storedTheme()));
  }
  function watchSystemTheme() {
    const mq = darkMedia();
    if (mq && mq.addEventListener) {
      mq.addEventListener("change", () => {
        if (storedTheme() === "auto") applyTheme();
      });
    }
  }
  // A titleless segmented icon control (System / Light / Dark). The active button
  // tracks the stored preference, not the resolved theme — so "System" stays lit
  // even as the OS flips the actual palette.
  function buildThemeControl() {
    const group = document.createElement("div");
    group.className = "co-theme-seg";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "Theme");
    const buttons = [];
    function sync() {
      const cur = storedTheme();
      for (const b of buttons) {
        const on = b.getAttribute("data-theme") === cur;
        b.classList.toggle("co-theme-btn-active", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      }
    }
    for (const t of THEMES) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "co-theme-btn";
      btn.setAttribute("data-theme", t);
      btn.title = THEME_TITLES[t];
      btn.setAttribute("aria-label", THEME_TITLES[t]);
      btn.innerHTML = THEME_ICONS[t];
      btn.addEventListener("click", () => {
        localStorage.setItem(THEME_KEY, t);
        applyTheme();
        sync();
      });
      group.appendChild(btn);
      buttons.push(btn);
    }
    sync();
    return group;
  }

  // The row 'lint-naming' → the profiling key 'lint:naming' (best-effort; the
  // profiling stream carries no rule slug — see activity.ts slugToKey).
  function slugToKey(slug) {
    return slug.indexOf("lint-") === 0 ? "lint:" + slug.slice(5) : slug;
  }

  function activityQuery() {
    const rules = Array.from(activitySelectedRules);
    return (
      "?last=" +
      encodeURIComponent(activityWindow) +
      (rules.length ? "&rules=" + encodeURIComponent(rules.join(",")) : "")
    );
  }

  function buildActivityView() {
    if (document.getElementById("co-activity-overlay")) return;
    const root = document.getElementById("root");
    if (!root || !root.parentElement) return;

    const overlay = document.createElement("div");
    overlay.id = "co-activity-overlay";
    overlay.style.display = "none";
    overlay.appendChild(buildOverlayNav("Activity"));

    const subbar = document.createElement("div");
    subbar.className = "co-run-subbar co-act-subbar";
    const wlabel = document.createElement("span");
    wlabel.className = "co-run-target-label";
    wlabel.textContent = "Window";
    const windows = document.createElement("div");
    windows.className = "co-act-windows";
    for (const w of ["1h", "24h", "7d", "30d"]) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "co-act-win" + (w === activityWindow ? " co-act-win-active" : "");
      b.setAttribute("data-win", w);
      b.textContent = w;
      windows.appendChild(b);
    }
    windows.addEventListener("click", (e) => {
      const t = e.target.closest(".co-act-win[data-win]");
      if (!t) return;
      activityWindow = t.getAttribute("data-win");
      for (const btn of windows.querySelectorAll(".co-act-win")) {
        btn.classList.toggle(
          "co-act-win-active",
          btn.getAttribute("data-win") === activityWindow,
        );
      }
      loadActivity(true);
    });
    subbar.appendChild(wlabel);
    subbar.appendChild(windows);
    overlay.appendChild(subbar);

    const body = document.createElement("div");
    body.className = "co-act-body";

    const top = document.createElement("div");
    top.className = "co-act-top";
    const toplist = document.createElement("div");
    toplist.className = "co-act-toplist";
    toplist.id = "co-act-toplist";
    toplist.addEventListener("click", (e) => {
      const t = e.target.closest(".co-act-toprow[data-key]");
      if (!t) return;
      activitySelectedRules.clear();
      activitySelectedRules.add(t.getAttribute("data-key"));
      loadActivity(true);
    });
    const chart = document.createElement("div");
    chart.className = "co-act-chart";
    chart.id = "co-act-chart";
    top.appendChild(toplist);
    top.appendChild(chart);
    body.appendChild(top);

    const bottom = document.createElement("div");
    bottom.className = "co-act-bottom";
    const bhead = document.createElement("div");
    bhead.className = "co-act-bottom-head";
    const btitle = document.createElement("span");
    btitle.className = "co-act-bottom-title";
    btitle.textContent = "Recent activity";
    const filter = document.createElement("div");
    filter.className = "co-act-filter";
    filter.id = "co-act-filter";
    bhead.appendChild(btitle);
    bhead.appendChild(filter);
    const feed = document.createElement("div");
    feed.className = "co-act-feed";
    feed.id = "co-act-feed";
    bottom.appendChild(bhead);
    bottom.appendChild(feed);
    body.appendChild(bottom);

    overlay.appendChild(body);
    root.parentElement.insertBefore(overlay, root.nextSibling);
  }

  function openActivity() {
    runActive = false;
    activityActive = true;
    syncOverlays();
    loadActivity(true);
  }

  function openActivityForRule(slug) {
    activitySelectedRules.clear();
    activitySelectedRules.add(slugToKey(slug));
    openActivity();
  }

  // The rule multiselect. Empty selection means "no filter" (all); an all-checked
  // dropdown collapses back to that, so only a strict subset actually narrows.
  function renderActivityFilter() {
    const slot = document.getElementById("co-act-filter");
    if (!slot) return;
    const allChecked = activitySelectedRules.size === 0;
    const selected = allChecked ? activityKeys.slice() : Array.from(activitySelectedRules);
    const dd = checkboxDropdown({
      items: activityKeys.map((k) => ({ value: k, label: k })),
      selected,
      summaryFn: (vals) => filterLabel("Rules", vals.length, activityKeys.length),
      onChange: (vals) => {
        activitySelectedRules.clear();
        if (vals.length !== activityKeys.length) {
          for (const v of vals) activitySelectedRules.add(v);
        }
        loadActivity(false);
      },
    });
    slot.innerHTML = "";
    slot.appendChild(dd.details);
  }

  function renderActivityTop(top) {
    const el = document.getElementById("co-act-toplist");
    if (!el) return;
    if (!top.length) {
      el.innerHTML = '<div class="co-act-empty">No activity in this window.</div>';
      return;
    }
    const max = Math.max(1, ...top.map((t) => t.runs));
    let html = '<div class="co-act-toplist-head">Top rules</div>';
    for (const t of top) {
      const pct = Math.round((t.runs / max) * 100);
      const fails = t.failures ? " · " + t.failures + " ✗" : "";
      html +=
        '<button type="button" class="co-act-toprow" data-key="' + esc(t.key) + '">' +
        '<span class="co-act-toprow-key">' + esc(t.key) + "</span>" +
        '<span class="co-act-toprow-bar"><span class="co-act-toprow-fill" style="width:' +
        pct + '%"></span></span>' +
        '<span class="co-act-toprow-n">' + t.runs + fails + "</span></button>";
    }
    el.innerHTML = html;
  }

  // A dependency-free SVG column chart: runs per time bucket, failures overlaid.
  function renderActivityChart(series) {
    const el = document.getElementById("co-act-chart");
    if (!el) return;
    const buckets = (series && series.buckets) || [];
    const max = Math.max(1, ...buckets.map((b) => b.runs));
    const W = 600, H = 150, base = H - 4;
    const bw = buckets.length ? (W - 8) / buckets.length : 0;
    let bars = "";
    buckets.forEach((b, i) => {
      const h = Math.round((b.runs / max) * (base - 6));
      const x = (4 + i * bw).toFixed(1);
      const w = Math.max(1, bw - 1).toFixed(1);
      bars +=
        '<rect class="co-act-bar" x="' + x + '" y="' + (base - h) +
        '" width="' + w + '" height="' + h + '"><title>' + b.runs +
        " runs</title></rect>";
      if (b.failures) {
        const fh = Math.round((b.failures / max) * (base - 6));
        bars +=
          '<rect class="co-act-bar-fail" x="' + x + '" y="' + (base - fh) +
          '" width="' + w + '" height="' + fh + '"><title>' + b.failures +
          " failures</title></rect>";
      }
    });
    el.innerHTML =
      '<svg class="co-act-svg" viewBox="0 0 ' + W + " " + H +
      '" preserveAspectRatio="none">' + bars + "</svg>" +
      '<div class="co-act-chart-cap">Runs over the last ' + esc(activityWindow) + "</div>";
  }

  function renderActivityFeed(events) {
    const el = document.getElementById("co-act-feed");
    if (!el) return;
    if (!events.length) {
      el.innerHTML = '<div class="co-act-empty">No recent activity.</div>';
      return;
    }
    let html = "";
    for (const ev of events) {
      const when = new Date(ev.timeMs).toLocaleString();
      const badge =
        '<span class="co-act-src co-act-src-' + (ev.source === "hook" ? "hook" : "log") +
        '">' + ev.source + "</span>";
      let pill = "";
      if (ev.status === "failure") pill = '<span class="co-run-pill co-run-pill-n">failure</span>';
      else if (ev.status === "success") pill = '<span class="co-run-pill co-run-pill-ok">success</span>';
      html +=
        '<div class="co-act-row"><span class="co-act-time">' + esc(when) + "</span>" +
        badge + '<span class="co-act-key">' + esc(ev.key) + "</span>" + pill +
        '<span class="co-act-detail">' + esc(ev.detail) + "</span></div>";
    }
    el.innerHTML = html;
  }

  async function loadActivityFeed() {
    const res = await fetch("/api/activity/feed" + activityQuery());
    if (!res.ok) throw new Error("GET /api/activity/feed -> " + res.status);
    renderActivityFeed(await res.json());
  }

  // rebuildFilter is false when the multiselect itself drove the reload, so its
  // open dropdown isn't torn down mid-interaction.
  async function loadActivity(rebuildFilter) {
    const res = await fetch("/api/activity/summary" + activityQuery());
    if (!res.ok) throw new Error("GET /api/activity/summary -> " + res.status);
    const data = await res.json();
    activityKeys = data.keys || [];
    if (rebuildFilter) renderActivityFilter();
    renderActivityTop(data.top || []);
    renderActivityChart(data.series || { bucketMs: 0, buckets: [] });
    await loadActivityFeed();
  }

  async function start() {
    applyTheme();
    watchSystemTheme();
    injectStyle();
    loadHighlighter();
    await loadData();
    await loadRunMeta();
    applyProjectRunRoot();
    buildRunView();
    buildActivityView();
    const root = document.getElementById("root") || document.body;
    new MutationObserver(schedule).observe(root, { childList: true, subtree: true });
    // Delegate on document so a React re-render of the table can't drop the
    // handler; the actions column is re-decorated but never re-bound.
    document.addEventListener("click", onActionClick);
    document.addEventListener("click", onHeaderClick);
    decorate();
    await maybeShowAnalyzeBanner();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { start(); });
  } else {
    start();
  }
})();
`;
