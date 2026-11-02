import { test } from "node:test";
import assert from "node:assert/strict";
import { strFromU8, unzipSync, zipSync, strToU8 } from "fflate";
import { workspaceArchive, importWorkspaceArchive } from "../src/archive.ts";

test("workspace ZIP preserves paths, current edits, Unicode and empty files", async () => {
  const archive = workspaceArchive({
    "src/app.ts": { original: "old content", content: "export const title = 'café';\n" },
    "docs/readme.md": { content: "# Project\n" },
    "empty.txt": { content: "" },
  });
  assert.equal(archive.type, "application/zip");
  const extracted = unzipSync(new Uint8Array(await archive.arrayBuffer()));
  assert.deepEqual(Object.keys(extracted).sort(), ["docs/readme.md", "empty.txt", "src/app.ts"]);
  assert.equal(strFromU8(extracted["src/app.ts"]), "export const title = 'café';\n");
  assert.equal(strFromU8(extracted["docs/readme.md"]), "# Project\n");
  assert.equal(extracted["empty.txt"].length, 0);
});

test("ZIP export rejects empty workspaces and unsafe paths explicitly", () => {
  assert.throws(() => workspaceArchive({}), /Create or open a file/);
  for (const path of ["../outside.txt", "/absolute.txt", ".git/config"]) {
    assert.throws(() => workspaceArchive({ [path]: { content: "test" } }), /Cannot export/);
  }
});

test("ZIP import round-trips nested text, Unicode, and empty files", async () => {
  const files = { "docs/hello.md": { content: "Hello café\n" }, "empty.txt": { content: "" } };
  const imported = await importWorkspaceArchive(workspaceArchive(files));
  for (const [path, { content }] of Object.entries(files))
    assert.deepEqual(imported[path], { original: "", content, isNew: true });
});

test("ZIP import fails atomically on unsafe paths, binary content, and oversized entries", async () => {
  for (const entries of [
    { "../escape.txt": strToU8("no") },
    { "binary.dat": new Uint8Array([0, 1, 2]) },
    { "invalid.txt": new Uint8Array([255]) },
    { "big.txt": strToU8("x".repeat(500001)) },
    { "folder": strToU8("file"), "folder/child.txt": strToU8("child") },
  ]) {
    const archive = new Blob([zipSync(entries)]);
    await assert.rejects(importWorkspaceArchive(archive));
  }
});
