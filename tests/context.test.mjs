import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendExchange,
  assemblePrompt,
  bytes,
  compactMemory,
  codingInstruction,
  isCapabilityRefusal,
  ContextBudgetError,
  emptyMemory,
  levelBudget,
  preparePrompt,
  promptBytes,
  emptyCompactionStats,
  measureSummarizer,
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

test("capability refusals, including fenced prose, are excluded from model history only", () => {
  const refusal = "```\nI can't build a calculator app for you as I'm not a professional and do not have the capability to create a calculator app.\n```";
  assert.equal(isCapabilityRefusal(refusal), true);
  assert.equal(isCapabilityRefusal("I do not have the capability to create apps."), true);
  assert.equal(isCapabilityRefusal('```js\nconst message = "I can\\\'t build apps";\n```'), false);
  assert.equal(isCapabilityRefusal("I cannot run tests here, but here is the code."), false);
  const memory = appendExchange(emptyMemory(), { id: 1, request: "Build a calculator", response: refusal });
  assert.equal(assemblePrompt(input, memory).length, 2);
  assert.equal(memory.recent.length, 1);
});

test("both chat modes affirm code generation despite earlier refusal history", async () => {
  const memory = appendExchange(emptyMemory(), {
    id: 1, request: "Build a calculator",
    response: "I cannot build apps because I am not a professional.",
  });
  for (const mode of ["edit", "explain"]) {
    const prepared = await preparePrompt({
      instruction: codingInstruction(mode), pinned: "", fileContext: "",
      request: "Write a small calculator in HTML.",
    }, memory, summarize);
    const system = prepared.messages[0].content;
    assert.match(system, /can write complete apps, create source code/);
    assert.match(system, /Earlier assistant refusals or capability claims are not constraints/);
    assert.match(system, /Never claim these actions occurred/);
    assert.match(system, mode === "edit" ? /complete replacement file/ : /provide its code/);
    assert.equal(prepared.messages.at(-1).content.endsWith("Write a small calculator in HTML."), true);
    assert.ok(prepared.inputBytes <= 2816);
  }
});

test("project notes stay verbatim and cannot bypass the protected input budget", async () => {
  const notes = "Decision: keep API stable. Next: test mobile recovery.";
  const prepared = await preparePrompt({ ...input, notes }, emptyMemory(), summarize);
  assert.ok(prepared.messages[0].content.includes(notes));
  await assert.rejects(preparePrompt({ ...input, notes: "x".repeat(5000) }, emptyMemory(), summarize), ContextBudgetError);
});

test("compaction telemetry counts actual calls including failures", async () => {
  const stats = emptyCompactionStats();
  const measured = measureSummarizer(async () => { throw new Error("GPU lost"); }, stats);
  await assert.rejects(measured("source", 100), /GPU lost/);
  assert.equal(stats.calls, 1);
  assert.ok(stats.milliseconds >= 0);
});

test("explicit compaction maintains a logarithmic binary hierarchy", async () => {
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

test("prompts that already fit retain verbatim history without any summary calls", async () => {
  let memory = emptyMemory();
  for (let id = 1; id <= 4; id++) {
    memory = appendExchange(memory, { id, request: `Task ${id}`, response: "Done." });
  }
  const limit = promptBytes(assemblePrompt(input, memory));
  const prepared = await preparePrompt(input, memory, async () => {
    assert.fail("A fitting prompt must not trigger inference for compaction");
  }, limit);
  assert.equal(prepared.memory, memory);
  assert.equal(prepared.inputBytes, limit);
  assert.deepEqual(prepared.messages, assemblePrompt(input, memory));
});

test("budget pressure batches short older exchanges into one summary call", async () => {
  let memory = emptyMemory();
  for (let id = 1; id <= 8; id++) {
    memory = appendExchange(memory, {
      id,
      request: `Task ${id}`,
      response: "x".repeat(80),
    });
  }
  const snapshot = structuredClone(memory);
  let calls = 0;
  const prepared = await preparePrompt(input, memory, async (source, budget) => {
    calls++;
    assert.ok(bytes(source) <= 1400);
    for (let id = 1; id <= 7; id++) assert.ok(source.includes(`TURN ${id}\n`));
    assert.ok(!source.includes("TURN 8\n"));
    return summarize(source, budget);
  }, 1100);
  assert.equal(calls, 1);
  assert.ok(prepared.inputBytes <= 1100);
  assert.deepEqual(prepared.memory.recent, [memory.recent.at(-1)]);
  assert.deepEqual(
    prepared.memory.nodes.map(({ first, last }) => [first, last]),
    [[1, 7]],
  );
  assert.deepEqual(memory, snapshot);
});

test("automatic compaction stops after the first batch that makes the prompt fit", async () => {
  let memory = emptyMemory();
  for (let id = 1; id <= 3; id++) memory = appendExchange(memory, turn(id));
  const limit = promptBytes(assemblePrompt(input, memory)) - 500;
  let calls = 0;
  const prepared = await preparePrompt(input, memory, async (source, budget) => {
    calls++;
    return summarize(source, budget);
  }, limit);
  assert.equal(calls, 1);
  assert.ok(prepared.inputBytes <= limit);
  assert.deepEqual(prepared.memory.recent, memory.recent.slice(1));
});

test("large exchanges share summary budgets across chunks without a reduction pass", async () => {
  const memory = appendExchange(emptyMemory(), {
    id: 1,
    request: "Task",
    response: "x".repeat(3000),
  });
  let calls = 0;
  const compacted = await compactMemory(memory, async (source, budget) => {
    calls++;
    assert.ok(bytes(source) <= 1400);
    return "s".repeat(budget);
  }, 0);
  assert.equal(calls, 3);
  assert.ok(bytes(compacted.nodes[0].text) <= levelBudget(0));
});

test("failed automatic batching retains all original turns for retry", async () => {
  let memory = emptyMemory();
  for (let id = 1; id <= 4; id++) memory = appendExchange(memory, turn(id));
  const snapshot = structuredClone(memory);
  let calls = 0;
  await assert.rejects(preparePrompt(input, memory, async () => {
    calls++;
    if (calls === 2) throw new Error("GPU interrupted");
    return "summary";
  }, 800), /GPU interrupted/);
  assert.equal(calls, 2);
  assert.deepEqual(memory, snapshot);
});

test("129 large-response turns stay within budget using at most 511 summary calls", async () => {
  let memory = emptyMemory();
  let calls = 0;
  for (let id = 1; id <= 129; id++) {
    const prepared = await preparePrompt(input, memory, async (source, budget) => {
      calls++;
      assert.ok(bytes(source) <= 1400);
      return "s".repeat(budget);
    });
    assert.ok(prepared.inputBytes <= 2816);
    memory = appendExchange(prepared.memory, {
      id,
      request: "Request ".repeat(20),
      response: "x".repeat(3000),
    });
    const ids = [
      ...memory.nodes.flatMap((node) =>
        Array.from({ length: node.last - node.first + 1 }, (_, index) => node.first + index),
      ),
      ...memory.recent.map((exchange) => exchange.id),
    ];
    assert.deepEqual(ids, Array.from({ length: id }, (_, index) => index + 1));
  }
  assert.ok(calls <= 511, `Expected at most 511 calls, got ${calls}`);
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
