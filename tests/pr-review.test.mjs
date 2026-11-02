import { test } from "node:test";
import assert from "node:assert/strict";
import { REVIEW_SCHEMA, reviewPullRequest, splitPatch } from "../src/prReview.ts";
import { GitHub } from "../src/github.ts";
import { byteLength } from "../src/agentTools.ts";

const patch = (lines) => Array.from({ length: lines }, (_, index) => `+const value${index} = compute(${index});`).join("\n");
const pr = (files) => ({ number: 7, title: "Add compute", body: "", base: "main", head: "work/x", files, omitted: 0 });

test("diffs split at line boundaries within the byte budget, keeping every line", () => {
  const text = patch(200);
  const chunks = splitPatch(text);
  assert.ok(chunks.length > 5);
  for (const chunk of chunks) assert.ok(byteLength(chunk) <= 1200);
  assert.equal(chunks.join("\n"), text);
  assert.deepEqual(splitPatch("one line"), ["one line"]);
  assert.deepEqual(splitPatch(""), []);
  const huge = splitPatch("+" + "x".repeat(5000) + "\n+ok");
  assert.ok(huge.every((chunk) => byteLength(chunk) <= 1200));
  assert.deepEqual(JSON.parse(REVIEW_SCHEMA).properties.findings.items.properties.severity.enum, ["high", "medium", "low"]);
});

test("review aggregates findings by severity, defangs model text and never posts anything itself", async () => {
  const seen = [];
  const replies = [
    JSON.stringify({ findings: [{ severity: "low", message: "Rename `x`" }, { severity: "high", message: "Thanks @octocat <img src=x onerror=alert(1)>\nSQL is built from input" }] }),
    JSON.stringify({ findings: [] }),
    "not json at all",
    JSON.stringify({ findings: [{ severity: "critical", message: "bad severity" }, { severity: "medium", message: "  " }, { severity: "medium", message: "Missing null check" }] }),
  ];
  const progress = [];
  const result = await reviewPullRequest({
    pr: { ...pr([{ path: "src/a.ts", status: "modified", patch: patch(60) }, { path: "b.ts", status: "added", patch: "+x" }, { path: "c.ts", status: "added", patch: "+y" }]), omitted: 2 },
    ask: async (request, diff) => { seen.push({ request, diff }); return replies[seen.length - 1] ?? JSON.stringify({ findings: [] }); },
    signal: new AbortController().signal,
    progress: (done, total, label) => progress.push([done, total, label]),
    model: "Llama 3.2 1B",
  });
  assert.equal(result.reviewed, 4);
  assert.equal(seen.length, 4);
  assert.ok(seen.every((call) => /^Pull request #7: Add compute\nFile: /.test(call.request)));
  assert.match(seen[0].request, /File: src\/a\.ts \(part 1\/2\)/);
  assert.equal(result.failed, 1);
  assert.equal(result.findings, 3);
  const lines = result.markdown.split("\n");
  assert.equal(lines[0], "## Automated review of #7");
  assert.match(lines[1], /^- \*\*high\*\* `src\/a\.ts \(part 1\/2\)`: Thanks @\u200boctocat &lt;img src=x onerror=alert\(1\)> SQL is built from input$/);
  assert.match(result.markdown, /\*\*medium\*\*[^\n]*Missing null check/);
  assert.ok(result.markdown.indexOf("**high**") < result.markdown.indexOf("**medium**"));
  assert.ok(result.markdown.indexOf("**medium**") < result.markdown.indexOf("**low**"));
  assert.doesNotMatch(result.markdown, /bad severity/);
  assert.match(result.markdown, /Reviewed 4 of 4 diff chunk\(s\); 2 binary or very large file\(s\) were not reviewed; 1 chunk\(s\) returned unusable output\./);
  assert.match(result.markdown, /small language model \(Llama 3\.2 1B\) running in the browser/);
  assert.deepEqual(progress[0], [0, 4, "src/a.ts (part 1/2)"]);
  assert.deepEqual(progress.at(-1), [4, 4, "done"]);
});

test("review is bounded, reports a clean result, and stops on abort", async () => {
  const many = pr(Array.from({ length: 40 }, (_, index) => ({ path: `f${index}.ts`, status: "added", patch: "+x" })));
  let calls = 0;
  const bounded = await reviewPullRequest({ pr: many, ask: async () => { calls++; return JSON.stringify({ findings: [] }); }, signal: new AbortController().signal, progress: () => {} });
  assert.equal(calls, 24);
  assert.equal(bounded.total, 40);
  assert.match(bounded.markdown, /No issues were found in the reviewed chunks\./);
  assert.match(bounded.markdown, /Reviewed 24 of 40 diff chunk/);
  const abort = new AbortController();
  await assert.rejects(reviewPullRequest({
    pr: many, signal: abort.signal, progress: () => {},
    ask: async () => { abort.abort(); return JSON.stringify({ findings: [] }); },
  }), { name: "AbortError" });
  const empty = await reviewPullRequest({ pr: pr([]), ask: async () => assert.fail("no chunks"), signal: new AbortController().signal, progress: () => {} });
  assert.equal(empty.reviewed, 0);
});

test("pull requests are read with bounded files, and comments need a token and text", async () => {
  const urls = [];
  const client = new GitHub("test-only-token", async (url, options) => {
    urls.push({ url: String(url), method: options.method });
    if (String(url).endsWith("/pulls/7"))
      return new Response(JSON.stringify({ title: "Add compute", body: "b".repeat(3000), base: { ref: "main" }, head: { ref: "work/x" } }));
    if (String(url).includes("/pulls/7/files"))
      return new Response(JSON.stringify([
        { filename: "a.ts", status: "added", patch: "p".repeat(30000) }, { filename: "img.png", status: "added" }, { status: "x" },
      ]));
    return new Response(JSON.stringify({ html_url: "https://github.com/o/r/pull/7#issuecomment-1" }));
  });
  const read = await client.readPullRequest({ owner: "o", name: "r" }, 7);
  assert.equal(read.body.length, 1500);
  assert.equal(read.files.length, 1);
  assert.equal(read.files[0].patch.length, 20000);
  assert.equal(read.omitted, 2);
  assert.deepEqual([read.base, read.head], ["main", "work/x"]);
  for (const number of [0, 1.2, 99999999])
    await assert.rejects(client.readPullRequest({ owner: "o", name: "r" }, number), /valid pull request number/);
  assert.equal(await client.commentOnPullRequest({ owner: "o", name: "r" }, 7, "review text"), "https://github.com/o/r/pull/7#issuecomment-1");
  assert.deepEqual(urls.at(-1), { url: "https://api.github.com/repos/o/r/issues/7/comments", method: "POST" });
  await assert.rejects(client.commentOnPullRequest({ owner: "o", name: "r" }, 7, "  "), /no review text/);
  await assert.rejects(new GitHub().commentOnPullRequest({ owner: "o", name: "r" }, 7, "x"), /token/);
  const bad = new GitHub("", async (url) => new Response(JSON.stringify(String(url).includes("/files") ? { nope: 1 } : { title: "t" })));
  await assert.rejects(bad.readPullRequest({ owner: "o", name: "r" }, 7), /unexpected file list/);
});
