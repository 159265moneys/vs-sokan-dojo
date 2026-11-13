# 段階3設計：未見の局所条件問題を供給する

2026-11-13更新。段階3の生成設計と、事前コンパイル済み確認catalogの実装記録。第1段階の枯渇反例は [STAGE1-REVIEW-V5.md](STAGE1-REVIEW-V5.md)、追加domainの契約は [STAGE2-DESIGN-V5.md](STAGE2-DESIGN-V5.md) に従う。

## 結論と今回の確定範囲

全15domainの原確認50題を使い切った後へ、**追加確認134題**を供給する固定recipeと静的catalogを作った。既存支持石を保つ白配置変更に加え、支持石の間隔・穴・関連軸を構造的に変えるrecipeを使う。D4・平行移動だけの盤、補助石の位置変更だけの盤、既知教材と局所的に同型の盤は採用しない。

`/tmp` の読込差替え環境で、製品のlearning/path実装を使って原50題を誤答し、対応補習50回を完了した。全15domainで次の推薦が同domainの新しい生成題になり、完了・JSON再読込後に当該domainの不足が解消した。136候補から、既存補習と意味同型だった2題を追加棄却した最終値が134題である。

本番では生成をその場で行わず、検算済み134題を共通curriculumへ静的登録する。学習API・保存復元・台帳は既存のtrusted登録を使う。初期・再試行・復元では本人が操作するまでヒントや解答を表示しない。実行時の既見照合で実際の供給数は減る。完全枯渇は未確認を保った明示的な状態にする。無限供給、人の習得、通常対局による明示予測domainの代替は保証しない。UIを含む段階3全体の独立審査は別途必要である。

counter-ray1の詳細は第2〜4節、全domainの構造と先行経路検証は第9・11節、本番化したファイル・API・検証結果は第12節に記す。

## 1. 生成単位と信頼境界

供給路を次の順序に固定する。

1. バージョン固定のrecipeと有限パラメータから候補盤を構成する。
2. 生成器と独立した検算器で、全合法入力・必要な全応手を列挙する。
3. 盤のD4・平行移動正規形、局所の因果関係、意味の重複を検査する。
4. 全既知教材・手順・説明盤と照合し、採用IDと検算結果を固定manifestへ登録する。
5. 検算済み問題を事前コンパイルし、共通curriculumへ登録する。実行時はそのtrusted登録からIDを解決する。保存JSONの盤・domain・正答・guideを教材の根拠として使わない。
6. 選題時にユーザーの既見台帳とも照合し、開始時にattemptを記録してから表示する。

検算結果には、初期盤、指定手順、予測の全完成点、本人の全受理手、有限目標、検算器版、recipe版、盤fingerprintを含める。これらは内部データであり、予測前の画面やARIAへ出さない。

固定manifestは検収済み教材のallowlistであり、クライアント保存値の署名認証ではない。保存値から任意recipeを登録したり、任意の証明を信じたりしない。

## 2. counter-ray1：実測した有限recipe

### 原則

- 15路自由五目、5個以上で五連。黒番開始、黒白同数。
- 原盤の黒石、指定黒候補 `c`、唯一の白受け `r` を固定する。
- 白3石を、`r` を通る直線上の `-4,-3,-2,-1,+1,+2,+3,+4` の3位置に置く。
- 石の追加はしない。重複、盤外、`c` または `r` への設置は棄却する。
- 全初期石について、その石を除くと「黒cの後の黒完成点」または「黒c・白rの後の白完成点」が変わることを要求する。削除盤は因果検査用であり、問題として使わない。
- 元の完成点・受理手集合の両方が変わらない候補は採用しない。

最後の二条件により、局所と無関係な遠方石だけで別盤を装うことを排除する。最初の試行では88候補が残ったが、原盤から継承した `I4` が一部変異では無関係になったため、それらも棄却した。採用案はその88盤ではない。

### 固定ID

形式は `gen-v5-counter-ray1-s{seed}-d{direction}-m{mask}`。例えば `gen-v5-counter-ray1-s0-d1-m07`。

- `seed` は下表の固定番号。mutableな教材配列の添字として実装しない。
- `direction` は盤内座標の `(dx,dy)`。`d0=(1,0)`、`d1=(0,1)`、`d2=(1,1)`、`d3=(1,-1)`。盤内yの増加は画面下向き。
- `mask` は上記8オフセットに対応するビット集合。小文字16進2桁を正規形とし、立っているビットは3個。`07` は `-4,-3,-2`。
- IDは候補のrawパラメータを表す。棄却数に依存する「採用順25番」のような連番にしない。
- パース可能なIDでも、固定manifestにないIDは教材として解決しない。

