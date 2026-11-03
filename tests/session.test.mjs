import { test } from "node:test";
import assert from "node:assert/strict";
import { readSession, MAX_SESSION_BYTES } from "../src/session.ts";
import { DEFAULT_MODEL_ID } from "../src/models.ts";

const session = () => ({
  version: 1, files: { "src/app.ts": { content: "export const x = 1;" } },
  active: "src/app.ts", transcript: [{ id: 2, request: "Task", response: "Partial", file: "src/app.ts", status: "Generating" }],
  memory: { nodes: [{ first: 1, last: 1, level: 0, text: "Notes" }], recent: [] },
  pinned: "Preserve APIs", notes: "Build a calculator", request: "Next task",
  mode: "edit", model: DEFAULT_MODEL_ID,
  proposal: { path: "src/app.ts", base: "old", next: "new", source: "ai" },
});

test("saved workspace round-trips editable state but strips credentials and unknown fields", () => {
  const data = session();
  const restored = readSession({
    ...data, token: "not-a-real-token", accessKey: "not-a-real-key", databaseUrl: "not-a-real-url",
    files: { "src/app.ts": { ...data.files["src/app.ts"], token: "not-a-real-token" } },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(restored)), data);
  assert.ok(!JSON.stringify(restored).includes("not-a-real"));
});

test("saved state rejects corrupt schemas, unsafe paths, invalid models, and overlapping memory", () => {
  for (const data of [
    { ...session(), version: 2 },
    { ...session(), files: { "../escape": { content: "bad" } } },
    { ...session(), active: "missing" },
    { ...session(), model: "unsupported" },
    { ...session(), notes: 10 },
    { ...session(), memory: { nodes: [{ first: 2, last: 1, level: 0, text: "bad" }], recent: [] } },
    { ...session(), proposal: { path: "missing", base: "", next: "", source: "ai" } },
  ]) assert.throws(() => readSession(data));
  assert.throws(() => readSession({ ...session(), request: "x".repeat(MAX_SESSION_BYTES) }), /limit/);
});

test("goal and steering persist without granting automatic resume permission", () => {
  const saved = readSession({ ...session(), goalLoop: { goal: "Build a timer", steering: "Keyboard accessible", running: true, enabled: true } });
  assert.deepEqual(saved.goalLoop, { goal: "Build a timer", steering: "Keyboard accessible" });
  assert.throws(() => readSession({ ...session(), goalLoop: { goal: "x".repeat(2001), steering: "" } }));
  assert.ok(!Object.hasOwn(readSession(session()), "goalLoop"));
});

test("an intentionally empty fresh workspace is a valid recoverable session", () => {
  const fresh = readSession({
    version: 1, files: {}, active: "", transcript: [],
    memory: { nodes: [], recent: [] }, pinned: "", notes: "", request: "",
    mode: "explain", model: DEFAULT_MODEL_ID, proposal: null,
  });
  assert.equal(Object.keys(fresh.files).length, 0);
  assert.equal(fresh.active, "");
  assert.equal(fresh.transcript.length, 0);
});
