import { test } from "node:test";
import assert from "node:assert/strict";
import { applyGoalEdit, runGoalLoop, goalResponseSchema } from "../src/goalLoop.ts";

const plan = (path = "app.ts", summary = "Implement the next step") =>
  JSON.stringify({ action: "edit", path, summary });
const review = (verdict = "pass", feedback = "Change matches the goal.") =>
  JSON.stringify({ verdict, feedback });
const code = (text) => `\`\`\`ts\n${text}\n\`\`\``;
const done = JSON.stringify({ action: "done", path: "", summary: "Goal appears met in the supplied files." });

function harness(replies) {
  const state = {
    files: { "app.ts": { original: "old", content: "old" } },
    paths: ["app.ts", "remote-only.ts"],
    input: { goal: "Build a counter", steering: "", revision: 0 },
    pause: false, calls: [], applied: [], stages: [],
    abort: new AbortController(),
  };
  const options = {
    input: () => state.input,
    workspace: () => ({ files: state.files, paths: state.paths }),
    signal: state.abort.signal,
    pauseRequested: () => state.pause,
    ask: async (call) => {
      state.calls.push(call);
      const reply = replies.shift();
      assert.notEqual(reply, undefined, "Unexpected extra inference call");
      return typeof reply === "function" ? await reply(call, state) : reply;
    },
    apply: (edit) => {
      state.files = applyGoalEdit(state.files, state.paths, edit);
      state.paths = [...new Set([...state.paths, edit.path])];
      state.applied.push(edit);
    },
    stage: (cycle, stage, detail) => state.stages.push({ cycle, stage, detail }),
    wait: async () => {},
  };
  return { state, options };
}

test("plans, drafts, reviews, applies locally, then separately reviews completion", async () => {
  const { state, options } = harness([plan(), code("new"), review(), done, review()]);
  assert.equal(await runGoalLoop(options), "reported-complete");
  assert.deepEqual(state.calls.map((call) => call.stage), ["Plan", "Draft", "Review", "Plan", "Completion review"]);
  assert.equal(state.files["app.ts"].content, "new");
  assert.equal(state.files["app.ts"].original, "old");
  assert.equal(state.applied.length, 1);
  for (const call of state.calls) {
    assert.match(call.instruction, /can write complete apps, create source code/);
    assert.match(call.instruction, /Never claim these actions occurred/);
  }
  assert.match(state.calls[2].fileContext, /Original:\nold\nProposed:\nnew/);
});

test("review findings cause a revision and a fresh review before applying", async () => {
  const { state, options } = harness([
    plan(), code("bad"), review("revise", "Handle zero correctly."),
    (call) => { assert.match(call.request, /Handle zero correctly/); return code("fixed"); },
    (call, current) => { assert.equal(current.applied.length, 0); current.pause = true; return review(); },
  ]);
  assert.equal(await runGoalLoop(options), "paused");
  assert.equal(state.files["app.ts"].content, "fixed");
  assert.deepEqual(state.calls.map((call) => call.stage), ["Plan", "Draft", "Review", "Revise", "Review"]);
});

test("review failures stop after two revisions and never mutate workspace files", async () => {
  const { state, options } = harness([plan(), code("bad1"), review("revise"), code("bad2"), review("revise"), code("bad3"), review("revise")]);
  await assert.rejects(runGoalLoop(options), /two revisions/);
  assert.equal(state.applied.length, 0);
  assert.equal(state.files["app.ts"].content, "old");
});

test("steering received during review discards the stale draft before applying", async () => {
  const { state, options } = harness([
    plan(), code("stale"),
    (_call, current) => {
      current.input = { ...current.input, revision: 1, steering: "Use accessible buttons" };
      return review();
    },
    (call) => {
      assert.match(call.request, /Use accessible buttons/);
      return plan();
    },
    code("accessible"),
    (_call, current) => { current.pause = true; return review(); },
  ]);
  assert.equal(await runGoalLoop(options), "paused");
  assert.deepEqual(state.applied.map((edit) => edit.next), ["accessible"]);
});

test("stop during review never applies a candidate", async () => {
  const { state, options } = harness([plan(), code("draft"), (_call, current) => {
    current.abort.abort();
    return review();
  }]);
  await assert.rejects(runGoalLoop(options), { name: "AbortError" });
  assert.equal(state.applied.length, 0);
});

