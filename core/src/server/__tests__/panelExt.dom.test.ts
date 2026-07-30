// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PANEL_EXT } from "../panelExt.js";

// Exercises the injected browser script against a DOM that mirrors the prebuilt
// panel's structure (native category <select> + rules table). The script is a
// runtime string, so we eval it and stub fetch the way the panel's own runtime
// would answer.

const RULES = [
  {
    slug: "lint-a",
    name: "A",
    categories: ["size"],
    stages: ["pre-commit"],
    languages: ["typescript"],
    actions: [],
    config: { maxLines: 300, exclude: ["dist/**"] },
    defaultAction: { type: "halt", delayMs: null },
    envActions: [{ environment: "claude", type: "warn" }],
  },
  {
    slug: "lint-b",
    name: "B",
    categories: ["naming"],
    stages: ["pre-commit", "pre-push"],
    languages: [],
    actions: [{ kind: "output" }],
  },
  // No category/stage and language-independent: the filters can't exclude it, so it always shows.
  { slug: "lint-c", name: "C", categories: [], stages: [], languages: [], languageIndependent: true, actions: [] },
];
const META = {
  languages: [
    { slug: "typescript", name: "TypeScript" },
    { slug: "javascript", name: "JavaScript" },
    { slug: "csharp", name: "C#" },
  ],
  environments: [
    { slug: "claude", name: "Claude Code" },
    { slug: "cursor", name: "Cursor" },
    { slug: "github", name: "GitHub" },
  ],
  actionTypes: [
    { slug: "warn", name: "Warn" },
    { slug: "halt", name: "Halt" },
    { slug: "delay_halt", name: "Delayed halt" },
  ],
  stages: [
    { slug: "pre-commit", name: "Pre-commit" },
    { slug: "pre-push", name: "Pre-push" },
    { slug: "claude-tool", name: "Claude tool" },
    { slug: "server", name: "Server" },
  ],
};

interface ProjectView {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  files: string[];
  directories: string[];
  isDefault: boolean;
}

// lint-a is disabled in project 2 only, so switching projects flips its toggle.
function projectRules(id: number) {
  return RULES.map((r) => ({ ...r, enabled: !(id === 2 && r.slug === "lint-a") }));
}

let projectList: ProjectView[];
let projectCreateCalls: { name: string; directories: string[] }[];
let patchCalls: { url: string; body: Record<string, unknown> }[];
let runCalls: { slugs: string[]; path: string }[];
let runResult: unknown;
let analyzeCalls: unknown[];
let analyzeFails: boolean;
let analyzeStatusResult: { analyzed: boolean; lastAnalyzed: string | null };
let lsStore: Map<string, string>;
let activitySummaryResult: unknown;
let activityFeedResult: unknown[];
let activityCalls: string[];
let activityFeedCalls: string[];
const RUN_RESULT = [
  {
    slug: "lint-a",
    ok: true,
    violations: [
      { path: "x.ts", line: 2, col: 5, kind: "size", detail: "too big" },
      { path: "x.ts", line: 2, col: 9, kind: "size", detail: "also big" },
    ],
  },
  { slug: "lint-b", ok: true, violations: [] },
  { slug: "lint-c", ok: false, violations: [], error: "boom" },
];
const FILE_TEXT = "const a = 1\nconst bad = 2\nconst c = 3\n";

function jsonRes(obj: unknown) {
  return { ok: true, status: 200, json: async () => obj } as unknown as Response;
}

function row(slug: string, name: string, category: string): string {
  return (
    '<tr class="row"><td><div class="font-medium">' + name + "</div>" +
    '<div class="font-mono">' + slug + "</div></td>" +
    "<td><span>" + category + "</span></td>" +
    '<td>pre-commit</td><td class="text-center">on</td><td>action</td></tr>'
  );
}

function buildPanelDom() {
  document.body.innerHTML =
    '<div id="root"><nav class="tabs">' +
    "<button>Rules</button><button>Profiling</button></nav>" +
    '<div class="bar">' +
    '<input class="search"/>' +
    '<select class="native-cat">' +
    '<option value="all">All categories</option>' +
    '<option value="size">size</option>' +
    '<option value="naming">naming</option>' +
    "</select>" +
    "<span>2 of 2 rules</span></div>" +
    '<table class="w-full"><thead><tr>' +
    "<th>Rule</th><th>Category</th><th>Stage</th><th>Enabled</th><th>Action</th>" +
    "</tr></thead><tbody>" +
    row("lint-a", "A", "size") +
    row("lint-b", "B", "naming") +
    row("lint-c", "C", "") +
    "</tbody></table></div>";
}

const flush = () => new Promise((r) => setTimeout(r, 0));

async function runInjected() {
  new Function(PANEL_EXT)();
  // Let loadData()'s fetches, decorate(), and the MutationObserver settle.
  for (let i = 0; i < 4; i++) await flush();
}