採用25題に必要なseedは2つだけである。

| seed | 参照した原題 | 固定黒 | c | r | family |
| --- | --- | --- | --- | --- | --- |
| s0 | straight-reply-threat | E8 F8 H8 | D8 | G8 | `counter/v5-straight-reply` |
| s3 | diagonal-attack-threat | F8 G7 I5 | E9 | H6 | `counter/v5-diagonal-attack` |

製品recipeにはこの固定値を所有させる。元教材の後日修正に連動させない。今回調査した原6seedのうち、他の4seedからの候補は重複または因果条件で落ちた。6つの独立familyを新しく獲得したとは数えない。familyをIDごとに水増しせず、生成domainの成功を旧baselineの代替にもしない。

### 全検算条件

1. 初期盤の石数は同数、双方五連なし、双方の即五連点なし。
2. `c` と `r` は合法。黒cは非終局で、黒の完成点集合が厳密に `{r}`。
3. 黒c後の全合法白応手を列挙する。白が既に五連になる応手はなく、黒の完成点を消す白応手が厳密に `r` のみ。
4. 黒c・白r後の白完成点集合を全空点から求める。非空なら `counter-threat`。集合の大きさから `four` / `open-four` を導出する。
5. 元盤の全合法黒手に `safe-four` を判定する。黒即五連、または黒完成点があり白即勝ちがなく、黒完成点をすべて消すどの合法白応手も白五連・白完成点を作らない、という既存の有限目標に合わせる。
6. 全受理手集合は非空で、危険な指定候補cを含まない。
7. 全初期石の因果検査を通過する。盤・座標だけを変えて意味を保つ変形ではないことも後段で確かめる。

全局最善、長い四追いの不存在、任意の応手に対する必勝までは認定しない。

## 3. 多様性と既知盤照合

二つの正規形を分けて使う。

**position fingerprint** は既存台帳と同じ、色付き全石のD4・平行移動正規形。新規盤同士だけでなく、教材初期盤、候補盤、答えのframes、単元説明盤、基礎手順の全段階、戦略図、expert courseの全棋譜prefixを走査する。ユーザーの実戦・過去attempt・表示履歴も実行時に照合する。表示や途中離脱だけでも次回は既見である。

**diagnostic fingerprint** は、設問の支持石、指定点、関連する白閉塞・白支持、完成点、全受理手、必要な即勝ち・二完成点生成手を役割付き点としてD4・平行移動正規化する。遠方の補助石と無関係な固定白手は除外する。134題中89題で補助石を除外した。既存assessmentだけでなく対応lessonにも同じ定義を適用する。最終検査では、全盤は別でも既存補習と局所的に同型だった2題を棄却した。

counter-ray1はさらに、黒支持石 `B`、指定候補 `C`、指定応手 `R`、白完成点 `F`、全受理手 `A` だけを使う保守的な **fact fingerprint** も適用し、43の因果別構造を25へ絞る。一方counter-clearは完成点が常にゼロなので、空の完成点集合だけで陰性構造を同一視せず、第9節の支持配置による否定根拠を含める。

これらは新しい初見判定の代わりではない。実行時の既見判定には従来の位置fingerprintと露出台帳も必ず使う。

既存の位置fingerprintは盤端情報を保持しないため、盤端だけ異なる問題を過剰に同形として落とす場合がある。今回もその保守性を緩めて供給を増やしていない。

## 4. prototypeの結果

実行環境は Node `v26.12.1`、macOS arm64。計測はこのローカル環境の単回値であり、ブラウザ性能の保証ではない。

| 項目 | 結果 |
| --- | ---: |
| 原seed数 | 6 |
| raw候補 | 1,344 = 6 × 4方向 × C(8,3) |
| 読み取った既知盤の出現数 | 1,183 |
| 既知盤のD4・平行移動正規形 | 435 |
| 幾何・重複石で棄却 | 489 |
| 予測domain不一致で棄却 | 602 |
| 既知／生成済みと同形で棄却 | 156 |
| 元題と完成点・受理手が同一で棄却 | 6 |
| 無関係な継承石があるため棄却 | 48 |
| 因果的に異なる新規盤 | 43 |
| fact fingerprintの重複を追加棄却 | 18 |
| **保守的な供給manifest** | **25** |

全候補検査は約4.27秒。5点窓による検算で黒44,893合法入力、指定黒後の白44,688応手、safe-four内の白133,848応手を調べた。これは棄却前の候補を含む総数。先行した既知353構造での実行と、段階2教材が加わった435構造での再実行で、43盤のJSONとhashは一致した。

