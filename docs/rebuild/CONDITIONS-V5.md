# M2 条件の未見弁別

`dist/assessment-conditions-v5.js` は、指定した一手後の局所事実を予測する確認盤12題と、別原盤の基礎問題4題を提供する。勝ち、唯一の最善手、攻撃の構築能力はこの選択回答から認定しない。

## 公開API

- `conditionsAssessments`: `check-conditions-01`〜`check-conditions-12`。`role: "assessment"`、`unitId/skillId: "conditions"`。
- `conditionsPracticeLessons`: `practice-conditions-01`〜`practice-conditions-04`。`role: "lesson"`。確認ドメインは付与しない。
- 全題 `kind: "compare"`、`completion: "comparison"`、`judge.kind: "compare"`。`start` の選択1回で終わり、黒白の応手履歴は必要としない。
- `questionHighlights` は指定候補の1点だけ。正答、完成点、阻害石を初期表示に渡さない。
- `prediction` は開発・検証用。`kind`、`move`、`completionPoints`、`focusCells`、`blockers`、`boundary`、`comparisonGroup` を保持する。
- `assessmentDomain` は肯定例に `conditions-positive`、否定例に `conditions-negative`。いずれも構築の確認盤とは別に集計する。

両端四を問う問題では、指定一手後の連続四石の両側が盤内の空点であることを判定する。完成点を問う問題では、次に黒を置くと五個以上が連続する空点を、重複せず数える。「完成点が二つ」と「連続した両端四」は別の事実であり、共有完成点の肯定例は横・縦に異なる完成点を持つが両端四ではない。

## 確認盤

同じ対のタイトル・設問・候補座標・選択肢は同一。タイトルは全題「形を確かめる」。選択肢は両端四の肯否、または完成点0/1/2か所で固定する。

| ID末尾 | family | 候補 | 指定一手後の完成点 | ドメイン | 比較する条件 |
| --- | --- | --- | --- | --- | --- |
| 01 | outer-space | E7 | I7 | negative | 三の両隣のさらに外側が白 |
| 02 | outer-space | E7 | D7・I7 | positive | D7の白が別の場所にある |
| 03 | outer-space | G8 | C12・H7 | positive | 斜めの完成点が二つ空いている |
| 04 | outer-space | G8 | C12 | negative | 斜めの両側の外側が白 |
| 05 | board-edge | D11 | B11・G11 | positive | 両方の完成点が盤内 |
| 06 | board-edge | D11 | E11 | negative | A11の外側は盤外 |
| 07 | board-edge | B14 | E11 | negative | A15の外側は盤外 |
| 08 | board-edge | B14 | A15・F10 | positive | 盤端の交点A15そのものは置ける |
| 09 | gapped-three | G4 | E4・J4 | positive | 飛び三の間を埋め、両側が空く |
| 10 | gapped-three | G4 | E4 | negative | 間を埋めてもJ4の白が残る |
| 11 | shared-completion | G8 | H8 | negative | 重なる二つの五マス窓がH8を共有 |
| 12 | shared-completion | G8 | H8・G9 | positive | 横と縦が別々の完成点を持つ |

肯定例6題、否定例6題。各ドメインは4familyを持ち、初回・保持・失敗後の再確認を別盤で行える候補数を確保する。どの盤を採用できるか、支援・既見・保持日数・失敗時の取り消しは進捗ゲート側で判定する。

## 基礎問題

4題は各familyを一度ずつ扱い、確認盤とは異なる原盤を使う。外側白の否定、盤内の両端の肯定、間を埋めても両端が白で完成点ゼロになる否定、縦横に異なる完成点を持つ肯定を含む。正答・誤答の両方に同じ因果説明と一手後の図を用意し、色で完成点と阻害石を示す。

## 検証

実行: `node --test tests/assessment-conditions-v5.test.mjs`

テストはゲーム本体の分類関数や生成スクリプトの判定を使わず、15×15盤の4方向について長さ5・6の窓を別実装で全列挙する。

1. 16原盤の黒白同数、空の候補、五連なし、双方の即時完成点なしを確認する。指定一手後も非終局で、白の即時完成点はない。
2. 全選択肢の真偽とドメイン、完成点集合、両端四の有無を照合する。すべての説明図が指定一手後の盤に一致し、完成点・白の阻害石・説明内の座標が一致することを確認する。
3. 対ごとに初期ラベルと候補強調が同一であることを確認する。
4. 外側が両方白の2題は全空点を仮置きし、対象三石を含む両端四がどこにもできないことを確認する。盤外座標、飛び三の中空点、二つの五マス窓が同じ点を共有する条件も個別に確認する。
5. 回転・反転8種と平行移動を正規化し、既存教材・既存確認盤・教材の説明フレーム・攻略書の全図・掲載全棋譜の途中盤と重複しないことを確認する。新規16原盤同士、および基礎問題の回答図と確認盤の重複も拒否する。

構築達成や保持ゲートの受理はこのファイルだけでは保証しない。カリキュラムへの登録、選択APIの状態遷移、初期候補表示、支援記録、保存・復元、ドメイン集計は統合側で検証する。
