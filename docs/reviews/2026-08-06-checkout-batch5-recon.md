# `/checkout` 第5批唯讀先行偵察報告(**零改檔**)

> 2026-08-06 · 視窗 D · 依 `D-117-A` item 1
> **本報告全程零檔案異動**;跑完 `git status --porcelain` 為空(見 §十一)。
> 真權威 = OD `pcm-home-redesign/pcm-checkout.css` + `checkout-page.html` + `checkout-page-handoff.md`。

---

## 一、方法與範圍

`cssdiff.py`(剝註解 → 走訪 `@media` → 正規化宣告 → 對稱 diff)
`pcm-checkout.css`(747 行)vs `apps/storefront/src/styles/checkout.css`(667 行)。

原始結果:**僅設計稿 60 條 / 值不同 6 條 / 僅真站 0 條**(`co-diff.txt`)。
再過一次「這個 class 在真站全 26 支 CSS 裡存在嗎」的過濾器,分成兩堆:

| 堆 | 條數 | 意思 |
|---|---|---|
| **真殘差**(class 真站完全沒有) | **25** | 全部是 R1/R2 新增的四族東西(§五) |
| 跨檔誤報 / 同檔既有 class 的新規則 | 35 | 其中 **28 條是整段平板段**(§四)、其餘是 `.pp-breadcrumb`(在 `products-page.css`)、`.btn-primary`(在 `cart.css`)等 |

🔴 **過濾器的已知盲點**:它只問「class 存不存在」,不問「這條規則存不存在」。
所以平板段那 28 條會被歸進「誤報」堆 —— 它們其實是**真的缺**。§四 獨立處理。

---

## 二、交接單 §二「全部只有這 8 筆」的現況核對

| # | selector | 交接單要的 | 真站現況 | 判定 |
|---|---|---|---|---|
| 1 | `.co-grand-val` | `--c-red-dark` | `checkout.css:529` 已是 | ✅ 已落地 |
| 2 | `.co-mobile-buybar-price` | `--c-red-dark` | `checkout.css:598` 已是 | ✅ |
| 3 | `.co-inv-hint` | `--c-red-dark` | `checkout.css:148` 已是 | ✅ |
| 4 | `.co-inv-reset` | `--c-red-dark` | `checkout.css:168` 已是 | ✅ |
| 5 | `.co-card-error` | `--c-red-dark` | `checkout.css:335` 已是 | ✅ |
| 6 | `.co-submit-error` | `--c-red-dark` | `checkout.css:475` 已是 | ✅ |
| 7 | `.tpfield.tpfield-error` | **不改**(留亮熔橘) | `checkout.css:334` `var(--c-red)` | ✅ 維持 |
| 8 | `.btn-primary`(在 `cart.css`) | `var(--c-red)` + hover `--c-red-dark` | `cart.css:302` **仍 `var(--c-text)` 墨黑** | 🔴 **未做** |

⇒ 六筆換色**在本夜跑之前就已經落地**(commit 註解標 `🔶 0c`,是第0批地基那輪做的)。
第5批真正剩下的只有第 8 筆,而它是本頁**最大的一顆雷**(§三)。

**交接單 §五 驗收條件的當下狀態**(唯讀實查,未修任何東西):

| # | 驗收條件 | 現況 |
|---|---|---|
| 1 | `checkout.css` 只有 6 筆 color 改動、無排版被動 | ✅ |
| 2 | 應付總額桌機+手機是深熔橘 | ✅(文字層) |
| 3 | **「下一步:發票與付款 →」與「確認付款 …」是熔橘底白字** | 🔴 **FAIL** —— 兩顆吃 `.btn-primary` = 墨黑 |
| 4 | `.tpfield` 錯誤框線仍亮熔橘 | ✅ |
| 5 | `.tpfield` 仍是 iframe 容器、零 `<input>` 收卡資料 | ✅ `TapPayCardFields.tsx:92` 是 `<div>` |
| 6 | 兩步指示器 base 與 900px 兩處同步、`checkout.test.ts` 綠 | ✅ 有 guard(`checkout.test.ts:14/21`) |
| 7 | §三 逐字字串仍在 | 未逐字核(本輪只做 CSS 面) |
| 8 | 付款鏈一行未改 | ✅ 本夜跑零 TSX 改動 |
| 9 | 手機 900px 以下 buybar/16px 防縮放 | ✅ `checkout.css:578`/`577` |

---

## 三、🔴 `.btn-primary` —— 設計端**自己內部打架**,第5批必須先解這題