残った43盤は、窓列挙とも製品の `game.js` / `learning.js` とも別実装の、各空点から4方向へ連続石を数える検算器で再検査した。黒9,417入力、指定黒後の白9,374応手、safe-four内の白28,122応手が一致した。約0.42秒。白完成点1個が36盤、2個が7盤。全石の因果検査も二度目の実装で通過した。

25盤はこの43盤の部分集合。保守選別後も原題6盤・基礎2盤のfact fingerprintとの衝突はない。全問題が受理手を `r` に持つため、本人の実入力という観点で多様な技能を25個測ったとは扱わない。測る不足は、白支持石の異なる関連構造で指定候補後の白完成点を予測できるか、そして元盤で安全な四を実入力できるかである。

### 採用25 IDの固定パラメータ

各maskを上記ID形式へ埋める。表の順序をrecipe v1の選題順とする。

| seed / direction | mask |
| --- | --- |
| s0 / d1 | `07 0b 0d` |
| s0 / d2 | `07 0b 0d 1c 2c 38 58 70 b0` |
| s3 / d0 | `07 0b 0d 0e 2c 38 58 70 b0` |
| s3 / d3 | `07 0b 0d 1c` |

例:

| ID末尾 | 初期白 | 予測後の白完成点 | 元盤の全受理手 |
| --- | --- | --- | --- |
| `s0-d1-m07` | G12 G11 G10 | G9 | G8 |
| `s0-d2-m1c` | E10 F9 H7 | D11 I6 | G8 |
| `s3-d0-m07` | D6 E6 F6 | G6 | H6 |

これらの白石は、離れて見える石も指定応手を含む5点窓の支持石である。一つでも除くと、検査した白完成点集合が変わる。

### 供給シミュレーション

原6題を既見として登録した小さな台帳から25回の選題を行い、毎回JSON保存・読込を挟んだ。別IDを25回返し、26回目は `exhausted` となった。同IDの再配布はなかった。

この先行試験は供給と保存だけのprototypeである。その後、第11節の/tmp読込差替え環境で、同じ134題を用いた実API経路まで検査した。本番統合後の再試験は依然必要である。

### 検証物

- `/tmp/sokan-generation-v5-prototype.mjs`：raw recipe、窓検算、既知盤照合、ID復元。
- `/tmp/sokan-generation-v5-independent.mjs`：独立した方向走査検算。
- `/tmp/sokan-generation-v5-conservative.mjs`：fact fingerprintの選別と供給台帳シミュレーション。
- `/tmp/sokan-generation-v5-candidates.json`：43盤と検算結果。SHA-256 `c021e7b7426bf3e78e3876bee34e9fea02864cde55c5db85ac08b1d88748f84b`。
- `/tmp/sokan-generation-v5-conservative.json`：採用候補25盤。SHA-256 `964cb03e596f1b014fb40d911ce48c6316843aa10a15333832756158dec1f2b5`。

これらのhashは検証物を取り違えないための記録である。製品の保存データを信頼する根拠にはしない。 `/tmp` は納品資産ではないため、実装時にrecipe・独立検算器・固定manifestをリポジトリへ移して検収する。

## 5. 採用した静的登録とAPI

`dist/assessment-reserve-v5.js` は検算済みの問題データと次のAPIだけを持つ。

```js
reserveAssessments                // frozen assessment array, 134 items
resolveReserveProblem(problemId)  // registered frozen problem | null
reserveCoverage                   // frozen { [assessmentDomain]: count }
```

全題に `role:"assessment"`、`supply:"reserve"` を付ける。`assessment-bank.js` がauthored問題へreserveを追加し、`curriculum.js` の `problems` から学習・app・learning-pathへ同じ内容が渡る。生成IDを特別扱いする別の保存経路を設けない。未登録IDは解決しない。

| 利用者 | trusted登録の使い方 |
| --- | --- |
| curriculum | authored assessmentとreserveを同じ問題集合に登録。通常練習のlesson集合へは入れない |
| learning | 既存byIdが全問題を含み、開始・判定・復元・記録が同じ定義を参照する |
| app | 現在問題・assessment判別が共通problemsから同じIDを解決する |
| learning-path | domainとsupplyを登録済み定義から導き、呼出側の任意タグでは資格や優先を変えない |

盤生成・検算・文面構成は `scripts/build-assessment-reserve-v5.mjs` が事前に行う。ソースは `data/generated-assessment-recipes-v5.json` と `data/generated-assessment-templates-v5.json`。recipe IDとパラメータの正規形、構造snapshot、domain、全受理手、位置・局所fingerprintを照合してから書き出す。authorの計算済みreasonがtemplateに混入した場合も拒否する。

