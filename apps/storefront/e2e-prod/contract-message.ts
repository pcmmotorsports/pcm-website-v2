/**
 * E2E production build 的「資料合約」失敗訊息 —— **挑哪一句** 這件事抽出來, 讓它可以被測。
 *
 * 🔴 **為什麼要抽出來**(2026-09-04, 線 `-db` 對 E2E 紅的成因分析):
 *   `global-setup.ts` 原本三個分支寫在一個 Playwright 的 async 函式裡
 *   ⇒ 要驗「哪個世界印哪一句」就得起一顆真瀏覽器 ⇒ **實際上沒有人在驗它**,
 *   而那一整天四發紅**全部**落在最泛用的那一句上, 那句說「疑似 DB 未連通」——
 *   🛑 **而同一發裡商品卡渲染了 100 張 ⇒ DB 明顯有回應。**
 *
 * 📌 **⇒ 原作者【想到了不對稱】而只寫了一邊**:檔裡本來就有一個分支處理
 *   「件數有而卡片沒渲染」, 訊息逐字寫著「這不是 DB 未連通(DB 明顯有回應),
 *   訊息不可混為一談」—— 而**反過來那半(卡片有而件數沒有)掉進了泛用句。**
 *
 * ⚠️ **本檔【不改行為】** —— 三個世界該不該紅完全沒動, 動的只有【紅的時候說什麼】。
 */

export type ContractProbe = {
  /** `.pp-grid a[href^="/products/"]` 數到幾張商品卡 */
  cardCount: number;
  /** `.pp-count` 的文字解析出一個 > 0 的整數了嗎 */
  totalOk: boolean;
  /** `totalOk` 為 true 時的那個數 */
  total: number;
  /**
   * 🔴 `.pp-count` 的**原始文字**(截斷)。
   * 加它的理由(2026-09-04, 線 `-front` 讀碼推翻了我的結論):
   *   `totalOk = false` 有**三種**世界, 而原本的訊息對三種印同一句:
   *     (a) count === null ⇒ 畫面是「件數未能載入」
   *     (b) 那一刻抓不到元素 ⇒ `innerText()` 拋 ⇒ `''`
   *     (c) count === 0     ⇒ 畫面是「0 件商品」⇒ total=0, 而閘要 `> 0`
   *   🛑 **而我在報告與 commit body 裡把 (a) 當成事實寫了** —— 而 `-front` 讀碼指出
   *      (a) 與「商品卡 100 張」在碼上不相容(兩條 catch 都回空清單)。
   *   ⇒ 📌 **我分不出來, 因為【那個字從來沒有被印出來】。** 印它, 下一次就分得出來。
   */
  countText: string;
  /** 第一張商品卡在預算內 visible 了嗎 */
  cardsRendered: boolean;
  /** 等商品卡用掉的預算(毫秒), 只為了寫進訊息 */
  navTimeoutMs: number;
};

/** 回失敗訊息;世界是好的就回 `null`。 */
export function contractFailureMessage(p: ContractProbe): string | null {
  if (p.cardCount >= 1 && p.totalOk) return null;

  // ① 件數有、卡片沒渲染 ⇒ DB 有回應, 問題在 streaming / 前端渲染。(既有分支, 字面不動)
  if (p.totalOk && !p.cardsRendered) {
    return (
      `[e2e-prod 資料合約] /products 件數=${p.total}(DB 有回應)但商品卡在 ` +
      `${p.navTimeoutMs / 1000}s 內未渲染完成 — 疑似 streaming/前端渲染卡住` +
      `(非 DB 未連通),先中止整套 E2E。`
    );
  }

  // ② 🔴 **新增**:卡片有、件數沒有 ⇒ 這是 ① 的鏡像, 而它原本掉進 ③ 的泛用句。
  if (p.cardCount >= 1 && !p.totalOk) {
    return (
      `[e2e-prod 資料合約] /products 商品卡=${p.cardCount}(DB 有回應、目錄查得到)` +
      `但【件數】解析不出來 — \`.pp-count\` 的原文是 ${JSON.stringify(p.countText.slice(0, 60))}` +
      ` ⇒ **不是 DB 未連通**(DB 明顯有回應)。先中止整套 E2E。` +
      `\n  🔵 三種世界靠上面那個原文分:` +
      `「件數未能載入」= count 為 null · 空字串 = 那一刻抓不到那個元素 · 「0 件商品」= 真的 0 件。` +
      `\n  🛑 **不要從這一句推出是哪一種 —— 看那個原文。**`
    );
  }

  // ③ 泛用:卡片是 0。這才是「疑似 DB 未連通或冷快取為空」真的成立的世界。
  return (
    `[e2e-prod 資料合約] /products 回 2xx 但無目錄資料` +
    `(商品卡=${p.cardCount}、件數=${p.totalOk ? p.total : '不可解析'})` +
    ` — 疑似 DB 未連通或冷快取為空,先中止整套 E2E 避免逐測噴難懂的逾時。`
  );
}
