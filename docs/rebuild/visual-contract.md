# 再構築UIの表示契約

`dist/rebuild-ui.css` を `game-ui.css`、`board-themes.css` の後に読み込む。既存のヘッダー、盤、石の描画とテーマ色は保持し、画面構造と操作領域を上書きする。

## 固定枠

- `body[data-mode]`: `learn` / `play` / `review`。3タブは常に同じ位置。
- `.topbar` 44px、`#context-bar` 40px、盤幅100%、`#board-controls` 48px、8px間隔、`#panel` 残り高さ、下部3タブ56px＋safe-bottom。
- `.board-frame`: border1px＋padding1px。393px幅なら盤本体389px、393×852に対して45.1926%。文章・誤答・結果で盤幅や上端を変更しない。
- `#panel` は `.panel-content`（内部スクロール）と `.panel-actions`（56px固定）の2要素を必ず持つ。actionsが空でも高さを残す。文章は14px、短い状態は12px以上。
- 393×852、safe-top59/safe-bottom34でpanel外枠約162px。上下borderを引き、actions56pxを除く領域が説明用。表示可能高が小さくても盤を縮めず説明欄をスクロールする。
- context内の44pxボタンは40px行から上下2pxだけはみ出す。上下の実操作とは競合させない。
- `[hidden]` を尊重する。`body[data-screen="library"]` では `#arena` 非表示、`#library-view` をflex＋内部スクロール。library時のcontextはアプリがhiddenを指定する。

## 内容と入力

- ライブラリ: `.library-head`（h1/h2＋操作）、`.learning-sections`（3ボタン）、`.unit-list .unit-card`、`.problem-list .problem-card`、`.record-list .record-card`。
- カード内: `.unit-number`、`.unit-copy > strong + span`、任意の`.unit-progress`と末尾アイコン。
- 盤下: `.lesson-kicker`、`.lesson-heading`、`.lesson-copy`、`.choice-list`、`.step-dots`、`.stage-actions`、`.review-phases`、`.move-timeline`、`.play-console`、`.result-summary`。
- 選択表示: `.active`、`aria-pressed="true"`を利用可能。step dotsは`data-active="true"`または値なしの`data-active`。false値は非アクティブ。
- 未選択は非ボタンの`.place-prompt`、選択後は`.place-button`。両方flex:1で同じ主操作枠を占める。主要ボタンは44px以上。
- 盤交点は全体表示では約24.3px間隔。44pxを全交点へ設定すると盤の入力が重なるため、このCSSでは交点サイズを拡張しない。誤タップ対策は仮置きと拡大の入力実装が担う。

## 盤上の原因表示

- `#board-overlay .shape-ring.focus|danger|good`: r20の既存石の輪、fill:none。themeのcircle塗りを上書きする。
- `.shape-point.focus|danger|good`: r15の空点。暗い内部＋色輪。直後の`text.shape-letter`にA/B等を置く。
- dangerは破線も併用。短い出現のみ、継続点滅なし。Reduce Motionでは静的に表示。
- `.winning-line`はfill:none、丸い端。既存themeの勝利線色を保持。
- DOM、盤位置、選択中、読み上げ用の意味はアプリが管理する。CSSは意味上の正誤や習得状態を作らない。

## 確認範囲

ソース上の構造・既存CSSの上書き順を確認。ブラウザー操作は親担当のため未実施。最終確認では全3mode、library、未選択/仮置き/失敗/完了、safe59/34、長文のスクロール、各themeの輪とA/Bの視認性を確認する。
