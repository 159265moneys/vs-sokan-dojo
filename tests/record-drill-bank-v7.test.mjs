import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { extractRecordDrills, recordSourceHash, verifyRecordDrill } from "../dist/record-drills.js";
import {
  createRecordDrillBank, mergeRecordDrills, selectRecordDrill, pinRecordDrill,
  noteDrillExposure, recordRecordDrillAttempt, getRecordDrillStats,
  noteRecordDrillAnalysis, hasRecordDrillAnalysis, recordDrillBankBytes,
  normalizeRecordDrillSkill, RECORD_DRILL_BANK_MAX_QUESTIONS, RECORD_DRILL_BANK_MAX_BYTES,
} from "../dist/record-drill-bank.js";

const fixture = JSON.parse(fs.readFileSync(new URL("../dist/record-drill-seeds-v7.json", import.meta.url), "utf8"));
const questions = fixture.questions;
const clone = (value) => JSON.parse(JSON.stringify(value));
function frozen(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(frozen); Object.freeze(value); }
  return value;
}
const bankWithSeeds = () => mergeRecordDrills(createRecordDrillBank(), questions);

test("bank retains complete exact source positions without mutating records or seed data", () => {
  const original = clone(fixture);
  const bank = mergeRecordDrills(frozen(createRecordDrillBank()), frozen(clone(questions)));
  assert.equal(bank.questions.length, questions.length);
  for (const q of bank.questions) {
    assert(verifyRecordDrill(q));
    assert.deepEqual(q, questions.find((item) => item.id === q.id));
    assert.equal(q.before.length, 225);
    assert.equal(q.prefix.length, q.ply - 1);
  }
  assert.deepEqual(fixture, original);
  const selected = selectRecordDrill(bank);
  selected.before.fill(0);
  assert(bank.questions.every((q) => verifyRecordDrill(q)));
});

test("restore rejects changed version, source prefix, board, fingerprint, and invalid questions", () => {
  const variants = [
    (q) => { q.version = 6; }, (q) => { q.prefix[0] = 0; },
    (q) => { q.before[0] = 1; }, (q) => { q.source.moves[0] = 0; },
    (q) => { q.source.recordHash = "0000000000000000"; },
    (q) => { q.fingerprint = "board:fake"; },
  ].map((change) => { const q = clone(questions[0]); change(q); return q; });
  assert.equal(mergeRecordDrills(createRecordDrillBank(), [...variants, null, {}, questions[0]]).questions.length, 1);
  assert.deepEqual(createRecordDrillBank("broken json"), createRecordDrillBank());
  assert.deepEqual(createRecordDrillBank({ ...bankWithSeeds(), version: 6 }), createRecordDrillBank());
});

test("round trips and repeated merges are idempotent, including independent practice history", () => {
  let bank = bankWithSeeds();
  const q = questions[0];
  bank = noteDrillExposure(bank, q.id, { eventId: "show-1", at: 10 });
  bank = recordRecordDrillAttempt(bank, { questionId: q.id, eventId: "win-1", outcome: "success", at: 20 });
  bank = pinRecordDrill(bank, q.id);
  const serialized = JSON.stringify(bank);
  assert.equal(JSON.stringify(createRecordDrillBank(serialized)), serialized);
  assert.deepEqual(mergeRecordDrills(bank, questions), bank);
  assert.deepEqual(noteDrillExposure(bank, q.id, { eventId: "show-1", at: 999 }), bank);
  assert.deepEqual(recordRecordDrillAttempt(bank, { questionId: q.id, eventId: "win-1", outcome: "success" }), bank);
});

