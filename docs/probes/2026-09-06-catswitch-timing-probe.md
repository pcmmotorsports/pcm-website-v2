# 切分類計時探針 —— ⟦search-CATSWITCHSLOW⟧ 兩發要用【同一把尺】

> 立於 2026-09-06 線 `-f3`。**存在的理由只有一個:35 的 preview(修前)與 36 的 preview(修後)是兩發不同時候、不同人跑的量測,而它們只有用同一段程式碼量才可比。**
> 🔴 **不要重打這段** —— 重打就是第二把尺。複製整段貼進 Playwright `browser_evaluate` / DevTools console。

---

## 1 · 🛑 先讀這一段,不然量出來的數會騙你

**「點下去 → 第一個視覺變化」不可以量整頁。**

🔬 實錘(2026-09-06,本機鑽機 A/B,同一台):我第一發把 `MutationObserver` 掛在 `document.body`,修前修後印出**一樣的數**(`17 ms` / `60 ms`)⇒ 差點下「這個修沒生效」的結論。

🎯 成因:**側欄那一列的 `is-active` 高亮修前就有,而且它是同步的** —— 那是一個真的視覺變化,只是**不在客人盯著看的地方**。

⇒ ✅ **觀察範圍只掛結果區**:`.pp-grid`(商品格線)+ `.pp-count` 的父節點(件數那一列)。
⇒ 📌 所以本檔量到的「第一個變化」讀作:**客人盯著結果區,多久之後那裡才有東西動。**

---

## 2 · 量測片段(整段複製,不要重打)

```js
async () => {
  const measure = async (label) => {
    const row = [...document.querySelectorAll('.fs-tree-l1')].find(b => b.textContent.startsWith(label));
    if (!row) return { label, error: 'row not found' };
    const grid = document.querySelector('.pp-grid');
    const bar = document.querySelector('.pp-count').parentElement;
    const before = grid.innerHTML;
    const countBefore = document.querySelector('.pp-count').textContent || '';
    const t0 = performance.now();
    let firstInResults = null, firstFeedback = null;
    const obs = new MutationObserver(() => {
      if (firstInResults === null) firstInResults = Math.round(performance.now() - t0);
      if (firstFeedback === null) {
        const c = document.querySelector('.pp-count')?.textContent || '';
        const g = document.querySelector('.pp-grid');
        if (c.includes('更新中') || (g && g.className.includes('is-loading'))) firstFeedback = Math.round(performance.now() - t0);
      }
    });
    obs.observe(grid, { subtree: true, childList: true, attributes: true, characterData: true });
    obs.observe(bar, { subtree: true, childList: true, attributes: true, characterData: true });
    row.click();
    const done = await new Promise((res) => {
      const iv = setInterval(() => {
        const g = document.querySelector('.pp-grid');
        const c = document.querySelector('.pp-count')?.textContent || '';
        if (g && g.innerHTML !== before && c !== countBefore && !c.includes('更新中')) { clearInterval(iv); res(Math.round(performance.now() - t0)); }
        if (performance.now() - t0 > 60000) { clearInterval(iv); res(null); }
      }, 8);
    });
    obs.disconnect();
    return { label, firstInResults, firstFeedback, done, countAfter: document.querySelector('.pp-count')?.textContent };
  };
  const names = [...document.querySelectorAll('.fs-tree-l1')].slice(0, 6).map(b => b.textContent);
  const a = await measure(names[0].replace(/[0-9]+$/, ''));
  await new Promise(r => setTimeout(r, 2000));
  const b = await measure(names[1].replace(/[0-9]+$/, ''));
  return { where: location.origin, names, a, b };
}
```

**怎麼跑**:開 `<preview 網址>/products` ⇒ 貼上 ⇒ 拿回傳的 JSON。兩個分類各一發、一次跑完。

---

## 3 · 三個欄位各自是什麼

| 欄位 | 讀作 |
|---|---|
| `firstInResults` | 點下去到**結果區**第一次有任何變化,幾 ms |
| `firstFeedback` | 點下去到**「更新中…」或 `.pp-grid.is-loading`** 出現,幾 ms。🔴 **修前這一格必為 `null`** —— 它就是判別兩個世界的那把尺 |
| `done` | 點下去到**內容真的換完**(格線變了 + 件數變了 + 不再是「更新中…」),幾 ms |

🛑 **`firstFeedback === null` 而 `firstInResults` 有值,不是壞掉** —— 那正是修前世界的長相。

---

## 4 · 已有的讀數(引用時**連環境一起搬**)

**本機鑽機**(`storefront-probe` 的 `next dev` + **108 件**種子,Chromium 桌機):

```
                  firstInResults      done
修前(恆 false)   184 / 251 ms      203 / 265 ms     ← 兩個數幾乎重合 = 等待期間零回饋
修後              58 /  33 ms      109 /  81 ms
```

🔴🔴 **這組毫秒數【不可以】搬去正式站** —— 那台的 RSC 只要 100–265 ms,而正式站量到 **3.4–8.5 秒**(板列 `⟦search-CATSWITCHSLOW⟧`,正本 `~/pcm-mailbox/量-抽屜正式站-20260906.md`)。
✅ **可搬的是比例**:「沒有回饋的那段佔整個等待」修前 **91% / 95%** ⇒ 修後 **53% / 41%**。

**preview(正式資料,25,190 件商品)** —— 35 已量、36 待量:

```
35 部署 ocyp0rdzi(front 收 69870bc28 = 修前)      2026-09-06 07:3x
分類                  firstInResults    done      firstFeedback
碳纖維部品 (2438)         3318 ms      3334 ms       null
腳踏後移與傳動 (1660)     3212 ms      3224 ms       null
```

🎯 **兩個數的差只有 16 / 12 ms ⇒ 等待的 99.5% 完全沒有回饋。**
🟢 `firstFeedback` 兩發都 `null` —— 同時證明**這是修前的部署**,以及**這把尺分得出兩個世界**(不是一支恆印 `null` 的死程式)。
🔵 對照本機鑽機修前的 184 / 251 ms:**正式資料是它的 13–18 倍**。⇒ 🛑 毫秒不可跨環境搬;而比例兩邊都成立(本機 91% / 95%,正式資料 99.5%)。
⚠️ 存取要 share token:裸網址 `http_code=302` 轉 Vercel SSO,帶 token `307` → 跟完 `200`;**token 綁單一部署,alias 一換就失效**(memory `reference_vercel-share-link-is-per-deployment`)。

**36 的 preview(修後)**:同一把尺、同樣兩個分類 —— **還沒量。**

---

## 5 · 這份探針答不出什麼

· **只試 2 個分類** ⇒ 「哪些分類會慢」沒有量。
· **桌機 Chromium** ⇒ 不是真手機、不是行動網路(真手機只會更慢,那個量沒做)。
· **各 1 發** ⇒ 沒有分布、沒有中位數;`ms=26993`(27 秒)那種尾巴這把尺看不到。
· `done` 的判準是「格線變了 **且** 件數變了」⇒ **切到一個件數剛好一樣的分類會量不到終點**(會卡到 60 秒逾時回 `null`)。撞到 `null` 先看這一條,不要當成站掛了。
