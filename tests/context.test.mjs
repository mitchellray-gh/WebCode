import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendExchange,
  assemblePrompt,
  bytes,
  compactMemory,
  ContextBudgetError,
  emptyMemory,
  levelBudget,
  preparePrompt,
  promptBytes,
} from "../src/context.ts";

const summarize = async (text, budget) =>
  `Notes ${text.length}.`.slice(0, budget);
const turn = (id) => ({
  id,
  request: `Task ${id} ` + "x".repeat(400),
  response: "Answer ".repeat(100),
});
const input = {
  instruction: "You are a coding assistant.",
  pinned: "Never auto-commit.",
  fileContext: "main.ts\nlet value = 2",
  request: "Explain the current code exactly.",
};

test("completed turns compact immediately into a logarithmic binary hierarchy", async () => {
  let memory = emptyMemory();
  for (let id = 1; id <= 129; id++) {
    memory = await compactMemory(appendExchange(memory, turn(id)), summarize);
    assert.equal(memory.recent.length, 1);
    assert.ok(memory.nodes.length <= Math.ceil(Math.log2(id + 1)));
    for (const node of memory.nodes)
      assert.ok(bytes(node.text) <= levelBudget(node.level));
  }
  assert.equal(memory.nodes.length, 1);
  assert.equal(memory.nodes[0].level, 7);
  assert.equal(memory.nodes[0].first, 1);
  assert.equal(memory.nodes[0].last, 128);
  assert.deepEqual(memory.recent[0], turn(129));
});

test("budget pressure compacts recent history but preserves pinned requirements, current code and request", async () => {
  const memory = appendExchange(
    appendExchange(emptyMemory(), turn(1)),
    turn(2),
  );
  const prepared = await preparePrompt(input, memory, summarize, 800);
  assert.ok(prepared.inputBytes <= 800);
  assert.equal(prepared.memory.recent.length, 0);
  assert.ok(
    prepared.messages.some((message) => message.content.includes(input.pinned)),
  );
  assert.ok(prepared.messages.at(-1).content.includes(input.fileContext));
  assert.ok(prepared.messages.at(-1).content.endsWith(input.request));
  assert.equal(memory.recent.length, 2);
});

test("oversized protected content fails before summarization rather than silently truncating", async () => {
  let calls = 0;
  await assert.rejects(
    preparePrompt(
      { ...input, request: "x".repeat(5000) },
      emptyMemory(),
      async () => {
        calls++;
        return "summary";
      },
    ),
    ContextBudgetError,
  );
  assert.equal(calls, 0);
});

test("a model that ignores the summary limit is trimmed, an empty summary fails atomically", async () => {
  const memory = appendExchange(
    appendExchange(emptyMemory(), turn(1)),
    turn(2),
  );
  const snapshot = structuredClone(memory);
  let calls = 0;
  const compacted = await compactMemory(memory, async () => {
    calls++;
    return "\u{1f680}".repeat(2000);
  });
  assert.equal(calls, 2);
  assert.ok(bytes(compacted.nodes[0].text) <= levelBudget(0));
  assert.ok(!compacted.nodes[0].text.includes("\ufffd"));
  assert.deepEqual(memory, snapshot);
  await assert.rejects(
    compactMemory(memory, async () => ""),
    /empty/,
  );
  assert.deepEqual(memory, snapshot);
});

test("summary source chunks obey byte limits for Unicode and merges cover every turn in order", async () => {
  let memory = emptyMemory();
  for (let id = 1; id <= 24; id++) {
    memory = await compactMemory(
      appendExchange(memory, {
        id,
        request: "\u{1f680}".repeat(800),
        response: "ok",
      }),
      async (source, budget) => {
        assert.ok(bytes(source) <= 1400);
        assert.ok(!source.includes("\ufffd"));
        return summarize(source, budget);
      },
    );
  }
  const ranges = memory.nodes.flatMap((node) =>
    Array.from(
      { length: node.last - node.first + 1 },
      (_, index) => node.first + index,
    ),
  );
  assert.deepEqual(
    ranges,
    Array.from({ length: 23 }, (_, index) => index + 1),
  );
  const prompt = assemblePrompt(input, memory);
  assert.equal(prompt.filter((message) => message.role === "system").length, 1);
  assert.ok(prompt[0].content.includes(input.pinned));
  assert.ok(promptBytes(prompt) > bytes(input.request));
});
