// Batch-Harness: pro Zeile base64(input) auf stdin ->
// Zeile "A " + base64(kanonbytes) oder "R " + code auf stdout.
// Ein Prozess fuer den ganzen Korpus (Differential-Performance).
import { createInterface } from "node:readline";
import { recanonicalize } from "./cwap_strict_json.mjs";

const rl = createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  const buf = Buffer.from(line, "base64");
  try {
    process.stdout.write("A " + recanonicalize(buf).toString("base64") + "\n");
  } catch (e) {
    process.stdout.write("R " + (e.code ?? "CRASH") + "\n");
  }
});