`.btn-primary` 全站只定義在 `cart.css:300`,**10 個消費點**(`grep -rn 'btn-primary' --include='*.tsx'`,已剔除 `.cs-btn-primary` 子字串誤命中):

| 消費點 | 按鈕語意 | 設計端要它什麼色 | 出處 |
|---|---|---|---|
| `CheckoutStep1.tsx:123` `.co-btn-next` | 下一步:發票與付款 | **熔橘** | checkout 交接單驗收 #3 |
| `CheckoutStep2.tsx:306` `.co-btn-pay` | 確認付款 | **熔橘** | 同上 |
| `CheckoutMobileBuybar.tsx:44` | 手機 下一步 | **熔橘** | `checkout-page.html:542` |
| `CheckoutMobileBuybar.tsx:48` | 手機 確認付款 | **熔橘** | `checkout-page.html:543` |
| `CheckoutRedirecting.tsx:40` | 未自動跳轉?點此繼續付款 | 熔橘 | `checkout-page.html:577` |
| `CheckoutSuccess.tsx:77` | 查詢付款結果(unknown 態) | 熔橘 | `checkout-page.html:567` |
| `CheckoutSuccess.tsx:88` | 返回購物車(failed 態) | 熔橘 | `checkout-page.html:572` |
| `CheckoutSuccess.tsx:92` | **繼續購物**(paid/processing 態) | 熔橘 | `checkout-page.html:556/561` |
| `CheckoutCartNotice.tsx:30` | **繼續購物** | ❓ | 無明文 |
| `CartView.tsx:242` | **繼續購物**(空車態) | **墨黑** | `cart-page-handoff.md:87` 逐字 |
| (`not-found.tsx:37`) | 404 主鈕 | 熔橘 | 已用 `.err-btn-primary` scope,不受影響 |

**衝突**:`cart-page-handoff.md:87` 逐字「空車狀態的 `.btn-primary`(繼續購物)維持墨黑未動 ——
它是導流鈕非結帳主 CTA;要一起改跟 Sean 說一聲」,而 checkout 交接單 §二-8 要 `.btn-primary` **全域**熔橘。
同一顆 class、兩份交接單、相反結論。設計稿 `checkout-page.html:556` 又把終態的「繼續購物」畫成 `btn-primary`(熔橘)。

**建議做法(不需 Sean 拍板的部分)**:比照第1批 404 的處理 —— **不動 `.btn-primary` 本體,逐點 scope**。
確定要熔橘的四顆:`.co-btn-next` / `.co-btn-pay` / `.co-mobile-buybar-btn`(手機兩顆共用同一 class)。
這四顆的依據是交接單驗收 #3 明文,零產品判斷。

**要留白給 Sean / 設計端的部分**:終態三顆(`.co-success-cta`:繼續購物 / 返回購物車 / 查詢付款結果)
與 `CheckoutCartNotice` 的「繼續購物」要不要一起熔橘。這是「導流鈕算不算主 CTA」的品味題,**我不猜**。

⚠️ 另外:第1批 404 那兩行「底色 + 同色框」是為了繞開墨黑 `.btn-primary` 寫的
(`error.css` 的 `.err-btn-primary`)。如果第5批最後決定把 `.btn-primary` 全域翻熔橘,
那兩行就變成重複宣告、**要一併刪**(D-216 §二 已掛這條 ⏳)。

---

## 四、🔴 整段平板段 28 條規則,真站零覆蓋 —— 而且**插入位置本身是規格的一部分**

設計稿 `pcm-checkout.css:724` 起有一整段 `@media (min-width: 600px) and (max-width: 1079px)`,
**28 條規則**,真站 `checkout.css` 完全沒有。清單見 `co-diff.txt:55-82`。涵蓋:
`.co-main` padding / `.co-head h1` 32px / `.co-step*` 三條 / `.co-section-head h2` /
`.co-addr-*` 三條 / `.co-inv-tabs` `.co-inv-grid` 兩欄 / `.co-card-row` 兩欄 / `.tpfield` 48px /
`.co-tp-ph` / `.co-pay-*` / `.co-ship-*` / `.co-review-item-name` / `.co-line` / `.co-summary-item` /
`.co-success-*` 兩條 / `.co-mobile-buybar*` 五條。

### 4-1 兩邊的斷點結構

| | 斷點(由上而下的原始碼順序) |
|---|---|
| 設計稿 | `600↓`(L242,元件層)→ `1024↓`(L660)→ `900↓`(L665)→ `720↓`(L712)→ `600↓`(L717)→ **`600–1079`(L724,最後)** |
| 真站 | `1024↓` → `900↓` → `720↓` → `600↓`(之後只有非 media 的遮罩段) |

