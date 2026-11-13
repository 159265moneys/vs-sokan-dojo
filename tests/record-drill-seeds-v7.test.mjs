import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { boardFrom, winner, winningLine, winningMoves, validateRecord } from "../dist/game.js";
import { verifyRecordDrill, startRecordDrill, getRecordDrillView } from "../dist/record-drills.js";
import { buildSeedBank, loadSourceRecords, validateSourceGame } from "../scripts/build-record-drill-seeds-v7.mjs";

const root = new URL("../", import.meta.url);
const read = (name) => JSON.parse(fs.readFileSync(new URL(name, root), "utf8"));
const bank = read("dist/record-drill-seeds-v7.json");
const expert = read("dist/expert-courses.json");
const supplemental = read("data/record-drill-source-games-v7.json");

test("recorded sources are complete actual engine games with exact settings and legal moves", () => {
  assert.equal(bank.version, 7);
  assert.equal(bank.sourceLabel, "収録棋譜");
  const allRecords = loadSourceRecords();
  assert.deepEqual(bank.records, allRecords.filter((r) => bank.questions.some((q) => q.source.recordId === r.id)));
  assert.equal(allRecords.length, expert.courses.length + supplemental.games.length);
  for (const input of bank.inputs) {
    assert(["dist/expert-courses.json", "data/record-drill-source-games-v7.json"].includes(input.path));
    assert.equal(input.sha256, crypto.createHash("sha256").update(fs.readFileSync(new URL(input.path, root))).digest("hex"));
  }
  const engineHash = crypto.createHash("sha256").update(fs.readFileSync(new URL("dist/engine/rapfi-single-simd128.wasm", root))).digest("hex");
  assert.equal(supplemental.engine.sha256, engineHash);
  assert(supplemental.engine.independentSides);
  for (const record of allRecords) {
    const valid = validateSourceGame(record);
    assert.equal(valid.result, record.result);
    assert.equal(record.provenance.engineSha256, engineHash);
    assert.equal(record.provenance.kind, "recorded-engine-match");
    assert(record.provenance.independentSides);
    assert.equal(record.startPly, undefined);
    const course = expert.courses.find((c) => c.id === record.id);
    if (course) {
      assert.deepEqual(record.moves, course.moves.map((m) => m.i));
      assert.equal(record.provenance.black.ms, course.blackMs);
      assert.equal(record.provenance.white.ms, 8000);
      assert.deepEqual(record.provenance.forcedOpening, course.forcedOpening);
    } else {
      const game = supplemental.games.find((g) => g.id === record.id);
      assert(game);
      assert.deepEqual(record.moves, game.moves.map((m) => m.i));
      assert.equal(game.openingKind, "natural");
      assert.equal(record.provenance.forcedOpening, null);
      assert.deepEqual(record.provenance.black, game.black);
      assert.deepEqual(record.provenance.white, game.white);
      assert.notEqual(record.level, "max", "500 ms white is not the app's 8 s maximum");
      game.moves.forEach((move, index) => {
        assert.equal(move.side, index % 2 + 1);
        assert.equal(move.searchMs, move.side === 1 ? game.black.ms : game.white.ms);
        assert(Number.isInteger(move.elapsedMs) && move.elapsedMs >= 0);
        assert(move.info && typeof move.info === "object");
        assert.equal(move.forced, undefined);
      });
    }
  }
});