同一入力は同一catalogを生成する。`node scripts/build-assessment-reserve-v5.mjs --check` は現在の出力とのバイト一致を検査する。日付、乱数、ユーザー履歴、探索順で採用IDを変えない。

本番moduleには `node:fs`、`/tmp`、未検収候補の探索がない。共通framesの参照を結び、frozen配列とID mapを作るだけである。各選択肢のframesを重複した盤配列として格納しない。全134題の出力は約581KB（非圧縮）。

## 6. 問題・frames・説明の構築

元問題をspreadして盤だけ差し替える実装は禁止する。元題の `prediction.whiteFinishes`、`prediction.reason`、完成点、blockers、boundary、guide、hintStages、choices、frames、説明文は変異後に古くなる。固定templateには盤・指定点・支持点・有限目標などの構造だけを保存し、計算済み理由・文面・framesを含めない。

materializerは検算結果から次を組み立てる。prototypeでも `prediction.reason` を新しい支持配置・実盤から再構成し、旧reasonの座標を継承しない。

- 予測は `candidate=c`、`reply=r`、実際の白完成点と対応する正答。
- 全選択肢のラベル・順番・初期タイトルは既存counterと共通。domainや完成点数を初期画面に混ぜない。
- 正答後の継続は元盤への本人入力で `safe-four`。仮想黒c・白rを実盤historyに残さない。
- framesは `B`、`B+c`、`B+c+r` から必要なものを再構成し、lastと石の一致を検査する。
- 完成点の座標文、支持石の強調、hint、結果文は検算した窓・集合から導出する。空点にcells、石のある点にpointsを置かない。
- 初期view、選択肢の公開データ、ARIA、途中の継続入力前に、正答事実や本人の受理手集合を漏らさない。

recipe名、検算根拠、保存方式は開発資料へ置く。本番には短いラベルと盤面・色・強調を使い、実装説明の段落を新設しない。

初期・retry・保存復元ではhint表示levelを0にし、本人がヒントを押すまでhintTextを空にする。使用履歴uses/maxLevelは残し、独立確認へ復帰させない。正答予測後でも本人の盤入力が未完了なら、公開viewのfeedback本文は空、盤の強調は指定支持石のみ、future pointsは表示しない。公開viewへguide、prediction.reason、hintStages、正誤フラグを渡さず、ARIAを含む選択肢表示にはid/titleだけを使う。具体的な解説文とframesは内部教材に保持し、回答・ヒント・解説という明示操作の契約に従って表示する。

## 7. 既見・attempt・保存復元

推薦を表示しただけでは消費しない。選題は純粋関数とし、開始操作で次の順に処理する。

1. resolverでIDを再解決し、対象unit/domain/phaseと現在の未見状態を再確認する。
2. `createAttempt` を生成し、既存の学習進捗とpath進捗へ未完了attemptを登録・保存する。
3. 保存成功後に盤を表示する。attempt行自体が次の選題で既見になる。

自分の初回表示に外部閲覧用 `noteExposure` を追加して、同じattemptの `exposureSeen` を誤って立てない。現在のAPIは外部閲覧を未完了attemptの支援・既見へ反映するので、開始記録と外部露出の意味を混同しない。

途中離脱、誤答、ヒント、見本、retry、タブ再読込でも、元のattempt IDとexposureを保持する。完了後の再表示を初見の新attemptとして救済しない。別名の同形盤もposition fingerprintで排除する。古いfamilyだけの露出記録は現在どおり保守的に扱い、生成盤を配るために削除・弱体化しない。そのような履歴では実際の供給数がmanifestの数未満になりうる。

保存は生成IDと通常のattempt操作履歴を持てばよい。盤・family・domain・source recipeのコピーを保持する場合も、照合用とし、信頼根拠にはしない。復元はIDから再構成した問題を起点に、選択、固定手順、本人入力、checkpoint、metrics、支援履歴を既存同様に再実行する。正答選択だけ、仮想手順だけ、任意タグ、改変盤で成功を作れないことを検査する。

同一教材版でのreload復元を必須とする。recipe v1は将来v2が増えても改変・再番号付けしない。将来のcurriculumVersion移行は別の互換表と再実行検証が必要で、現在の版一致ゲートを一括で緩めない。互換性がないattemptを再開できなくても、履歴・既見・旧成果を破棄して未見へ戻さない。

## 8. 推薦と有限な枯渇の扱い

