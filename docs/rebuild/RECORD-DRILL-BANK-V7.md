# 実戦問題バンク v7

`dist/record-drill-bank.js` は棋譜から抽出済みの問題と、その問題での練習履歴だけを扱う純粋な保存・選択ヘルパー。localStorage、棋譜一覧、カリキュラム、通し対局の成績には書き込まない。入力を変更せず、新しい bank または問題のコピーを返す。

## 保存形式と検証

- `version: 7`, `questions`, `stats`, `analysisReceipts`, `activeId`, `recentIds`, `eventIds`, `sequence`。
- 問題は最大60件、bank 全体の JSON は UTF-8 で最大1,500,000バイト。件数・容量はオプションでさらに小さくできる。容量オプションの下限は1,024バイト。
- 原棋譜、exact prefix、225マスの盤面、出典ハッシュ、fingerprint、ID、integrity はコアの `verifyRecordDrill` で検証する。盤面の移動、回転、切り取り、石の追加は行わない。
- fingerprint および `source.recordHash + ply` で重複を除く。同局面では `own`、`import`、`library` の順を優先する。表示済みの履歴は出典の変更でリセットしない。
- activeId は現在の問題の内容を固定し、通常の件数・容量整理で最後まで保持する。単体でも指定容量に収まらない場合は問題を保持できず、activeId は null になる。
- 問題を失った履歴や解析済みキャッシュから先に容量を整理する。履歴は最大240局面、解析キャッシュは最大240件、イベントの重複防止キーは直近512件。これらは永久的な監査ログではない。
- integrity は破損検知用のチェックサムで、外部データの署名ではない。外から読み込んだ「問題オブジェクト」を信用せず、検証した原棋譜からワーカーで再抽出する。

## API

```js
createRecordDrillBank(rawOrJSONString?, { maxQuestions?, maxBytes?, activeId? }?)
mergeRecordDrills(bank, questions, { maxQuestions?, maxBytes?, activeId? }?)
pinRecordDrill(bank, questionIdOrNull, options?)
recordDrillBankBytes(bank)
getRecordDrillStats(bank, questionId)
```

壊れた JSON、別version、検証できない問題は採用しない。保存して再読込した正常なbankと、同じ問題を再度mergeした結果は変化しない。

```js
selectRecordDrill(bank, {
  excludeIds: [currentQuestionId],
  excludeFingerprints: [],
  excludeBoards: [currentReviewBoard],
  skillId: "order",
  patternId: "four-chase", // 任意。指定時は同じ型も必要
  sourceKind: "own",      // 任意。指定時は他の出典に切り替えない
  preferUnseen: true,
}) // question | null
normalizeRecordDrillSkill("four-chase") // "order"
```

現在の解説盤面と現在の問題の両方を除外する。盤面除外はコアのfingerprintを使用するため、向きや平行移動だけが違う同形も除く。ただし返す問題は原棋譜の盤面そのもの。未表示、直近に出していない問題、異なる棋譜、自己棋譜の順などで選び、条件に合う問題がなければnull。指定したskillやpatternを緩めたり、孤立した教材盤に置き換えたりしない。解答済み・表示済みだけを理由に問題を削除せず、明示的に再練習できる。

```js
noteDrillExposure(bank, questionId, { eventId: "attempt-1:open", at: Date.now() })
recordRecordDrillAttempt(bank, {
  questionId,
  eventId: "attempt-1:event-3",
  outcome: "success", // success | mistake | unknown | hint | retry
  at: Date.now(),
})
```

stats は `seen/completed/hints/mistakes/retries/attempts/unknown` を独立に保持する。`attempts` は確定したsuccessまたはmistakeの記録数で、通し対局数ではない。`unknown` はmistakesにもcompletedにも加算しない。露出と採点には異なるeventIdを使う。同じ問題・eventIdの再送は変化せず、リロード後の二重計上を防ぐ。eventId省略時は各呼出しを新しい出来事として数える。hintを別イベントで記録しているときは、successの`hinted`を重ねて渡さない。

```js
hasRecordDrillAnalysis(bank, { recordHash, analysisKey: "v7:min14:depth3:max4" })
noteRecordDrillAnalysis(bank, {
  recordHash,
  analysisKey: "v7:min14:depth3:max4",
  complete: true,
  questionCount: questions.length,
  sourceKind: "own",
  sourceId: record.id,
  at: Date.now(),
})
```

