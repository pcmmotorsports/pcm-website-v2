# `#661` 後台商品搜尋 —— plan(鐵則 8:跨 3+ 檔,等批)

> 落檔 2026-08-19(`date` 實跑值見 commit)。作者 G2(後台訂單線 + 本片)。
> **狀態:未批准。** 條目 `#661` 逐字「**形狀要另提 plan,本條不決定**」⇒ 本檔就是那份 plan。
> **不送 Sean**:依 memory `feedback_standard-admin-features-are-not-decisions`
> (判別句「這個功能換一個後台也會有嗎?會 ⇒ 自己補」)⇒ **送主視窗批。**

---

## 0. 要改什麼(四處,鐵則 8 的「跨 3+ 檔」就是這裡)

```
① apps/admin/src/lib/products/product-repository.ts   listProductsForAdmin 加 keyword 參數
② apps/admin/src/app/products/page.tsx                 讀 ?q= 傳下去 + 修 buildHref(見 §0-a)
③ apps/admin/src/components/products/(新)product-keyword-search.tsx   搜尋框
④ apps/admin/src/components/products/product-filter-chips.tsx          要把 q 帶著走
⑤ (新)apps/admin/src/lib/products/product-list-view.ts  buildProductListHref —— 見 §0-a
```
🔴 **④⑤ 是最容易漏、而且漏了不會紅的那一個** —— 見 §3。

### 0-a 🔴🔴 開檔驗證的結果:**這一頁【今天就已經】有那個 bug,而它掉的是 `set_by`**

主視窗要我確認「§0 那幾個檔真的是渲染那一頁的那幾個」。我照做去追渲染樹,
**而追出來的東西比「檔對不對」重要得多。**

```
apps/admin/src/app/products/page.tsx:106 逐字
  buildHref={(p) => (p <= 1 ? '/products' : `/products?page=${p}`)}
🔴 它【沒有帶 set_by】。
```
**⇒ 今天的實際行為(不需要我這一片就存在)**:
```
按「手動」chip ⇒ /products?set_by=staff&page=1 ⇒ 看到篩選後的清單
按「下一頁」   ⇒ /products?page=2              ⇒ set_by 蒸發
              ⇒ 看到【全部商品】的第 2 頁,而 chip 高亮跳回「全部」
```
⇒ **`#661` 的 `q` 只是同一個洞的第二個受害者。我原本要防的東西,它已經在流血了。**

**⇒ 處置:併進本片,不另開條目。** 理由是 Sean 常設偏好**不做一半**
(memory `project_0818-no-half-done-work`)——
**我要動的就是那一行 `buildHref`;只加 `q` 而讓 `set_by` 繼續掉,是在同一個函式上做一半。**

**做法(照 orders 那一面的既有形狀,不發明)**:
```
新增 lib/products/product-list-view.ts 的 buildProductListHref({ page, setBy, q })
⇒ 唯一組網址的地方,chip / 分頁 / 搜尋框三個呼叫端全部走它
⇒ 形狀對照:orders 那面有 buildOrderListHref(本 repo 既有慣例)
```
✅ **而共用元件【不用動】**:`components/shared/list-pagination.tsx:48` 收的是
`buildHref: (page: number) => string` 回呼,網址是**呼叫端**組的
⇒ **不觸發鐵則 12⑥(共用元件行為改動)**,射程仍在 products 這一面。

**驗收要多一格(它是既有 bug 的守門,不是新功能的)**:
```
□ 按「手動」chip ⇒ 翻到第 2 頁 ⇒ set_by 仍在網址上、清單仍是「手動」那批
  🔴 突變驗過:把 buildProductListHref 裡帶 setBy 的那段拿掉 ⇒ 這一格必須紅
```

---

## 1. 🔴 唯一的設計決定:**用網址 `?q=`,不抄 orders/customers 的 cookie + PRG**

**這一條要寫清楚,因為條目與交辦都說「照抄 customers 那一面的形狀」。**

**orders / customers 為什麼是 cookie + PRG(當場開檔,逐字)**
```
apps/admin/src/lib/orders/keyword-search-action.ts:19      「搜尋詞不進 URL ⇒ 表單必須 POST」(Q-a=B)
apps/admin/src/lib/orders/keyword-search-action.ts:26      「搜尋詞絕不落 log…migration 20260809180000 檔頭明令」
apps/admin/src/lib/customers/keyword-search-action.ts:52-57 白名單擋 `return_to=/customers?q=王小明`
                                                            逐字「PII 進 URL / 瀏覽歷史 / access log / Referer」
```
⇒ **那整套機制的前提是【搜尋詞是 PII】**(客人姓名、電話)。

**而商品搜尋的詞是料號 / 商品名 / 品牌 —— 不是 PII。前提不成立。**
🔴 這正是 memory `feedback_inheritance-three-shapes-and-purpose-words` 講的最毒那一種:
**繼承一個【前提已消失】的決定** —— 原句在原脈絡對,搬過來就變成沒有理由的複雜度。

**而且網址派才是【這一頁自己】的既有模型**(不是我發明的):
```
apps/admin/src/components/products/product-filter-chips.tsx:11 逐字
  「沿用的是三件:.fchip 樣式類別、零 JS 的 <Link>、**選中態靠網址不靠 state**」
  href={`/products?set_by=${...}&page=1`}
```
⇒ 在這一頁上,**cookie 派才是不一致的那個選項**。