不足domainの既存authored確認を優先し、それが尽きた場合に同domainの検収済み生成manifestを選ぶ。補習直後・保持でも同じ仕組みを使い、既知盤の再使用で独立確認を満たさない。保持は追加初回一式から別日かつ24時間以上、ユーザーの操作時だけ判定する。

未見不足を通常対局の推薦へ黙って置き換えない。生成まで尽きた場合は `exhausted` を構造化して返し、必要domainを未確認のまま保持する。画面は例えば短い `新しい確認なし` と既存の戻る／補習導線で扱い、長い実装説明を表示しない。通常対局を選べても明示予測domainを満たしたことにはしない。

最終的な枯渇自体を消せるとは主張しない。追加recipeを検収・公開する供給運用と、各domainの予備数を把握する必要がある。本番の原確認優先・trusted supply・完全枯渇の契約は [ASSESSMENT-SUPPLY-V5.md](ASSESSMENT-SUPPLY-V5.md) を参照する。自動スケジュール、heartbeat、定期実行、自動再開は使わない。

## 9. 全domainの最終供給manifest

| domain | 原確認 | 原盤消費後の追加供給 |
| --- | ---: | ---: |
| conditions-positive | 6 | 8 |
| conditions-negative | 6 | 7 |
| counter-threat | 6 | 25 |
| counter-clear | 6 | 8 |
| branch-ready | 3 | 8 |
| branch-rebuild | 3 | 8 |
| prepare-two | 3 | 8 |
| prepare-one | 3 | 8 |
| opening-near-ready | 2 | 8 |
| opening-near-blocked | 2 | 8 |
| opening-far-ready | 2 | 8 |
| opening-far-blocked | 2 | 7 |
| practical-win | 2 | 8 |
| practical-defense | 2 | 7 |
| practical-build | 2 | 8 |
| **計** | **50** | **134** |

これは現在の固定allowlistの上限であり、候補空間の全列挙で得られる数学的最大数ではない。全体を1 IDずつ使用・既見登録・JSON再読込して、134題の再配布なしと、全domainで最後に `exhausted` へ到達することを確認した。

### local-edit1：104題

原templateの黒または白を1石移動する。候補・白の指定手は固定し、黒を動かす場合は支持点・arms・continuation.cellsも構造パラメータから作り直す。置き換え先が盤外、重複、指定手の点であれば拒否する。初期五連、石数不一致、要求domain不一致、本人目標の解なし、元課題と事実集合が変わらない候補も拒否する。

固定IDは白1石の `gen-v5-relocate1:{sourceId}:w{from}-{to}`、黒支持1石の `gen-v5-local-edit1:{sourceId}:b{from}-{to}`。from/toは0〜224の盤内添字。両ID形式は内部の同じ `local-edit1` recipeを使い、side・from・toをallowlistから取得する。sourceIdは固定snapshotのキーであり、更新され続ける教材から再取得しない。

白だけで正答事実が固定されるpositiveを無理に増やしていない。実際、白移動だけの先行検査ではconditions-positiveとbranch-readyは0題だった。次の構造変更を使う。

- **conditions-positive**：completion-countの直線・交差支持配置を変える。8題の内訳は完成点2個が6題、3個が2題。生成するcompletion-countの選択肢は **0／1／2以上** とし、結果文には実数と全座標を示す。交差した2完成点を「両端四」と呼ばない。open-four形式をそのまま交差形へ拡張しない。
- **branch-ready**：残る三石の穴・間隔を変え、本人の受理手やその完成点の役割を変える。例は `...double-interior-gap-ready:b112-127`。H8の支持石をH7へ移すと本人の受理手はH8になる。旧reasonの「黒H7」を残してはならない。
- **branch-rebuild／prepare**：関連白の閉塞と支持距離を変え、全受理手・有効方向を再列挙する。prepareは指定黒cが既に両端の空いた三を作る候補を除外した。
- **opening全4条件**：支持距離と白の遮断位置を変え、near/farと成立/不成立をそれぞれ再判定する。不成立の変異は白を除いた配置なら二方向接続が可能なものに限り、もともと接続不能な支持配置を白の遮断と偽らない。
- **practical**：黒即勝ちを優先し、その後に白即勝ち、白の次の二完成点、静かな配置の順で分類する。winでは白の競合脅威も局所signatureに含める。buildでは双方の即勝ちと白の二完成点がなく、黒の次の二完成点もないことを確認する。

石数を保つために、元の関連石を固定の補助位置へ退避する候補がある。その移動先の違いでは数を増やさない。局所の支持・閉塞・全受理手などが変わることを要求し、補助位置を第二signatureから除外する。

