# 受け四の予測と攻めの選び直し（v5）

## 公開API

`dist/assessment-counter-v5.js` は次を公開する。

- `counterAssessmentProblems`: 確認12題、`role: "assessment"`。
- `counterPracticeProblems`: 別盤の基礎2題、`role: "lesson"`。
- `counterProblemsV5`: 上記14題。

全題 `unitId/skillId: "counter"`、`kind: "compare"`、`requiresBranch: false`。
確認IDは `check-counter-v5-{family}-{threat|clear}`、基礎IDは
`practice-counter-v5-closed-gap-{threat|clear}`。
`assessmentDomain` は `counter-threat` / `counter-clear`。各確認domainに6題、6familyある。

## 学習者の二つの判断

1. 印の黒候補を仮に置き、黒の四を白が受けると白の完成点が何個になるかを予測する。
2. 正答後、元の盤で本人が安全な四を一手入力する。危険盤では最初の候補を撤回する必要がある。反撃のない盤では最初の候補も受理する。

問い・選択肢・続きの目標は全題共通。正例と負例でラベルや指示を変えない。

- 問い: `印の黒手に白が受けると、白の完成点は？`
- 選択肢ID/表示: `open-four` / `2つ以上`、`four` / `1つ`、`clear` / `なし`。
- 続き: `moves: []`, `cells: []`, `objective: "safe-four"`。
- 続きの表示: `元の盤で、安全な四を作る`。

`questionHighlights` は黒候補の空点だけを示す。白の受け・完成点・安全な代案は初期表示に含めない。
`hintTexts` と `hintStages` は3段階。予測中のヒントは黒候補、白受け、白完成点の順に焦点を移す。
続きのヒントは learning 側で現在の `safe-four` 目標から再計算する。

予測の根拠は `prediction: { candidate, reply, outcome, whiteFinishes }` に保存。
各選択肢の説明framesは `仮想手順：黒…`、`仮想手順：白…` と明記する。
基礎では予測正答時に仮想framesを示す。確認では本人の盤入力完了まで仮想framesを保留し、途中は元盤と共通目標だけを示す。
完了後は仮想framesに続けて本人が元盤で選んだ一手を示し、最終表示も実盤に一致させる。
候補や仮想の白受けは実盤・実historyへ追加しない。
予測正答後は `acceptedDecisions = 1, history = []`、本人の正しい一手後は
`acceptedDecisions = 2, history = [{ i, side: 1 }]` になる。

## 有限目標 `safe-four`

黒が今の一手で五連を完成すれば受理する。それ以外は次を全て満たす一手を受理する。

1. 黒に五連の完成点がある（四を作った）。
2. 黒着手直後、白に五連の完成点がない。
3. 白が一手で黒の全完成点を塞げる場合、その白受けの後に白の完成点がない。

黒の完成点が二つ以上あり白が一手で全部塞げない場合も、白の即勝ちがないことを要求する。
一般局面での唯一最善手、全局的な安全、将来の全変化での勝利は主張しない。
誤答はこの有限目標を満たさないという判定であり、探索不成立を負けと呼ばない。

## 確認盤の対照

各対照で黒石・候補・白受けは同一、白石1個の位置だけを変える。

| family | 黒候補 | 白受け | 危険盤の白完成点 | 危険盤で選び直す手 | 反撃なし盤の受理手 |
| --- | --- | --- | --- | --- | --- |
| straight-reply | D8 | G8 | G9・G4 | G8 | D8・G8・I8 |
| inside-gap | I8 | F8 | F11・F6 | F8 | D8・F8・I8 |
| closed-end | H8 | I8 | I9 | I8 | H8・I8 |
| diagonal-attack | E9 | H6 | E6・J6 | H6 | E9・H6・J4 |
| crossed-diagonals | B12 | E9 | F10・A5 | E9 | B12・E9・G7 |
| board-edge | E1 | H1 | D5 | H1 | E1・H1・J1 |

縦横の直列、内側の空点、石による端の閉塞、斜めの攻め、斜線同士の交差、盤端という差を含む。
危険確認6題の内訳は活四4題・完成点1つの四2題。反撃なし確認6題は全て白完成点0。
基礎 `closed-gap` は候補I6、白受けG6。危険側の白完成点はG7、安全な代案はG6。
反撃なし側ではG6・I6を受理する。

## 検証

`node --test tests/assessment-counter-v5.test.mjs`

2026-11-12: curriculum / learning 統合後、6テスト全通過。

テスト内の独立実装は `game.js` の勝敗/完成点関数と `learning.js` の判定を使わず、15路盤の5点窓を列挙する。

- 全14盤の黒合法一手3,058手を独立判定し、受理手一覧 `guide` と照合する。
- 候補黒着手後の全白合法応手3,044手を列挙。黒の完成点を全て消す白受けが指定の1点のみであることと、その白完成点を照合する。
- `safe-four` の検査でも、黒の全完成点を消す白応手を全合法手から列挙して白完成点を再検査する。
- 危険盤7題では候補を拒否し代案を受理。反撃なし7題では候補を受理。全受理手は合計26手。
- 全盤で黒白同数、初期終局なし、初期の黒白即勝ちなしを検査する。
- 全新初形同士、既存curriculumの全盤/frames、旧確認bank、攻略書の全図frames、旧lessonの各手順盤、expert courseの全棋譜prefixをD4・平行移動正規化して重複を検査する。無限に生成され得る将来のランダム盤までの非重複は主張しない。
- learning統合後、全3,058合法入力の正誤を独立判定と照合。予測のみでは完了しないこと、正答後の実盤不変、historyへの仮想手混入なし、restore、誤予測/危険な実入力からのretryも検査する。
