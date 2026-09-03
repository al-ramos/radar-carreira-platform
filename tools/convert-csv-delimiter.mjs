import fs from "node:fs/promises";

const file = "exports/analise-externa-codex-2026-08-24.csv";
const input = await fs.readFile(file, "utf8");
let quoted = false;
let output = "";
for (let index = 0; index < input.length; index += 1) {
  const char = input[index];
  if (char === '"') {
    if (quoted && input[index + 1] === '"') {
      output += '""';
      index += 1;
      continue;
    }
    quoted = !quoted;
  }
  output += char === "," && !quoted ? ";" : char;
}
if (quoted) throw new Error("CSV de origem possui aspas não fechadas.");
await fs.writeFile(file, output, "utf8");
