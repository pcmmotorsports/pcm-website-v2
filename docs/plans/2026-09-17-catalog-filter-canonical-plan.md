# plan · 目錄篩選網址的 canonical 要不要收斂(2026-09-17,前台窗)

> 🛑 **本檔只是 plan,一行碼都沒動。** 鐵則 8:碰 SEO 標籤 ⇒ 先寫 plan 等 Sean 批。
> 觸發:Sean 匯出 Search Console「已檢索 - 目前尚未建立索引」22 筆,其中 **4 筆是篩選網址**。

---

## 0. 🔴 先更正一件事 —— 我第一次量錯了,而我差點拿它去推翻主視窗

```
我第一發:curl "…/products?pbrands=ebc?t=123"   ← 🔴 我自己把 & 寫成 ?, 參數變成 "ebc?t=123"
         ⇒ 那個值解不出品牌 ⇒ canonical 收斂回 /products
         ⇒ 我差點回報「主視窗的證據不對」
✅ 接好網址重量:canonical = /products?pbrands=ebc(自我指涉)⇒ **主視窗是對的**
```
📌 **判別句(與昨天那個 629/1,119 同一族):對不上的時候,先問「我問的是不是同一個問題」。**
**昨天那一次救了一支好板;這一次救的是【別人的信譽】。**

---

## 1. 現況(全部實測,2026-09-17)

### 1-1 canonical 現在長怎樣

| 網址 | canonical | robots |
|---|---|---|
| `/products` 🔵正對照 | `/products` | (無) |
| `/brands/ebc` 🔵正對照 | `/brands/ebc` | (無) |
| `/products?pbrands=ebc` | **`/products?pbrands=ebc`**(自我指涉) | (無) |
| `/products?pbrands=gilles` | 自我指涉 | (無) |
| `/products?categories=車身防護與防摔` | 自我指涉 | (無) |
| `/products?categories=拉桿與把手&pbrands=gilles` | 自我指涉 | (無) |
| `/products?pmin=3000&pmax=10000` | **無** | **`noindex, follow`** |

### 1-2 🟢 這【不是】沒人管,是一個寫過理由的決定

`apps/storefront/src/lib/catalog-canonical.ts` 檔頭逐字:
> 「**會變 ⇒ 它是一個真的頁,進 canonical。不會變(只是換排序 / 換每頁幾筆)⇒ 不進 canonical,讓它們併回同一個網址。**」
> 「…那些頁連自我指涉都沒有。**自我指涉的 canonical 在這裡是最誠實的選擇。**」

而價格區間那格**刻意走 noindex 而不是 canonical**,理由也寫著:
> 「Google 看得出來不成立的宣告(內容根本不同)⇒ 它會忽略我們的 canonical、自己挑一個。**要不收錄就直說 noindex,不要用 canonical 假裝。**」
> 「🔴 **noindex 的頁一律不產 canonical**…那兩個訊號互相打架…**Google 已知會把 `noindex` 沿著 canonical 傳給目標頁**」

⇒ 📌 **主視窗提醒的「canonical 與 noindex 不要一起下」——【這支檔已經照做了】,而且是作者自審時抓到的。**

### 1-3 規模

```
sitemap:25,434 條,🟢 帶問號的【0 條】·  /brands/ 26 條 · /products 1 條
   ⇒ 📌 我們【沒有】把篩選網址送給 Google。它是從站內連結爬到的。
組合空間(客人看得到的口徑):
   大分類 17 · 含子類 85 · 品牌 23 · 車款 12,482 列
   ⇒ 分類×品牌 = 85 × 23 ≈ 1,955
   ⇒ 再乘車款 ⇒ 🔴 **實質無上限**
```

### 1-4 🔵 而 Google 現在的行為是「已檢索、未建立索引」

**那是 Google 爬過之後【自己決定不收】。** 不是錯誤狀態,也沒有罰則。
⇒ **今天沒有任何客人受影響,也沒有排名損失的證據。**

---

## 2. 🔴 主視窗那個假設不成立(要寫清楚,免得照它做)

> 「有專門品牌頁 ⇒ `/products?pbrands=X` 就是那一頁的【重複版】⇒ 該指過去」

