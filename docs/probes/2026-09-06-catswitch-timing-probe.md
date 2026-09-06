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

```
36 部署 o2jd3bqq4(含回饋片 94367b16e = 修後)        2026-09-06 09:0x
分類                  firstInResults    done      firstFeedback
碳纖維部品 (2438)          10 ms      3210 ms        10 ms
腳踏後移與傳動 (1660)       4 ms      3277 ms         4 ms
```

🟢 **`firstFeedback` 從 `null`(35)變成數字(36)** ⇒ **同一把尺、兩個世界、兩種輸出 = 尺有判別力。**
🎯 「沒有回饋的那段佔等待」**99.5% ⇒ 0.3% / 0.1%**。
🔵 `done` 3210 / 3277 vs 修前 3334 / 3224 —— **沒變**,正如設計:② 一毫秒都沒動。

### 4.1 🔴 量具事故:`curl` 的那組讀數全部作廢

`curl` 帶 `_vercel_share` token **從來沒有進到我們的站**,它落在 **Vercel 的登入頁**,而那頁**回 `200`**:
```
curl -sL "<preview>/products?_vercel_share=…"   ⇒  http 200
  <title>Login – Vercel</title>        pp-count 命中 0 次
```
🛑 **`http_code=200` 不是「我進得去」** —— 兩個世界(進得去 / 被擋)**印同一個 200**。
⇒ 作廢 07:55:49 那四發與整組 curl 讀數;**「兩把尺打架」的謎題就此解掉 —— 其中一把根本沒對準目標。**
✅ **修法(本檔 §6 步驟 0 已改)**:驗存取一律看**內容標記**(`pp-count` 的命中數),不看 `http_code`。
🔵 瀏覽器那組**仍然有效** —— Playwright 帶得動 cookie,而每一發都從 DOM 讀到真的件數(`2438 件商品`)。

---

## 5 · 這份探針答不出什麼

· **只試 2 個分類** ⇒ 「哪些分類會慢」沒有量。
· **桌機 Chromium** ⇒ 不是真手機、不是行動網路(真手機只會更慢,那個量沒做)。
· **各 1 發** ⇒ 沒有分布、沒有中位數;`ms=26993`(27 秒)那種尾巴這把尺看不到。
· `done` 的判準是「格線變了 **且** 件數變了」⇒ **切到一個件數剛好一樣的分類會量不到終點**(會卡到 60 秒逾時回 `null`)。撞到 `null` 先看這一條,不要當成站掛了。


---

## 6 · 36 的 preview 要**一次量兩件**(照這個順序,不要分兩趟)

> 🔴 **為什麼寫成清單**:兩件事共用同一個 share token,而**token 綁單一部署、alias 一換就失效**
> ⇒ 分兩趟做,第二趟很可能拿到 302 而要重來;而重來的那一發**已經不是同一個部署狀態**。

**0. 拿 token**(`get_access_to_vercel_url`),然後 `curl -s -o /dev/null -w '%{http_code}'` 記下 http_code。
   裸網址 `302`(轉 Vercel SSO)· 帶 token `307` → 跟完 `200`。**兩個都記,那是「我真的進得去」的證據。**

**1. 件事一 —— 回饋那格(修後)**:照 §2 原封跑,兩個分類各一發。
   🟢 **判準只有一個:`firstFeedback` 這次必須是【數字】**。
   ⇒ 35 那發是 `null`(修前),36 這發是數字(修後)⇒ **同一把尺、兩個世界、兩種輸出** = 尺有判別力。
   🛑 `firstFeedback` 仍是 `null` ⇒ **不要先怪碼**:先確認這個部署真的含 `94367b16e`(回饋片)。

**2. 件事二 —— `tax=` 那一格**:用 Vercel runtime logs 撈 `catalogRoute`。
   ```
   get_runtime_logs  query="catalogRoute"  since="30m"  limit=30
   ```
   🔵 **撈之前先打幾發**(§2 那一輪就會產生),否則撈到 0 而那個 0 只代表「還沒有人打」。
   ⚠️ **`deploymentId` 用 URL 形式撈過一次是空的** —— 那時我沒有正對照,所以**不知道是真的沒有還是篩錯**。
      ✅ 這次先跑一發 `group_by="requestPath" since="1h"` 當**尺的正對照**,看得到 `/products` 有計數再往下。

   **怎麼判(三選一,寫在這裡免得當場猜)**
   | 讀到的 | 結論 |
   |---|---|
   | `tax=` 帶分類遠大於不帶 | 就是它 —— 而真正奇怪的是「同一支 `vehicle-taxonomy-v3` 快取,為什麼只有帶分類沒命中」 |
   | 五格都小而 `total=` 也小 | 慢的在這一行**之外**(RSC 序列化 / 傳輸)⇒ 儀器要往外挪一層 |
   | 五格都大 | 我瀏覽器那把尺有問題,以 `curl` 那組為準,重畫 §4 的數字 |

