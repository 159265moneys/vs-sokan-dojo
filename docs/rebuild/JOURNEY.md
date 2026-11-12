# 空盤から続ける課題対局

`dist/journey.js` は、人が黒の全着手を担当し、実CPUの白応手を受けて終局まで続ける純粋な状態機械。通常の対局タブと別に「学ぶ」で使う。固定の黒手順や正解座標列を持たず、合法な黒手をすべて受け入れる。棋譜が成立すること、局所目標に到達したこと、一局に勝ったこと、未補助で技能を習得したことを別々に記録する。

## 課題対局と分岐継続

| ID | 教える行為 | 局所目標 | 完了・到達の条件 |
| --- | --- | --- | --- |
| `build` | 自分で配置し、相手の遮断を受けて方向を変え、実際の脅威へつなぐ | 二方向の連結点／遮断後に残った方向を使用／三または四／応手を絞る四／五連 | 本人が終局まで指し、五つすべてを現在の手順で観測 |
| `defend` | 自分の即勝ち、白の即勝ち、白の次の二つの勝ち口を優先し、受けた後も続ける | 即勝ちの阻止／次の二つの勝ち口の阻止／受け石を含む三・四への再展開／終局 | 本人が終局まで指し、四つすべてを現在の手順で観測 |
| `practice` | 戦術の予告と自動コーチ表示なしで、一局を自分で指す | 五連／終局 | 未補助で黒の五連まで到達 |
| `branch` | 既知の配置から二方向を本人が作り、実際に塞がれた側から切り替えて勝ち切る | 方向転換／四／五連 | 途中局面から本人が最後まで指し、三つすべてを観測。空盤の一局と別記録 |

`goalMet` はこの課題内の条件。認定・未見転用・保持の証明ではない。二方向の連結だけで課題全体を合格にしない。発生しなかった目標は `not-observed` であり、成功にも失敗にも数えない。例えば白が一方向を遮断しなかった一局から、方向転換の技能は判断できない。`finish-game` は敗局でも活動完了として達成するので、棋力の成功には `winner`、`result`、`finish-five` を併せて見る。

`build` と `defend` は初めから事後フィードバックがある支援付き練習として `guided-journey` を残す。`branch` はさらに `known-lesson-position` を残す。`practice` は途中のコーチ評価・戦術ハイライトを `getJourneyView` で隠す。内部の証拠収集は続けるが、未補助のまま解答を先に見せない。復習の元局面からの開始は、代案に触れた可能性がある活動として `review-position` を残す。

## API とCPU接続

```js
let state = createJourney("build", {
  attemptId: "app-generated-unique-id",
  replyVariant: "natural", // natural / H7 / G7 / H6。0..3も受理。
});

state = playJourneyMove(state, blackPoint);
let view = getJourneyView(state);
if (view.needsReply) {
  const { teachingMove, openingMove, ms, strength } = view.replyConfig;
  const i = teachingMove ?? openingMove ?? (await engine.search(state.moves, { ms, strength })).i;
  state = applyJourneyReply(state, i);
}
```

`Engine.search` の結果の `.i` が着手インデックス。状態機械はCPU、ネットワーク、時刻、タイマー、保存領域を所有しない。白の探索待ちに同じ状態へ二重入力しない制御、探索結果が現局面のものかの照合、エラー表示、終了後の保存をapp側が担当する。

返り値は元の状態を書き換えない、新しい凍結済みのJSONデータ。

| API | 結果 |
| --- | --- |
| `journeyTracks` | `id/title/goal/unitIds/objectives/stages/white` の定義 |
| `createJourney(trackId, options)` | 初期状態。既定は空盤・黒番 |
| `playJourneyMove(state, i)` | 黒の合法着手。局所的な誤りでも対局は続く |
| `applyJourneyReply(state, i)` | 外部CPUが選んだ白の合法着手 |
| `getJourneyView(state)` | 盤、手順、短い状態、ステージ、目標、盤上強調、白設定 |
| `previewJourneyMove(state, i)` | 確定前の候補を仮置きした盤・局所比較。元状態と到達記録は不変 |
| `getJourneyResult(state)` | 下記の証拠データ。途中は `unfinished` |
| `markJourneyAssistance(state, kind)` | ヒント、参考棋譜、比較案などの閲覧記録 |
| `retryJourney(state, toPly?)` | 既定は最後に確認できた誤りの直前。誤りがなければ直前の黒番へ戻る |
| `restoreJourney(saved)` | 操作履歴を再実行して復元。盤・手順・評価・補助履歴の不一致を拒否 |

状態の `status` は `playing`（黒の入力）、`reply`（白の応手）、`completed`。`completed` になるのは実際の五連または満盤だけ。途中の到達、誤りの検出、勝ち筋の局所証明で入力を打ち切らない。