**查了:兩頁不是同一種東西。**
```
/brands/ebc            品牌故事頁(lede / about / craft / highlights)+ 【精選幾件】商品
                       資料來自 brand-content.ts 與 fetchBrandTopProducts
/products?pbrands=ebc  那個品牌的【完整商品列表】, 可翻頁、可再疊分類
```
🔴 **把後者 canonical 指到前者 = 宣告「這兩頁內容一樣」,而它們不一樣** ——
**那正是 1-2 那段警告過的錯**:Google 看得出來不成立,會忽略我們的宣告、自己挑一個。
⇒ 🛑 **甲案(指去品牌頁)否決,理由是資料面的,不是偏好。**

---

## 3. 三個選項

```
甲  維持現狀(單一篩選自我指涉、價格區間 noindex)
    ✅ 0 改動 · 0 風險 · 而 Google 已經自己在過濾
    ⚠️ 組合數無上限, 收進去的越多之後越難清

乙  只給【多重篩選】noindex, 單一篩選維持可索引        ← 🎯 推薦
    判準:參數超過一個(分類+品牌 / 分類+車款…)⇒ noindex, 不產 canonical
    ✅ /products?pbrands=gilles(單一品牌目錄)照舊可被找到 —— 那對客人有價值
    ✅ /products?categories=拉桿與把手&pbrands=gilles 這種長尾直接不收
    ✅ 形狀與既有的價格區間那格【完全一致】, 不是新發明
    🔴 Sean 那四筆裡有 1 筆(分類+品牌)會被這條收掉, 另 3 筆維持現狀

丙  全部篩選網址 noindex
    ⚠️ 會連「某品牌的完整目錄」一起關掉 —— 而那可能是真的入口
    🛑 沒有資料支持這樣做(我們沒有搜尋流量的分項數字)
```

🔵 **而三個選項有一個共同前提是我【答不出來】的**:
**「客人有沒有從 Google 搜『gilles 腳踏』進到篩選頁」** —— 那要 Search Console 的**查詢報表**,不是索引狀態報表。
⇒ 📌 **沒有那份資料,乙與丙的差別是猜的。** 建議連這一題一起端 Sean(他有 GSC 權限)。

---

## 4. 若走乙 —— 改什麼

```
檔:apps/storefront/src/lib/catalog-canonical.ts(唯一一處判準, 不散到別的檔)
改:noindex 的條件多一項「進 canonical 的參數 ≥ 2 種」
🔵 next.config 不用動(這是 metadata 不是 headers)⇒ 不碰部署設定
```

## 5. rollback

```
單檔、純函式、無 DB、無 migration ⇒ git revert 那一顆即可
⚠️ 而【已經被 Google 收錄的】不會因為 revert 就回來, 也不會因為上線就立刻消失
   ⇒ 📌 索引變化以【週】計 ⇒ 上線後不要用「明天看有沒有變」當驗收
```

## 6. 事後閘(要能紅得起來)

```
🔵 正對照(不准被改到):
   /products                       canonical 必須 = /products      且無 robots
   /brands/ebc                     canonical 必須 = /brands/ebc
   /products?pbrands=gilles        canonical 必須 = 自己(單一篩選仍可索引)
🔴 負對照(這一格是本片的目的):
   /products?categories=拉桿與把手&pbrands=gilles
      ⇒ 必須 noindex, 且【不產 canonical】(兩個訊號不准同時出現)
🔬 突變:把「≥ 2 種」改成「≥ 3 種」⇒ 上面那格必須當場紅
```

---

## 7. 🛑 這份 plan 答不出什麼

- **不知道這些頁有沒有帶來流量** —— 要 GSC 查詢報表(§3 末)。
- **不知道 Google 會不會照做** —— canonical / noindex 都是**建議**,不是指令;它可以忽略。
- **不代表 SEO 沒有別的問題** —— 我只看了這一件,那 22 筆裡另外 17 筆(商品頁)我沒查。
- 🔴 **不急**:今天 0 客人受影響。**而它會隨時間變貴 —— 那是理由,不是急迫性。**

---

*前台窗 `pcm-website-v2-a1` · 2026-09-17 · 數字全部實測,canonical 用 `curl` 抓 `<link rel="canonical">`。*
