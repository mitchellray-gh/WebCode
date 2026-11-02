import { strToU8, unzipSync, zipSync } from "fflate";
import type { Zippable } from "fflate";
import { validateNewPath } from "./github.ts";

export function workspaceArchive(files: Record<string, { content: string }>) {
  const entries = Object.entries(files);
  if (!entries.length) throw new Error("Create or open a file before downloading a ZIP.");
  const archive: Zippable = Object.create(null);
  for (const [path, file] of entries) {
    const problem = validateNewPath(path, []);
    if (problem) throw new Error(`Cannot export ${path}: ${problem}`);
    archive[path] = strToU8(file.content);
  }

  return new Blob([new Uint8Array(zipSync(archive))], {
    type: "application/zip",
  });
}

export async function importWorkspaceArchive(file: Blob) {
  if (file.size > 3_000_000) throw new Error("ZIP exceeds the 3 MB import limit.");
  let total = 0;
  const paths: string[] = [];
  const extracted = unzipSync(new Uint8Array(await file.arrayBuffer()), {
    filter: (entry) => {
      const directory = entry.name.endsWith("/");
      const path = directory ? entry.name.slice(0, -1) : entry.name;
      const problem = validateNewPath(path, directory ? [] : paths);
      if (problem) throw new Error(`Cannot import ${entry.name}: ${problem}`);
      if (directory) return false;
      total += entry.originalSize;
      if (paths.length >= 1000 || entry.originalSize > 500_000 || total > 2_000_000)
        throw new Error("ZIP exceeds import limits: 1,000 files, 500 KB per file, 2 MB total expanded text.");
      paths.push(path);
      return true;
    },
  });
  if (!paths.length) throw new Error("ZIP contains no text files.");
  const files: Record<string, { original: string; content: string; isNew: true }> = Object.create(null);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  if (paths.some((path) => !Object.hasOwn(extracted, path)))
    throw new Error("ZIP contains an unsupported file name. Nothing was imported.");
  for (const [path, data] of Object.entries(extracted)) {
    let content: string;
    try { content = decoder.decode(data); }
    catch { throw new Error(`${path} is not valid UTF-8 text. Nothing was imported.`); }
    if (Array.from(content).some((character) => {
      const code = character.charCodeAt(0);
      return code < 9 || (code >= 14 && code < 32);
    }))
      throw new Error(`${path} appears to be binary. Only text workspaces can be imported.`);
    files[path] = { original: "", content, isNew: true };
  }
  return files;
}
