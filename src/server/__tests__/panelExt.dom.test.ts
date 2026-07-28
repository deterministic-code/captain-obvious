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
  // No category and no languages: the filters can't exclude it, so it always shows.
  { slug: "lint-c", name: "C", categories: [], languages: [], actions: [] },
];
const META = {
  languages: [
    { slug: "typescript", name: "TypeScript" },
    { slug: "javascript", name: "JavaScript" },
    { slug: "csharp", name: "C#" },
  ],
};

let patchCalls: { url: string; body: { languages: string[] } }[];

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
    '<div id="root"><div class="bar">' +
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
  vi.stubGlobal("fetch", async (url: string, opts?: RequestInit) => {
    if (url === "/api/rules") return jsonRes(RULES);
    if (url === "/api/meta") return jsonRes(META);
    if (opts?.method === "PATCH") {
      patchCalls.push({ url, body: JSON.parse(opts.body as string) });
      return jsonRes({});
    }
    throw new Error("unexpected fetch: " + url);
  });
  vi.stubGlobal("alert", () => {});
  buildPanelDom();
});

afterEach(() => {
  vi.unstubAllGlobals();
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
});
