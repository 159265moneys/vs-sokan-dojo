import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { validateRecord, winner, winningMoves } from "../dist/game.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const sourceFile = path.join(root, "data/record-drill-source-games-v7.json");
const expertFile = path.join(root, "dist/expert-courses.json");
const outputFile = path.join(root, "dist/record-drill-seeds-v7.json");
const hash = (data) => crypto.createHash("sha256").update(data).digest("hex");
const readJSON = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJSON = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
};
export const extractionOptions = {
  sourceKind: "library",
  sourceLabel: "収録棋譜",
  minStones: 14,
  minProofPlies: 5,
  maxQuestions: 4,
  minPlyGap: 6,
  proofLimits: { maxPly: 9, maxNodes: 450, quietDepth: 2 },
};

export function validateSourceGame(record) {
  if (!record || record.rule !== "freestyle15" || record.startPly || record.setup || record.sourceLessonId ||
      ["lesson", "snapshot", "authored-snapshot", "problem"].includes(record.origin))
    throw Error("Only complete empty-board freestyle records are allowed");
  if (!record.id || !record.provenance || !record.moves.length)
    throw Error("Missing record provenance");
  const valid = validateRecord(structuredClone(record));
  if (!["win", "loss", "draw"].includes(valid.result) || valid.result !== record.result)
    throw Error(`${record.id}: the recorded result disagrees with the board`);
  if (record.moves.some((m, j) => typeof m === "object" && m.side !== undefined && m.side !== j % 2 + 1))
    throw Error(`${record.id}: inconsistent move colors`);
  return valid;
}

export function loadSourceRecords() {
  const expert = readJSON(expertFile);
  const supplemental = fs.existsSync(sourceFile) ? readJSON(sourceFile) : { games: [] };
  const records = expert.courses.map((course) => ({
    id: course.id,
    rule: expert.rule,
    level: "max",
    result: course.result,
    moves: course.moves.map((m) => m.i),
    provenance: {
      kind: "recorded-engine-match",
      source: "dist/expert-courses.json",
      sourceId: course.id,
      engine: expert.engine.name,
      engineVersion: expert.engine.version,
      engineSha256: expert.engine.sha256,
      independentSides: expert.engine.independentSides,
      black: { strength: expert.engine.strength, ms: course.blackMs },
      white: { strength: expert.engine.strength, ms: course.whiteMs },
      openingKind: course.openingKind,
      forcedOpening: course.forcedOpening,
    },
  })).concat((supplemental.games || []).map((game) => ({
    id: game.id,
    rule: game.rule,
    level: "strong",
    result: game.result,
    moves: game.moves.map((m) => m.i),
    provenance: {
      kind: "recorded-engine-match",
      source: "data/record-drill-source-games-v7.json",
      sourceId: game.id,
      engine: supplemental.engine.name,
      engineVersion: supplemental.engine.version,
      engineSha256: supplemental.engine.sha256,
      independentSides: true,
      black: game.black,
      white: game.white,
      openingKind: "natural",
      forcedOpening: null,
    },
  })));
  const ids = new Set();
  for (const record of records) {
    validateSourceGame(record);
    if (ids.has(record.id)) throw Error("Duplicate record id");
    ids.add(record.id);
  }
  return records;
}

function summarizeQuestion(q) {
  const m = q.moment;
  return {
    id: q.id,
    recordId: q.source.recordId,
    result: q.source.result,
    ply: q.ply,
    stones: q.before.filter(Boolean).length,
    kind: m.kind,
    role: m.evidence?.attacker === 2 ? "defense" : "win",
    skillId: m.skillId,
    patternType: m.patternType,
    scope: m.scope,
    proofPlies: q.proofPlies,
    evidencePlies: m.evidence?.plies || m.evidence?.line?.length || 0,
    immediateBlackWins: winningMoves(Uint8Array.from(q.before), 1).length,
    immediateWhiteWins: winningMoves(Uint8Array.from(q.before), 2).length,
  };
}

export async function buildSeedBank({ onProgress = () => {} } = {}) {
  const { extractRecordDrills } = await import("../dist/record-drills.js");
  const records = loadSourceRecords(), questions = [], audits = [];
  for (const record of records) {
    const selected = await extractRecordDrills(record, {
      ...extractionOptions,
      sourceId: record.id,
      seenFingerprints: questions.map((q) => q.fingerprint),
    });
    questions.push(...selected);
    audits.push({ recordId: record.id, result: record.result, plies: record.moves.length,
      selected: selected.length, coverage: selected.coverage });
    onProgress(audits.at(-1));
  }
  return {
    version: 7,
    kind: "recorded-game-drills",
    sourceLabel: "収録棋譜",
    inputs: [expertFile, sourceFile].filter((p) => fs.existsSync(p)).map((file) => ({
      path: path.relative(root, file), sha256: hash(fs.readFileSync(file)),
    })),
    extraction: extractionOptions,
    records: records.filter((r) => questions.some((q) => q.source.recordId === r.id)),
    questions,
    audit: { records: audits, questions: questions.map(summarizeQuestion) },
  };
}

