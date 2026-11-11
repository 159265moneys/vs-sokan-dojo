# 学習API

2026-11-11。実装済みの公開契約。curriculum.jsは教材、learning.jsは純粋な状態遷移・採点・進捗、controllerは表示・仮置き・再生カーソル・保存を担当する。収録範囲と検証はCONTENT.md。

## 共通型・教材

```ts
type Point = number; // 0..224。index=y*15+x。A15=0、H8=112、O1=224。
type Board = number[]; // 長さ225、0=空・1=黒・2=白。通常配列。
type Move = { i: Point; side: 1 | 2 };
type Highlight = {
  cells: Point[];  // 根拠となる置石。配列順に勝手な折れ線を結ばない。
  points: Point[]; // 空点・勝ち口・候補。
  tone: 'focus' | 'danger' | 'good';
};
type Frame = {
  board: Board;
  last: Point | null;
  title: string;
  text: string;
  highlights: Highlight[];
};
type Unit = {
  id: string; title: string; goal: string;
  problemIds: string[];
  lessonFrames: Frame[];
};
type Problem = {
  id: string; unitId: string; family: string;
  title: string; goal: string;
  kind: 'play' | 'choice' | 'compare';
  goalKind: 'win' | 'prevent-fork' | 'recognize-counter' | 'compare-plan';
  completion: 'five' | 'local-goal' | 'comparison';
  board: Board;
  sideToMove: 1;
  rootNodeId: string;
  nodes: DecisionNode[]; // 教材内部。controllerは直接読まない。
  judge: JudgeSpec;     // 別解・限定目標・未判定の扱い。
  evidence: { source: 'original' | 'record' | 'licensed';
              sourceId: string | null; scope: string; verification: string };
};
export const curriculumVersion: string;
export const units: Unit[];
export const problems: Problem[];
```

対象は15×15自由五目、双方禁手なし、5以上勝ち、黒番開始。lastは着点number、色はboard[last]から得る。Frameのtextには「なぜ・相手の可能手・残る方向」を1〜2文で持つ。仕様や証明器の内部名は表示しない。familyは概念系列で、回転・移動だけで別の習得概念にしない。

内部のDecisionNodeにはinput（board/choice）、選択肢、許容手、白の複数応手、次ノード、段階ヒント、反証フレームを持たせる。登録候補以外も盤面から検証し、別解なら許容する。未登録・探索不発・打切りを負けにしない。代表再生一本と全応手の証明を区別する。内部schemaは教材実装時に定め、controllerを依存させない。

## 公開関数

```ts
createAttempt(problemId, { replyVariant = 0, attemptId = null } = {}): State
playLearningMove(state, i): State
answerLearningChoice(state, choiceId): State
getLearningView(state): View
getDemoFrames(unitId): Frame[]
hintLearning(state): State
markLearningGuidance(state): State
retryLearning(state): State
restoreLearningAttempt(raw): State | null

createLearningProgress(raw = null): Progress
recordLearningAttempt(progress, state): Progress
recordLessonView(progress, unitId): Progress
getLearningStats(progress, { problemId?, unitId?, family? }): Stats
```

すべて同期・純粋関数。原教材・入力stateを変更しない。変化がない操作は同一state、通常の遷移は新stateを返す。get系は共有配列を外へ出さない。日時・乱数・localStorage・Rapfiを内部で呼ばない。探索は上限付きで、足りなければunknown。

replyVariantは非負整数で、各判断点の合法な白応手から決定的に選ぶ（基本はvariant % 応手数）。attemptIdはcontrollerが開始ごとに発行する。nullはプレビュー/単体テスト用で進捗に記録しない。未知のidは開発時Error、復元不正はnull。範囲外・占有点・異なるinputへの操作・choose以外の回答は無変更で成績にも入れない。

## 保存状態

```ts
type Feedback = {
  kind: 'none' | 'continued' | 'completed' | 'goal-miss' |
        'proven-loss' | 'unknown' | 'observation';
  correct: true | false | null;
  claim: 'none' | 'win' | 'loss' | 'local-goal' | 'comparison';
  move: Point | null;
  choiceId: string | null;
  title: string; text: string;
};
type State = {
  schemaVersion: 1; curriculumVersion: string;
  attemptId: string | null; problemId: string; replyVariant: number;
  nodeId: string | null;
  board: Board;
  history: Move[]; // 開始盤から進んだ練習手順。反証の仮想枝は入れない。
  status: 'choose' | 'feedback' | 'solved';
  checkpoint: { board: Board; history: Move[]; nodeId: string | null };
  feedback: Feedback;
  transitionFrames: Frame[];
  refutationFrames: Frame[];
  hints: { level: number; maxLevel: number; uses: number;
           byDecision: Record<string, number> };
  metrics: { submittedDecisions: number; acceptedDecisions: number;
             verifiedMistakes: number; unknownSelections: number;
             retries: number };
  guide: Point[];            // 検証済みのヒント候補。controllerは直接表示しない。
  hintStages: Highlight[][];
  hintTexts: string[];
  exercise: object | null;   // 比較後の盤上継続。教材由来の内部データ。
  guidanceSeen: boolean;    // 正解途中の案内を見た。hint level/usesとは別。
};
```