🔴 **設計稿把平板段擺在最後,不是隨手放的**:`600–1079` 與 `1024↓` / `900↓` / `720↓` 的
specificity 完全相同(都是 0,1,0 級的 class 選擇器包在 media 裡),**只能靠原始碼順序分勝負**。
擺最後 ⇒ 在 600–720 這一段,平板段會**回頭覆蓋** `720↓` 的單欄規則:

- `720↓` 給 `.co-inv-tabs` / `.co-inv-grid` 各 `1fr`(單欄)
- 平板段給 `.co-inv-tabs` `repeat(3,1fr)`、`.co-inv-grid` `1fr 1fr`
- ⇒ 620px 寬時 **發票三 tab 並排、發票欄位兩欄**,`720↓` 那兩條只在 <600 才活著。

這是設計稿自己的 cascade 結論,**照搬就要連順序一起搬**。第5批的守門要釘住
「平板段的 index > `720↓` 的 index」,否則有人日後把它移到前面、視覺會靜默倒退。

### 4-2 與既有測試切片邊界的交互(第3批那個洞的同型風險)

`checkout.test.ts:22-24` 與 `45-47` 用
`CSS.indexOf('@media (max-width: 900px)')` → `CSS.indexOf('@media (max-width: 720px)', …)` 切片。
現況 `checkout.css` 每個 media header **各只出現 1 次**(已實查),切片安全。
⇒ **平板段必須append 在 `600↓` 之後**(cascade 也要求如此),放在 900 與 720 之間會同時破壞
cascade 與這兩條既有斷言的切片邊界。

---

## 五、25 條真殘差 = R1/R2 的四族新東西(**都不是純換色,交接單 §二「只有 8 筆」再次不成立**)

| 族 | 真殘差 selector | 需要的不只是 CSS |
|---|---|---|
| **U1 錯誤摘要清單** | `.co-submit-error-head`(+`svg`)/ `-list`(+`li`)/ `-jump`(+`>span:first-child` / `em` / `:hover`)/ `-go` / `.co-field-flash`,以及 `.co-submit-error` 本體要從純文字變成有底色+框的方塊 | 🔴 **要動 `CheckoutStep2.tsx` + `usePaymentErrors`**:把一句話換成可點清單、點了 `focus()` + 閃框、錯誤在第一步時要先切回第一步 |
| **U3 卡欄可讀性** | `.co-card-brands`(+`i`)/ `.co-card-hint` / `.co-tp-ph` / `.co-card-field > span`;外加 `.tpfield` 框線 `--c-border` → `--c-border-strong`(值不同那 6 條之一) | 🔴 **要動 `TapPayCardFields.tsx`**,而那支有硬約束(§5-1) |
| **U4 手機底欄補一行** | `.co-mobile-buybar-sub`(900↓ 與平板段各一條) | 要動 `CheckoutMobileBuybar.tsx`,且那行文案要拿到「件數 / 運費」 |
| **R2 行內新增地址** | `.co-addr-add-row`(+`.co-addr-add`)/ `.co-addr-manage`(+`:hover`)/ `.co-addr-form` / `600↓` 的單欄版 | 🔴 **功能新增**:`CheckoutStep1.tsx` 要 import 既有的 `components/account/InlineAddressForm.tsx`(已存在 ✅)、接 server action、送出後自動選用 + 觸發 `autofillInvoice()` |

另有兩條與族無關:
- `.co-tier-badge` —— 真站右側摘要用的是 `TierBadge` 元件(與 `/account` 同型),**不是 CSS class**。同 D-216 §七-5 的 `.acc-tier-badge` 一模一樣的形狀,不是缺漏。
- `.co-agree input { accent-color: var(--c-text) }` / `.co-section-head h2 { margin: 0 }` / `.co-inv-grid .auth-field { margin-bottom: 0 }` / `.co-mobile-buybar-price { line-height: 1.15 }` —— 四條小的排版差,值不同那堆裡的。

### 5-1 🔴 `TapPayCardFields.tsx` 的硬約束(U3 一定會踩)

該檔 `:23-24` 與 `:58` 逐字寫死兩條:
1. `.co-card-row` 是 `grid-template-columns: 1fr 1fr` ⇒ **紅字必須放在 `.auth-field` 內部**,
   做成 `.co-card-row` 的直接子元素會多一格、把兩欄擠歪。
