import { test } from "node:test";
import assert from "node:assert/strict";
import { prebuiltAppConfig } from "@mlc-ai/web-llm";
import {
  MODEL_CHOICES,
  DEFAULT_MODEL_ID,
  modelChoice,
  modelSource,
} from "../src/models.ts";

test("every selectable model exists in the installed WebLLM catalog and uses ModelScope", () => {
  assert.equal(
    new Set(MODEL_CHOICES.map((model) => model.id)).size,
    MODEL_CHOICES.length,
  );
  for (const model of MODEL_CHOICES) {
    const record = prebuiltAppConfig.model_list.find(
      (record) => record.model_id === model.id,
    );
    assert.ok(record, model.id);
    assert.ok(Math.abs(record.vram_required_MB - model.memoryMB) < 2);
    assert.equal(new URL(modelSource(model.id)).host, "modelscope.cn");
    assert.equal(modelChoice(model.id), model);
  }
  assert.equal(modelChoice(DEFAULT_MODEL_ID).name, "Llama 3.2 1B");
  assert.throws(
    () => modelSource("https://huggingface.co/example"),
    /supported browser model/,
  );
});