### counter-clear-ray1：5題

counter-clearの8題中3題はlocal-edit1、残り5題は陰性専用recipeである。rを通る軸の3白を変更し、白r後の全完成点が空であることを全窓から確認する。

単に「白を除くと完成点が変わる」を要求すると陰性全体を落としてしまう。代わりに、黒c・白r後の黒のない各5点窓で、r以外の白支持数が最大2個であることを記録する。新しい3白のそれぞれが最大支持ペアに参加し、どの石を除いてもその診断構造が変わることを要求する。3白の同じ軸上の間隔が異なり、どの5点窓にもr＋3白が入らない、という否定根拠である。

固定IDは `gen-v5-counter-clear-ray1-s0-d1-m{mask}`、maskは `13 15 19 25 26`。例えば `m13` の白G12/G11/G7は、r=G8に対して支持ペアG12/G11とG11/G7を持つ。完成点はゼロ、元盤の受理手はD8/G8/I8。`m15` はG12/G10とG10/G7という別の間隔条件になる。

### 最終照合と除外

最新作業ツリーの既知447構造と照合した。134の生成初期盤同士、既知盤との位置衝突、生成framesが別の生成初期盤を見せる衝突は0。統一したdiagnostic fingerprintの衝突も0。

最終段階で次の2候補を除外した。これが136候補から134へ減った理由である。

- `gen-v5-relocate1:check-conditions-10:w33-169`：`practice-conditions-03` と局所同型。
- `gen-v5-local-edit1:check-opening-v5-bounded-row-room-far:b110-116`：`practice-opening-v5-far-interior-remedial-far` と局所同型。

教材が後日増えたら、この照合を再実行する。公開済みIDの内容を変更して重複を回避してはならない。

## 10. 実装後の独立審査の受入条件

1. counter-threat原6題を実APIで誤答し、毎回対応補習を完了する第1段階の反例を再現する。次の推薦が未見の同domain生成問題になり、本人入力後にそのdomainの不足が解消できること。
2. 初回・補習後再確認・保持の各経路で、違う未見IDを使えること。23時間59分59秒で保持不可、別日かつ24時間以上で可能という既存契約を維持すること。
3. 開始直後、誤答後、正答予測後、実入力後の保存JSONを復元し、ID・盤・checkpoint・本人入力・支援・既見を保つこと。
4. malformed ID、未登録パラメータ、変造domain/family/board/guide、正答選択だけの完了、履歴欠損を拒否すること。retryやID別名で独立確認を回復しないこと。
5. 134題の全合法入力を製品の判定と独立検算器で比較し、frames・説明・reasonの座標・初期漏洩も検査すること。
6. 全静的教材、段階2教材、生成問題、表示した各framesの間で既知盤照合を行うこと。学習者の過去露出がある候補をスキップすること。
7. 最終枯渇で通常対局をdomain確認の代用品にしないこと。未確認を保ち、教材解決不能を成功として処理しないこと。
8. 旧baseline・旧進捗を保存し、生成ID数をfamily達成数へ水増ししないこと。通常練習や混合キューからassessmentを閲覧してしまわないこと。
9. 全15domainそれぞれについて初回・補習後・保持の供給を実測すること。生成教材の検算だけで本番UI・推薦の接続まで合格にしないこと。

第11節の検証はこの受入条件の一部を/tmp環境で実行したもの。本番統合後に独立審査を行うまでは設計検証済み候補であり、段階3の製品完成や学習完了を示すものではない。

## 11. 全domainの先行prototype検証

この節は本番化前に行った/tmp環境での検証記録である。現在の再生成と製品テストは第12節のリポジトリ内ファイルを使う。

### 検証の範囲

`/tmp/sokan-generation-v5-all-oracle.mjs` は製品の `game.js`、`learning.js`、`learning-objectives.js` をimportしない独立実装である。五・六点窓と全合法手の有限目標を使い、先に原50確認題のdomain・全受理手が一致することを確認した。生成では、単純な構造recipeが作った候補をこのoracleで棄却・認証する。その後、製品の `exerciseSatisfied` と全合法本人入力を比較した。

`/tmp/sokan-generation-v5-overlay/` は、製品 `learning.js` / `learning-path.js` をコピーし、import先だけを差し替えた環境である。共通curriculum shimへ静的教材と生成manifestを登録し、実際の `createAttempt`、予測・盤入力、`restoreLearningAttempt`、`recordAttemptEvidence`、`selectAssessment`、`nextLearningStep`、`unitStatus` を呼ぶ。学習・pathアルゴリズム自体を通過しやすいように変更していない。本番の配信ファイルやブラウザを変更・操作した試験ではない。

