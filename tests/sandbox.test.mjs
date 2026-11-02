import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPreview, defaultEntry, htmlFromReply, looksLikeHtml, previewPages, resolveRef, PREVIEW_CHANNEL } from "../src/sandbox.ts";

const page = `<!doctype html>
<html><head><title>Calc</title>
<link rel="stylesheet" href="css/style.css">
<link rel='icon' href='favicon.ico'>
</head><body><button id="b">Add</button>
<script src="./js/app.js"></script>
</body></html>`;

test("a finished reply that is a web page can be run, ambiguous or non-page replies cannot", () => {
  const page = "<!DOCTYPE html>\n<html><body><h1>Calculator</h1></body></html>";
  assert.equal(htmlFromReply(page), page);
  assert.equal(htmlFromReply(`Here you go:\n\`\`\`html\n${page}\n\`\`\`\nEnjoy.`), page);
  assert.equal(htmlFromReply("```\n" + page + "\n```"), page);
  assert.equal(htmlFromReply("```html\n<div>fragment</div>\n```"), "<div>fragment</div>");
  assert.equal(htmlFromReply(`\`\`\`html\n${page}\n\`\`\`\n\`\`\`js\nx()\n\`\`\``), null);
  assert.equal(htmlFromReply("```ts\nconst a = 1;\n```"), null);
  assert.equal(htmlFromReply("Use <b>bold</b> text."), null);
  assert.equal(htmlFromReply("```html\n" + page), null);
  assert.equal(looksLikeHtml("  \n<html lang='en'>"), true);
  assert.equal(looksLikeHtml("const html = '<html>';"), false);
});

test("pages are found, with the active page and index.html preferred", () => {
  const paths = ["a.js", "docs/about.html", "site/index.html", "z.htm"];
  assert.deepEqual(previewPages(paths), ["docs/about.html", "site/index.html", "z.htm"]);
  assert.equal(defaultEntry(paths, "z.htm"), "z.htm");
  assert.equal(defaultEntry(paths, "a.js"), "site/index.html");
  assert.equal(defaultEntry(["x/b.html", "a.html"], ""), "x/b.html");
  assert.equal(defaultEntry(["a.js"], "a.js"), "");
});

test("references resolve like a static server and cannot leave the workspace", () => {
  assert.equal(resolveRef("index.html", "app.js?v=2#top"), "app.js");
  assert.equal(resolveRef("site/index.html", "../lib/a.js"), "lib/a.js");
  assert.equal(resolveRef("site/index.html", "/root.css"), "root.css");
  assert.equal(resolveRef("site/index.html", "./a/./b.js"), "site/a/b.js");
  assert.equal(resolveRef("site/index.html", "../../escape.js"), null);
  assert.equal(resolveRef("index.html", "#only-hash"), null);
  assert.equal(resolveRef("index.html", "my%20file.js"), "my file.js");
});

test("local scripts and stylesheets are inlined; external and missing references are untouched", () => {
  const files = {
    "index.html": page.replace("<link rel='icon'", '<link rel="stylesheet" href="https://cdn.example/x.css"><link rel="stylesheet" href="missing.css"><link rel=\'icon\''),
    "css/style.css": "body{color:red}",
    "js/app.js": "console.log('hi')",
  };
  const built = buildPreview(files, "index.html");
  assert.match(built.standalone, /<style>body\{color:red\}<\/style>/);
  assert.match(built.standalone, /<script>console\.log\('hi'\)<\/script>/);
  assert.doesNotMatch(built.standalone, /src="\.\/js\/app\.js"|href="css\/style\.css"/);
  assert.match(built.standalone, /href="https:\/\/cdn\.example\/x\.css"/);
  assert.match(built.standalone, /href="missing\.css"/);
  assert.deepEqual(built.missing, ["missing.css"]);
  assert.match(built.standalone, /rel='icon' href='favicon\.ico'/);
  assert.equal(built.standalone.includes(PREVIEW_CHANNEL), false);
});

test("inlined code cannot close its own element, attributes survive and inputs are not modified", () => {
  const files = {
    "p/index.html": '<head><script type="module" defer src="../m.js"></script><link media=\'(min-width: 1px)\' rel="stylesheet" href="s.css"></head>',
    "m.js": 'document.write("</script><b>x</b>")',
    "p/s.css": "a::after{content:'</style>'}",
  };
  const snapshot = structuredClone(files);
  const built = buildPreview(files, "p/index.html");
  assert.match(built.standalone, /<script type="module" defer>document\.write\("<\\\/script><b>x<\/b>"\)<\/script>/);
  assert.match(built.standalone, /<style media="\(min-width: 1px\)">a::after\{content:'<\\\/style>'\}<\/style>/);
  assert.deepEqual(files, snapshot);
});