JSON往復可能。Set/Map/TypedArray/関数/undefined/Infinityを入れない。checkpointは直前の学習者の判断点。誤った盤上回答は黒一石をboard/historyへ置いてfeedbackにするが、仮想の白反証はrefutationFramesだけへ置く。choice回答は盤入力の代わりにchoiceIdを採点し、必要なら次の判断点へ進める。controllerは採点分岐を持たない。

restoreは版・問題存在・石値・履歴合法性・開始盤からの再構築一致・status・指標を検査する。非互換ならnull。正解表や達成フラグを無検証で信用せず、旧進捗を昇格しない。元の保存データを消すAPIではない。

## 遷移の要点

| 回答結果 | 状態・表示 | 完了/成績 |
| --- | --- | --- |
| 途中の正解 | 黒→合法な白応手を確定、次の黒番でchoose。transitionFramesはその順 | correct=trueでも未完了。勝ち問題は黒が五連を置くまで続行 |
| 最終正解 | solved。五連後に白を置かない | claimはwin/local-goal/comparisonを区別 |
| 目標未達 | feedback、correct=false、kind=goal-miss | verifiedMistakes増。負けとは表示しない |
| 強制負けを証明 | feedback、correct=false、kind=proven-loss | 根拠のあるrefutationFramesを返す |
| 未判定 | feedback、correct=null、kind=unknown、claim=none | unknownSelectionsのみ増。誤答率に入れない |
| 既知の局所的な失敗 | feedback、correct=null、kind=observation、claim=none | 「つなぎ目を取られる」等の検証済みの現象を説明。最終勝敗は断定せず、unknownSelectionsに記録 |
| 正しいchoice | 次ノードがあればchoose、最終判断ならsolved | 比較や反撃認識の達成を黒勝ちと扱わない |
| retryLearning | checkpointへ戻してchoose | retries増。誤答・未知・使用済みヒントを保持 |
| hintLearning | chooseのみ有効、盤と履歴は不変 | 原則3段階、最大後の連打は無変更 |
| markLearningGuidance | chooseの初回だけguidanceSeen=true | ヒント段階/回数は増やさず、完了時は補助つきとして記録 |

ヒントは範囲→関係する線→候補点。次判断点ではlevel=0だが、試行全体のuses/maxLevelは維持する。同じ判断点へretryした時は既使用段階を復元する。solvedへの回答・ヒントは無変更。

レッスンで正解途中のtransition説明を出す時は、controllerが表示前にmarkLearningGuidanceを呼ぶ。実戦問題/復習では、次の答えを含むcaption/highlightを途中で出さず、着石のみ表示する。solved後の解説にはmarkを呼ばない（呼んでも無変更）。guidanceSeenは保存・retry後も維持され、同じattemptIdの古いスナップショットで消えない。

## 表示の取得・見本との分離

```ts
type View = {
  problemId: string; unitId: string;
  title: string; goal: string;
  kind: Problem['kind']; goalKind: Problem['goalKind'];
  input: 'board' | 'choice' | 'none';
  choices: { id: string; title: string }[]; // 正誤・解のフラグは返さない。
  board: Board; last: Point | null; highlights: Highlight[];
  status: State['status'];
  canPlace: boolean; canHint: boolean; canRetry: boolean;
  hintLevel: number; hintText: string; guidanceSeen: boolean; feedback: Feedback;
  transitionFrames: Frame[]; refutationFrames: Frame[];
};
```

getDemoFramesは例題の盤面付きFrame[]。createAttemptはその再生状態を引き継がず、独立した練習の開始盤を作る。controllerはmode=demo/practiceと再生カーソルを別に保持する。実演終了後にcreateAttemptし、練習初期のhighlightsに正解点を漏らさない。初期表示でもgetDemoFramesの0番を描くため、導入の空欄を作らない。

例B「H8から勝てるか」はchoice、序盤候補の比較はcompareとして出せる。盤へ無理に一石を置かせない。選択後に盤上継続を行う教材は、次DecisionNodeのinputをboardへ変える。kindは問題の種類、inputは現在の操作。