**3. 兩件都量完再回報** —— 🛑 **不要只回報好消息那一件**。

### 6.1 ⚠️ 已知的量具風險(先寫,免得當場把它讀成結論)

🔴 **同一件事我量到過兩組對不起來的數**:
```
              瀏覽器 fetch(body 段)      curl(total)
帶分類            2979–6085 ms            1099–2243 ms   ← curl 這組【會變快】
不帶分類            151–252 ms             810 ms        ← curl 這組反而慢
```
⇒ 📌 **在對得起來之前,`fetch` 那組的絕對毫秒不可以拿去解釋 log。**
🟢 **仍然站得住的是【真的點下去】那一組**(3212 / 3318 ms),因為它與板上**獨立**量到的正式站
3371 / 3378 / 5487 / 6259 ms 同一量級 —— ⇒ **§2 的點擊計時是主尺,`fetch`/`curl` 是輔助。**


---

## 7 · 🔴 真兇(2026-09-06 09:3x 釘住)—— 而**它與「只有分類軸」是兩件事**

**那 3 秒 = `fetchVehicleTaxonomy` 逾時後整包不進快取,下一發又 cold。** 三把尺:

| # | 尺 | 讀到什麼 |
|---|---|---|
| ① | 查證 agent | `revalidating cache with key` 在 `unstable-cache.js:183` —— **STALE 分支背景重跑 callback 而它 reject 才印**;MISS 分支不印 |
| ② | 完整的 err | `[fetchVehicleTaxonomy] 第 5 頁(offset 4000)失敗: canceling statement due to statement timeout`,`cause.code` **57014** |
| ③ | 正式庫唯讀 | `anon statement_timeout=3s`;`vehicle_taxonomy_public` 12,197 列;同 `ORDER BY` 下 `OFFSET 0`=**108 ms** · `OFFSET 4000`=**843 ms** · `OFFSET 12000`=211 ms |

⇒ `BATCH=4` 併發 + 負載 ⇒ 第 4/5 頁過 3 秒 ⇒ throw ⇒ **整包不進快取** ⇒ 下一發又 cold。
🟢 **修法**:**一發拿全部**(全掃 211 ms 遠小於 3 秒),不分頁。**不動 `unstable_cache` 那一層。**

### 7.1 🛑 已解釋的與**沒有**解釋的,分開寫

✅ **解釋得了**:為什麼 cold 時要 2.8–5.8 秒 · 為什麼「打第二發也不會變快」(每發都 throw ⇒ 永遠寫不進去)。
🔴 **解釋不了**:**為什麼只有分類軸 cold,而品牌 / 價格 / 無篩選 warm**(16 發零例外)。
　主視窗的猜想是「STALE 視窗與併發量的巧合」—— **標未確認**。
📌 **我們有一個解釋得了【時間】、解釋不了【分佈】的成因。**
🛑 **不要因為修法有效就宣布那個形狀被解釋了** —— 修法讓每一發都快,那會讓這個問題**永遠不會再被問**,而它沒有被回答。

### 7.2 🔴 順這條線撞到的另一件事(**正式站 · 客人看得到 · 靜默**)

近 6 小時 `branch=main`(**正式站**)的 runtime logs:
`[tryVehicleTaxonomy] cached fitments fetch failed … 57014` 命中 **31 個相異網址**,**全部是商品詳情頁**;
00:20:10–00:21:12 **一分鐘內 9 發**。

🎯 `fetchVehicleTaxonomy`(`products.ts:1006-1009`)**刻意丟掉 `failed`**,而 `tryVehicleTaxonomy` catch 之後回的是**空陣列**(`:999-1003`)
⇒ 🛑 **那一發請求的車款對照表是【空的】,而頁面照樣回 `200`。**
⛔ ~~舊說法:被 `try` 接住 ⇒ 客人拿到一份【殘缺的】車輛對照表~~ ⇒ 🔴 **訂正:不是殘缺,是【空的】。**

⏰ **這要另開一列** —— 同一個根因,**受害面不同**(PDP 的車款資訊,不是切分類的等待)。
「一發拿全部」**應該**會一起修掉它,而**那要驗過才能說**。
