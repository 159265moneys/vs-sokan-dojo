# 第1・第2段階の確認範囲ゲート

## 互換性と現在の確認

保存ledgerのschemaVersionは3、curriculumVersionは従来値のまま使う。新しい問題が加わったことを理由に履歴を初期化しない。既存のattempt、閲覧・見本・同盤のexposure、実戦、復習、基礎練習の成果を維持する。

`initialConfirmed`、`initialEvidence`、`initialPracticalEvidence`、`historicalRetained`は従来の基準についての歴史的成果である。現在の単元完了・前提単元・次の推薦は`currentConfirmed`を使う。

| 単元                     | 従来のbaseline                                    | 必須の追加確認                                                                         |
| ------------------------ | ------------------------------------------------- | -------------------------------------------------------------------------------------- |
| conditions               | 独立2family・2branch、または従来の契約適合実戦2局 | conditions-positive、conditions-negative 各1問                                         |
| counter                  | 独立2family・2branch、または従来の契約適合実戦2局 | counter-threat、counter-clear 各1問（予測＋本人の黒一手）                              |
| branch                   | 従来の独立2family・2branch、または契約適合実戦2局 | branch-ready、branch-rebuild 各1問                                                     |
| prepare                  | 従来の独立2family・2branch、または契約適合実戦2局 | prepare-two、prepare-one 各1問                                                         |
| opening                  | 従来の独立2family・2branch、または契約適合実戦2局 | opening-near-ready、opening-near-blocked、opening-far-ready、opening-far-blocked 各1問 |
| practice                 | 従来のbaseline基準                                | practical-win、practical-defense、practical-build 各1問                                |
| priority・defense・order | 従来の基準                                        | なし                                                                                   |

追加domain問題はbaselineのfamily/branchやbaseline保持の代わりにしない。実戦2局はbaselineだけを示し、予測の明示的な実施を示さない。baseline完了済の保存データには不足domainだけを推薦する。解いたことのない新盤が尽きても、既知盤を独立確認へ昇格させない。

## 根拠の信頼範囲

`requiredAssessmentDomains`は単元ごとの一般的な要件表。問題のdomainは読込済のcurriculum定義をIDで引き、role、unit、family、盤面fingerprint、compare形式を照合して求める。呼出側や保存JSONへ任意の`assessmentDomain`を書き足しても能力根拠にはならない。

追加確認は従来の独立条件（solved、初見、ヒント・誘導・誤答・未判定・再試行なし）に加え、conditionsは`acceptedDecisions >= 1`、それ以外の5単元は`acceptedDecisions >= 2`と本人の黒一手を必要とする。`requiresBranch:false`は教材定義から得るので、固定手順や比較をbaselineの応手分岐習得へ代用しない。

実入力の根拠はtrusted教材の正答choiceにあるcontinuationを使う。branch・prepare・openingのhistoryは固定黒白2手と本人黒1手、counter・practiceは本人黒1手でなければならない。保存historyのprefixを教材の`continuation.moves`へ完全一致させ、元盤から全手を合法に再生し、本人入力後の盤を`learning-objectives.js`の`exerciseSatisfied(board, exercise, placed)`で再検査する。正答選択だけ、固定黒手だけ、prefixの欠落・改変、空点への無関係な一手、任意のexerciseタグではdomain確認にならない。段階1のcounterの有効な予測＋入力履歴は同じ局所目標を満たすため維持される。

`recordAttemptEvidence`はattempt内の`metrics.acceptedDecisions`と`history`を保存する。旧attemptにその情報がなくても従来baselineの成果は失われない。新domain問題の情報不足は新domainの確認だけを保留する。

## 保持と再確認

追加domainの初回一式とbaselineが揃った時点を`coverageInitialAt`として持つ。保持には従来baselineの保持に加え、この時点から別日かつ24時間以上経過した新盤で各domainを再確認する。古いbaseline保持は履歴として残り、追加domainだけで保持完了にならない。

追加domainで失敗した場合は、そのdomainに紐づく復習を作る。`teachesAssessmentDomain`が対応する新lessonを推薦し、そのlessonを完了してから新盤で同じdomainを再確認する。補習の対応関係もcurriculum定義のID・unit・family・盤面から照合し、選択回数・固定prefix・本人入力の局所目標を同じ判定で再検査する。兄弟domainのlesson、従来の一般lesson、任意のタグ、通常の課題対局、本人入力の欠けたsolved記録はこの補習を代替しない。新lessonをroleだけassessmentへ変更してもbaseline根拠にはしない。既知盤の成功も独立再確認にはならない。複数のdomainで失敗した場合は別々の未解消要件として残す。

従来baselineの確認失敗および実戦復習の転移確認では、baselineの新確認1問または契約適合実戦2局に加え、復習後に全必須domainを確認する。実戦だけで予測要件を代替しない。priority・defense・orderの復習・保持判定は従来どおり。

openingは距離と正負を組み合わせた4条件を個別に要求する。「近い白は否定」「遠い白は肯定」の2問だけでは、近接でも連結できる例・離れていても阻害される例を確認済みにしない。保持・補習・再確認も同じ4条件で照合し、距離だけ・正負だけが同じ兄弟条件で代替しない。

第2段階の供給はbranch・prepare各domain3問、opening・practice各domain2問。opening・practiceは初回・保持で2問を使うと再確認用新盤が残らない。追加供給前に失敗や補助・既知化で枯渇しても、既知盤を再利用せず、`assessment-exhausted`と未解消domainを維持する。段階3の供給追加へ必要条件を持ち越す。

## UI接続

`unitStatus`の追加フィールド:

- `baselineConfirmed`、`baselineRetained`: 従来の観測の状態。
- `requiredAssessmentDomains`、`confirmedAssessmentDomains`、`pendingAssessmentDomains`: 初回・再確認の不足範囲。
- `retainedAssessmentDomains`、`pendingRetentionDomains`: 保持の不足範囲。
- `coverageInitialAt`、`domainInitialEvidence`、`domainRetentionEvidence`: 監査用の日付・問題ID。
- `assessmentReview.requiredDomain/requiredDomains/pendingDomains/baselinePending`: 未解消復習の具体的な範囲。

`nextLearningStep`は追加初回確認に`reason:"coverage"`、`label:"追加確認"`、`assessmentDomain`を返す。従来のdiagnostic/initial/reconfirmation等のreasonは残す。`unitStatus.label`はbaseline後の不足を`追加確認 0/2`等で示す。初回に必要なdomainをすべて満たした後は従来の保持待ちへ進む。

保持は既存どおり明示操作で`selectAssessment(..., {phase:"retention", at})`を呼ぶ。自動スケジュール・定期確認・自動再開は追加しない。UIは短いラベルと状態だけを表示し、本資料の実装説明を転載しない。

## 検証

`tests/coverage-v5.test.mjs`で第1段階の旧データ保持、追加分のみ推薦、baseline代替禁止、保持、補助/未判定/既知盤の排除、任意タグ拒否、反撃予測後の実入力、およびdomainごとの補習・再確認を検証する。

`tests/position-coverage-v5.test.mjs`では第2段階の全11domainについて実学習APIから予測・本人入力を行い、初回、保持、失敗後の対応補習と新盤再確認を検証する。固定prefixの改変と局所目標を満たさない実入力の拒否、保存復元、既存baseline保持、baseline失敗後の全domain再確認、openingの4条件すべての必須化、opening・practiceの枯渇を含む。`tests/learning-path.test.mjs`は従来の機能と、契約適合実戦2局が追加予測を代替しないことを確認する。
