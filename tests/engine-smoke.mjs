import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import assert from "node:assert/strict";
import { lessons } from "../dist/lessons.js";
import { coord } from "../dist/game.js";
const dir = path.resolve("dist/engine"),
  file = path.join(dir, "rapfi-single-simd128.js");
const mod = new Module(file);
mod.filename = file;
mod._compile(fs.readFileSync(file, "utf8"), file);
const data = Buffer.concat(
  [0, 1, 2].map((i) => fs.readFileSync(path.join(dir, `weights-${i}.bin`))),
);
let resolveSearch,
  info = {},
  banner = [];
const engine = await mod.exports({
  wasmBinary: fs.readFileSync(path.join(dir, "rapfi-single-simd128.wasm")),
  getPreloadedPackage: () =>
    data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
  onReceiveStdout: (line) => {
    if (line.startsWith("INFO ")) {
      const [, key, ...v] = line.split(" ");
      info[key] = v.join(" ");
    } else if (/^\d+,\d+$/.test(line)) {
      const [x, y] = line.split(",").map(Number);
      resolveSearch?.({ i: y * 15 + x, info: { ...info } });
    } else if (line !== "OK") banner.push(line);
  },
  onReceiveStderr: (s) => console.error(s),
});
const command = (s) => engine.sendCommand(s);
command("ABOUT");
command("START 15");
command("INFO RULE 0");
command("INFO THREAD_NUM 1");
command("INFO HASH_SIZE 65536");
command("INFO PONDERING 0");
command("INFO SHOW_DETAIL 3");
command("INFO STRENGTH 100");
command("INFO TIMEOUT_TURN 500");
command("INFO TIMEOUT_MATCH 100000000");
command("INFO TIME_LEFT 100000000");
async function search(black, white) {
  info = {};
  const m = [];
  for (let j = 0; j < black.length; j++) {
    m.push(`${black[j] % 15},${Math.floor(black[j] / 15)},1`);
    if (white[j] !== undefined)
      m.push(`${white[j] % 15},${Math.floor(white[j] / 15)},2`);
  }
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("Engine timeout")), 10000);
    resolveSearch = (r) => {
      clearTimeout(timer);
      resolve(r);
    };
    command("YXBOARD " + m.join(" ") + " DONE");
    command("YXNBEST 1");
  });
}
for (const id of ["five", "block", "outside", "overline"]) {
  const l = lessons.find((l) => l.id === id),
    r = await search(l.black, l.white);
  assert(l.answers.includes(r.i), `${id}: ${coord(r.i)}`);
  console.log(id, coord(r.i), JSON.stringify(r.info));
}
console.log(
  "ENGINE",
  banner.filter((s) => s.includes("Rapfi") || s.includes("version")).join("\n"),
);
console.log("Rapfi tactical smoke passed");
process.exit(0);
