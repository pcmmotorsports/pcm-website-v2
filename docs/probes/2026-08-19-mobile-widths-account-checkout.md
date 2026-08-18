# 手機寬度量測:`/account` 與 `/checkout`(登入態)+ 一個差點被我報出去的假 finding

2026-08-19 02:45–02:52 CST(`date` 實跑),G3。

> **為什麼是這兩頁**:G1 掃 74 支 URL 時,`/account` 與 `/checkout` **實際落在 `/login`**
> (而 HTTP status 仍是 200 ⇒ **狀態碼完全不會告訴你這件事**,是比對 `finalPath` 才發現的)。
> ⇒ 那兩頁**沒有被量到**,而它們是客人動線上最後兩頁。**我會登入,所以由我補。**

## 效度限定

```
量的是   線上 https://shop.pcmmotorsports.com(追 main;origin/main = 84f57eda)
登入     用我自己的測試帳號 g3-sandbox-test@pcmmotorsports.com
尺       scripts/storefront-probe/overflow-ruler.mjs 的 run() 邏輯,逐字 inline 進瀏覽器執行
         (線上是 https,無法 import http://127.0.0.1 的模組 ⇒ 改用 inline;三條自檢照跑)
🔴 沒有按付款、沒有按「立即購買」。零新訂單。
```

## 結果:四發全乾淨,而 `finalPath` 證明我真的停在那兩頁

| 頁 | 寬 | `selfCheck.ok` | `findings` | `finalPath` | 橫捲容器內略過 |
|---|---|---|---|---|---|
| `/checkout` | 390 | ✅ true | **0** | `/checkout` | 0 |
| `/checkout` | 320 | ✅ true | **0** | `/checkout` | 0 |
| `/account` | 390 | ✅ true | **0** | `/account` | **173** |
| `/account` | 320 | ✅ true | **0** | `/account` | **173** |

```
每一發的 selfCheck 三條都過:widthOk(vw 等於我設的值)/ probeSeen(探針看得見)/
afterRemoval == before(拿掉探針數字回來)
🔴 finalPath 逐字就是 /checkout 與 /account ⇒ **沒有被踢回 /login**,這正是 G1 量不到的那一格
```

**那 173 個略過的是什麼**(尺的規定:略過的不能靜默丟掉):
```
classes:pcard-gallery-img / b-carousel-item / pcard / pcard-img-wrap / pcard-gallery / pcard-heart
⇒ 全部來自 /account 底部「為你推薦」那個橫向輪播 —— 那是它的設計,不是溢出
⚠️ 而「略過」不等於「沒問題」,只等於「這把尺不管它」
```

---

# 🔴🔴 這一輪真正的收穫:**我差點報出一個假 finding,而它會讓人去修一個沒有壞的東西**

## 我量到什麼

在 390 寬、`/products` 上量 `.pcard-heart`(50 顆,取前 4 顆):
```
熱區 32×32
有效 opacity(含祖先連乘)= 0
pointer-events = none
document.elementFromPoint(愛心中心) ⇒ img.pcard-gallery-img(不是愛心)
```
**照這個結果,我本來要寫的是**:
> 🔴 Sean 08-18 拍板「手機常駐顯示」**沒有落地** —— 手機上愛心 opacity 0,客人看不到也按不到。

## 🔴 而那是假的。原因:**我的瀏覽器不是手機,它只是一個窄視窗**

落筆前多問一句「**這個寬度下,瀏覽器自認是什麼裝置?**」,當場量:
```
matchMedia('(hover: hover)').matches   ⇒ true      ← 🔴 它自認【有滑鼠】
matchMedia('(hover: none)').matches    ⇒ false
matchMedia('(pointer: fine)').matches  ⇒ true
matchMedia('(pointer: coarse)').matches⇒ false
navigator.maxTouchPoints               ⇒ 0
innerWidth                             ⇒ 390
```
而那顆愛心的顯示規則**就是掛在 hover 上的**(repo 原始碼):
```
apps/storefront/src/styles/product-card.css:159  .pcard:hover .pcard-heart { opacity:1; …; pointer-events:auto; }
apps/storefront/src/styles/product-card.css:169  @media (hover: none) {
apps/storefront/src/styles/product-card.css:170    .pcard-heart { opacity:1; transform:translateY(0); pointer-events:auto; }
```
**而它真的有部署上去** —— 在線上頁面直接讀 CSSOM:
```js
// 掃 document.styleSheets 找 (hover: none) 底下的 .pcard-heart
⇒ 樣式表總數 3 / 讀不到的 1(跨域)/ 命中 1:
   media "(hover: none)" · sel ".pcard-heart"
   css   "opacity: 1; pointer-events: auto; transform: translateY(0px);"
```
⇒ **真手機(`hover: none`)上,那顆愛心是常駐顯示且可按的。Sean 那條拍板【有落地】。**
⇒ 我量到的 opacity 0,是因為**我的瀏覽器落在 `hover: hover` 那一支**,不是因為功能沒做。

## 🔴 這件事的射程:**任何「把視窗縮窄」的量測,都量不到 hover-keyed 的 CSS**

```
把視窗縮到 390 ⇒ 只改變【寬度】那一個維度
真手機同時改變:hover: none / pointer: coarse / maxTouchPoints > 0
⇒ 凡是寫在 @media (hover: none) 或 (pointer: coarse) 底下的規則,
  **在「縮窄視窗」這種量測裡【完全不會生效】** —— 而畫面看起來就是「那東西沒做」
```
**判別句(落筆前問)**:**我這一發是在量「窄畫面」還是在量「手機」?**
```
量窄畫面 ⇒ 溢出、換行、被切 —— 這一類 resize 就夠(本檔上半的四發就是這一類,結論成立)
量手機   ⇒ 觸控、hover 替代、熱區、鍵盤 —— **resize 不夠,要真的模擬觸控裝置**
```
⚠️ **這一格可能影響別人的數字**:任何只用 resize 做的手機掃描,
**對 hover-keyed 的東西是系統性盲的**(不是偶爾漏,是那一整類都看不到)。
⇒ 這句話我**沒有**去核別人的量法,**未確認**;只是把射程寫出來讓他們自己核。

## 附帶:那顆愛心【不會吃掉點擊】

```
pointer-events = none(桌面 hover 之外的狀態)
elementFromPoint(愛心中心) ⇒ 命中的是商品圖,不是愛心
⇒ 「手機上愛心會吃掉點擊、害客人點不進商品」這個擔憂,**在線上這一版不成立**
```
📎 memory `project_0818-sean-delegates-favorites-ux` 記過「`.pcard-heart` 是該檔唯一沒寫
`pointer-events:none` 的隱形元素」⇒ **那件事已經被修掉了**(現在有,見 `product-card.css:159/170`
與線上 CSSOM 實讀)。**那條 memory 的那半可以關掉了。**

## 本輪沒有答到的

```
1. 真觸控裝置上的實際畫面 —— 我用 CSS 規則 + CSSOM 證明「規則在」,
   **沒有在 hover:none 的環境下實跑過**。要 100% 就得開觸控模擬再走一次
2. 鍵盤跳出來之後的版面(結帳表單 / 登入框)—— 那需要真的觸發軟鍵盤,resize 做不到
3. 熱區大小是否足夠(32×32)—— 我量了尺寸,**沒有比對任何無障礙標準**(未確認)
4. /account 那 173 個略過的東西在真手機上會不會出事
```