test("duplicate provenance prefers own/import over library and retains revealed-position history", async () => {
  const source = fixture.records.find((record) => record.id === questions[0].source.recordId);
  const own = await extractRecordDrills(source, { sourceKind: "own", sourceLabel: "自分の実戦", sourceId: "local-1" });
  const imported = await extractRecordDrills(source, { sourceKind: "import", sourceLabel: "取込棋譜", sourceId: "import-1" });
  assert(own.length && imported.length);
  const q = own.find((item) => item.fingerprint === questions[0].fingerprint);
  assert(q);
  let bank = noteDrillExposure(bankWithSeeds(), q.id, { eventId: "revealed", at: 10 });
  bank = mergeRecordDrills(bank, imported);
  assert.equal(bank.questions.find((item) => item.id === q.id).source.kind, "import");
  bank = mergeRecordDrills(bank, own);
  assert.equal(bank.questions.find((item) => item.id === q.id).source.kind, "own");
  assert.equal(bank.questions.filter((item) => item.fingerprint === q.fingerprint).length, 1);
  assert.equal(getRecordDrillStats(bank, q.id).seen, 1);
  assert.deepEqual(bank.questions.find((item) => item.id === q.id).before, questions[0].before);
  const pinned = pinRecordDrill(bankWithSeeds(), q.id);
  assert.deepEqual(mergeRecordDrills(pinned, own).questions.find((item) => item.id === q.id), questions[0]);
});

test("question count and UTF-8 byte budgets evict derived caches while pinning the active question", () => {
  const sourceBefore = JSON.stringify(fixture.records);
  const active = questions[0];
  let bank = pinRecordDrill(bankWithSeeds(), active.id);
  bank = mergeRecordDrills(bank, questions, { maxQuestions: 2 });
  assert.equal(bank.questions.length, 2);
  assert(bank.questions.some((q) => q.id === active.id));
  bank = mergeRecordDrills(bankWithSeeds(), [], { activeId: active.id, maxBytes: 5000 });
  assert(recordDrillBankBytes(bank) <= 5000);
  assert(bank.questions.some((q) => q.id === active.id));
  assert.equal(recordDrillBankBytes(bank), Buffer.byteLength(JSON.stringify(bank), "utf8"));
  assert.equal(RECORD_DRILL_BANK_MAX_QUESTIONS, 60);
  assert.equal(RECORD_DRILL_BANK_MAX_BYTES, 1_500_000);
  const tiny = mergeRecordDrills(bankWithSeeds(), [], { activeId: active.id, maxBytes: 1024 });
  assert(recordDrillBankBytes(tiny) <= 1024);
  assert.equal(tiny.activeId, null);
  assert.equal(JSON.stringify(fixture.records), sourceBefore);
});

test("related practice excludes both revealed boards and current question, with no lesson fallback", () => {
  const bank = bankWithSeeds();
  const sameSkill = questions.filter((q) => q.moment.skillId === "order");
  assert(sameSkill.length >= 3);
  const next = selectRecordDrill(bank, { skillId: "order", excludeIds: [sameSkill[0].id], excludeBoards: [sameSkill[1].before] });
  assert(next && next.id !== sameSkill[0].id && next.id !== sameSkill[1].id);
  assert.equal(next.moment.skillId, "order");
  assert.equal(selectRecordDrill(bank, { skillId: "order", excludeFingerprints: sameSkill.map((q) => q.fingerprint) }), null);
  assert.equal(selectRecordDrill(bank, { skillId: "no-such-skill" }), null);
  assert.equal(selectRecordDrill(bank, { sourceKind: "own" }), null);
  const related = selectRecordDrill(bank, { skillId: "order", patternId: "vcf" });
  assert.equal(related.moment.patternType, "four-chase");
  assert.equal(related.moment.skillId, "order");
  assert.equal(normalizeRecordDrillSkill(" four-chase "), "order");
  const only = mergeRecordDrills(createRecordDrillBank(), [sameSkill[0]]);
  assert.equal(selectRecordDrill(only, { excludeBoards: [sameSkill[0].before] }), null);
});