`getJourneyView` は `board/moves/last/status/turn/needsReply/completed/winner/title/goal/stage/objectives/instruction/feedback/highlights/canRetry/retryPly/assisted/replyConfig` を返す。`instruction:{title,text}` は次に実行する行為、`feedback` は実際の着手で変わった座標・方向・完成点を1〜2文で返す。

支援付き課題の案内は、黒石一個なら「一つつないで別方向の余地を残す」、二個から「二つの黒石へ異なる方向でつながる交点を比べる」、白の遮断後は「残る具体的な方向を使う」、守備後は「受けた石と既存の黒石から展開する」へ変わる。自分の即勝ち、白の即勝ち、白の次の二つの勝ち口があれば、配置の案内よりその優先判断を先に返す。

確定前の比較は `previewJourneyMove` の `board/last/move/title/text/highlights/facts/hypothetical/proofScope` を使う。候補を選び直して同じ盤で比較し、確定操作で初めて `playJourneyMove` を呼ぶ。プレビューはjournal、機会、誤り、達成を増やさず、保存元にも影響しない。二方向への連結は幾何の事実、白の完成点を残す候補はその具体的な点として説明し、未判定の静かな配置を悪手や必勝と認定しない。入力できない状態・占有点では `null` を返す。`practice` は `instruction:null`、プレビューも `null` にして案内を出さない。

白の既定設定は `build:700ms/strength65`、`defend:1500ms/85`、`practice:8000ms/100`。`options.white` で上書きでき、実際の設定を結果に残す。H7/G7/H6は空盤の白初手だけを変えた課題対局。指定点が黒の初手で埋まっていれば自然探索へ進む。実際に指定白初手が打たれたときだけ `openingOverride` と `white.kind:'seeded-opening'` を記録する。これを自然応手の最強CPU対局と同じ試験として扱わない。

### 分岐継続の開始と白の介入

`createJourney('branch', { attemptId, replyVariant: 'E8' })` は、既知課題 `two-direction-fork` の黒F8/G8/H6/H7・白B3/D4/K12/M13を、合法交互履歴 `F8 B3 G8 D4 H6 K12 H7 M13` で開始する。黒の最初の選択を本人が担当し、完成した二方向の三を初期盤として渡さない。`startPly:8`、`origin:'position'`、`fromOpening:false`、`assisted:true`、`sourceProblemId:'two-direction-fork'` を保持する。

`replyVariant` は `E8/H9/I8/H5`（数値0〜3も同順）で、既定はE8。最初の黒着手後に、異なる二方向の実在する活三・飛び三があり、指定白点が一方の両端四への伸びをすべて止め、もう一方向の三→四が残る場合だけ `replyConfig.teachingMove` を返す。黒が別案を選び条件を満たさなければ `null` で、自然CPU応手へ進む。占有点にも打たない。白設定は700ms/strength65で、この一手以降の白はCPUが担当する。

実際に条件を満たした白応手を適用した場合、`branchOverride:{move,ply,variant,blockedAxes,remainingAxes,scope}` を残し、`white.kind:'teaching-branch'` とする。axisは0=横、1=縦、2/3=二つの斜め、scopeは `blocked-open-three-then-other-four`。例えばH8→E8では横が止まり、黒H5/H9で縦の四を本人が作ったときに切替を達成する。そこで終えず、CPUの受け後に本人が五連まで指す。

標準進行の集計では、空盤buildの構築・三四・四・五連と、そこで未観測だった切替の補充を別の記録として扱う。分岐継続は、横を止める応手E8/I8と縦を止める応手H5/H9のそれぞれについて、実際の `blockedAxes` と `switch-direction/force-four/finish-five` の完走を確認できる。片方しか経験していない状態を両方向の完了にしない。独立試験や空盤での達成に換算しない。

## 観測と証明の範囲

| 目標 | 毎手確認する事実 | 主張しないこと |
| --- | --- | --- |
| `two-directions` | 今置いた黒石を含み、別々の方向に既存黒石があり、白のない五路の線分が残る | 二石の配置が必勝、あるいは最善という評価 |
| `switch-direction` | 白で幾何学的な一方向が消えた後に別方向へ延ばす、または活三・飛び三の両端四化が止まった後に別方向の実在する三を四にする | その方向が唯一の正解。別の静かな案は `unknown`。任意の白の近接や、片方だけの伸びの減少を方向の消滅にしない |
| `build-threat` | 置いた黒石を含む、外側の空点条件を満たす三または実際の四がある。単元は `conditions` | 形があるだけで強制勝ち、または静かな準備 `prepare` を遂行したという評価 |
| `force-four` | 黒の五連完成点が存在し、白の即勝ち点はない | 白の受けが反撃にならないこと。その後も本人が読む |
| `take-win` | 黒に現在の五連完成点があり、その一手で勝った | 見逃しがそのまま強制敗北を意味すること |
| `stop-five` | 黒の即勝ちがなく、白の即勝ちを消した | 元から二つ以上ある勝ち口を受けきれない手への重複した非難 |
| `prevent-fork` | 白が次の一手で二つ以上の完成点を作り、黒に即勝ちがない局所反証を消した | 探索していない長いVCTや一般中盤の評価 |
| `recover-after-defense` | 守った手より後の本人の着手で、その守った石を含む三・四を作った | 受け一手だけで立て直し技能を達成したこと |
| `finish-five` | 実際の黒五連 | 最強CPUへの安定勝利 |

