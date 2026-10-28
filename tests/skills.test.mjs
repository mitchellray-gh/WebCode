import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import {
  parseSkillPack,
  attachSkillContext,
  mergeImportedSkills,
  readSkillLibrary,
  SKILL_BYTE_BUDGET,
} from "../src/skills.ts";
import {
  assemblePrompt,
  preparePrompt,
  emptyMemory,
  ContextBudgetError,
} from "../src/context.ts";

const skill = {
  id: "test-skill",
  name: "Test skill",
  description: "Useful coding guidance.",
  category: "Testing",
  tags: ["tests"],
  version: "1.0.0",
  instructions: "Preserve the public API and test the changed behavior.",
};
const input = {
  instruction: "Help with code.",
  pinned: "No network writes.",
  fileContext: "main.ts",
  request: "Fix the bug.",
};

test("all 48 bundled skills are valid, unique and individually fit the prompt budget", () => {
  const directory = new URL("../skills/", import.meta.url);
  const skills = readdirSync(directory)
    .filter((name) => name.endsWith(".skills.json"))
    .flatMap((name) =>
      parseSkillPack(readFileSync(new URL(name, directory), "utf8"), name),
    );
  assert.equal(skills.length, 48);
  assert.equal(new Set(skills.map((skill) => skill.id)).size, 48);
  assert.equal(new Set(skills.map((skill) => skill.category)).size, 8);
  for (const skill of skills)
    assert.ok(attachSkillContext([skill]).includes(skill.instructions));
});

test("JSON and standard Markdown skills validate into one portable format", () => {
  assert.deepEqual(parseSkillPack(JSON.stringify(skill)), [skill]);
  const markdown =
    "---\nname: Test skill\ndescription: Useful coding guidance.\ncategory: Testing\ntags: [tests]\n---\nPreserve the public API and test the changed behavior.";
  assert.deepEqual(parseSkillPack(markdown, "SKILL.md"), [skill]);
  assert.throws(() => parseSkillPack("{bad"), /Invalid skill JSON/);
  assert.throws(
    () => parseSkillPack(JSON.stringify({ ...skill, instructions: "" })),
    /nonempty/,
  );
  assert.throws(
    () => parseSkillPack(JSON.stringify([skill, skill])),
    /duplicate IDs/,
  );
  assert.throws(() => parseSkillPack("x".repeat(131073)), /128 KB/);
  assert.throws(
    () => parseSkillPack("---\nname: [bad\n---\nbody", "SKILL.md"),
    /frontmatter/,
  );
});

test("imports are atomic and cannot replace bundled or existing IDs", () => {
  assert.deepEqual(mergeImportedSkills([], [skill], []), [skill]);
  assert.throws(
    () => mergeImportedSkills([], [skill], [skill.id]),
    /already exists/,
  );
  assert.throws(
    () => mergeImportedSkills([skill], [skill], []),
    /already exists/,
  );
});

test("saved libraries restore validated skills and reject corrupt or conflicting data", () => {
  const saved = readSkillLibrary(
    JSON.stringify({
      imported: [skill],
      attachedIds: [skill.id, "missing-id"],
    }),
    [],
  );
  assert.deepEqual(saved.imported, [skill]);
  assert.deepEqual(saved.attachedIds, [skill.id]);
  assert.equal(saved.warning, "");
  for (const raw of [
    "bad JSON",
    "{}",
    JSON.stringify({ imported: [skill], attachedIds: [] }),
  ]) {
    const restored = readSkillLibrary(raw, [skill]);
    assert.ok(restored.warning);
    assert.deepEqual(restored.imported, []);
  }
});

test("attached instructions are literal protected context, never silently clipped", async () => {
  const skills = attachSkillContext([skill]);
  const prompt = assemblePrompt({ ...input, skills }, emptyMemory());
  assert.ok(prompt[0].content.includes(skill.instructions));
  assert.ok(prompt[0].content.includes("No network writes."));
  assert.ok(prompt.at(-1).content.endsWith(input.request));
  assert.throws(() => attachSkillContext(Array(4).fill(skill)), /at most 3/);
  assert.throws(
    () =>
      attachSkillContext([
        { ...skill, instructions: "x".repeat(SKILL_BYTE_BUDGET) },
      ]),
    /exceed/,
  );
  await assert.rejects(
    preparePrompt(
      { ...input, skills, fileContext: "x".repeat(2800) },
      emptyMemory(),
      async () => "summary",
    ),
    ContextBudgetError,
  );
});