test("the sandbox bridge is injected only into the frame, in a valid position", () => {
  const withHead = buildPreview({ "a.html": "<!doctype html><html><head><title>t</title></head><body></body></html>" }, "a.html");
  assert.ok(withHead.frame.indexOf("<head>") < withHead.frame.indexOf(PREVIEW_CHANNEL));
  assert.ok(withHead.frame.indexOf(PREVIEW_CHANNEL) < withHead.frame.indexOf("<title>"));
  const noHead = buildPreview({ "a.html": "<!doctype html><html><body>x</body></html>" }, "a.html");
  assert.match(noHead.frame, /<html><head><script>/);
  const bare = buildPreview({ "a.html": "<!DOCTYPE html><p>hello</p>" }, "a.html");
  assert.match(bare.frame, /^<!DOCTYPE html><script>/);
  assert.equal(buildPreview({ "a.html": "<p>x</p>" }, "a.html").frame.startsWith("<script>"), true);
  for (const built of [withHead, noHead, bare]) assert.equal(built.standalone.includes("postMessage"), false);
});

test("the bridge script is syntactically valid and has no closing script tag", () => {
  const { frame } = buildPreview({ "a.html": "<head></head>" }, "a.html");
  const code = /<script>([\s\S]*)<\/script>/.exec(frame)[1];
  assert.doesNotThrow(() => new Function(code));
  assert.equal(code.includes("</"), false);
});

test("bridge reports console output, errors and local navigation, and shims storage", () => {
  const { frame } = buildPreview({ "a.html": "<head></head>" }, "a.html");
  const code = /<script>([\s\S]*)<\/script>/.exec(frame)[1];
  const sent = [];
  const listeners = {};
  const window = { addEventListener: (type, fn) => { listeners[type] = fn; } };
  const console = { log() {}, info() {}, warn() {}, error() {} };
  const document = { addEventListener: (type, fn) => { listeners[`doc:${type}`] = fn; } };
  new Function("window", "console", "document", "parent", "addEventListener", "Object", code)(
    window, console, document, { postMessage: (message) => sent.push(message) }, window.addEventListener, Object);
  console.log("a", { b: 1 }, undefined);
  console.error("boom");
  listeners.error({ message: "bad", lineno: 7 });
  const local = { defaultPrevented: false, preventDefault() { this.stopped = true; }, target: { closest: () => ({ getAttribute: () => "about.html" }) } };
  listeners["doc:click"](local);
  listeners["doc:click"]({ defaultPrevented: false, preventDefault() { throw new Error("must not intercept"); }, target: { closest: () => ({ getAttribute: () => "https://example.com" }) } });
  listeners["doc:click"]({ defaultPrevented: false, preventDefault() { throw new Error("must not intercept"); }, target: { closest: () => ({ getAttribute: () => "#section" }) } });
  assert.deepEqual(sent.map((m) => [m.channel, m.type, m.level ?? m.href, m.text]), [
    [PREVIEW_CHANNEL, "log", "log", 'a {"b":1} undefined'],
    [PREVIEW_CHANNEL, "log", "error", "boom"],
    [PREVIEW_CHANNEL, "log", "error", "bad (line 7)"],
    [PREVIEW_CHANNEL, "navigate", "about.html", undefined],
  ]);
  assert.equal(local.stopped, true);
  window.localStorage.setItem("k", 1);
  assert.equal(window.localStorage.getItem("k"), "1");
  assert.equal(window.localStorage.length, 1);
  window.localStorage.clear();
  assert.equal(window.localStorage.getItem("k"), null);
  for (let index = 0; index < 400; index++) console.log(index);
  assert.ok(sent.length <= 301);
});

test("unsupported sources are explained instead of failing silently", () => {
  const files = {
    "index.html": '<script src="app.ts"></script><script type="module" src="main.js"></script><script src="nope.js"></script>',
    "app.ts": "const a: number = 1;",
    "main.js": 'import { x } from "./other.js"; console.log(x);',
  };
  const built = buildPreview(files, "index.html");
  assert.match(built.warnings.join("\n"), /app\.ts is TypeScript/);
  assert.match(built.warnings.join("\n"), /main\.js imports other workspace files as modules/);
  assert.deepEqual(built.missing, ["nope.js"]);
  assert.match(built.standalone, /<script src="app\.ts"><\/script>/);
  assert.throws(() => buildPreview(files, "app.ts"), /Choose an HTML file/);
  assert.throws(() => buildPreview(files, "missing.html"), /Choose an HTML file/);
  assert.throws(() => buildPreview({ "a.html": "x".repeat(2_100_000) }, "a.html"), /too large/);
  assert.match(buildPreview({ "a.html": "  " }, "a.html").standalone, /empty/);
});