beforeEach(() => {
  projectList = [
    { id: 1, slug: "repo", name: "Repo", description: null, files: [], directories: ["/proj"], isDefault: true },
    { id: 2, slug: "web", name: "Web", description: null, files: [], directories: ["/proj/src"], isDefault: false },
  ];
  projectCreateCalls = [];
  patchCalls = [];
  runCalls = [];
  runResult = RUN_RESULT;
  analyzeCalls = [];
  analyzeFails = false;
  analyzeStatusResult = { analyzed: true, lastAnalyzed: "2026-01-01T00:00:00Z" };
  activityCalls = [];
  activityFeedCalls = [];
  activitySummaryResult = {
    keys: ["commit", "lint:dup", "lint:naming"],
    top: [
      { key: "lint:naming", runs: 5, failures: 2 },
      { key: "lint:dup", runs: 3, failures: 0 },
    ],
    series: { bucketMs: 1000, buckets: [{ t: 1, runs: 2, failures: 1 }, { t: 2, runs: 3, failures: 0 }] },
  };
  activityFeedResult = [
    { timeMs: 2000, source: "hook", key: "lint:naming", status: "failure", detail: "npm lint:naming" },
    { timeMs: 1000, source: "log", key: "rule.enabled", detail: "enabled lint-naming" },
  ];
  // This happy-dom build ships no Storage, so stub localStorage the way the panel
  // uses it (get/set), Map-backed and fresh per test.
  lsStore = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (lsStore.has(k) ? lsStore.get(k) : null),
    setItem: (k: string, v: string) => void lsStore.set(k, String(v)),
  });
  vi.stubGlobal("fetch", async (url: string, opts?: RequestInit) => {
    if (url === "/api/projects" && opts?.method === "POST") {
      const body = JSON.parse(opts.body as string);
      projectCreateCalls.push(body);
      const created = {
        id: 3,
        slug: "gamma",
        name: body.name,
        description: body.description ?? null,
        files: body.files ?? [],
        directories: body.directories ?? [],
        isDefault: false,
      };
      projectList.push(created);
      return jsonRes(created);
    }
    if (url === "/api/projects") return jsonRes(projectList);
    if (typeof url === "string" && /^\/api\/projects\/\d+\/rules$/.test(url)) {
      return jsonRes(projectRules(Number(url.split("/")[3])));
    }
    if (url === "/api/rules") return jsonRes(RULES);
    if (url === "/api/meta") return jsonRes(META);
    if (url === "/api/mode") {
      return jsonRes({ mode: "local", dbPath: "/proj/.captain-obvious/captain-obvious.db", auditDbPath: "/proj/.captain-obvious/audit-log.db" });
    }
    if (url === "/api/run/meta") {
      return jsonRes({ root: "/proj", runnableSlugs: ["lint-a", "lint-b"] });
    }
    if (typeof url === "string" && url.startsWith("/api/run/browse")) {
      const q = new URL(url, "http://x").searchParams.get("path");
      if (q === "/proj/src") {
        return jsonRes({
          path: "/proj/src",
          parent: "/proj",
          entries: [{ name: "app.ts", type: "file", path: "/proj/src/app.ts" }],
        });
      }
      return jsonRes({
        path: "/proj",
        parent: "/",
        entries: [
          { name: "src", type: "dir", path: "/proj/src" },
          { name: "index.ts", type: "file", path: "/proj/index.ts" },
        ],
      });
    }
    if (url === "/api/run") {
      runCalls.push(JSON.parse(opts?.body as string));
      return jsonRes(runResult);
    }
    if (url === "/api/analyze/status") return jsonRes(analyzeStatusResult);
    if (url === "/api/analyze") {
      analyzeCalls.push(JSON.parse((opts?.body as string) || "{}"));
      if (analyzeFails) {
        return { ok: false, status: 400, json: async () => ({ error: "scan failed" }) } as unknown as Response;
      }
      return jsonRes({
        root: "/proj",
        totalFiles: 3,
        otherFiles: 1,
        languages: [{ slug: "typescript", name: "TypeScript", files: 3 }],
      });
    }
    if (typeof url === "string" && url.startsWith("/api/run/file")) {
      const p = new URL(url, "http://x").searchParams.get("path")!;
      if (p === "boom.ts") {
        return { ok: false, status: 400, json: async () => ({ error: "read failed" }) } as unknown as Response;
      }
      return jsonRes({ path: "/proj/" + p, text: FILE_TEXT });
    }
    if (typeof url === "string" && url.startsWith("/api/activity/summary")) {
      activityCalls.push(url);
      return jsonRes(activitySummaryResult);
    }
    if (typeof url === "string" && url.startsWith("/api/activity/feed")) {
      activityFeedCalls.push(url);
      return jsonRes(activityFeedResult);
    }
    if (opts?.method === "PATCH") {
      patchCalls.push({ url, body: JSON.parse(opts.body as string) });
      return jsonRes({});
    }
    throw new Error("unexpected fetch: " + url);
  });
  vi.stubGlobal("alert", () => {});
  // The panel lazy-loads highlight.js from a CDN <script>; happy-dom can't fetch
  // it, so treat the disabled load as a no-op instead of logging a load error.
  (window as unknown as { happyDOM: { settings: { handleDisabledFileLoadingAsSuccess: boolean } } })
    .happyDOM.settings.handleDisabledFileLoadingAsSuccess = true;
  buildPanelDom();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { hljs?: unknown }).hljs;
});