test("unsafe paths, unopened remote paths, malformed reviews and no-op edits stop explicitly", async () => {
  for (const [responses, error] of [
    [[plan("../escape.ts")], /Cannot target/],
    [[plan("remote-only.ts")], /Open remote files first/],
    [[plan(), code("new"), '{"verdict":"maybe","feedback":"ok"}'], /explicitly return/],
    [[plan(), code("old")], /no change/],
    [[plan(), "unfinished draft"], /single code block/],
    [[done, review("revise", "Missing work")], /Completion review rejected/],
    [["import * as app from './app';"], /malformed JSON instead of a plan\/review/],
  ]) {
    const { state, options } = harness(responses);
    await assert.rejects(runGoalLoop(options), error);
    assert.equal(state.applied.length, 0);
  }
});

test("goal schemas constrain planning and review but never source-code drafts", () => {
  const planSchema = JSON.parse(goalResponseSchema("Plan"));
  assert.deepEqual(planSchema.properties.action.enum, ["inspect", "edit", "done"]);
  for (const stage of ["Review", "Completion review"]) {
    const schema = JSON.parse(goalResponseSchema(stage));
    assert.deepEqual(schema.properties.verdict.enum, ["pass", "revise"]);
    assert.deepEqual(schema.required, ["verdict", "feedback"]);
  }
  assert.equal(goalResponseSchema("Draft"), undefined);
  assert.equal(goalResponseSchema("Revise"), undefined);
});

test("new files can be created, inspected and used in subsequent cycles", async () => {
  const { state, options } = harness([
    plan("src/new.ts"), code("new file"), review(),
    JSON.stringify({ action: "inspect", path: "app.ts", summary: "Read original" }),
    (call) => { assert.match(call.fileContext, /File app.ts:\nold/); return done; },
    review(),
  ]);
  assert.equal(await runGoalLoop(options), "reported-complete");
  assert.deepEqual(state.files["src/new.ts"], { original: "", content: "new file", isNew: true });
});

test("apply checks for concurrent edits and creation collisions", () => {
  const files = { "app.ts": { original: "old", content: "edited manually" } };
  assert.throws(() => applyGoalEdit(files, ["app.ts"], { path: "app.ts", base: "old", next: "draft" }), /File changed/);
  assert.throws(() => applyGoalEdit(files, ["app.ts", "remote.ts"], { path: "remote.ts", base: null, next: "draft" }), /already exists/);
  assert.equal(files["app.ts"].content, "edited manually");
});

test("the save-file cap blocks new files but still permits reviewed edits", () => {
  const files = Object.fromEntries(Array.from({ length: 1000 }, (_, index) =>
    [`file${index}.ts`, { original: "old", content: "old" }]));
  const paths = Object.keys(files);
  assert.throws(() => applyGoalEdit(files, paths,
    { path: "extra.ts", base: null, next: "new" }), /1,000-file save limit/);
  const updated = applyGoalEdit(files, paths,
    { path: "file0.ts", base: "old", next: "updated" });
  assert.equal(Object.keys(updated).length, 1000);
  assert.equal(updated["file0.ts"].content, "updated");
  assert.equal(files["file0.ts"].content, "old");
});

test("repeated inspected files and cycling code states stop rather than spin", async () => {
  const inspect = JSON.stringify({ action: "inspect", path: "app.ts", summary: "Inspect" });
  const inspected = harness([inspect, inspect]);
  await assert.rejects(runGoalLoop(inspected.options), /without progress/);
  const alternating = harness([inspect,
    JSON.stringify({ action: "inspect", path: "other.ts", summary: "Inspect another file" }), inspect]);
  alternating.state.files["other.ts"] = { original: "", content: "" };
  await assert.rejects(runGoalLoop(alternating.options), /without progress/);
  const cycling = harness([plan(), code("first"), review(), plan(), code("second"), review(), plan(), code("first"), review()]);
  await assert.rejects(runGoalLoop(cycling.options), /repeated a recent/);
  assert.equal(cycling.state.files["app.ts"].content, "second");
});

test("continuous mode has no fixed iteration cap and pauses at a cycle boundary", async () => {
  const replies = [];
  for (let index = 0; index < 25; index++)
    replies.push(plan(), code(`change ${index}`), (_call, state) => {
      if (state.applied.length === 24) state.pause = true;
      return review();
    });
  const { state, options } = harness(replies);
  assert.equal(await runGoalLoop(options), "paused");
  assert.equal(state.applied.length, 25);
});
