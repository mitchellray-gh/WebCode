import { test } from "node:test";
import assert from "node:assert/strict";
import { clip, searchWorkspace } from "../src/agentTools.ts";
import { formatCheck } from "../src/sandbox.ts";
import { GitHub } from "../src/github.ts";

test("clip respects a UTF-8 byte budget without splitting characters", () => {
  assert.equal(clip("short", 10), "short");
  const clipped = clip("é".repeat(100), 21);
  assert.ok(new TextEncoder().encode(clipped).length <= 21);
  assert.ok(clipped.endsWith("…"));
  assert.doesNotMatch(clipped, /\uFFFD/);
  assert.equal(clip("a".repeat(50), 2).length <= 3, true);
});

test("workspace search ranks open file lines, path matches and unopened repository paths", () => {
  const files = {
    "src/counter.ts": { content: "export function increment(n) {\n  return n + 1;\n}\nconst helper = 2;" },
    "notes.md": { content: "Counter notes\nnothing else" },
  };
  const report = searchWorkspace(files, ["src/counter.ts", "src/counter.test.ts", "docs/a.md"], "counter helper");
  const lines = report.split("\n");
  assert.match(lines[0], /src\/counter\.ts \(open file, path match\)|src\/counter\.test\.ts \(not open; use read\)/);
  assert.match(report, /src\/counter\.ts:4: const helper = 2;/);
  assert.match(report, /src\/counter\.test\.ts \(not open; use read\)/);
  assert.doesNotMatch(report, /docs\/a\.md/);
  assert.match(report, /notes\.md:1: Counter notes/);
  assert.match(searchWorkspace(files, [], "zzzz nothing-here"), /No matches/);
  assert.match(searchWorkspace(files, [], "a ?"), /at least one word/);
  const many = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`f${index}.ts`, { content: "needle ".repeat(30) }]));
  const bounded = searchWorkspace(many, [], "needle");
  assert.ok(new TextEncoder().encode(bounded).length <= 900);
  assert.match(bounded, /^Top 8 of 40 matches/);
});

test("page checks report errors, missing files and warnings, or a clean run", () => {
  const clean = { missing: [], warnings: [] };
  assert.equal(formatCheck("index.html", [{ level: "log", text: "ready" }], clean), "index.html ran cleanly (1 console line).");
  assert.equal(formatCheck("index.html", [], clean), "index.html ran cleanly (0 console lines).");
  const report = formatCheck("index.html", [
    { level: "error", text: "ReferenceError: x is not defined (line 3)" }, { level: "log", text: "hi" },
  ], { missing: ["app.js"], warnings: ["util.ts is TypeScript/JSX."] });
  assert.match(report, /^index\.html: 1 error\(s\): ReferenceError: x is not defined \(line 3\); missing files: app\.js; warnings: util\.ts/);
  const long = formatCheck("a.html", Array.from({ length: 9 }, () => ({ level: "error", text: "e".repeat(300) })), clean);
  assert.ok(new TextEncoder().encode(long).length <= 650);
});

test("GitHub code search needs a token, sanitizes the query and returns paths only", async () => {
  await assert.rejects(new GitHub().searchCode({ owner: "o", name: "r" }, "x"), /needs a token/);
  let requested = "";
  const client = new GitHub("test-only-token", async (url) => {
    requested = String(url);
    return new Response(JSON.stringify({ items: [{ path: "src/a.ts", sha: "1" }, { path: 5 }, { path: "b.md" }] }));
  });
  assert.deepEqual(await client.searchCode({ owner: "o", name: "r" }, 'foo(bar) "baz" repo:evil/x'), ["src/a.ts", "b.md"]);
  const q = decodeURIComponent(new URL(requested).searchParams.get("q"));
  assert.equal(q, "foo bar baz repo evil x repo:o/r");
  assert.equal(q.match(/repo:/g).length, 1);
  assert.equal(new URL(requested).searchParams.get("per_page"), "5");
  assert.deepEqual(await client.searchCode({ owner: "o", name: "r" }, "(((("), []);
  const bad = new GitHub("test-only-token", async () => new Response(JSON.stringify({ nope: 1 })));
  await assert.rejects(bad.searchCode({ owner: "o", name: "r" }, "x"), /unexpected search response/);
});
