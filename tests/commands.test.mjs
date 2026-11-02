import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractCodeBlock,
  freshPath,
  parseCommand,
  resolvePath,
} from "../src/commands.ts";

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

test("running a web app is a real app action, but questions about it reach the model", () => {
  assert.deepEqual(parseCommand("/run"), { type: "run", path: "" });
  assert.deepEqual(parseCommand("/run site/about.html"), { type: "run", path: "site/about.html" });
  for (const alias of ["/preview", "/launch", "/serve"])
    assert.equal(parseCommand(alias).type, "run");
  for (const text of ["run the app", "Please launch my web app", "preview the site", "start the application", "serve this page"])
    assert.deepEqual(parseCommand(text), { type: "run", path: "" }, text);
  for (const text of ["how do I run the app?", "run the tests", "explain why the app crashes", "start a timer in the app", "launch codes are secret"])
    assert.equal(parseCommand(text), null, text);
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

test("/new carries an optional path and never matches plain sentences", () => {
  assert.deepEqual(parseCommand("/new src/util.ts"), {
    type: "new",
    path: "src/util.ts",
    description: "",
    onExists: "error",
  });
  assert.deepEqual(parseCommand("/new"), {
    type: "new",
    path: "",
    description: "",
    onExists: "error",
  });
  assert.deepEqual(parseCommand("/new docs/a.md write a short intro"), {
    type: "new",
    path: "docs/a.md",
    description: "write a short intro",
    onExists: "error",
  });
  assert.equal(parseCommand("new feature ideas for this file"), null);
});

test("plain requests to create a file are handled by the app, questions are not", () => {
  const text = "write a new readme containing a smiley";
  assert.deepEqual(parseCommand(text), {
    type: "new",
    path: "README.md",
    description: text,
    onExists: "fresh",
  });
  assert.equal(
    parseCommand("Create a README.md with install steps").path,
    "README.md",
  );
  const named = parseCommand(
    "Please create a new file called src/hello.ts that prints hi.",
  );
  assert.equal(named.path, "src/hello.ts");
  assert.equal(named.onExists, "open");
  assert.equal(
    parseCommand("create a python file named utils.py.").path,
    "utils.py",
  );
  for (const question of [
    "how do I write a readme?",
    "Can you create a readme for me",
    "write a function that sorts a list",
    "create a file",
    "explain this readme",
  ])
    assert.equal(parseCommand(question), null, question);
});

test("extractCodeBlock takes exactly one fenced block and ignores surrounding prose", () => {
  assert.equal(extractCodeBlock("```ts\nconst a = 1\n```"), "const a = 1");
  assert.equal(
    extractCodeBlock(
      "Here you go:\n```typescript\nlet x\nlet y\n```\nHope that helps.",
    ),
    "let x\nlet y",
  );
  assert.equal(extractCodeBlock("export const a = 1"), null);
  assert.equal(extractCodeBlock("```a\n1\n```\n```b\n2\n```"), null);
  assert.equal(extractCodeBlock("```ts\nunterminated"), null);
});

test("freshPath never reuses an existing name", () => {
  assert.equal(freshPath(["a.ts"], "README.md"), "README.md");
  assert.equal(freshPath(["README.md"], "README.md"), "README-2.md");
  assert.equal(
    freshPath(["README.md", "README-2.md"], "README.md"),
    "README-3.md",
  );
  assert.equal(freshPath(["docs/notes"], "docs/notes"), "docs/notes-2");
  assert.equal(freshPath(["src.v1/app"], "src.v1/app"), "src.v1/app-2");
});

test("issue and pull request commands are explicit, and questions about them reach the model", () => {
  assert.deepEqual(parseCommand("/issues"), { type: "issues" });
  assert.deepEqual(parseCommand("/issue 12"), { type: "issue", number: 12 });
  assert.deepEqual(parseCommand("/issue #7"), { type: "issue", number: 7 });
  assert.deepEqual(parseCommand("/issue"), { type: "help" });
  assert.deepEqual(parseCommand("/issue abc"), { type: "help" });
  assert.deepEqual(parseCommand("/pr"), { type: "pr", title: "" });
  assert.deepEqual(parseCommand("/pr Fix the crash"), { type: "pr", title: "Fix the crash" });
  for (const text of ["open a pull request", "Please create the pull request", "make a pull request"])
    assert.deepEqual(parseCommand(text), { type: "pr", title: "" }, text);
  for (const text of ["how do I open a pull request?", "explain what a pull request is", "review the pull request changes"])
    assert.equal(parseCommand(text), null, text);
});
