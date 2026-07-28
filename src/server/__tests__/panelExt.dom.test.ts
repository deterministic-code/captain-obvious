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
  it("appends Fix and Languages header columns", async () => {
    await runInjected();
    const heads = [...document.querySelectorAll("thead th")].map((t) =>
      t.textContent,
    );
    expect(heads.slice(-2)).toEqual(["Fix", "Languages"]);
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
      ...document.querySelectorAll(".co-filter-cats .co-dd-item input"),
    ].map((i) => (i as HTMLInputElement).value);
    expect(catValues.sort()).toEqual(["naming", "size"]);
  });

  it("PATCHes the new language set when a row checkbox is toggled", async () => {
    await runInjected();
    const cell = document.querySelector(".co-lang-td")!; // lint-a
    const jsBox = [...cell.querySelectorAll<HTMLInputElement>("input")].find(
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

  it("filters rows by the selected category", async () => {
    await runInjected();
    const namingBox = [
      ...document.querySelectorAll<HTMLInputElement>(
        ".co-filter-cats .co-dd-item input",
      ),
    ].find((i) => i.value === "naming")!;
    namingBox.checked = true;
    namingBox.dispatchEvent(new Event("change", { bubbles: true }));
    for (let i = 0; i < 3; i++) await flush();

    const rows = document.querySelectorAll<HTMLTableRowElement>("tbody tr");
    expect(rows[0].style.display).toBe("none"); // lint-a (size) hidden
    expect(rows[1].style.display).toBe(""); // lint-b (naming) shown
  });
});
