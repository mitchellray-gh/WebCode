import { test } from "node:test";
import assert from "node:assert/strict";
import { strFromU8, unzipSync } from "fflate";
import { workspaceArchive } from "../src/archive.ts";

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