test("every bundled question retains every original stone and starts before an immediate finish or forced block", () => {
  assert(bank.questions.length >= 3);
  const fingerprints = new Set(), ids = new Set();
  for (const q of bank.questions) {
    const record = bank.records.find((r) => r.id === q.source.recordId);
    assert(record);
    assert(verifyRecordDrill(q, record));
    assert(!fingerprints.has(q.fingerprint), "rotated or shifted copies are not independent questions");
    assert(!ids.has(q.id));
    fingerprints.add(q.fingerprint); ids.add(q.id);
    assert.equal(q.source.kind, "library");
    assert.equal(q.source.label, "収録棋譜");
    assert.equal(q.source.result, record.result);
    assert.deepEqual(q.source.moves, record.moves);
    assert.deepEqual(q.prefix, record.moves.slice(0, q.ply - 1));
    assert.deepEqual(q.before, Array.from(boardFrom(q.prefix)));
    assert.equal(q.before.filter(Boolean).length, q.ply - 1);
    assert(q.ply >= 15 && q.ply % 2 === 1);
    assert(q.proofPlies >= 5);
    assert.equal(winner(q.before), 0);
    assert.deepEqual(winningMoves(Uint8Array.from(q.before), 1), []);
    assert.deepEqual(winningMoves(Uint8Array.from(q.before), 2), []);
    assert(!["miss-win", "miss-block"].includes(q.moment.kind));
    assert.equal(q.moment.actual, record.moves[q.ply - 1]);
    const view = getRecordDrillView(q, startRecordDrill(q, { attemptId: "seed-audit" }));
    assert.equal(view.source.label, "収録棋譜");
    assert.equal(view.source.kind, "library");
    assert.equal(view.source.result, undefined, "the source result is not an answer hint before the attempt");
    assert.equal(view.alternatives, undefined);
    assert.equal(view.proof, undefined);
  }
  assert(bank.questions.some((q) => q.proofPlies >= 7));
});

test("the seed bank includes full-board loss decisions with independently replayable white attacks", () => {
  const defenses = bank.questions.filter((q) => q.moment.evidence?.attacker === 2);
  assert(defenses.length >= 2, "recorded losses must not disappear behind winning-only examples");
  assert(bank.questions.filter((q) => q.moment.scope === "forced-win").length >= 3);
  for (const q of defenses) {
    assert.equal(q.source.result, "loss");
    assert.equal(q.moment.scope, "line-prevented", "a prevented line is not a certified saved game");
    const b = Uint8Array.from(q.before), evidence = q.moment.evidence;
    assert.equal(evidence.status, "proven");
    assert.equal(evidence.scope, "continuous-four");
    b[q.moment.actual] = 1;
    evidence.line.forEach((point, j) => {
      assert.equal(winner(b), 0);
      assert.equal(b[point], 0);
      if (j % 2 === 1) assert(winningMoves(b, 2).includes(point), "black is responding to a real white four");
      b[point] = j % 2 ? 1 : 2;
      if (j % 2 === 0 && j < evidence.line.length - 1) {
        assert(winningMoves(b, 2).length > 0);
        assert.equal(winningMoves(b, 1).length, 0, "black cannot win before the certified attack finishes");
      }
    });
    assert.equal(winner(b), 2);
    assert(winningLine(b, evidence.line.at(-1)).length >= 5);
  }
});

test("source validation rejects made-up setup records, wrong outcomes and terminal continuations", () => {
  const record = structuredClone(bank.records[0]);
  assert.throws(() => validateSourceGame({ ...record, startPly: 14 }));
  assert.throws(() => validateSourceGame({ ...record, setup: true }));
  assert.throws(() => validateSourceGame({ ...record, origin: "authored-snapshot" }));
  assert.throws(() => validateSourceGame({ ...record, result: "loss" }));
  assert.throws(() => validateSourceGame({ ...record, moves: [...record.moves, record.moves[0]] }));
  const invalid = { ...record, moves: record.moves.map((i, index) => ({ i, side: index % 2 + 1 })) };
  invalid.moves[1].side = 1;
  assert.throws(() => validateSourceGame(invalid));
  const q = structuredClone(bank.questions[0]);
  q.before[q.prefix[0]] = 0;
  assert.equal(verifyRecordDrill(q, record), false, "removing even a non-tactical stone invalidates provenance");
});

test("frozen source replay deterministically regenerates the full seed bank", { timeout: 180000 }, async () => {
  assert.deepEqual(await buildSeedBank(), bank);
  for (const record of bank.records)
    assert.equal(validateRecord(structuredClone(record)).moves.length, record.moves.length);
});