2. 「**不另包一層新 div**:零新增節點 ⇒ `.co-card-row` 子數不變、零版面回歸風險」。

而設計稿 U3 的作法是把卡欄標籤從 `label.auth-field > span` 換成 **`.co-card-field > span`**,
並在卡號欄右側塞 `.co-card-brands`。⇒ **這等於直接違反上面兩條**。
第5批要嘛把品牌標記塞進既有 `.auth-field` 內、要嘛推翻那兩條註解 —— 後者屬 PCI 敏感元件的結構改動,
**建議前者**,並且不論哪條路都要跑鐵則 12 的 codex 對抗審查(§十)。

---

## 六、殼 / TabBar 盤點

| 項 | 現況 | 判定 |
|---|---|---|
| Header / HomeFooter | `CheckoutView.tsx:275` / `:385` 逐頁 import ✅ | 與第2批確立的「本站殼是逐頁 import」一致 |
| 麵包屑 | `CheckoutView.tsx:278` `className="pp-breadcrumb co-breadcrumb"`,`.pp-breadcrumb` 規則住在 `products-page.css` | ✅ 不是缺漏(cssdiff 的跨檔誤報) |
| **MobileTabBar** | `MobileTabBar.tsx:120` 的 hidden 判定只排除 `/products/<slug>` 與 `/coming-soon` ⇒ **`/checkout` 會出現底部 TabBar** | ❓ 見下 |

🔴 **buybar 與 TabBar 疊在同一個底部**:
- `.co-mobile-buybar`(`checkout.css:580`,base `:558` 是 `display: none`):`position: fixed; bottom: 0; z-index: 100`,只在 `900↓` 顯示
- `.mobile-tabbar`(`mobile-tabbar.css:26-35`):`bottom: 0; height: 64px; z-index: 40`,`1079↓` 顯示
- `body { padding-bottom: calc(70px + safe-area) }` 是為 TabBar 保留的

⇒ **≤900px**:buybar(z=100)壓在 TabBar(z=40)上面。buybar 高度由 `padding 12+12` + 內容(10px 眉標 + 22px 價 + 2px)推算 ≈ **60px 上下,比 TabBar 的 64px 矮** ⇒ 幾何上 TabBar 有機會從 buybar 上緣**露出幾個 px**,body 也多留了 ~10px 空。
⇒ **901–1079px**:TabBar 顯示、buybar `display:none`、桌機動作列 `.co-actions` 顯示 ⇒ 這一段沒問題。

**設計稿那邊**:`checkout-page.html` **整頁沒有 TabBar 的 markup**(grep 零命中),
`pcm-shell.css:112` 的 TabBar 規則與真站字面同(同 z-index 40)⇒ 設計端是「結帳頁沒有 TabBar」的世界觀。

**這題我不自己決定**:要不要把 `/checkout` 加進 `MobileTabBar` 的 hidden 判定,
是「結帳流程中要不要保留全站導覽」的產品選擇(離開結帳 vs 不給離開)。**記在 STOP 留白。**
⚠️ 而且我**沒有辦法量**那幾個 px —— 本 worktree 的 `/checkout` 是 HTTP 500(§九)。

---

## 七、半像素 / 字體 token / 寫死值盤點(`checkout.css`)

| 面 | 結果 |
|---|---|
| **半像素字級** | **0 處** ✅(檔內三處 `1.5px` 是 `border-width`,`:194` `:269` `:312`,設計稿同值) |
| **`var(--font-*)` typo 別名** | **0 處** ✅ |
| 寫死 `IBM Plex Mono` | 0 處 ✅ |
| 寫死 `"Noto Serif TC", serif` | 2 處 —— 但**設計稿也是 2 處寫死**,且全站 6 支 CSS 同寫法、無 `--f-serif` token ⇒ 站規慣例,**不是缺陷、不要順手改** |
| 宣告層寫死容器寬 | 0 處;但 `checkout.css:26` 吃 `var(--content-max)` = **1600px**(`tokens.css:30`),設計稿要 1440 |

### 7-1 `--content-max` 收斂:第5批做完就只剩一個消費點

第1批刻意沒動 token、改逐點換(理由:動 token 會一併重繪 `/checkout`,而金流頁那時禁碰)。
現在全樹 `var(--content-max)` **只剩兩個消費點**(實查):
- `checkout.css:26`
- `product-page.css:22`(商品詳情頁,不在任何一批 = Sean Q4 那題)

