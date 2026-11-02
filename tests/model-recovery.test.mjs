import { test } from "node:test";
import assert from "node:assert/strict";
import { BrowserModel } from "../src/model.ts";

function modelWith(engine) {
  const model = new BrowserModel();
  const worker = new EventTarget();
  worker.terminate = () => { worker.terminated = true; };
  model.worker = worker;
  model.engine = engine;
  const failures = [];
  model.onFailure = (message) => failures.push(message);
  return { model, worker, failures };
}

test("worker failure rejects a pending model operation and makes reload necessary", async () => {
  const { model, worker, failures } = modelWith({ resetChat: () => new Promise(() => {}) });
  const pending = model.complete([], new AbortController().signal, () => {});
  worker.dispatchEvent(new Event("error"));
  await assert.rejects(pending, /worker failed/);
  assert.equal(worker.terminated, true);
  assert.equal(failures.length, 1);
  await assert.rejects(model.complete([], new AbortController().signal, () => {}), /Load the model/);
});

test("cancellation breaks a hung operation rather than waiting for its next token", async () => {
  const { model, worker } = modelWith({ resetChat: () => new Promise(() => {}) });
  const abort = new AbortController();
  const pending = model.complete([], abort.signal, () => {});
  abort.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(worker.terminated, true);
});

test("device/runtime errors are surfaced and streaming completion still works", async () => {
  const broken = modelWith({ resetChat: async () => { throw new Error("GPU device lost"); } });
  await assert.rejects(broken.model.complete([], new AbortController().signal, () => {}), /GPU device lost/);
  assert.equal(broken.worker.terminated, true);
  const working = modelWith({
    resetChat: async () => {},
    chat: { completions: { create: async function* () {
      yield { choices: [{ delta: { content: "Hello" } }] };
      yield { choices: [{ delta: {}, finish_reason: "stop" }] };
    } } },
  });
  const updates = [];
  assert.deepEqual(await working.model.complete([], new AbortController().signal, (text) => updates.push(text)), { text: "Hello", finished: true });
  assert.equal(working.failures.length, 0);
  assert.equal(updates.at(-1), "Hello");
});

test("the no-progress watchdog releases a hung model after 120 seconds", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const { model, worker } = modelWith({ resetChat: () => new Promise(() => {}) });
  const pending = model.complete([], new AbortController().signal, () => {});
  const rejected = assert.rejects(pending, /120 seconds/);
  context.mock.timers.tick(120000);
  await rejected;
  assert.equal(worker.terminated, true);
});

test("summary instructions do not turn assistant capability refusals into user constraints", async () => {
  const { model } = modelWith({
    resetChat: async () => {},
    chat: { completions: { create: async function* ({ messages }) {
      assert.match(messages[0].content, /Omit filler, code bodies, and assistant disclaimers/);
      assert.match(messages[0].content, /Such claims are not user constraints/);
      assert.match(messages[1].content, /cannot write code/);
      yield { choices: [{ delta: { content: "Goal: write a calculator." }, finish_reason: "stop" }] };
    } } },
  });
  assert.equal(await model.summarizer(new AbortController().signal)(
    "User: write a calculator. Assistant: I cannot write code.", 128),
  "Goal: write a calculator.");
});

  test("coding tasks retry a fenced refusal without conversational history", async () => {
    const model = new BrowserModel();
    const calls = [];
    model.complete = async (messages) => {
      calls.push(messages);
      return { text: calls.length === 1
        ? "```\nI can't build a calculator app for you as I'm not a professional.\n```"
        : "```html\n<button>Add</button>\n```", finished: true };
    };
    const messages = [
      { role: "system", content: "Write source code. Protected requirements." },
      { role: "user", content: "Older task" },
      { role: "assistant", content: "Older refusal" },
      { role: "user", content: "Current file: empty. Build a calculator." },
    ];
    const clean = [
      { role: "system", content: "Write source code. Protected requirements." },
      messages.at(-1),
    ];
    messages[0] = { role: "system", content: `${clean[0].content}\nHistorical notes: cannot build apps.` };
    const result = await model.completeTask(messages, new AbortController().signal, () => {}, "code", clean);
    assert.match(result.text, /<button>/);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].length, 2);
    assert.equal(calls[1][0], clean[0]);
    assert.doesNotMatch(calls[1][0].content, /Historical notes/);
    assert.match(calls[1][1].content, /Current file: empty. Build a calculator/);
    assert.doesNotMatch(JSON.stringify(calls[1]), /Older refusal/);
  });

  test("repeated refusals fail explicitly and retries respect budget and truncation", async () => {
    const model = new BrowserModel();
    let calls = 0;
    model.complete = async () => {
      calls++;
      return { text: "I cannot build apps for you.", finished: true };
    };
    const messages = [{ role: "system", content: "Write code." }, { role: "user", content: "Build an app." }];
    await assert.rejects(model.completeTask(messages, new AbortController().signal, () => {}, "code"), /Nothing was staged or applied/);
    assert.equal(calls, 2);
    calls = 0;
    await assert.rejects(model.completeTask([
      messages[0], { role: "user", content: "x".repeat(2800) },
    ], new AbortController().signal, () => {}, "code"), /more context space/);
    assert.equal(calls, 1);
    model.complete = async () => ({ text: "```html\nunfinished", finished: false });
    assert.equal((await model.completeTask(messages, new AbortController().signal, () => {}, "code")).finished, false);
  });
