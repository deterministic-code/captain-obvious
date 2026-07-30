import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function readJson(path, fallback = {}) {
  const raw = await readFile(path, "utf8").catch((err) => {
    if (err.code === "ENOENT") {
      return null;
    }
    throw err;
  });
  return raw === null ? fallback : JSON.parse(raw);
}

export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