危険な一手の記録は即勝ちの見逃し、単一の即勝ちを放置、代わりに安全な一手が実在するのに白の次の二つの勝ち口を許した場合に限る。最後のケースは `白の交点→黒が一方を塞ぐ→白が他方で五連` の合法な局所反証を持つ。安全な代案を限定候補から確認できなければ `unknown` とし、負けや悪手へ変換しない。

方向転換の二つの証拠はscopeで区別する。二方向の連結幾何を守って延ばした場合は `connection-geometry-only`。実際の活三・飛び三の両端四化が消え、別方向の三から四を作った場合は `blocked-open-three-then-other-four`。後者では、残った方向が閉じた三でも、実際に一つの完成点を持つ四へ進めるなら記録できる。その四を両端四や必勝と呼び替えない。静かな準備の証拠はこの単なる形判定から生成せず、別の証明付きレビューへ委ねる。

実際のCPUがその反撃を選んだ場合は `actual-counter` と実着手を返し、現在の盤上に根拠を示す。反証手順の黒の受けや白の勝ちを自動で打たず、人間とCPUが担当する。CPUが別案を選べば、その実際の局面をそのまま続ける。

## 自戦からの継続

```js
const initialMoves = record.moves.slice(0, review.ply - 1);
let recovery = createJourney("defend", {
  attemptId: recoveryId,
  initialMoves,
  sourceReview: review,
});
```

`sourceReview.before` と手順から再現した盤の完全一致、黒番、交互合法履歴、途中に終局がないことを検証する。盤だけから便宜的な手順をでっち上げない。改善一手も固定せず、元の棋譜・レビューを書き換えずに別試行で続ける。

結果は `origin:'review'`、元の手数 `startPly`、`fromOpening:false`、`sourceReview` を持つ。レビューなしの途中局面は `origin:'position'`。空盤の一局の戦績と混ぜない。元の指摘を他の未見局面や次の自然対局で実行したかは、別の学習台帳・未見評価モジュールが担当する。

## 証拠と再試行

結果の主な項目は `id/attemptId/trackId/origin/startPly/fromOpening/sourceReview/sourceProblemId/moves/replyVariant/openingOverride/branchOverride/white/result/winner/completed/assisted/retries/assistance/achievedObjectives/objectives/opportunities/mistakes/goalEvents/goalMet/proofScope`。

`opportunities` は `objectiveId/unitId/ply/branch/kind/outcome/success/evidence/retracted`。`outcome` は `achieved`、`missed`、`unknown`、`success` はそれぞれ `true/false/null`。発生自体がないときは機会を捏造しない。目標一覧に `not-observed` が残る。`goalEvents` は同じ機会の互換用別名。

再試行では戻した後の機会を `retracted:true` とし、現在の到達数から除外する。元の誤り・補助・再試行回数は消さない。残った盤の連結・守備後の文脈を引き継ぎ、同じ判断点を練習できる。保存復元は操作履歴から同じ証拠を再計算するため、復元で未補助に戻らない。

モデル棋譜の序盤や中盤は比較参考としてapp側で表示できるが、その閲覧は `markJourneyAssistance(state, 'model-reference')` で記録する。モデルの手順一致をこの状態機械の採点条件や独立習得の証拠にしない。

## 検証と残る範囲

`node --test tests/journey.test.mjs` で、空盤から異なる合法入力、実応手と継続、遮断方向による判断変更、三・四から本人の五連、攻守の優先、受け後の再展開、実反撃、局面開始の分離、元棋譜不変、再試行保持、保存復元の破損拒否、未観測・未知と失敗の区別を確認する。CPU統合と画面操作の確認はapp担当の統合検証で行う。

この追加はF1/F5/F6/F7に対して、本人が配置から局所目標と終局をつなぐ工程を追加する。一般中盤の最善手評価、全戦術の検出、どのCPU応手でも各目標が必ず発生する出題保証はない。単元ごとの学習効果、転用、保持、児童生徒の最強CPU安定勝利を実測したことにもならない。静かな案が未判定のまま続くことは意図した境界である。