**代價對照**
```
              cookie + PRG            網址 ?q=
行數           約 250 行(兩支)        約 60-80 行
可加書籤/分享   ✗                       ✓(員工可存「Brembo 的全部商品」)
上一頁         ✗(POST 之後回不去)      ✓
PII 風險       它要解的問題             不存在(料號不是 PII)
與本頁既有模型  相反                    一致
```
⇒ **建議:網址 `?q=`,零 JS 的 `<form method="get">`。** 這是本片唯一要主視窗點頭的形狀題。
⚠️ **反面也寫出來**:若日後商品搜尋要支援「用客人名字反查他買過什麼」⇒ **那一刻起就是 PII**,
   要回頭改成 cookie 派。**這句寫進元件檔頭,不要只寫在本 plan。**

---

## 2. 搜哪幾欄、怎麼比對

```
MVP = external_id(料號)+ title(商品名),OR 關係
比對方式 = ILIKE '%…%'(Postgres,大小寫不敏感)
```
🔴 **為什麼是 `ILIKE` 而不是 `pg_trgm` / 全文檢索 —— 這一格直接關掉條目裡的地雷**:
```
條目 #661 警告:pg_trgm 在 macOS 對中文抽零 trigram ⇒ 本機測會恆假綠
              (memory reference_pg-trgm-cjk-zero-on-macos-libc)
而 ILIKE 不經過 trigram —— 它是純粹的子字串比對,對 CJK 與 ASCII 行為一致
⇒ 🔴 選 ILIKE ⇒ 那個假綠陷阱【不適用】,本機測到的就是正式站會發生的
⚠️ 而我要標明限定:我沒有在 Linux 或正式站實跑過 ILIKE 對中文的行為(未驗)。
   我的根據是「ILIKE 不呼叫 pg_trgm」這個機制,不是一次量測。
```
**天花板寫出來,不要讓下一個人以為這是完整搜尋**:
```
· 不做同義詞、不做錯字容忍、不做斷詞、不做相關度排序
· 前置 % 的 ILIKE 走不了 btree index ⇒ 全表掃描
  現況 20,341 列(G3 量、我沒重量)⇒ 單次查詢在毫秒級,不需要索引
  🔴 判別線:**列數到十萬級再回頭看**,不是「以後有空再優化」
· 不碰顧客站那條搜尋線(memory project_storefront-keyword-search-line)—— 不同範圍,不合併
```

---

## 3. 🔴 最容易漏而且【不會紅】的那一格:篩選與分頁要把 `q` 帶著走

**這不是假設,同一個 repo 已經有一次實例**:
```
apps/admin/src/components/orders/order-filter-chips.tsx:54-57 逐字記著
  「按『待處理』→ 再按『全部』⇒ 高亮跳回全部,**清單還是待處理那批**」
  成因:『全部』只把 goodsAxes 設成 undefined,而 pendingOnly 被 ...filter 原封帶過去
```
⇒ 本片的對稱形狀:**搜尋「Brembo」之後按「手動」chip ⇒ `q` 掉了 ⇒ 回到全部商品**,
而**畫面看起來完全正常**(chip 亮了、清單也變了)⇒ 員工不會知道搜尋被洗掉。

**驗收條件(這三格缺一不可)**
```
① 搜尋後按 chip ⇒ q 仍在網址上、清單仍是搜尋結果的子集
② 搜尋後翻頁   ⇒ q 仍在網址上
③ 改搜尋詞     ⇒ page 歸 1(否則停在第 30 頁看到空白,同 chip 那條既有理由)
```

---

## 4. 驗收(逐條 yes/no)

```
□ 空字串 / 全空白 ⇒ 視同沒搜尋(不是「搜尋空字串」),且不留 ?q= 在網址上
□ 料號完全比對 ⇒ 找得到
□ 商品名部分比對(中文)⇒ 找得到
□ 大小寫不敏感 ⇒ brembo 找得到 Brembo
□ 找不到時 ⇒ 畫面明說「找不到符合的商品」+ 一顆清除搜尋,不是空白頁
□ §3 那三格全過
□ 分頁列的「共 N 件」= 搜尋後的數,不是全表數
   🔴 這格特別寫出來:repository 已有一段逐字警告過同型錯誤
     (product-repository.ts:144-147「客戶端過濾只會過濾這一頁,而 count 仍是全表數」)
□ 四綠:TURBO_FORCE=1 typecheck / lint / build + 該頁 vitest
```

---

## 5. 不做 / 邊界

```
· 不動 .sql、不動 schema、不建索引(§2 已說明為什麼現在不需要)
· 不動 orders / customers 既有的兩支搜尋(不重構、不抽共用元件 —— YAGNI,
  理由同 product-filter-chips.tsx:6-12 那段既有裁定)
· 不 push、不 apply
· 體積估 60-90 分(⚠️ 看影響面估的,沒拆到步驟級)
```

## 6. 誠實揭示

```
· 20,341 件 / 1,018 頁 是 G3 量的(本機 localhost:3001 + ADMIN_DEV_BYPASS + 連正式庫),我沒重量
  ⇒ 而【缺口不依賴那個數字】:沒有搜尋就是沒有搜尋,件數只影響它有多痛
· 🏁 ~~我沒有開過後台商品頁(沒有實跑 dev server)—— §0 的四個檔是【讀 code】盤出來的~~
  **已補(2026-08-19)**:追渲染樹的結果見 §0-a —— **那四個檔漏了一個**
  (`components/shared/list-pagination.tsx`,而它不用改),**而且追出一個今天就存在的 bug**。
  ⚠️ **仍未做的那半**:我**沒有用瀏覽器看過畫面**。
  靜態追 import 追得出「哪些檔參與渲染」,**追不出「畫面長什麼樣」**。
· ILIKE 對中文的行為我沒有實跑驗證,根據是機制(不經過 pg_trgm),不是量測
· 「約 250 行 / 約 60-80 行」是看既有兩支的行數推的(100+126 與 118+131),不是寫完後量的
```