describe("panelExt injected script", () => {
  it("adds a Languages column right after Category, and Fix at the end", async () => {
    await runInjected();
    const heads = [...document.querySelectorAll("thead th")].map((t) =>
      t.textContent,
    );
    // Native: Rule, Category, Stage, Enabled, Action.
    expect(heads).toEqual([
      "Rule",
      "Category",
      "Languages",
      "Stage",
      "Enabled",
      "Action",
      "Fix",
      "",
    ]);
    // The native Category/Stage cells are hidden and replaced in place by
    // editable-pill cells; Languages sits right after the Category pill cell.
    const firstRow = document.querySelector("tbody tr")!;
    expect(firstRow.children[2].classList.contains("co-cat-td")).toBe(true);
    expect(firstRow.children[3].classList.contains("co-lang-td")).toBe(true);
    expect(firstRow.children[5].classList.contains("co-stage-td")).toBe(true);
    expect(
      (firstRow.children[1] as HTMLElement).style.display === "none" &&
        (firstRow.children[4] as HTMLElement).style.display === "none",
    ).toBe(true);
  });

  it("sorts rows by a clicked column and toggles asc/desc, surviving re-render", async () => {
    await runInjected();
    const slugOrder = () =>
      [...document.querySelectorAll("tbody tr")].map(
        (r) => r.querySelector(".font-mono")?.textContent,
      );
    const header = (label: string) =>
      [...document.querySelectorAll<HTMLElement>("thead th")].find(
        (t) => t.textContent!.trim() === label,
      )!;
    // Natural catalog order.
    expect(slugOrder()).toEqual(["lint-a", "lint-b", "lint-c"]);

    // Category asc: "" (lint-c) < "naming" (lint-b) < "size" (lint-a).
    const cat = header("Category");
    cat.click();
    expect(slugOrder()).toEqual(["lint-c", "lint-b", "lint-a"]);
    expect(cat.classList.contains("co-sort-asc")).toBe(true);
    // A second click flips to descending.
    cat.click();
    expect(slugOrder()).toEqual(["lint-a", "lint-b", "lint-c"]);
    expect(cat.classList.contains("co-sort-desc")).toBe(true);

    // Fix count sorts numerically: only lint-b has an action.
    header("Fix").click();
    expect(slugOrder()).toEqual(["lint-a", "lint-c", "lint-b"]);

    // The native Action column isn't sortable — the order holds.
    const before = slugOrder();
    header("Action").click();
    expect(slugOrder()).toEqual(before);

    // A React-style re-render (a MutationObserver tick) keeps the active sort.
    document.getElementById("root")!.appendChild(document.createElement("div"));
    for (let i = 0; i < 2; i++) await flush();
    expect(slugOrder()).toEqual(["lint-a", "lint-c", "lint-b"]);
  });

  it("leaves already-sorted rows untouched on a re-render tick (no churn, no scroll jump)", async () => {
    await runInjected();
    const header = (label: string) =>
      [...document.querySelectorAll<HTMLElement>("thead th")].find(
        (t) => t.textContent!.trim() === label,
      )!;
    header("Category").click(); // sort is now active; DOM is in sorted order
    const tbody = document.querySelector("tbody")!;
    const appendSpy = vi.spyOn(tbody, "appendChild");
    // An unrelated re-render tick (a toast, a React re-render) fires decorate() →
    // applySort(). With the DOM already sorted it must not re-append any row —
    // re-appending would detach an open dropdown's row and scroll the page.
    document.getElementById("root")!.appendChild(document.createElement("div"));
    for (let i = 0; i < 2; i++) await flush();
    expect(appendSpy).not.toHaveBeenCalled();
  });

  it("renders each rule's languages by display name (— when none)", async () => {
    await runInjected();
    const rows = document.querySelectorAll("tbody tr");
    const summaryOf = (tr: Element) =>
      tr.querySelector(".co-lang-td .co-dd-summary")?.textContent;
    expect(summaryOf(rows[0])).toBe("TypeScript");
    expect(summaryOf(rows[1])).toBe("—");
  });

  it("renders a fixed 'Language independent' cell for language-independent rules", async () => {
    await runInjected();
    const cell = document.querySelectorAll(".co-lang-td")[2]; // lint-c
    const dd = cell.querySelector(".co-lang-dd")!;
    expect(dd.classList.contains("co-lang-independent")).toBe(true);
    expect(dd.querySelector(".co-dd-summary")?.textContent).toBe(
      "Language independent",
    );
    // Nothing to narrow: no editable checkboxes, and the filter can't exclude it.
    expect(dd.querySelector(".co-dd-opt")).toBeNull();
    expect(cell.getAttribute("data-langs")).toBe("");
  });

  it("replaces the native category filter with Category + Language multiselects", async () => {
    await runInjected();
    const native = document.querySelector<HTMLSelectElement>(".native-cat")!;
    expect(native.style.display).toBe("none");
    expect(document.querySelector(".co-filter-cats")).not.toBeNull();
    expect(document.querySelector(".co-filter-langs")).not.toBeNull();
    // Category options come from the rules' full category sets.
    const catValues = [
      ...document.querySelectorAll(".co-filter-cats .co-dd-opt"),
    ].map((i) => (i as HTMLInputElement).value);
    expect(catValues.sort()).toEqual(["naming", "size"]);
  });

  it("gives each dropdown a search box, an All toggle, and Clear/Close buttons", async () => {
    await runInjected();
    const cat = document.querySelector(".co-filter-cats")!;
    expect(cat.querySelector(".co-dd-search")).not.toBeNull();
    expect(cat.querySelector(".co-dd-all")).not.toBeNull();
    expect(cat.querySelector(".co-dd-clear")).not.toBeNull();
    expect(cat.querySelector(".co-dd-close")).not.toBeNull();
    // The All toggle is the first item, ahead of the options.
    const firstItem = cat.querySelector(".co-dd-list .co-dd-item input");
    expect((firstItem as HTMLInputElement).classList.contains("co-dd-all")).toBe(
      true,
    );
  });

  it("search hides options whose label doesn't match", async () => {
    await runInjected();
    const cat = document.querySelector(".co-filter-cats")!;
    const opt = (v: string) =>
      [...cat.querySelectorAll<HTMLInputElement>(".co-dd-opt")].find(
        (i) => i.value === v,
      )!;
    const labelOf = (i: HTMLInputElement) => i.closest(".co-dd-item") as HTMLElement;
    const search = cat.querySelector<HTMLInputElement>(".co-dd-search")!;
    search.value = "nam";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    expect(labelOf(opt("size")).style.display).toBe("none");
    expect(labelOf(opt("naming")).style.display).toBe("");
  });

  it("defaults to All selected; unchecking narrows, Clear empties, All restores", async () => {
    await runInjected();
    const cat = document.querySelector(".co-filter-cats")!;
    const opt = (v: string) =>
      [...cat.querySelectorAll<HTMLInputElement>(".co-dd-opt")].find(
        (i) => i.value === v,
      )!;
    const all = cat.querySelector<HTMLInputElement>(".co-dd-all")!;
    const summary = () => cat.querySelector(".co-dd-summary")!.textContent;

    // Default: All checked, every option checked, summary reads "all".
    expect(all.checked).toBe(true);
    expect(opt("size").checked).toBe(true);
    expect(opt("naming").checked).toBe(true);
    expect(summary()).toBe("Categories: all");

    // Uncheck one option -> narrows; All reflects the partial state.
    opt("size").checked = false;
    opt("size").dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(all.checked).toBe(false);
    expect(summary()).toBe("Categories (1)");

    // Clear -> nothing selected.
    cat.querySelector<HTMLButtonElement>(".co-dd-clear")!.click();
    await flush();
    expect(opt("naming").checked).toBe(false);
    expect(summary()).toBe("Categories: none");

    // All -> everything selected again.
    all.checked = true;
    all.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(opt("size").checked).toBe(true);
    expect(summary()).toBe("Categories: all");
  });

  it("Close button collapses the dropdown", async () => {
    await runInjected();
    const details = document.querySelector<HTMLDetailsElement>(".co-filter-cats")!;
    details.open = true;
    details.querySelector<HTMLButtonElement>(".co-dd-close")!.click();
    expect(details.open).toBe(false);
  });

  it("a click outside an open dropdown collapses it", async () => {
    await runInjected();
    const details = document.querySelector<HTMLDetailsElement>(".co-filter-cats")!;
    details.open = true;
    document.body.click();
    expect(details.open).toBe(false);
  });

  it("a click inside an open dropdown leaves it open", async () => {
    await runInjected();
    const details = document.querySelector<HTMLDetailsElement>(".co-filter-cats")!;
    details.open = true;
    details.querySelector<HTMLInputElement>(".co-dd-search")!.click();
    expect(details.open).toBe(true);
  });

  it("PATCHes the new language set when a row checkbox is toggled", async () => {
    await runInjected();
    const cell = document.querySelector(".co-lang-td")!; // lint-a
    const jsBox = [...cell.querySelectorAll<HTMLInputElement>(".co-dd-opt")].find(
      (i) => i.value === "javascript",
    )!;
    jsBox.checked = true;
    jsBox.dispatchEvent(new Event("change", { bubbles: true }));
    for (let i = 0; i < 3; i++) await flush();

    expect(patchCalls).toHaveLength(1);
    expect(patchCalls[0].url).toBe("/api/projects/1/rules/lint-a");
    expect([...(patchCalls[0].body.languages as string[])].sort()).toEqual([
      "javascript",
      "typescript",
    ]);
  });

  it("renders editable category pills and PATCHes the global rule on toggle", async () => {
    await runInjected();
    const cell = document.querySelector(".co-cat-td")!; // lint-a has ["size"]
    const pills = [...cell.querySelectorAll(".co-pill")].map((p) => p.textContent);
    expect(pills.some((t) => t!.startsWith("size"))).toBe(true);
    const box = [...cell.querySelectorAll<HTMLInputElement>(".co-dd-opt")].find(
      (i) => i.value === "naming",
    )!;
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    for (let i = 0; i < 3; i++) await flush();
    expect(patchCalls).toHaveLength(1);
    expect(patchCalls[0].url).toBe("/api/rules/lint-a");
    expect([...(patchCalls[0].body.categories as string[])].sort()).toEqual([
      "naming",
      "size",
    ]);
  });

  it("removes a category pill and PATCHes the reduced set", async () => {
    await runInjected();
    const cell = document.querySelector(".co-cat-td")!; // lint-a
    cell.querySelector<HTMLButtonElement>(".co-pill-x")!.click();
    for (let i = 0; i < 3; i++) await flush();
    expect(patchCalls[0].url).toBe("/api/rules/lint-a");
    expect(patchCalls[0].body.categories).toEqual([]);
  });

  it("creates a brand-new category from free text and PATCHes it", async () => {
    await runInjected();
    const cell = document.querySelector(".co-cat-td")!; // lint-a
    cell.querySelector<HTMLInputElement>(".co-pills-new")!.value = "governance";
    cell.querySelector<HTMLButtonElement>(".co-dd-add-btn")!.click();
    for (let i = 0; i < 3; i++) await flush();
    expect(patchCalls[0].url).toBe("/api/rules/lint-a");
    expect([...(patchCalls[0].body.categories as string[])].sort()).toEqual([
      "governance",
      "size",
    ]);
  });

  it("renders editable stage pills and PATCHes the global rule on toggle", async () => {
    await runInjected();
    const cell = document.querySelector(".co-stage-td")!; // lint-a has ["pre-commit"]
    const pills = [...cell.querySelectorAll(".co-pill")].map((p) => p.textContent);
    expect(pills.some((t) => t!.startsWith("Pre-commit"))).toBe(true);
    const box = [...cell.querySelectorAll<HTMLInputElement>(".co-dd-opt")].find(
      (i) => i.value === "pre-push",
    )!;
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    for (let i = 0; i < 3; i++) await flush();
    expect(patchCalls[0].url).toBe("/api/rules/lint-a");
    expect([...(patchCalls[0].body.stages as string[])].sort()).toEqual([
      "pre-commit",
      "pre-push",
    ]);
  });

  it("offers no free-text creation for stages (fixed taxonomy)", async () => {
    await runInjected();
    const cell = document.querySelector(".co-stage-td")!;
    expect(cell.querySelector(".co-pills-new")).toBeNull();
    // The four canonical stages are the only options.
    const opts = [...cell.querySelectorAll<HTMLInputElement>(".co-dd-opt")].map(
      (i) => i.value,
    );
    expect(opts.sort()).toEqual(["claude-tool", "pre-commit", "pre-push", "server"]);
  });

  it("narrows rows by the Stage filter", async () => {
    await runInjected();
    for (const v of ["pre-commit", "claude-tool", "server"]) {
      const b = [
        ...document.querySelectorAll<HTMLInputElement>(".co-filter-stages .co-dd-opt"),
      ].find((i) => i.value === v)!;
      b.checked = false;
      b.dispatchEvent(new Event("change", { bubbles: true }));
    }
    for (let i = 0; i < 3; i++) await flush();
    const rows = document.querySelectorAll<HTMLTableRowElement>("tbody tr");
    expect(rows[0].style.display).toBe("none"); // lint-a (pre-commit only) hidden
    expect(rows[1].style.display).toBe(""); // lint-b (has pre-push) shown
    expect(rows[2].style.display).toBe(""); // lint-c (no stage) always shows
  });

  it("shows every row by default (All selected drives the filter)", async () => {
    await runInjected();
    const rows = document.querySelectorAll<HTMLTableRowElement>("tbody tr");
    expect([...rows].map((r) => r.style.display)).toEqual(["", "", ""]);
  });

  it("narrows rows when a category is unchecked; metadata-less rows still show", async () => {
    await runInjected();
    const sizeBox = [
      ...document.querySelectorAll<HTMLInputElement>(".co-filter-cats .co-dd-opt"),
    ].find((i) => i.value === "size")!;
    sizeBox.checked = false; // leaves only "naming" selected
    sizeBox.dispatchEvent(new Event("change", { bubbles: true }));
    for (let i = 0; i < 3; i++) await flush();

    const rows = document.querySelectorAll<HTMLTableRowElement>("tbody tr");
    expect(rows[0].style.display).toBe("none"); // lint-a (size) hidden
    expect(rows[1].style.display).toBe(""); // lint-b (naming) shown
    expect(rows[2].style.display).toBe(""); // lint-c (no category) always shows
  });

  it("injects a Run tab right after Rules and a hidden overlay listing only runnable rules", async () => {
    await runInjected();
    const tab = document.querySelector(".co-run-tab")!;
    expect(tab.textContent).toBe("Run");
    // Positioned immediately after the Rules tab (not appended at the end).
    const labels = [...document.querySelectorAll("nav button")].map((b) => b.textContent);
    expect(labels).toEqual(["Rules", "Run", "Activity", "Profiling"]);
    const overlay = document.querySelector<HTMLElement>("#co-run-overlay")!;
    expect(overlay.style.display).toBe("none");
    // Picker prefills the folder and lists only the runnable slugs (lint-a, lint-b).
    expect(document.querySelector<HTMLInputElement>("#co-run-path")!.value).toBe("/proj");
    const opts = [...overlay.querySelectorAll<HTMLInputElement>(".co-run-opt")].map(
      (i) => i.value,
    );
    expect(opts.sort()).toEqual(["lint-a", "lint-b"]);
  });

  it("Run tab shows the overlay and hides the panel; the branded nav restores it", async () => {
    await runInjected();
    const root = document.getElementById("root")!;
    const overlay = document.querySelector<HTMLElement>("#co-run-overlay")!;
    (document.querySelector(".co-run-tab") as HTMLElement).click();
    expect(overlay.style.display).toBe("flex");
    expect(root.style.display).toBe("none");
    // The overlay wears the panel's branded header; its Rules tab closes the
    // overlay and routes back into the panel.
    (overlay.querySelector('.co-run-nav-tab[data-nav="Rules"]') as HTMLElement).click();
    expect(overlay.style.display).toBe("none");
    expect(root.style.display).toBe("");
  });

  it("hides the native Advanced tab", async () => {
    const nav = document.querySelector("nav")!;
    const advanced = document.createElement("button");
    advanced.textContent = "Advanced";
    nav.appendChild(advanced); // decorate() hides it on the first pass
    await runInjected();
    expect(advanced.style.display).toBe("none");
  });

  it("gives the Run overlay a branded header whose Activity tab switches overlays", async () => {
    await runInjected();
    const runOverlay = document.querySelector<HTMLElement>("#co-run-overlay")!;
    (document.querySelector(".co-run-tab") as HTMLElement).click();
    expect(runOverlay.querySelector(".co-run-brand-name")!.textContent).toBe("Captain Obvious");
    expect(runOverlay.querySelector(".co-run-nav-active")!.textContent).toBe("Run");
    // The Activity tab in the Run overlay's nav swaps to the Activity overlay.
    (runOverlay.querySelector('.co-run-nav-tab[data-nav="Activity"]') as HTMLElement).click();
    for (let i = 0; i < 3; i++) await flush();
    expect(runOverlay.style.display).toBe("none");
    expect(document.querySelector<HTMLElement>("#co-activity-overlay")!.style.display).toBe("flex");
  });

  it("wraps the rules table so it scrolls instead of clipping columns", async () => {
    await runInjected();
    const table = document.querySelector("table")!;
    expect(table.parentElement!.classList.contains("co-table-wrap")).toBe(true);
  });

  it("shows a Local/Global mode badge in the header from /api/mode", async () => {
    await runInjected();
    const badge = document.querySelector<HTMLElement>(".co-mode-badge")!;
    expect(badge.textContent).toBe("Local");
    expect(badge.classList.contains("co-mode-global")).toBe(false);
    expect(badge.title).toContain(".captain-obvious/captain-obvious.db");
  });

  it("browses the server filesystem: navigate into a dir and pick a file as target", async () => {
    await runInjected();
    const overlay = document.querySelector<HTMLElement>("#co-run-overlay")!;
    const pathInput = overlay.querySelector<HTMLInputElement>("#co-run-path")!;
    const browser = overlay.querySelector<HTMLElement>("#co-run-browser")!;

    overlay.querySelector<HTMLButtonElement>(".co-run-browse-btn")!.click();
    for (let i = 0; i < 3; i++) await flush();
    expect(browser.style.display).toBe("block");
    // Root listing shows the dir and file entries.
    expect([...browser.querySelectorAll(".co-run-entry")].map((e) => e.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("src"), expect.stringContaining("index.ts")]),
    );

    // Navigate into src/ …
    browser.querySelector<HTMLElement>('[data-dir="/proj/src"]')!.click();
    for (let i = 0; i < 3; i++) await flush();
    // … then pick a file → target set, browser closes.
    browser.querySelector<HTMLElement>('[data-file="/proj/src/app.ts"]')!.click();
    expect(pathInput.value).toBe("/proj/src/app.ts");
    expect(browser.style.display).toBe("none");
  });

  it("Use-this-folder picks the current directory as the target", async () => {
    await runInjected();
    const overlay = document.querySelector<HTMLElement>("#co-run-overlay")!;
    const browser = overlay.querySelector<HTMLElement>("#co-run-browser")!;
    overlay.querySelector<HTMLButtonElement>(".co-run-browse-btn")!.click();
    for (let i = 0; i < 3; i++) await flush();
    browser.querySelector<HTMLButtonElement>(".co-run-use")!.click();
    expect(overlay.querySelector<HTMLInputElement>("#co-run-path")!.value).toBe("/proj");
  });

  it("gates Run on a selection, then POSTs the chosen slugs and renders grouped results", async () => {
    await runInjected();
    const overlay = document.querySelector<HTMLElement>("#co-run-overlay")!;
    const btn = overlay.querySelector<HTMLButtonElement>("#co-run-btn")!;
    expect(btn.disabled).toBe(true); // no selection yet

    const box = [...overlay.querySelectorAll<HTMLInputElement>(".co-run-opt")].find(
      (i) => i.value === "lint-a",
    )!;
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    expect(btn.disabled).toBe(false);

    btn.click();
    for (let i = 0; i < 4; i++) await flush();

    expect(runCalls).toHaveLength(1);
    expect(runCalls[0]).toEqual({ slugs: ["lint-a"], path: "/proj" });
    const results = overlay.querySelector("#co-run-results")!;
    expect(results.querySelector(".co-run-slug")!.textContent).toBe("lint-a");
    expect(results.textContent).toContain("too big");
    expect(results.textContent).toContain("no violations"); // lint-b, empty
  });

  // Run lint-a, then return the overlay with results rendered so a violation
  // row can be clicked into the editor.
  async function runAndSelect(): Promise<HTMLElement> {
    await runInjected();
    const overlay = document.querySelector<HTMLElement>("#co-run-overlay")!;
    const box = [...overlay.querySelectorAll<HTMLInputElement>(".co-run-opt")].find(
      (i) => i.value === "lint-a",
    )!;
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    overlay.querySelector<HTMLButtonElement>("#co-run-btn")!.click();
    for (let i = 0; i < 4; i++) await flush();
    return overlay;
  }

  function synthVio(results: Element, path: string, line: string): HTMLElement {
    const vio = document.createElement("div");
    vio.className = "co-run-vio";
    vio.setAttribute("data-path", path);
    vio.setAttribute("data-line", line);
    results.appendChild(vio);
    return vio;
  }

  function visibleRunSlugs(overlay: HTMLElement): (string | null)[] {
    return [...overlay.querySelectorAll<HTMLElement>("#co-run-results-list .co-run-rule")]
      .filter((b) => b.style.display !== "none")
      .map((b) => b.getAttribute("data-slug"));
  }

  function setRunFilter(overlay: HTMLElement, id: string, value: string): void {
    const sel = overlay.querySelector<HTMLSelectElement>("#" + id)!;
    sel.value = value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }

  it("shows the output toolbar at all times, even before a run", async () => {
    await runInjected();
    expect(document.querySelector<HTMLElement>("#co-run-results-bar")!.style.display).toBe("flex");
    const overlay = await runAndSelect();
    expect(overlay.querySelector<HTMLElement>("#co-run-results-bar")!.style.display).toBe("flex");
  });

  it("offers exactly All / Violations / Successes / Errors in the Show filter", async () => {
    const overlay = await runAndSelect();
    const labels = [...overlay.querySelectorAll<HTMLOptionElement>("#co-run-show option")].map(
      (o) => o.textContent,
    );
    expect(labels).toEqual(["All", "Violations", "Successes", "Errors"]);
  });

  it("narrows output blocks by result state via the Show dropdown", async () => {
    const overlay = await runAndSelect();
    expect(visibleRunSlugs(overlay)).toEqual(["lint-a", "lint-b", "lint-c"]);
    setRunFilter(overlay, "co-run-show", "violations");
    expect(visibleRunSlugs(overlay)).toEqual(["lint-a"]);
    setRunFilter(overlay, "co-run-show", "successes");
    expect(visibleRunSlugs(overlay)).toEqual(["lint-b"]);
    setRunFilter(overlay, "co-run-show", "errors");
    expect(visibleRunSlugs(overlay)).toEqual(["lint-c"]);
    setRunFilter(overlay, "co-run-show", "all");
    expect(visibleRunSlugs(overlay)).toEqual(["lint-a", "lint-b", "lint-c"]);
  });

  it("lists All rules plus each run rule and narrows to one, ANDed with Show", async () => {
    const overlay = await runAndSelect();
    const labels = [...overlay.querySelectorAll<HTMLOptionElement>("#co-run-rulefilter option")].map(
      (o) => o.textContent,
    );
    expect(labels).toEqual(["All rules", "lint-a", "lint-b", "lint-c"]);
    setRunFilter(overlay, "co-run-rulefilter", "lint-b");
    expect(visibleRunSlugs(overlay)).toEqual(["lint-b"]);
    // Rule=lint-b (a success) with Show=violations leaves nothing.
    setRunFilter(overlay, "co-run-show", "violations");
    expect(visibleRunSlugs(overlay)).toEqual([]);
  });

  it("resets the Rule filter to All when a fresh run drops the selected rule", async () => {
    const overlay = await runAndSelect();
    setRunFilter(overlay, "co-run-rulefilter", "lint-a");
    expect(visibleRunSlugs(overlay)).toEqual(["lint-a"]);
    runResult = [{ slug: "lint-b", ok: true, violations: [] }];
    overlay.querySelector<HTMLButtonElement>("#co-run-btn")!.click();
    for (let i = 0; i < 4; i++) await flush();
    expect(overlay.querySelector<HTMLSelectElement>("#co-run-rulefilter")!.value).toBe("all");
    expect(visibleRunSlugs(overlay)).toEqual(["lint-b"]);
  });

  it("shows an editor placeholder until a result is opened", async () => {
    await runInjected();
    expect(document.querySelector("#co-run-editor .co-ed-empty")).not.toBeNull();
  });

  it("ignores clicks on the results background", async () => {
    const overlay = await runAndSelect();
    overlay.querySelector<HTMLElement>("#co-run-results")!.click();
    await flush();
    expect(overlay.querySelector("#co-run-editor .co-ed-empty")).not.toBeNull();
  });

  it("clicking a violation opens the file with a caret at the offending column", async () => {
    const overlay = await runAndSelect();
    overlay.querySelector<HTMLElement>('.co-run-vio[data-path="x.ts"]')!.click();
    for (let i = 0; i < 4; i++) await flush();
    const editor = overlay.querySelector("#co-run-editor")!;
    expect(editor.querySelector(".co-ed-head")!.textContent).toBe("/proj/x.ts");
    const active = editor.querySelector("#co-ed-active")!;
    expect(active.querySelector(".co-gutter")!.textContent).toBe("2");
    expect(editor.textContent).toContain("const bad = 2");
    const carets = [...editor.querySelectorAll(".co-caret")];
    expect(carets).toHaveLength(2); // both violations sit on line 2
    expect(carets[0].textContent).toContain("^");
    expect(carets[0].textContent).toContain("lint-a: too big");
  });

  it("colours code with highlight.js when it is loaded", async () => {
    const highlight = vi.fn((code: string) => ({ value: '<em class="tok">' + code + "</em>" }));
    (window as unknown as { hljs: unknown }).hljs = { getLanguage: () => ({}), highlight };
    const overlay = await runAndSelect();
    overlay.querySelector<HTMLElement>('.co-run-vio[data-path="x.ts"]')!.click();
    for (let i = 0; i < 4; i++) await flush();
    expect(overlay.querySelector("#co-run-editor .co-line .tok")).not.toBeNull();
    expect(highlight).toHaveBeenCalled();
  });

  it("falls back to plain escaped text when highlight.js lacks the language", async () => {
    const highlight = vi.fn();
    (window as unknown as { hljs: unknown }).hljs = { getLanguage: () => null, highlight };
    const overlay = await runAndSelect();
    overlay.querySelector<HTMLElement>('.co-run-vio[data-path="x.ts"]')!.click();
    for (let i = 0; i < 4; i++) await flush();
    expect(highlight).not.toHaveBeenCalled();
    expect(overlay.querySelector("#co-run-editor")!.textContent).toContain("const bad = 2");
  });

  it("shows an error in the editor when the file can't be read", async () => {
    const overlay = await runAndSelect();
    synthVio(overlay.querySelector("#co-run-results")!, "boom.ts", "1").click();
    for (let i = 0; i < 4; i++) await flush();
    expect(overlay.querySelector("#co-run-editor .co-run-error")!.textContent).toBe(
      "read failed",
    );
  });

  it("opens a file with no recorded violations and no active line", async () => {
    const overlay = await runAndSelect();
    // A marker line past EOF leaves no active row and no caret rows.
    synthVio(overlay.querySelector("#co-run-results")!, "other.ts", "99").click();
    for (let i = 0; i < 4; i++) await flush();
    const editor = overlay.querySelector("#co-run-editor")!;
    expect(editor.querySelector(".co-code")).not.toBeNull();
    expect(editor.querySelector("#co-ed-active")).toBeNull();
    expect(editor.querySelectorAll(".co-caret")).toHaveLength(0);
  });

  it("shows no analyze banner once the project has been analyzed", async () => {
    await runInjected(); // analyzeStatusResult defaults to analyzed:true
    expect(document.getElementById("co-analyze")).toBeNull();
  });

  it("prompts to analyze when the project hasn't been analyzed", async () => {
    analyzeStatusResult = { analyzed: false, lastAnalyzed: null };
    await runInjected();
    const banner = document.getElementById("co-analyze")!;
    expect(banner).not.toBeNull();
    expect(banner.textContent).toContain("hasn't been analyzed");
    expect(banner.querySelector(".co-analyze-run")).not.toBeNull();
  });

  it("Ignore hides the banner and remembers the choice for this browser", async () => {
    analyzeStatusResult = { analyzed: false, lastAnalyzed: null };
    await runInjected();
    (document.querySelector(".co-analyze-ignore") as HTMLElement).click();
    expect(document.getElementById("co-analyze")).toBeNull();
    expect(lsStore.get("co-analyze-ignored")).toBe("1");
  });

  it("does not prompt again when this browser has ignored the banner", async () => {
    analyzeStatusResult = { analyzed: false, lastAnalyzed: null };
    lsStore.set("co-analyze-ignored", "1");
    await runInjected();
    expect(document.getElementById("co-analyze")).toBeNull();
  });

  it("Analyze posts the scan and shows the detected languages, then Dismiss clears it", async () => {
    analyzeStatusResult = { analyzed: false, lastAnalyzed: null };
    await runInjected();
    (document.querySelector(".co-analyze-run") as HTMLElement).click();
    for (let i = 0; i < 3; i++) await flush();

    expect(analyzeCalls).toHaveLength(1);
    const banner = document.getElementById("co-analyze")!;
    expect(banner.classList.contains("co-analyze-done")).toBe(true);
    expect(banner.textContent).toContain("TypeScript (3)");

    (banner.querySelector(".co-analyze-ignore") as HTMLElement).click();
    expect(document.getElementById("co-analyze")).toBeNull();
  });

  it("shows the error and re-enables the button when analyze fails", async () => {
    analyzeStatusResult = { analyzed: false, lastAnalyzed: null };
    analyzeFails = true;
    await runInjected();
    const runBtn = document.querySelector(".co-analyze-run") as HTMLButtonElement;
    runBtn.click();
    for (let i = 0; i < 3; i++) await flush();

    const banner = document.getElementById("co-analyze")!;
    expect(banner.textContent).toContain("scan failed");
    expect(runBtn.disabled).toBe(false);
  });

  const enabledBox = (slug: string) => {
    const tr = [...document.querySelectorAll("tbody tr")].find(
      (r) => r.querySelector(".font-mono")?.textContent === slug,
    )!;
    return tr.querySelector<HTMLInputElement>(".co-enabled-td .co-enabled-box")!;
  };

  const themeBtn = (t: string) =>
    document.querySelector<HTMLButtonElement>('.co-theme-seg .co-theme-btn[data-theme="' + t + '"]')!;

  it("renders a titleless icon theme control defaulting to System (resolved to light)", async () => {
    await runInjected();
    const seg = document.querySelector(".co-theme-seg")!;
    const btns = [...seg.querySelectorAll(".co-theme-btn")];
    expect(btns.map((b) => b.getAttribute("data-theme"))).toEqual(["auto", "light", "dark"]);
    // Icons only — no visible text label anywhere in the control.
    expect(seg.textContent).toBe("");
    expect(btns.every((b) => b.querySelector("svg") !== null)).toBe(true);
    // System is the active preference; with no OS dark signal it resolves to light.
    expect(themeBtn("auto").classList.contains("co-theme-btn-active")).toBe(true);
    expect(document.documentElement.getAttribute("data-co-theme")).toBe("light");
  });

  it("clicking the Dark icon flips the theme, persists it, and marks the button active", async () => {
    await runInjected();
    themeBtn("dark").click();
    expect(document.documentElement.getAttribute("data-co-theme")).toBe("dark");
    expect(lsStore.get("co-theme")).toBe("dark");
    expect(themeBtn("dark").classList.contains("co-theme-btn-active")).toBe(true);
    expect(themeBtn("auto").classList.contains("co-theme-btn-active")).toBe(false);
  });

  it("restores the stored theme on load", async () => {
    lsStore.set("co-theme", "dark");
    await runInjected();
    expect(themeBtn("dark").classList.contains("co-theme-btn-active")).toBe(true);
    expect(document.documentElement.getAttribute("data-co-theme")).toBe("dark");
  });

  it("renders a header project selector defaulting to the installed project", async () => {
    await runInjected();
    const sel = document.querySelector<HTMLSelectElement>(".co-project-select")!;
    const opts = [...sel.options].map((o) => o.textContent);
    expect(opts).toEqual(["Repo (default)", "Web", "＋ New project…"]);
    expect(sel.value).toBe("1");
  });

  it("swaps the native Enabled toggle for a project-scoped one that PATCHes enabled", async () => {
    await runInjected();
    const tr = document.querySelector("tbody tr")!; // lint-a
    // Native enabled cell hidden; our project toggle rendered and checked.
    expect(tr.querySelector<HTMLElement>("td.text-center")!.style.display).toBe("none");
    const box = enabledBox("lint-a");
    expect(box.checked).toBe(true);

    box.checked = false;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    for (let i = 0; i < 3; i++) await flush();
    expect(patchCalls).toHaveLength(1);
    expect(patchCalls[0].url).toBe("/api/projects/1/rules/lint-a");
    expect(patchCalls[0].body).toEqual({ enabled: false });
  });

  it("switching projects reloads the table with that project's config", async () => {
    await runInjected();
    expect(enabledBox("lint-a").checked).toBe(true);
    const sel = document.querySelector<HTMLSelectElement>(".co-project-select")!;
    sel.value = "2";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    for (let i = 0; i < 4; i++) await flush();
    // Project 2 has lint-a disabled.
    expect(enabledBox("lint-a").checked).toBe(false);
    expect(lsStore.get("co-project")).toBe("2");
  });

  it("restores the last-selected project from localStorage", async () => {
    lsStore.set("co-project", "2");
    await runInjected();
    expect(document.querySelector<HTMLSelectElement>(".co-project-select")!.value).toBe("2");
    expect(enabledBox("lint-a").checked).toBe(false);
  });

  it("creates a project from the modal, then selects it", async () => {
    await runInjected();
    const sel = document.querySelector<HTMLSelectElement>(".co-project-select")!;
    sel.value = "__new__";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    for (let i = 0; i < 3; i++) await flush();

    const modal = document.getElementById("co-project-modal")!;
    expect(modal).not.toBeNull();
    // The folder browser loaded the run root's listing.
    expect(modal.querySelector(".co-modal-browser-path")!.textContent).toBe("/proj");
    modal.querySelector<HTMLButtonElement>(".co-modal-use")!.click();

    (modal.querySelector<HTMLInputElement>(".co-modal-name")!).value = "Gamma";
    modal.querySelector<HTMLButtonElement>(".co-modal-create")!.click();
    for (let i = 0; i < 4; i++) await flush();

    expect(projectCreateCalls).toHaveLength(1);
    expect(projectCreateCalls[0]).toMatchObject({ name: "Gamma", directories: ["/proj"] });
    expect(document.getElementById("co-project-modal")).toBeNull();
    expect(document.querySelector<HTMLSelectElement>(".co-project-select")!.value).toBe("3");
  });

  it("does not rebuild the project dropdown on unrelated re-render ticks", async () => {
    await runInjected();
    const sel = document.querySelector<HTMLSelectElement>(".co-project-select")!;
    const firstOption = sel.options[0];
    // Fire several observer ticks the way the panel's React re-renders would.
    for (let i = 0; i < 3; i++) {
      const marker = document.createElement("div");
      document.getElementById("root")!.appendChild(marker);
      marker.remove();
      await flush();
    }
    // Options kept their identity → the open native dropdown isn't clobbered.
    expect(sel.options[0]).toBe(firstOption);
    // "＋ New project…" still opens the modal after the churn.
    sel.value = "__new__";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    for (let i = 0; i < 2; i++) await flush();
    expect(document.getElementById("co-project-modal")).not.toBeNull();
  });

  const actBtn = (slug: string, act: string) => {
    const tr = [...document.querySelectorAll("tbody tr")].find(
      (r) => r.querySelector(".font-mono")?.textContent === slug,
    )!;
    return tr.querySelector<HTMLButtonElement>('.co-act-td .co-act-btn[data-act="' + act + '"]')!;
  };

  it("adds a trailing actions column with Run/Activity/Settings icon buttons per row", async () => {
    await runInjected();
    const cells = document.querySelectorAll(".co-act-td");
    expect(cells).toHaveLength(3);
    const acts = [...cells[0].querySelectorAll(".co-act-btn")].map((b) =>
      b.getAttribute("data-act"),
    );
    expect(acts).toEqual(["run", "activity", "settings"]);
    // Icons are inline Lucide SVGs, not emoji or text.
    expect(cells[0].querySelector(".co-act-btn svg")).not.toBeNull();
  });

  const toasts = () => [...document.querySelectorAll("#co-toast-region .co-toast")];
  const toastText = (el: Element) => el.querySelector(".co-toast-msg")?.textContent;

  it("toasts when a rule is enabled/disabled", async () => {
    await runInjected();
    const box = enabledBox("lint-a");
    box.checked = false;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    for (let i = 0; i < 3; i++) await flush();
    expect(toasts().map(toastText)).toContain("Disabled lint-a");
    expect(toasts()[0].classList.contains("co-toast-success")).toBe(true);
  });

  it("toasts after saving rule settings", async () => {
    await runInjected();
    actBtn("lint-a", "settings").click();
    await flush();
    const modal = document.getElementById("co-set-modal")!;
    modal.querySelector<HTMLButtonElement>(".co-set-save")!.click();
    for (let i = 0; i < 4; i++) await flush();
    expect(toasts().map(toastText)).toContain("Saved settings for lint-a");
  });

  it("dismisses a toast when it is clicked", async () => {
    await runInjected();
    const box = enabledBox("lint-a");
    box.checked = false;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    for (let i = 0; i < 3; i++) await flush();
    const t = toasts()[0];
    t.dispatchEvent(new Event("click", { bubbles: true }));
    expect(t.classList.contains("co-toast-out")).toBe(true);
  });

  it("Run icon opens the overlay with only that rule preselected", async () => {
    await runInjected();
    const overlay = document.querySelector<HTMLElement>("#co-run-overlay")!;
    actBtn("lint-a", "run").click();
    await flush();
    expect(overlay.style.display).toBe("flex");
    const checked = [...overlay.querySelectorAll<HTMLInputElement>(".co-run-opt")]
      .filter((b) => b.checked)
      .map((b) => b.value);
    expect(checked).toEqual(["lint-a"]);
    expect(overlay.querySelector<HTMLButtonElement>("#co-run-btn")!.disabled).toBe(false);
  });

  const openActivityTab = async () => {
    (document.querySelector(".co-activity-tab") as HTMLElement).click();
    for (let i = 0; i < 3; i++) await flush();
    return document.querySelector<HTMLElement>("#co-activity-overlay")!;
  };

  it("hides the native Reporting tab", async () => {
    const nav = document.querySelector("nav")!;
    const reporting = document.createElement("button");
    reporting.textContent = "Reporting";
    nav.appendChild(reporting); // decorate() hides it on the first pass
    await runInjected();
    expect(reporting.style.display).toBe("none");
  });

  it("Activity tab opens the overlay and renders the top list, chart, and feed", async () => {
    await runInjected();
    const overlay = await openActivityTab();
    expect(overlay.style.display).toBe("flex");
    expect(document.getElementById("root")!.style.display).toBe("none");
    // Top-rules list, ranked, with the busiest first.
    const rows = [...overlay.querySelectorAll(".co-act-toprow")].map((r) =>
      r.querySelector(".co-act-toprow-key")!.textContent,
    );
    expect(rows).toEqual(["lint:naming", "lint:dup"]);
    // SVG chart drew a bar per bucket.
    expect(overlay.querySelectorAll(".co-act-chart svg rect.co-act-bar").length).toBe(2);
    // Feed shows both a hook run (with a failure pill) and a config log entry.
    const feed = overlay.querySelector("#co-act-feed")!;
    expect(feed.querySelectorAll(".co-act-row")).toHaveLength(2);
    expect(feed.textContent).toContain("npm lint:naming");
    expect(feed.querySelector(".co-run-pill-n")!.textContent).toBe("failure");
    expect(feed.textContent).toContain("enabled lint-naming");
  });

  it("Activity icon on a rule row opens the overlay pre-filtered to that rule", async () => {
    await runInjected();
    actBtn("lint-a", "activity").click();
    for (let i = 0; i < 3; i++) await flush();
    const overlay = document.querySelector<HTMLElement>("#co-activity-overlay")!;
    expect(overlay.style.display).toBe("flex");
    // Both summary and feed were fetched scoped to the mapped key lint:a.
    expect(activityCalls.some((u) => u.includes("rules=lint%3Aa"))).toBe(true);
    expect(activityFeedCalls.some((u) => u.includes("rules=lint%3Aa"))).toBe(true);
  });

  it("the rule multiselect re-fetches the feed scoped to the chosen keys", async () => {
    await runInjected();
    const overlay = await openActivityTab();
    activityFeedCalls.length = 0;
    // Narrow to a strict subset (uncheck two of the three keys).
    const dd = overlay.querySelector(".co-act-filter")!;
    const opt = (v: string) =>
      [...dd.querySelectorAll<HTMLInputElement>(".co-dd-opt")].find((i) => i.value === v)!;
    opt("commit").checked = false;
    opt("commit").dispatchEvent(new Event("change", { bubbles: true }));
    opt("lint:dup").checked = false;
    opt("lint:dup").dispatchEvent(new Event("change", { bubbles: true }));
    for (let i = 0; i < 3; i++) await flush();
    expect(activityFeedCalls.at(-1)).toContain("rules=lint%3Anaming");
  });

  it("switching the time window re-fetches for that span", async () => {
    await runInjected();
    const overlay = await openActivityTab();
    activityCalls.length = 0;
    (overlay.querySelector('.co-act-win[data-win="1h"]') as HTMLElement).click();
    for (let i = 0; i < 3; i++) await flush();
    expect(overlay.querySelector(".co-act-win-active")!.textContent).toBe("1h");
    expect(activityCalls.at(-1)).toContain("last=1h");
  });

  it("Settings icon opens a project-scoped dialog prefilled from the rule", async () => {
    await runInjected();
    actBtn("lint-a", "settings").click();
    await flush();
    const modal = document.getElementById("co-set-modal")!;
    expect(modal).not.toBeNull();
    expect(modal.querySelector(".co-modal-title")!.textContent).toBe("Settings — lint-a");
    expect(modal.querySelector(".co-set-sub")!.textContent).toBe("Project: Repo");
    // Enabled prefilled.
    expect(modal.querySelector<HTMLInputElement>(".co-set-enabled .co-set-check")!.checked).toBe(true);
    // Severity: default = halt, claude override = warn.
    const selects = [...modal.querySelectorAll<HTMLSelectElement>(".co-set-select")];
    expect(selects[0].value).toBe("halt");
    const claudeRow = [...modal.querySelectorAll(".co-set-row")].find(
      (r) => r.querySelector(".co-set-label")?.textContent === "Claude Code",
    )!;
    expect(claudeRow.querySelector<HTMLSelectElement>(".co-set-select")!.value).toBe("warn");
    // Config: a number field (maxLines) and an exclude list editor with a chip.
    expect(modal.querySelector<HTMLInputElement>(".co-set-num")!.value).toBe("300");
    expect(modal.querySelector(".co-set-chip")!.textContent).toContain("dist/**");
  });

  it("Settings Save PATCHes enabled, config, and materialised severity bindings", async () => {
    await runInjected();
    actBtn("lint-a", "settings").click();
    await flush();
    const modal = document.getElementById("co-set-modal")!;

    // Disable, bump maxLines, add an exclude entry.
    modal.querySelector<HTMLInputElement>(".co-set-enabled .co-set-check")!.checked = false;
    modal.querySelector<HTMLInputElement>(".co-set-num")!.value = "120";
    const listInput = modal.querySelector<HTMLInputElement>(".co-set-add-input")!;
    listInput.value = "build/**";
    modal.querySelector<HTMLButtonElement>(".co-set-add")!.click();

    modal.querySelector<HTMLButtonElement>(".co-set-save")!.click();
    for (let i = 0; i < 4; i++) await flush();

    // First PATCH carries the scalar edits + a clean-slate removeAction.
    const base = patchCalls.find((c) => "enabled" in c.body)!;
    expect(base.url).toBe("/api/projects/1/rules/lint-a");
    expect(base.body).toMatchObject({
      enabled: false,
      removeAction: "all",
      config: { maxLines: 120, exclude: ["dist/**", "build/**"] },
    });
    // Shown severity is re-materialised as project bindings (default halt + claude warn).
    const setActions = patchCalls
      .map((c) => c.body.setAction as { type: string; environment?: string } | undefined)
      .filter(Boolean);
    expect(setActions).toEqual([
      { type: "halt", delayMs: null },
      { type: "warn", environment: "claude" },
    ]);
    expect(document.getElementById("co-set-modal")).toBeNull();
  });
});