`recordHash` はコアの `recordSourceHash(record)` から得る。同じIDの棋譜が変更されても内容ハッシュが変わるので解析済みとは扱わない。解析条件が変わるときはanalysisKeyも変える。ワーカーが成功した後だけ `complete: true` を記録する。正常終了して0問だった場合は記録できるが、中断・失敗・未完了は記録できない。sourceIdは表示・追跡用で、キャッシュの同一性には使わない。

## 検証

`node --test tests/record-drill-bank-v7.test.mjs`

実際の収録棋譜から生成した問題で、完全な盤面・原棋譜の不変性、改変拒否、保存復元の冪等性、出典優先、件数とUTF-8容量、active固定、関連する別局面の選択、未判定の非誤答扱い、解析済みキャッシュの内容同一性を確認する。

## ローカルワーカーのコントローラー

`dist/record-drill-controller.js` の `RecordDrillController` が保存・読込・解析待ち行列・解答ワーカーをまとめる。DOMには触れない。

```js
const drills = new RecordDrillController({
  read, save, onChange, onAssist, onExpose,
  // テスト時だけ差し替える:
  // workerFactory: (channel /* "grade" | "extract" */) => worker,
  // fetchSeeds: (relativeURL) => Promise<seedJSON>,
});
await drills.initialize(records);
const next = drills.choose({ skillId, excludeIds, excludeBoards });
if (next) await drills.start(next); // ID指定も可能
await drills.command("grade", point);
await drills.command("hint");
await drills.command("answer");
await drills.command("retry");
await drills.command("hide-hints");
await drills.resume();
drills.syncRecords(records);
drills.pauseGeneration();
drills.resumeGeneration();
drills.dispose();
```

公開状態は `bank/question/state/view/replayFrames/busy/error/loading/seedsError/scan`。画面はコアの伏せ情報境界を通した `view` と `replayFrames` を使い、`question.moment` や `state.plan` を未回答画面に表示しない。`scan.state` は `idle/scanning/paused/error`、`done/total` は対象棋譜の解析手数、`queued` は待機棋譜数。

`initialize` は収録問題を取り込み、保存済み試行があれば検証して復元する。`resume` は保存試行をワーカーでイベント再生し、続いてhide-hintsを実行してから公開・再保存する。ヒントを閉じても利用履歴は残る。解説表示のためにanswer操作を自動実行することはない。

`record-drill-bank-v7` と `record-drill-attempt-v7` をread/saveへ渡す。試行の保存形式は `{version:7,questionId,sourceHash,state}`。保存失敗はerrorに残し、保存先のデータを削除しない。現在の試行のメトリクスを安定したeventIdで再照合するため、復元で露出・ヒント・成功を重複計上しない。answerはbankのhintsに援助1件として加え、コアのmetricsではanswersのまま保持する。

背景解析は完了・投了・途中保存した原棋譜を対象とし、`sourceLessonId` や途中盤面から始めた教材を除く。`recordOrigin === "import"` は取込棋譜、それ以外は自己棋譜として抽出する。条件は石数14以上、証明5手以上、最大4問、間隔6手。解析済みのキーは内容ハッシュと `v7-depth5`。収録seed読込で自己棋譜の解析済みマークを先に付けない。

背景解析と解答処理は別ワーカー。各要求の終端でワーカーを終了し、要求ID・版・出典を照合する。新しい問題の開始は古い解答要求を中断する。pauseGenerationは現在の棋譜を待ち行列に残して背景ワーカーだけを終了する。失敗・中断・差替え後の遅延応答は解析済みとして保存しない。失敗後の再試行は次の明示的なsyncRecordsで行う。タイマー、定期実行、自動再開、原棋譜の外部送信は実装しない。

コントローラーの検証: `node --test tests/record-drill-controller-v7.test.mjs`。実際のコアワーカーハンドラーと差替え可能なワーカーを使い、原棋譜の一致、勝ちまでの継続、ヒントを隠した復元、失敗・中断・遅延応答、棋譜ID再利用、保存破損と保存失敗を確認する。
