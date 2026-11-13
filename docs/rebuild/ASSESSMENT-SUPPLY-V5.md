# 第3段階：未見確認の供給と完全枯渇

## 信頼範囲と優先順

第1・第2段階の原確認50問に、検算済みの静的catalog `assessment-reserve-v5.js` の134問を追加する。reserveは全15domainを補う。各問題は通常のcurriculumへ登録し、学習API・保存復元・局所目標判定・初見判定を原確認と共通にする。実行中の盤生成、未登録IDの特例解決、任意タグからの確認資格付与は行わない。

`selectAssessment`は不足条件に該当する未見の原確認を優先し、該当する原確認が尽きた後に未見reserveを選ぶ。複数domainが不足している場合も、選べる原確認をreserveより先に提示する。同じ供給区分内では従来の未成功family優先を維持する。これは初回、補習後の再確認、手動の別日保持で共通である。

供給区分はtrusted curriculumの `supply` を読む。呼出側が問題へ `supply:"reserve"` を足したり外したりしても優先順を変えない。domainと供給を持つ問題は教材ID・unit・family・盤面fingerprintを照合し、返却問題も登録済み定義に正規化する。未登録のreserveやdomainタグ付き問題をbaseline候補へ流用しない。

未登録IDや不一致の教材identityでdomain/reserveを名乗るattemptは、`invalidAssessmentDomain`を付けて履歴と既知盤を維持する。独立確認にもbaselineの誤答・再確認要求にも混ぜない。再読込でも除外を維持し、偽装した別IDの記録によって原確認が再配布されることを防ぐ。

原確認とreserveはどちらも追加domainの根拠であり、既存baselineの2family・分岐や契約適合実戦の代わりにはしない。基礎教材も確認問題に付け替えない。

## 初見と履歴

台帳のschema/curriculumVersionを変更しない。既存の初回・保持・実戦・補習成果、誤答、補助、途中離脱、露出、問題ID、盤面fingerprintを保存する。登録済みreserveの増加は候補の追加であり、既知盤を未見へ戻す移行ではない。

候補の未見判定は既存の `wasSeen` と位置fingerprintを使う。回転・反転・平行移動、別ID、同じfamilyへの再配布では既知盤を新しい確認にしない。候補配列に同じ問題や同じ位置が重複しても、残数を増やさない。ヒント・誘導・誤答・未判定・再試行がある完了は、reserveでも独立確認にならない。

catalogの問題は有限の局所条件を確認するための供給である。問題数・残数・新しいIDの数を、異なる技能数や人間の学習効果へ読み替えない。盤の因果性・幾何・全受理手の検算は生成側の検証資料とテストを参照する。

## 完全枯渇

対応補習が必要な場合は、まず既存の `teachesAssessmentDomain` に対応するlessonを推薦する。補習完了後に同domainの未見reserveがあれば確認へ進む。補習は独立確認の代替にはしない。

必要なdomainの原確認とreserveが両方尽きた場合、`nextLearningStep`は次の構造を返す。

```js
{
  kind: "assessment-unavailable",
  unitId,
  assessmentDomain,
  pendingDomains,
  exhaustedDomains,
  needsBaseline,
  phase: "initial" | "reconfirmation",
  reason: "domain-exhausted",
  label: "復習へ"
}
```

普通対局を行えば明示的な予測条件を確認できるような推薦には切り替えない。`currentConfirmed`や`retained`を昇格させず、不足domainを維持する。baselineも含む全候補が既知のときもdomain枯渇を明示する。

baselineだけが枯渇し、domainには未見供給がある場合は、従来どおり契約適合実戦によるbaseline代替を残す。domain要件がない単元の枯渇も従来どおり扱う。これらの実戦は追加domainそのものを解消しない。

## 供給照会API

`assessmentAvailability(progress, unitId, bank, { phase = "initial", at })`は台帳を変更せず、次の情報を返す。照会範囲は渡されたbankである。本番UIでは原確認とreserveを含む全確認bankを渡す。

| フィールド                           | 意味                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `state`                              | `ready` / `waiting` / `exhausted` / `complete`                                                          |
| `phase`                              | `initial` / `reconfirmation` / `retention`                                                              |
| `reason`                             | 保持待ちは `initial-incomplete` / `retention-not-due`、枯渇は `domain-exhausted` / `baseline-exhausted` |
| `problemId`, `assessmentDomain`      | 準備できた確認、または枯渇した条件                                                                      |
| `needsBaseline`                      | 今回baselineの確認・再確認が必要か                                                                      |
| `pendingDomains`, `exhaustedDomains` | 今回不足する条件と、そのうち供給ゼロの条件                                                              |
| `remaining`                          | 今回の候補の `{ authored, reserve, total }`。baseline待ちならbaseline候補を数える                       |
| `domains`                            | 全必須domainごとの `{ assessmentDomain, pending, remaining }`                                           |

`waiting`は保持の初回未完了または日付未到来を表す。補習の段階は既存の `assessmentReview.stage` / `nextLearningStep` が制御し、供給照会だけで補習を省略しない。保持には既存どおり `coverageInitialAt` から別日かつ24時間以上が必要で、`at` は呼出側が渡す。

保持UIは `{phase:"retention",at}` で照会し、枯渇と日付待ちを区別する。`nextLearningStep`の通常経路から自動で保持を開始しない。既存単元の任意の追加確認を壊さないため、domain要件なしで既に初回完了した単元では、供給照会は `complete`、従来の `selectAssessment` は任意確認用の未見問題を返す場合がある。

本番画面では短い未確認・補習・別単元への導線に接続する。本資料の生成方式・検証件数・保存仕様を画面説明として転載しない。スケジュール、定期実行、自動再開は追加しない。

## 検証

`tests/assessment-supply-v5.test.mjs`は全15domainについて、原確認50問の全誤答、対応補習、同domainのreserveによる不足解消を実学習APIで再現する。並び順や任意の供給タグに依存しない原確認優先、別日保持のreserve、全候補露出後の構造化枯渇、保存復元、反転・別IDの再配布拒否、baseline代替の維持も検証する。

第1・第2段階の既存coverageテストは原確認だけのbankを明示し、当時の有限供給と枯渇を引き続き検査する。新テストで同じ保存台帳に全bankを渡すとreserveが利用可能になることを確認する。既存履歴の削除やリセットは行わない。
