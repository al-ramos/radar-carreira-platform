import assert from "node:assert/strict";
import test from "node:test";
import { AUTOMATIC_ACTION_STAGE, resolveAutomaticStage } from "../lib/pipeline-stage.ts";

test("ações de candidatura escolhem o estágio correspondente", () => {
  assert.equal(AUTOMATIC_ACTION_STAGE.analyze, "saved");
  assert.equal(AUTOMATIC_ACTION_STAGE.copy_email, "saved");
  assert.equal(AUTOMATIC_ACTION_STAGE.forward, "saved");
  assert.equal(AUTOMATIC_ACTION_STAGE.apply, "applied");
  assert.equal(AUTOMATIC_ACTION_STAGE.open_outlook, "applied");
  assert.equal(AUTOMATIC_ACTION_STAGE.mark_sent, "applied");
});

test("ações automáticas avançam o status sem rebaixar etapas posteriores", () => {
  assert.equal(resolveAutomaticStage(undefined, "saved"), "saved");
  assert.equal(resolveAutomaticStage("viewed", "applied"), "applied");
  assert.equal(resolveAutomaticStage("saved", "applied"), "applied");
  assert.equal(resolveAutomaticStage("applied", "saved"), "applied");
  assert.equal(resolveAutomaticStage("interview", "saved"), "interview");
  assert.equal(resolveAutomaticStage("offer", "applied"), "offer");
  assert.equal(resolveAutomaticStage("rejected", "applied"), "rejected");
  assert.equal(resolveAutomaticStage("archived", "saved"), "archived");
});