async function loadEngine() {
  const dir = path.join(root, "dist/engine"), file = path.join(dir, "rapfi-single-simd128.js");
  const mod = new Module(file);
  mod.filename = file;
  mod._compile(fs.readFileSync(file, "utf8"), file);
  const data = Buffer.concat([0, 1, 2].map((i) => fs.readFileSync(path.join(dir, `weights-${i}.bin`))));
  let resolveSearch = null, info = {};
  const instance = await mod.exports({
    wasmBinary: fs.readFileSync(path.join(dir, "rapfi-single-simd128.wasm")),
    getPreloadedPackage: () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    onReceiveStdout: (line) => {
      if (line.startsWith("INFO ")) {
        const [, key, ...value] = line.split(" ");
        info[key] = value.join(" ");
      } else if (/^\d+,\d+$/.test(line)) {
        const [x, y] = line.split(",").map(Number), resolve = resolveSearch;
        resolveSearch = null;
        resolve?.({ i: y * 15 + x, info: { ...info } });
      } else if (line.startsWith("ERROR")) throw Error(line);
    },
    onReceiveStderr: (line) => console.error(line),
  });
  const command = (s) => instance.sendCommand(s);
  for (const c of ["ABOUT", "START 15", "INFO RULE 0", "INFO THREAD_NUM 1", "INFO HASH_SIZE 65536",
    "INFO PONDERING 0", "INFO SHOW_DETAIL 3", "INFO MAX_DEPTH 100", "INFO MAX_NODE 0",
    "INFO TIMEOUT_MATCH 100000000", "INFO TIME_LEFT 100000000"]) command(c);
  return { search: (moves, { ms, strength }) => {
    info = {};
    const side = moves.length % 2 + 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("Engine search timed out")), ms + 30000);
      resolveSearch = (r) => { clearTimeout(timer); resolve(r); };
      command("INFO STRENGTH " + strength);
      command("INFO TIMEOUT_TURN " + ms);
      command("YXBOARD " + moves.map((m, j) => `${m.i % 15},${Math.floor(m.i / 15)},${j % 2 + 1 === side ? 1 : 2}`).join(" ") + " DONE");
      command("YXNBEST 1");
    });
  } };
}

// This opt-in command plays new, nondeterministic engine matches. Ordinary builds
// and --check only replay the checked-in frozen records and never run an engine.
export async function recordNewGames(count = 3, { blackStrength } = {}) {
  const existing = fs.existsSync(sourceFile) ? readJSON(sourceFile) : null;
  const document = existing || {
    version: 7,
    rule: "freestyle15",
    engine: { name: "Rapfi", version: "0.43.01", platform: "Wasm SIMD / single thread / Node.js generation",
      sha256: hash(fs.readFileSync(path.join(root, "dist/engine/rapfi-single-simd128.wasm"))),
      source: "dist/engine/SOURCE.txt", threads: 1, hashKiB: 65536, independentSides: true },
    games: [],
  };
  for (let gameIndex = 0; gameIndex < count; gameIndex++) {
    const n = document.games.length;
    const black = { strength: blackStrength ?? [35, 55, 75, 5, 15][n % 5], ms: 100 };
    const white = { strength: 100, ms: 500 };
    const game = { id: `cpu-recorded-v7-${n + 1}`, rule: "freestyle15", openingKind: "natural",
      recordedAt: new Date().toISOString(), black, white, moves: [], result: null };
    const blackEngine = await loadEngine(), whiteEngine = await loadEngine(), board = new Uint8Array(225);
    for (let j = 0; j < 225; j++) {
      const side = j % 2 + 1, setting = side === 1 ? black : white, started = Date.now();
      const move = await (side === 1 ? blackEngine : whiteEngine).search(game.moves, setting);
      if (!Number.isInteger(move.i) || move.i < 0 || move.i >= 225 || board[move.i] || winner(board))
        throw Error("Engine returned an illegal move");
      game.moves.push({ i: move.i, side, searchMs: setting.ms, elapsedMs: Date.now() - started, info: move.info });
      board[move.i] = side;
      if (winner(board) || j === 224) {
        game.result = winner(board) === 1 ? "win" : winner(board) === 2 ? "loss" : "draw";
        break;
      }
    }
    validateSourceGame({ ...game, provenance: { kind: "recorded-engine-match" } });
    document.games.push(game);
    writeJSON(sourceFile, document);
    console.log(JSON.stringify({ recorded: game.id, plies: game.moves.length, result: game.result, black, white }));
  }
  return document;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--record-games")) {
    const raw = args[args.indexOf("--record-games") + 1], count = raw ? Number(raw) : 3;
    if (!Number.isInteger(count) || count < 1 || count > 5) throw Error("--record-games needs a count from 1 to 5");
    const strengthIndex = args.indexOf("--black-strength");
    const blackStrength = strengthIndex >= 0 ? Number(args[strengthIndex + 1]) : undefined;
    if (blackStrength !== undefined && (!Number.isInteger(blackStrength) || blackStrength < 1 || blackStrength > 100))
      throw Error("--black-strength needs an integer from 1 to 100");
    await recordNewGames(count, { blackStrength });
    return;
  }
  const bank = await buildSeedBank({ onProgress: (r) => console.log(`${r.recordId}: ${r.plies} plies, ${r.result}, ${r.selected} selected`) });
  const json = JSON.stringify(bank, null, 2) + "\n";
  if (args.includes("--check")) {
    if (!fs.existsSync(outputFile) || fs.readFileSync(outputFile, "utf8") !== json)
      throw Error("Recorded drill seed bank is stale; run node scripts/build-record-drill-seeds-v7.mjs");
    console.log(`Verified ${bank.records.length} frozen games and ${bank.questions.length} full-board questions.`);
  } else {
    fs.writeFileSync(outputFile, json);
    console.log(`Built ${bank.records.length} frozen games and ${bank.questions.length} full-board questions.`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