| 最終134題での検査 | 結果 |
| --- | --- |
| IDから盤・metadata・正答・guideを復元 | 134題一致 |
| 独立oracle対製品objective | 全25,969合法本人入力が一致 |
| 初期・予測後・完了などのattempt復元 | 536回通過 |
| 原バンクを実APIで誤答 | 50題 |
| 対応domainの補習を実APIで完了 | 50回 |
| 原盤消費後の推薦→新生成題→不足解消 | 全15domainで通過 |
| 盤改変／未登録ID | 268件を拒否 |
| 新生成盤の順次供給・既見登録・JSON再読込 | 134回、同ID再配布なし |
| 完全枯渇 | 全15domainで明示的exhausted、未確認を維持 |
| 保持 | 6単元・15domainで別の生成題を使用して成立 |
| 23時間59分59秒時点の保持 | 6単元すべて拒否 |
| 実盤から再構成したreason | 134題の座標・完成点・支持・閉塞・窓を検査 |
| framesの盤・last・cells/points | 735フレーム通過 |
| 位置・局所signature・生成frameから別初期盤への衝突 | すべて0 |

conditionsの既存契約は予測1決定で完了する。他の13domainでは正答予測に本人入力を加えた2決定を必要とし、今回の経路試験でもその値になった。固定黒白手を本人入力に数えていない。

完全枯渇の試験は、実selectorの `null` を不足domain付きの `exhausted` に変換するprototypeラッパーを使った。この試験の時点では製品 `nextLearningStep` の通常対局フォールバックは未変更だった。その後の本番統合では第8節と供給ゲート設計に従う明示的な不足分岐を採用する。

overlayでは生成問題を先に解決してcurriculumへ登録した。この方式を第5節の事前コンパイル済み静的登録として本番化した。実ブラウザでの漏洩・操作の独立審査はこのprototype検証の範囲に含まない。

### 性能

local-edit候補の探索・選別は約24.6秒だった。実行時にこの探索を繰り返さない。最終の134題をすべて解決してdescriptorまで作るcold importは約0.95秒、IDを直接再解決するcacheなしの単回測定は中央値6.47ms、95パーセンタイル16.24ms、最大36.17ms。Node v26.12.1 / macOS arm64の値であり、実ブラウザの値ではない。製品では1題ずつの解決と上限付きcacheを使い、最初に134題すべてをmaterializeする必要はない。

### 最終ファイル

全て絶対パス。これらはprototypeの引継ぎ物で、本番へ直接配信する配置ではない。

- `/tmp/sokan-generation-v5-manifest.json`：**最終134 ID**、固定recipeパラメータ、domain、位置・局所fingerprint、全受理手等のcertificate。
- `/tmp/sokan-generation-v5-templates.json`：原50templateの固定構造。authorの文面・frames・計算済みreason・完成点を保存しない。
- `/tmp/sokan-generation-v5-runtime.mjs`：allowlistからIDを解決し、盤・metadata・選択肢・guide・framesを再構成するprototype。
- `/tmp/sokan-generation-v5-descriptors.mjs`：実盤からcompletion-count、counter-response、remaining-four、followup-directions、connection、priorityのreasonと結果文を構成する。
- `/tmp/sokan-generation-v5-all-oracle.mjs`：独立したdomain・局所目標判定。
- `/tmp/sokan-generation-v5-final-candidates.json`：最終134盤と検算事実、再構成済みprediction。
- `/tmp/sokan-generation-v5-diagnostic-signatures.json`：補助石を除いた局所signatureと採用点の監査用データ。
- `/tmp/sokan-generation-v5-overlay/check.mjs`：全合法本人入力、復元、原50誤答→補習→15domain供給を再実行。
- `/tmp/sokan-generation-v5-overlay/lifecycle.mjs`：全134供給・枯渇、保持、盤・ID改変拒否を再実行。
- `/tmp/sokan-generation-v5-descriptor-check.mjs`：reasonとframesの座標を再検査。
- `/tmp/sokan-generation-v5-audit.mjs`：静的教材・生成盤・frames・局所同型を再照合。
- `/tmp/sokan-generation-v5-manifest-summary.json`、`/tmp/sokan-generation-v5-overlay-summary.json`、`/tmp/sokan-generation-v5-lifecycle-summary.json`、`/tmp/sokan-generation-v5-descriptor-summary.json`、`/tmp/sokan-generation-v5-audit-summary.json`：最終結果。

最終manifest SHA-256:
`c12fce771135bb8fc881d7a8280d3e84f439f532f870d6eb3fa93769d3200c20`

