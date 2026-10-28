import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCommand, resolvePath } from "../src/commands.ts";

test("slash commands map to real actions", () => {
  assert.deepEqual(parseCommand("/open octocat/Hello-World"), {
    type: "open",
    slug: "octocat/Hello-World",
    branch: "",
  });
  assert.deepEqual(parseCommand("/connect a/b dev"), {
    type: "open",
    slug: "a/b",
    branch: "dev",
  });
  assert.deepEqual(parseCommand("/files  ts "), {
    type: "files",
    filter: "ts",
  });
  assert.deepEqual(parseCommand("/read src/a.ts"), {
    type: "read",
    path: "src/a.ts",
  });
  assert.deepEqual(parseCommand("/open"), { type: "help" });
  assert.deepEqual(parseCommand("/read"), { type: "help" });
});

test("plain language connects only with an explicit github.com link", () => {
  assert.deepEqual(
    parseCommand("connect to https://github.com/octocat/Hello-World.git"),
    { type: "open", slug: "octocat/Hello-World", branch: "" },
  );
  assert.deepEqual(
    parseCommand("Open https://github.com/a/b/tree/feature/x please"),
    { type: "open", slug: "a/b", branch: "feature/x" },
  );
  assert.equal(parseCommand("Explain https://github.com/a/b"), null);
  assert.equal(parseCommand("connect to my repo"), null);
  assert.equal(parseCommand("open the README and explain it"), null);
});

test("ordinary requests and unknown slashes reach the model", () => {
  assert.equal(parseCommand("Rename the variable completed"), null);
  assert.equal(parseCommand("/usr/bin is a path, explain it"), null);
});

test("path resolution prefers exact, then suffix, then substring", () => {
  const paths = [
    "README.md",
    "src/index.ts",
    "docs/index.ts",
    "src/app/main.ts",
  ];
  assert.deepEqual(resolvePath(paths, "readme.md"), ["README.md"]);
  assert.deepEqual(resolvePath(paths, "main.ts"), ["src/app/main.ts"]);
  assert.deepEqual(resolvePath(paths, "index.ts"), [
    "src/index.ts",
    "docs/index.ts",
  ]);
  assert.deepEqual(resolvePath(paths, "app"), ["src/app/main.ts"]);
  assert.deepEqual(resolvePath(paths, "missing"), []);
});

test("publish is only triggered by an explicit command or an imperative sentence", () => {
  assert.deepEqual(parseCommand("/publish"), {
    type: "publish",
    branch: "",
    message: "",
  });
  assert.deepEqual(parseCommand("/publish work/fix Fix the typo in README"), {
    type: "publish",
    branch: "work/fix",
    message: "Fix the typo in README",
  });
  assert.deepEqual(parseCommand("Publish my changes to GitHub"), {
    type: "publish",
    branch: "",
    message: "",
  });
  assert.deepEqual(parseCommand("please push the edits to a new branch"), {
    type: "publish",
    branch: "",
    message: "",
  });
  assert.equal(parseCommand("How do I publish my changes to GitHub?"), null);
  assert.equal(parseCommand("Explain what publish does in this code"), null);
  assert.equal(parseCommand("commit"), null);
});
