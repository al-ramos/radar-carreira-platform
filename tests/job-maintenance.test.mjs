import assert from "node:assert/strict";
import test from "node:test";
import { parseMaintenanceQuantity, selectedMaintenanceQuantity } from "../lib/job-maintenance.ts";

test("manutenção não impõe teto fixo e aceita processar todo o recorte", () => {
  assert.deepEqual(parseMaintenanceQuantity(undefined), { valid: true });
  assert.deepEqual(parseMaintenanceQuantity(""), { valid: true });
  assert.deepEqual(parseMaintenanceQuantity(51), { valid: true, limit: 51 });
  assert.deepEqual(parseMaintenanceQuantity(5_000), { valid: true, limit: 5_000 });
});

test("manutenção rejeita quantidades inválidas e limita apenas ao total elegível", () => {
  for (const value of [0, -1, 1.5, "50", Number.MAX_SAFE_INTEGER + 1]) {
    assert.deepEqual(parseMaintenanceQuantity(value), { valid: false });
  }
  assert.equal(selectedMaintenanceQuantity("", 3_193), 3_193);
  assert.equal(selectedMaintenanceQuantity("100", 3_193), 100);
  assert.equal(selectedMaintenanceQuantity("5000", 3_193), 3_193);
  assert.equal(selectedMaintenanceQuantity("0", 3_193), 0);
});