test("selection prefers unseen positions but completed full boards remain usable", () => {
  let bank = bankWithSeeds();
  const first = selectRecordDrill(bank);
  bank = noteDrillExposure(bank, first.id, { eventId: "show", at: 1 });
  assert.notEqual(selectRecordDrill(bank).id, first.id);
  let only = mergeRecordDrills(createRecordDrillBank(), [first]);
  only = recordRecordDrillAttempt(only, { questionId: first.id, eventId: "complete", outcome: "success" });
  assert.equal(selectRecordDrill(only).id, first.id);
});

test("mistakes, hints, retries, success and unknown stay separate from curriculum/full-game completion", () => {
  const q = questions[0];
  let bank = bankWithSeeds();
  for (const outcome of ["hint", "mistake", "retry", "unknown", "success"])
    bank = recordRecordDrillAttempt(bank, { questionId: q.id, eventId: outcome, outcome, at: 10 });
  const stat = getRecordDrillStats(bank, q.id);
  assert.deepEqual([stat.hints, stat.mistakes, stat.retries, stat.unknown, stat.completed, stat.attempts], [1, 1, 1, 1, 1, 2]);
  const prior = clone(bank);
  bank = recordRecordDrillAttempt(bank, { questionId: q.id, eventId: "unknown-again", outcome: "unknown" });
  assert.equal(bank.stats[q.id].mistakes, prior.stats[q.id].mistakes);
  assert.equal(bank.stats[q.id].completed, prior.stats[q.id].completed);
  assert(!("curriculum" in bank) && !("qualification" in bank) && !("fullGames" in bank));
  assert.deepEqual(recordRecordDrillAttempt(bank, { questionId: q.id, outcome: "not-proven" }), bank);
});

test("only completed analysis is cached, with content hash and analysis configuration as identity", () => {
  const record = fixture.records[0], recordHash = recordSourceHash(record);
  const receipt = { recordHash, analysisKey: "v7:min14:proof3", questionCount: 0, sourceId: record.id, at: 1 };
  let bank = noteRecordDrillAnalysis(createRecordDrillBank(), receipt);
  assert(!hasRecordDrillAnalysis(bank, receipt));
  bank = noteRecordDrillAnalysis(bank, { ...receipt, complete: false });
  assert(!hasRecordDrillAnalysis(bank, receipt));
  bank = noteRecordDrillAnalysis(bank, { ...receipt, complete: true });
  assert(hasRecordDrillAnalysis(bank, receipt));
  assert(!hasRecordDrillAnalysis(bank, { recordHash, analysisKey: "v7:min20:proof5" }));
  const changed = { ...fixture.records[1], id: record.id };
  assert.notEqual(recordSourceHash(changed), recordHash);
  assert(!hasRecordDrillAnalysis(bank, { ...receipt, recordHash: recordSourceHash(changed) }));
  assert.deepEqual(noteRecordDrillAnalysis(bank, { ...receipt, complete: true }), bank);
  assert.deepEqual(createRecordDrillBank(JSON.stringify(bank)), bank);
});

test("receipt and event histories cannot grow the derived cache beyond its bounds", () => {
  let bank = mergeRecordDrills(createRecordDrillBank(), [questions[0]]);
  const raw = clone(bank);
  raw.eventIds = Array.from({ length: 2000 }, (_, i) => `event-${i}`);
  raw.analysisReceipts = Object.fromEntries(Array.from({ length: 500 }, (_, i) => {
    const receipt = { recordHash: i.toString(16).padStart(16, "0"), analysisKey: "default", complete: true,
      questionCount: 0, sourceKind: null, sourceId: null, at: i, updated: i };
    return [JSON.stringify([receipt.recordHash, receipt.analysisKey]), receipt];
  }));
  bank = createRecordDrillBank(raw);
  assert.equal(bank.eventIds.length, 512);
  assert.equal(Object.keys(bank.analysisReceipts).length, 240);
  assert(recordDrillBankBytes(bank) <= RECORD_DRILL_BANK_MAX_BYTES);
  assert.equal(bank.questions.length, 1);
});