⇒ 第5批把 `checkout.css:26` 換成 `var(--shell-bar-max)`,`--content-max` 就只剩商品詳情頁一個消費點。
**注意**:這是排版改動,交接單 §七-1 逐字說「屬排版、不在純換色授權內,**維持真站現值即可**,
要對齊 1440 再說一聲」⇒ **要先跟設計端說一聲**才能動,我不自行決定。

---

## 八、既有守門盤點(第5批不要弄壞的東西)

`checkout.test.ts`(68 行 / 5 條斷言):
1. `:14` 桌機 `.co-steps` 兩欄(切片 = 第一個 `@media` 之前)
2. `:21` `900↓` 的 `.co-steps` 兩欄(切片 = `900↓` → `720↓`)
3. `:35` `.co-shipping-summary-address` 三條截短宣告齊備
4. `:44` `900↓` 通知 Email `font-size ≥ 16px`(防 iOS 聚焦縮放)
5. `:58` / `:63` `.co-pay-overlay` 遮罩兩條

另有 `action-color.test.ts:150-155` 面層掃描已把 checkout 的 6 個文字層釘住,
`:181` 把 `.tpfield.tpfield-error` 的**亮**熔橘框線釘住(防「順手改深」)。

⇒ 第5批新增的守門至少要含:平板段 28 條的抽樣 + **平板段位置在 `720↓` 之後**(§4-1)+
四顆熔橘 CTA 的 scope 邊界(**反面**:`CartView` 空車「繼續購物」仍墨黑)。

---

## 九、🔴 我做不到的驗證

1. **`/checkout` 在本 worktree 是 HTTP 500** —— 無 DB、`useResolvedCart` server-resolve 拿不到購物車。
   ⇒ 本報告**全部是文字層 + 幾何推算**,零真瀏覽器實測。§六 那幾個 px、§三 那四顆鈕的實際顏色,
   都要在有 DB 的環境才驗得了。
2. §二 驗收 #7(§三 逐字字串仍在)**我只做了 CSS 面、沒有逐字核 TSX 文案**。
   那是第5批施工時要逐條對的(交接單 §三 有三張表)。
3. 五個終態(`paid` / `processing` / `unknown` / `failed` / `redirect`)一個都沒看過。

---

## 十、給第5批的建議順序與風險

**順序**(由低風險到高風險,每步可獨立 commit):
1. 平板段 28 條(§四)—— 純 CSS、append 在檔尾、零 TSX。**先做這步**,它最大、最機械、風險最低。
2. 四顆 CTA 熔橘 scope(§三)+ `.tpfield` 框線 `--c-border-strong`(§五 U3 的 CSS 部分)—— 純 CSS。
3. `--content-max` → `--shell-bar-max`(§7-1)—— **先問設計端**。
4. U4 手機底欄補一行 —— 小幅 TSX。
5. U3 卡欄標記 —— 🔴 動 `TapPayCardFields.tsx`,踩 §5-1 的硬約束。
6. U1 錯誤摘要清單 —— 🔴 動 `CheckoutStep2.tsx` + `usePaymentErrors`。
7. R2 行內新增地址 —— 🔴 **功能新增**,跨 `CheckoutStep1.tsx` + `InlineAddressForm` + server action。

**鐵則判定**:
- 1-4 步:動的是 `/checkout` 的樣式與非金流 markup,**不碰付款鏈**。
- **5-7 步命中鐵則 12**:`/checkout` 是①錢的頁面,U1 改的是**付款送出失敗後的導引**、
  R2 改的是**收件地址寫入**(server action)⇒ commit 前必過 codex 對抗審查、且**不 push**。
- 第 7 步同時命中**鐵則 8**(跨 3+ 檔 + 新功能)⇒ **要先提 plan 等 Sean 批准**。
- 全程紅線:`.tpfield` 不得變 `<input>`、不得搬設計稿的驗證流程、不得幫確認付款鈕加回 `disabled`、
  不得動 `.co-agree` 兩個連結的 `target="_blank"`(改成 span+onClick 會變成「讀條款=誤勾同意」)。

**體積估**:第 1 步約 15-25 分鐘(鐵則 4 內);第 5-7 步每步都是獨立一片,**不要跟第 1 步同一 commit**。

---

## 十一、零留痕自證

```
跑前 git status --porcelain → 空
跑後 git status --porcelain → 空
```
本輪只讀檔 + 在 scratchpad 產生 `od-checkout.css` / `co-diff.txt` / `residual-filtered.txt`,
**repo 內零檔案異動**。

— 視窗 D,2026-08-06