序盤の継続は固定answersを持たず、exercise.objectiveと既存の構成石から目標形を判定する。open-threeはその石と新しい石を含み、一手で両端の空いた連続四になる形。fourは同じ構成石と新しい石を含む五セル内に黒4・空点1がある形。F10/D8/J8や飛び三も、条件を満たせば同じ正解として受理する。

controllerはtransitionFramesを再生してからstate.boardへ戻る。再生途中の盤を採点入力にしない。反証の再生やタブ復帰でplayLearningMoveを再実行しない。初期chooseでは正解のgood点を表示しない。

solvedのView.board/last/highlightsは、最後のtransitionFrameをまとめて投影する。choice回答後も結果盤とマークが一致する。Stateの実際の履歴を、反証の仮想手順で書き換えることはない。ヒント表示にはhintTextを使い、段階番号だけを表示しない。

## 進捗

recordLearningAttemptを開始直後と各遷移後に呼ぶ。同じattemptIdの最新スナップショットを置き換え、何度保存しても二重加算しない。最初からの再挑戦は新attemptId、判断点へのretryは同じattemptId。進捗へ盤225配列やframesを複製しない。

集計は並列の軸とし、一つのランクへ潰さない。viewed、started/completed、初遭遇完了、初遭遇かつ誤答0/未知0/retry0/ヒント0の自力完了、補助つき完了、再試行完了、未判定を含む試行。初遭遇は開始時点で記録し、途中離脱後に再開始しても初見に戻さない。problem初見とfamily初見を区別する。unknownを誤答にはしないが、自力正解の実証にも数えない。

順序はprogressが初めてattemptIdを見た時の連番で管理。スケジュールや通知は作らない。recordLessonViewは閲覧だけを記録し、習得・完了へ自動昇格しない。

```ts
type Stats = {
  viewed: boolean | number; // unitId指定時は閲覧済みbool、全体では閲覧単元数。
  started: number; completed: number;
  completedProblems: number; problemCount: number;
  completedProblemIds: string[]; cleanProblemIds: string[];
  firstEncounterCompleted: number; firstTryUnaided: number;
  familyFirstTryUnaided: number; independentCompleted: number;
  assistedCompleted: number; guidedCompleted: number; retryCompleted: number;
  unknownEncountered: number; verifiedMistakes: number; hintUses: number;
  reviewProblemIds: string[]; needsReview: boolean;
  lastOutcome: 'new' | 'in-progress' | 'unassessed' | 'assisted' | 'retry' | 'unaided';
};
```

completedは試行数、completedProblemsは重複を除く問題数。reviewProblemIdsは、各問題の最新試行が未完了か、補助・誤答・未判定・retryを含むもの。後の新試行で自力完了すると対象から外れる。solvedとして記録済みのattemptIdへ古い開始stateを渡しても、達成を巻き戻さない。

assistedCompletedはヒント使用またはguidanceSeenの完了。guidedCompletedはguidanceSeenの完了だけを数える。guidanceSeenがあれば、hintUsesが0でもfirstTryUnaided/familyFirstTryUnaided/independentCompletedには加えず、lastOutcomeはassistedとなる（未判定を含む場合はunassessedが優先）。

## 最小使用例

```js
// 見本。練習stateとは別のcontroller状態。
const demoFrames = getDemoFrames(unitId);
renderFrame(demoFrames[0]);

// 「練習へ」で明示的に新規開始。
let learning = createAttempt(problemId, {
  replyVariant: 0,
  attemptId: crypto.randomUUID(), // controllerの責務
});
progress = recordLearningAttempt(progress, learning);
renderLearning(getLearningView(learning));

// 仮置きでは呼ばず、「ここに置く」の確定時だけ呼ぶ。
learning = playLearningMove(learning, selectedPoint);
// choice/compareの選択ボタンなら代わりに:
// learning = answerLearningChoice(learning, choiceId);
if (lessonContext && learning.status === 'choose' && learning.transitionFrames.length) {
  learning = markLearningGuidance(learning);
}
progress = recordLearningAttempt(progress, learning);
saveLearning({ learning, progress });
renderLearning(getLearningView(learning));

// 同じ判断点へ。ヒント・誤答履歴は消えない。
learning = retryLearning(learning);
```

実装済み: state返却型、三値correct、last:number|null、choice専用API、retry/restore API、見本と練習の独立、開始時の進捗記録。教材は9単元21課題・19概念系列。受け入れテストは不変性、別解、複数白応手、途中継続、観察/未知、反証合法性、説明文、表示盤とマーク、ヒント/retry、JSON往復、二重記録防止。
