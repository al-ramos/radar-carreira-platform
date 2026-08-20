import assert from "node:assert/strict";
import test from "node:test";
import { hasValidContactEmail, normalizeContactEmail } from "../lib/contact-email.ts";

test("normaliza um único e-mail de contato válido", () => {
  assert.equal(normalizeContactEmail("  RH@Empresa.COM "), "rh@empresa.com");
  assert.equal(hasValidContactEmail("rh@empresa.com"), true);
});

test("recusa contato ausente, incompleto ou lista de destinatários", () => {
  for (const value of [null, "", "rh@empresa", "rh@empresa.com, vaga@empresa.com", "nome sem email"]) {
    assert.equal(normalizeContactEmail(value), null);
  }
});
