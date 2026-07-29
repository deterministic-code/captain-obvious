// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PANEL_EXT } from "../panelExt.js";

// Exercises the injected browser script against a DOM that mirrors the prebuilt
// panel's structure (native category <select> + rules table). The script is a
// runtime string, so we eval it and stub fetch the way the panel's own runtime
// would answer.

const RULES = [
  { slug: "lint-a", name: "A", categories: ["size"], languages: ["typescript"], actions: [] },
  { slug: "lint-b", name: "B", categories: ["naming"], languages: [], actions: [{ kind: "output" }] },
  // No category and language-independent: the filters can't exclude it, so it always shows.
  { slug: "lint-c", name: "C", categories: [], languages: [], languageIndependent: true, actions: [] },
];
const META = {
  languages: [
    { slug: "typescript", name: "TypeScript" },
    { slug: "javascript", name: "JavaScript" },
    { slug: "csharp", name: "C#" },
  ],
};

let patchCalls: { url: string; body: { languages: string[] } }[];
let runCalls: { slugs: string[]; path: string }[];
let analyzeCalls: unknown[];
let analyzeFails: boolean;
let analyzeStatusResult: { analyzed: boolean; lastAnalyzed: string | null };
let lsStore: Map<string, string>;
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
    "<td>pre-commit</td><td>on</td><td>action</td></tr>"
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
  patchCalls = [];
  runCalls = [];
  analyzeCalls = [];
  analyzeFails = false;
  analyzeStatusResult = { analyzed: true, lastAnalyzed: "2026-01-01T00:00:00Z" };
  // This happy-dom build ships no Storage, so stub localStorage the way the panel
  // uses it (get/set), Map-backed and fresh per test.
  lsStore = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (lsStore.has(k) ? lsStore.get(k) : null),
    setItem: (k: string, v: string) => void lsStore.set(k, String(v)),
  });
  vi.stubGlobal("fetch", async (url: string, opts?: RequestInit) => {
    if (url === "/api/rules") return jsonRes(RULES);
    if (url === "/api/meta") return jsonRes(META);
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
      return jsonRes(RUN_RESULT);
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
    ]);
    // The per-row Languages cell lands in the same (third) column.
    const firstRow = document.querySelector("tbody tr")!;
    expect(firstRow.children[2].classList.contains("co-lang-td")).toBe(true);
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
    expect(patchCalls[0].url).toBe("/api/rules/lint-a");
    expect([...patchCalls[0].body.languages].sort()).toEqual([
      "javascript",
      "typescript",
    ]);
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
    expect(labels).toEqual(["Rules", "Run", "Profiling"]);
    const overlay = document.querySelector<HTMLElement>("#co-run-overlay")!;
    expect(overlay.style.display).toBe("none");
    // Picker prefills the folder and lists only the runnable slugs (lint-a, lint-b).
    expect(document.querySelector<HTMLInputElement>("#co-run-path")!.value).toBe("/proj");
    const opts = [...overlay.querySelectorAll<HTMLInputElement>(".co-run-opt")].map(
      (i) => i.value,
    );
    expect(opts.sort()).toEqual(["lint-a", "lint-b"]);
  });

  it("Run tab shows the overlay and hides the panel; Back restores it", async () => {
    await runInjected();
    const root = document.getElementById("root")!;
    const overlay = document.querySelector<HTMLElement>("#co-run-overlay")!;
    (document.querySelector(".co-run-tab") as HTMLElement).click();
    expect(overlay.style.display).toBe("flex");
    expect(root.style.display).toBe("none");
    (overlay.querySelector(".co-run-back") as HTMLElement).click();
    expect(overlay.style.display).toBe("none");
    expect(root.style.display).toBe("");
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
});
