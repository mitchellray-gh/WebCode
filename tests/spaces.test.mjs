import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_SPACES, MAX_SPACES, MAX_TASKS, activeSpace, addSpace, parsePaths, readSpaces, removeSpace, saveTask, spaceContext, updateSpace,
} from "../src/spaces.ts";
import { SPLIT_SCHEMA, withSteps } from "../src/goalSteps.ts";
import { readSession } from "../src/session.ts";

test("reusable tasks are saved per space, replaced by name, bounded, and loaded from legacy sessions", () => {
  const state = addSpace(EMPTY_SPACES, "a");
  const saved = saveTask(state, "a", "  Add   tests ", "  Write tests for the API.  ");
  assert.deepEqual(saved.spaces[0].tasks, [{ name: "Add tests", goal: "Write tests for the API." }]);
  const replaced = saveTask(saved, "a", "add TESTS", "Write more tests.");
  assert.deepEqual(replaced.spaces[0].tasks, [{ name: "add TESTS", goal: "Write more tests." }]);
  assert.deepEqual(state.spaces[0].tasks, []);
  assert.throws(() => saveTask(state, "missing", "x", "y"), /Choose a space/);
  assert.throws(() => saveTask(state, "a", "  ", "y"), /Name the task/);
  assert.throws(() => saveTask(state, "a", "x", "  "), /Write a goal/);
  assert.equal(saveTask(state, "a", "x", "g".repeat(5000)).spaces[0].tasks[0].goal.length, 1900);
  let full = state;
  for (let i = 0; i < MAX_TASKS; i++) full = saveTask(full, "a", `t${i}`, "g");
  assert.throws(() => saveTask(full, "a", "one more", "g"), /up to 10 tasks/);
  assert.equal(saveTask(full, "a", "t3", "changed").spaces[0].tasks.length, MAX_TASKS);
  const legacy = readSpaces({ spaces: [{ id: "a", name: "Old", instructions: "", paths: [] }], active: "a" });
  assert.deepEqual(legacy.spaces[0].tasks, []);
  const restored = readSpaces(JSON.parse(JSON.stringify(replaced)));
  assert.deepEqual(restored.spaces[0].tasks, replaced.spaces[0].tasks);
  for (const bad of [
    { spaces: [{ id: "a", name: "n", instructions: "", paths: [], tasks: "x" }], active: "" },
    { spaces: [{ id: "a", name: "n", instructions: "", paths: [], tasks: Array(11).fill({ name: "t", goal: "g" }) }], active: "" },
    { spaces: [{ id: "a", name: "n", instructions: "", paths: [], tasks: [{ name: "t" }] }], active: "" },
    { spaces: [{ id: "a", name: "n", instructions: "", paths: [], tasks: [{ name: "x".repeat(41), goal: "g" }] }], active: "" },
    { spaces: [{ id: "a", name: "n", instructions: "", paths: [], tasks: [null] }], active: "" },
  ]) assert.throws(() => readSpaces(bad));
});

test("a goal is split into an ordered step list that replaces any earlier split", () => {
  const goal = "Build a todo app";
  const split = withSteps(goal, JSON.stringify({ steps: ["Create index.html", "  Add   the list ", "", 7, "Style it"] }));
  assert.equal(split, "Build a todo app\n\nWork through these steps in order, finishing each before the next:\n1. Create index.html\n2. Add the list\n3. Style it");
  assert.equal(withSteps(split, JSON.stringify({ steps: ["One", "Two"] })), "Build a todo app\n\nWork through these steps in order, finishing each before the next:\n1. One\n2. Two");
  assert.equal(withSteps(goal, JSON.stringify({ steps: Array.from({ length: 9 }, (_, i) => `s${i}`) })).split("\n").length, 4 + 5 - 1);
  for (const bad of ["not json", "{}", JSON.stringify({ steps: ["only one"] }), JSON.stringify({ steps: "text" }), JSON.stringify({ steps: [" ", 1] })])
    assert.throws(() => withSteps(goal, bad), /goal was not changed/, bad);
  assert.throws(() => withSteps("g".repeat(1990), JSON.stringify({ steps: ["a", "b"] })), /too long/);
  assert.deepEqual(JSON.parse(SPLIT_SCHEMA).properties.steps, { type: "array", minItems: 2, maxItems: 5, items: { type: "string" } });
  assert.equal(withSteps(goal, JSON.stringify({ steps: ["x".repeat(500), "y"] })).split("\n")[3].length, "1. ".length + 160);
});