構造template SHA-256:
`43184ccfea116933fd1cdcd5e11748396f2873be11b7b82e4161be37c4c2f6e6`

recipeを探索し直す場合は `fixed-support.mjs` → `expand.mjs` → `finalize.mjs` → `audit.mjs` → `prune.mjs` の各 `/tmp/sokan-generation-v5-` スクリプトを使う。先行counter生成には第4節のprototype・independent・conservativeを使う。最終登録前にauditをもう一度実行し、衝突0を確認する。この試行用構成を整理した本番ソースと再生成手順は第12節へ移行済みである。


## 12. 本番化した供給catalog

### 所有ファイルと再生成

- `data/generated-assessment-recipes-v5.json`：134個の固定ID、recipeパラメータ、検算certificate、位置・局所signature。
- `data/generated-assessment-templates-v5.json`：原template50個の構造snapshot。文字列の解説、frames、計算済みreason・完成点は持たない。
- `scripts/build-assessment-reserve-v5.mjs`：recipeの再構成、certificate照合、静的catalogの書き出し。`--check`で再現性を検査する。
- `scripts/reserve-oracle-v5.mjs`：製品predicateをimportしない独立した有限目標・予測検算。
- `scripts/reserve-novelty-v5.mjs`：補助石を除く局所signature。
- `scripts/reserve-descriptors-v5.mjs`：現在の盤から具体候補、完成点、支持、遮断白、方向と理由文を構成する。
- `dist/assessment-reserve-v5.js`：生成済みのbrowser用catalogと第5節のAPI。
- `tests/assessment-reserve-v5.test.mjs`：教材・予測・全合法入力・保存復元・非表示・既知盤・枯渇反例の検査。

```sh
node scripts/build-assessment-reserve-v5.mjs
node scripts/build-assessment-reserve-v5.mjs --check
node --test tests/assessment-reserve-v5.test.mjs
```

ID・盤・全受理手集合は最終134題から変更していない。固定recipeの意味を後日変更せず、別の構造を追加するときは新しいrecipe版・新IDを使う。

### 本番問題の表現

prepareは「黒cを使う活三は何方向に作れる？」と対象を明示する。同じ軸の反対向きに複数候補がある場合も1方向として説明する。practicalの勝ち選択肢は「今すぐ五連」。completion-countの2以上には実数と全完成点を説明し、交差完成点を両端四と呼ばない。

counter-threatの結果盤では白rを含む実際の四石と完成点を発光させる。counter-clearはrと各軸の最大支持組の白石を強調し、黒のない5点区間で白が最大何個かを示す。空の5点窓を大量に発光させない。branch・prepare・openingも具体候補・完成点・遮断白を実盤のreasonから強調し、古いtemplateの座標を引き継がない。

branchの説明例は、可能なら四石が連続する候補を先に選ぶ。外側の白によって完成点が一つになる直接の対照を示し、本文と発光は同じ `reason.example` を参照する。最初のrebuild reserveは黒H7でH6〜H9を四にし、白H5が一方を閉じ、H10だけが完成点になる例である。全候補から二完成点を作れないという検算結果は維持する。表記は「指定の黒石」。counter-clearにも最大支持組の具体座標を一群示す。

### 担当範囲の製品検証

正式テストは134題すべてを共通curriculumから `createAttempt` して実行する。以下はその検査範囲である。

2026-11-13の担当テスト実行は **10テスト、失敗0**。再生成 `--check` も一致した。

- 全25,969合法本人入力を実 `playLearningMove` と独立oracleで比較。
- counterの白7,194応手、practicalの白3,273手、branch/prepareの予測用黒6,944手を列挙。完成点は別実装の方向走査でも照合。
- ID復元、初期・予測後・完了・retry、盤や未登録IDの改変拒否。既存の失敗・支援履歴を保存。
- 全静的教材・全手順・生成盤・framesとの位置照合と、authored lessonを含めた局所同型照合。
- 原counter-threat6題を全誤答→毎回対応補習→新reserve推薦→独立完了で不足解消する反例回帰。
- 134題の初期・再試行・ヒント使用状態からの復元でヒントを自動表示しない。利用履歴は維持し、本人入力前は答えの空点や説明を公開しない。
- 同じ固定入力からの再生成一致、static catalogにnode:fsや/tmp依存がないこと。

全15domainの本番選題、authored優先、保持、完全枯渇ルートは別の `tests/assessment-supply-v5.test.mjs` が担当する。UIを含む段階3全体の独立審査に合格するまでは、教材・供給の製品テスト通過だけで完成とは認定しない。
