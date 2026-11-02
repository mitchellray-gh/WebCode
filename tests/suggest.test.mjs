import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanSuggestion, suggestionPrompt } from "../src/suggest.ts";

test("suggestion prompts bound the context on both sides and mark the cursor once", () => {
  const before = Array.from({ length: 400 }, (_, i) => `line ${i}`).join("\n") + "\nconst total = ";
  const after = "\n" + "tail ".repeat(200);
  const prompt = suggestionPrompt("src/app.ts", before, after);
  assert.match(prompt, /^File: src\/app\.ts\n/);
  assert.equal(prompt.split("<CURSOR>").length, 2);
  assert.ok(prompt.length < 1200 + 300 + 80);
  assert.match(prompt, /const total = <CURSOR>\n/);
  assert.match(prompt, /^File: src\/app\.ts\nline \d+\n/);
  assert.equal(suggestionPrompt("a.ts", "x", "y"), "File: a.ts\nx<CURSOR>y");
});

test("model output is cleaned into safe ghost text", () => {
  assert.equal(cleanSuggestion("5;", "const a = ", ""), "5;");
  assert.equal(cleanSuggestion("```ts\nreturn a + b;\n```", "function add(a, b) {\n  ", "\n}"), "return a + b;");
  assert.equal(cleanSuggestion("```\nx\n```\nHere is the explanation.", "", ""), "x");
  assert.equal(cleanSuggestion("<CURSOR>done()", "", ""), "done()");
  assert.equal(cleanSuggestion("\n\n  value;\n\n", "", ""), "  value;");
  for (const empty of ["", "   \n ", "```\n```", "<CURSOR>"]) assert.equal(cleanSuggestion(empty, "x", "y"), "", JSON.stringify(empty));
});

test("restated and run-on text is trimmed instead of duplicated", () => {
  assert.equal(cleanSuggestion("const total = 1 + 2;", "const total = ", ""), "1 + 2;");
  assert.equal(cleanSuggestion("function add(a, b) {\n  return a + b;\n}", "function add(a, b) {\n  ", ""), "return a + b;\n}");
  assert.equal(cleanSuggestion("return a + b;\n}", "  ", "\n}"), "return a + b;");
  assert.equal(cleanSuggestion("ab", "xxab", ""), "ab");
  assert.equal(cleanSuggestion("foo(); bar();", "", "bar();"), "foo();");
});

test("suggestions are bounded in lines and characters", () => {
  const long = Array.from({ length: 30 }, (_, i) => `line${i}`).join("\n");
  assert.equal(cleanSuggestion(long, "", "").split("\n").length, 8);
  assert.equal(cleanSuggestion("y".repeat(2000), "", "").length, 400);
});