test("spaces are created, edited, selected and removed immutably within limits", () => {
  const first = addSpace(EMPTY_SPACES, "a", ["src/app.ts"]);
  assert.deepEqual(first.spaces[0], { id: "a", name: "Space 1", instructions: "", paths: ["src/app.ts"], tasks: [] });
  assert.equal(first.active, "a");
  assert.deepEqual(EMPTY_SPACES, { spaces: [], active: "" });
  const edited = updateSpace(first, "a", { name: "N".repeat(80), instructions: "I".repeat(2000), paths: Array.from({ length: 30 }, (_, i) => `f${i}`) });
  assert.equal(edited.spaces[0].name.length, 40);
  assert.equal(edited.spaces[0].instructions.length, 1000);
  assert.equal(edited.spaces[0].paths.length, 20);
  assert.equal(first.spaces[0].name, "Space 1");
  const second = addSpace(edited, "b");
  assert.equal(second.active, "b");
  assert.equal(activeSpace(second).id, "b");
  assert.deepEqual(removeSpace(second, "b").active, "");
  assert.equal(removeSpace(second, "a").active, "b");
  let full = EMPTY_SPACES;
  for (let i = 0; i < MAX_SPACES; i++) full = addSpace(full, `s${i}`);
  assert.throws(() => addSpace(full, "extra"), /up to 12 spaces/);
});

test("path lists are trimmed, de-duplicated, capped and stripped of control characters", () => {
  assert.deepEqual(parsePaths(" src/a.ts \r\n\n/src/a.ts\nlib/b.ts\u0007x\n"), ["src/a.ts", "lib/b.tsx"]);
  assert.equal(parsePaths(Array.from({ length: 50 }, (_, i) => `f${i}.ts`).join("\n")).length, 20);
  assert.equal(parsePaths("x".repeat(500))[0].length, 200);
  assert.deepEqual(parsePaths(""), []);
});

test("saved spaces are validated, with unknown fields stripped and a missing selection cleared", () => {
  const clean = readSpaces({ spaces: [{ id: "a", name: "API", instructions: "Use REST.", paths: ["x.ts"], secret: "no" }], active: "a" });
  assert.deepEqual(clean, { spaces: [{ id: "a", name: "API", instructions: "Use REST.", paths: ["x.ts"], tasks: [] }], active: "a" });
  assert.equal(readSpaces({ spaces: [], active: "gone" }).active, "");
  assert.equal(readSpaces({ spaces: clean.spaces, active: "gone" }).active, "");
  for (const bad of [
    null, [], { spaces: "x" }, { spaces: Array.from({ length: 13 }, (_, i) => ({ id: `s${i}`, name: "n", instructions: "", paths: [] })) },
    { spaces: [{ id: "a", name: "n", instructions: "", paths: [] }, { id: "a", name: "n", instructions: "", paths: [] }] },
    { spaces: [{ id: "", name: "n", instructions: "", paths: [] }] },
    { spaces: [{ id: "a", name: "x".repeat(41), instructions: "", paths: [] }] },
    { spaces: [{ id: "a", name: "n", instructions: "x".repeat(1001), paths: [] }] },
    { spaces: [{ id: "a", name: "n", instructions: "", paths: Array(21).fill("f") }] },
    { spaces: [{ id: "a", name: "n\u0000", instructions: "", paths: [] }] },
    { spaces: [{ id: "a", name: "n", instructions: "", paths: [5] }] },
  ]) assert.throws(() => readSpaces(bad), undefined, JSON.stringify(bad).slice(0, 60));
});

test("the active space adds protected instructions and a planner hint; no space adds nothing", () => {
  assert.deepEqual(spaceContext(EMPTY_SPACES), { requirements: "", hint: "" });
  const state = updateSpace(addSpace(EMPTY_SPACES, "a", ["src/api.ts", "src/db.ts"]), "a", { name: "Backend", instructions: "  Use PostgreSQL only.  " });
  assert.deepEqual(spaceContext(state), {
    requirements: 'Space "Backend" instructions:\nUse PostgreSQL only.',
    hint: 'Space "Backend" files to focus on (open or read them when needed):\nsrc/api.ts\nsrc/db.ts',
  });
  assert.deepEqual(spaceContext({ ...state, active: "" }), { requirements: "", hint: "" });
  assert.equal(spaceContext(updateSpace(state, "a", { instructions: "  ", paths: [] })).requirements, "");
});

test("spaces persist with the workspace session and legacy sessions still load", () => {
  const base = {
    version: 1, files: {}, active: "", transcript: [], memory: { nodes: [], recent: [] }, pinned: "", notes: "",
    request: "", mode: "explain", model: "SmolLM2-360M-Instruct-q4f32_1-MLC", proposal: null,
  };
  assert.equal(readSession(base).spaces, undefined);
  const saved = readSession({ ...base, spaces: { spaces: [{ id: "a", name: "API", instructions: "x", paths: [], token: "no" }], active: "a" } });
  assert.deepEqual(saved.spaces, { spaces: [{ id: "a", name: "API", instructions: "x", paths: [], tasks: [] }], active: "a" });
  assert.throws(() => readSession({ ...base, spaces: { spaces: [{ id: "a", name: 5 }], active: "a" } }));
});
