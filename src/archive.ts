import { strToU8, zipSync } from "fflate";
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
