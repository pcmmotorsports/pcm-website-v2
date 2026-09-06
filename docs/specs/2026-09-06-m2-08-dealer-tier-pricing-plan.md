# M-2-08 plan · 登入的經銷會員看到 store 價(**v2 —— codex R1 FAIL 9 must-fix 折後**)

> `-auth` 2026-09-06 · Sean **Q17=甲**(排上線前)· 板列 ⟦auth-DEALERTIERPRICING⟧ · 鐵則 12①(錢)
> 🛑 **本 plan 有一題【要 Sean 先答才能動工】—— 見 §A。** 其餘部分即使批了也擋在那一題後面。

## A · 稅別:**一半早就拍過了**,而剩下的那一半有兩題
🔬 **來源 = memory `project_0829-pricing-tax-convention`,我開原檔讀過, 不是轉述。**
✅ **已拍板(Sean 2026-08-29 逐字)**:「網站售價都含稅沒問題, 但是經銷價都是未稅。」
　⇒ `price_general` = **含稅**(顧客站 `ProductInfo.tsx` 那句「含稅」**是對的, 不改**)· `price_store` = **未稅**。
　⇒ 追加逐字:「沒有經銷價錢, 就是賣經銷一般會員價錢, 但是不含稅, 稅外加, **沒錯, 就是比一般客人貴**」
　　⇒ **經銷單每列都當未稅**;`tax_total = subtotal × 5%`。⚠️ 他明白且明說「沒錯」⇒ **不要重問、不要替他擔心**。
⚠️ **而那支 memory 自己標了三格是【推的被寫成拍板】, 引用時不得當定論**:
　「一般單 `tax_total = 0`」· 「稅基 = subtotal(運費/折扣排除在外)」· 「整單捨入一次」
　—— 第三格它逐字寫著法條射程被放寬三層(§32-1 管的是【一期】不是【一張單】, 且 `.5 往哪走` 原文沒寫)。
　⇒ 🛑 **本 plan 不碰稅基與捨入**, 那是 B1/B2 的格子。

### A-1 · 待 Sean **Q24**(主視窗已端):顧客站怎麼顯示
甲 = 顯示未稅數字 + 標籤改「未稅」+ 結帳多一列稅 ｜ 乙 = 換算成含稅顯示。**主視窗推甲, 我同意。**
⇒ 📌 **§F-7 的期望值先照【甲】寫成草稿並標「待 Q24」**;他答乙就整條重寫, 不是改個字。

### A-2 · 🔴🔴 **而我這一片會把另一個【沒人定義的格子】從理論變成日常** —— 這一題比 A-1 硬
那支 memory 的 R3 標為 must-fix 且**零載體**:「**哪張單算經銷單**」沒有人定義。
　· 經銷 tier 會員**今天就能**登顧客站、用**含稅**價下單, 而那張單帶 `tier_at_checkout='store'`。
　· 🔬 **我複量過那個欄是活的**:`tier_at_checkout` / `tierAtCheckout` 在**生產碼 10 支檔**命中
　　(🟢 正對照 `memberTier` 3 支 · 🟢 負對照 編造字 0)。
　· ⇒ 若下游用 **tier** 判單型 ⇒ 那張**含稅**單會被**再加 5%**。
🛑 **而本片把顧客站的經銷會員改成看【未稅】價 ⇒ 同一個欄之下, 訂單的稅制在本片前後【不一樣】。**
⇒ 📌 **⇒ 判單型不能只看 `tier_at_checkout`, 要有一個「這張單的每列是不是未稅」的載體。**
⇒ **本片必須帶著它一起做, 不得留給下一片** —— 留下來的話, 上線那天起每一張經銷會員的顧客站單都在賭下游怎麼判。

### A-3 · 那個載體的形狀(**由本片定義** —— B2 無主, 主視窗 `-f1` 2026-09-06 裁)
🔬 **前情, 開檔核過**:板列 ⟦f3-TAXNEXT1⟧(`docs/launch-todo.md`)+ 出處
`20260829140000_m4b_b2c_manual_order_explicit_tax_total.sql:62-78`。那五項裡的**第 1 項**逐字是
「`orders` 加一欄記【定價單 / 經銷單】—— **本片刻意不加**」, 理由逐字:
**「一個沒有人會寫的欄位, 與一個不存在的欄位, 在資料上長得一樣」**。
🎯 **⇒ 而本片正好把那個理由消掉** —— 顧客站的 `create_order` **知道**當下用的是哪一種價
⇒ **從本片起「有人會寫」** ⇒ 那個欄不再是空的。**這不是推翻他的決定, 是他那個決定的前提變了。**

**形狀(最小、可驗、不猜稅)**:`orders` 加一欄 **`line_prices_are_untaxed boolean NOT NULL DEFAULT false`**。
· 🔴 **它記的是【事實】不是【身分】** —— 「這張單的每列金額是不是未稅」, 而**不是**「這個人是不是經銷」。
　📌 那正是 `tier_at_checkout` 答不出來的那一格:**身分會變、單不會**。
· 🔴 `DEFAULT false` 的方向是**保守**:舊單與任何忘了寫的路徑都被當**含稅** ⇒ 下游**不會**多加 5%。
　(反過來 default true ⇒ 忘了寫就多收客人錢。)
· 🔴 **寫入點只有一個**:`create_order`;而顧客站開始顯示未稅 **與** 它開始寫 `true`
　**必須同一顆 commit** —— 那是 ⟦f3-TAXNEXT1⟧ **第 5 項**逐字的要求, 不是我加的。
· ⚠️ **成本要先講**:⟦f3-TAXNEXT1⟧ **第 2 項**逐字 —— 函式加參數 `CREATE OR REPLACE` 加不了
　⇒ 要 `DROP + CREATE` ⇒ **撞鐵則 12②(函式權限)** ⇒ 本片會有一支動 `GRANT/REVOKE` 的 migration。
· ⛔ **本片不碰 `tax_total` 的算式** —— ⟦f3-TAXNEXT1⟧ **第 4 項**逐字說它要等
　【價格基礎與稅基契約】落地(codex R2 列了應稅運費 / 折扣分攤 / 代購 / 免稅品項)。
　⇒ 📌 **本片只負責【說清楚這張單是什麼】, 不負責【算它的稅】。** 那個分工要寫在欄註解裡。

## B · 今天是什麼(每條座標都自己開過;**v1 有三條是錯的, 逐條標**)
| # | 事實 | 座標 |
|---|---|---|
| 1 | PDP **tier 釘死 general**, 是拍板 | `app/products/[slug]/page.tsx` 檔頭 |
| 2 | ⛔ ~~`computeEffectivePrice` 呼叫端只有一處~~ **兩處** —— 第二處算原價 | `lib/products.ts:170` + `:174` |
| 3 | ⛔ ~~`:333` 是 `/products` 列表~~ **那是【首頁 featured】**, 而且包在 `unstable_cache(['featured-ui-products-v3'])` 裡 | `lib/products.ts:325-336` |
| 4 | 🔴 **真實列表走 catalog RPC, 搜尋又是另一條固定 general 的路** | `app/products/page.tsx:310-326` |
| 5 | 🔴 **那支 RPC 的價格篩選與排序【依 general】** | `20260906910000_…_expose_external_id.sql:198-199 / :248-250` |
| 6 | 購物車**只回 `unitPrice`**、逐欄白名單 | `app/cart/actions.ts:13-14 / :56` |
| 7 | 公開投影**物理排除 `price_store`** | `20260808000000_…_expose_view.sql:24 / :59 / :91` |
| 8 | ✅ **server 端認 tier 的解析器已存在** | `lib/tier.ts:80-95`(fail-closed 退 general 且 log) |
| 9 | 🔴 **`anon` 與 `authenticated` 對 `products` 都【沒有】SELECT**(正式庫實測 false / false;RLS on · policy **5** 條;🟢 正對照 全庫 policy 102 · 🟢 負對照 anon DELETE=false) | 2026-09-06 唯讀 |
| 10 | 正式庫 25,769 件 **store 與 general 100% 同價** | ⟦auth-DEALERTIERPRICING⟧ |
| 11 | `brands.premium_extra_pct` **25 / 25 全部非 null** ⇒ ⛔ ~~premiumStore 缺資料~~ **資料是齊的** | 2026-09-06 唯讀 |

🎯 **事實 9 是甲案的正當性**:一般登入者**根本讀不到那張表** ⇒ 只能走 `security definer`。

## C · 範圍
✅ 登入且 `customers.tier='store'` ⇒ **PDP / 真實列表 / 搜尋 / 購物車**看到 store 價(v1 的「三處」漏了搜尋)。
⛔ 不做 `premiumStore`(**範圍選擇, 不是資料阻塞** —— 見事實 11)· 後台 · 報價單 repo。
⛔ **不把 `price_store` 加進公開投影** —— 那讓未登入者也拿得到, 方向相反。

## D · 形狀:甲(RPC, 不收 tier 參數)—— 而 codex 打出四個必須釘死的細節
`get_effective_prices(product_ids[])`,`security definer`,tier 由內部 `auth.uid()` 查。
1. 🔴 **呼叫端用哪一把 key 是承重前提** —— 用 `service_role` 或裸 `anon` 時 `auth.uid()` 是 NULL ⇒ **永遠回 general 而不報錯**。
   ⇒ **plan 釘死:必須用帶使用者 JWT 的 client**,且 §F-1 那格要用**真 JWT** 打,不得用 fixture。
2. 🔴 **不得進共用快取**(must-fix ①):`unstable_cache` 是跨使用者的 ⇒ 個人有效價疊加**只能在快取之外**。
3. 🔴 **篩選與排序要跟著改**(must-fix ③):否則經銷會員選 5,000-10,000 會看到 4,800、排序也不依畫面價。
4. 🔴 RPC 本身:精確 `EXECUTE` 對象 · owner · 固定 `search_path` · **下架過濾** · 輸入陣列上限 · `premiumStore` 明確降級。
   ⇒ **動工前必讀** `docs/patterns/revoking-function-execute-in-supabase.md`。
⛔ 乙(server 端 `service_role` 直讀)⇒ 繞過 RLS, 一個 import 錯邊洩漏全表。⛔ 丙(view 加 RLS-gated 欄)⇒ 與 `security_invoker` + 5 條 policy 交互面大, 改錯的方向是「多給」。

## E · 一句我 v1 寫錯的話(must-fix ④)
⛔ ~~「client bundle 永遠拿不到 store 價」~~ —— **要顯示就必然送到瀏覽器**。
✅ 正確的護欄是:**只回一個【已算好的單一有效值】**;未登入 / general **收不到替代價、收不到 tier 結構**。

## F · 驗收(每條可 yes/no;🔴 = 必須有一格會紅)
1. 🔴 **真 JWT 打**:`tier='store'` 的真使用者 ⇒ 拿到 store 價。**不得用 fixture 代替**(must-fix ⑤)。
2. 🔴 **偽造拿不到**:未登入 / 一般會員 ⇒ general。
3. 🔴 **裸 client 會紅**:故意用不帶 JWT 的 client 呼叫 ⇒ 斷言**不是靜默回 general**, 而是**出聲**(must-fix ⑦)。
4. 🔴 **異價世界四處都變**:餵一件 store < general ⇒ PDP / 列表 / 搜尋 / 購物車**各一格**。
5. 🔴 **篩選排序一致**:經銷會員用價格區間篩 ⇒ 回來的每一件**畫面價都落在區間內**。
6. 🔴 **共用快取不汙染**:經銷會員先看、訪客後看 ⇒ 訪客拿到 general(must-fix ①)。
7. 🔴 **稅別一致(草稿, 標【待 Q24】—— 照甲寫;他答乙就整條重寫)**:經銷會員的畫面單價是**未稅**、標籤逐字**不含「含稅」**、結帳頁**多一列稅**且該列 = 未稅小計 × 5%;一般會員該列**不出現**。
7b. 🔴 **單型載體(§A-2)**:經銷會員從顧客站下的單, 下游判得出「這張單的每列是未稅」而**不是只看 `tier_at_checkout`**;突變 = 把那個載體拿掉 ⇒ 本格必須紅。
8. 🔴 **fail-closed 出聲**:RPC 失敗 ⇒ 顯示 general **且 log**, 不是 NT$0、不是空白。
9. 🔴 **突變**:把 RPC 內的 `auth.uid()` 換成參數 tier ⇒ 第 2 條必須紅。
🛑 **v1 那七條在「今天 100% 同價」的世界裡有四條沒有判別力**(codex 逐條驗到 3)⇒ 第 4 條是它們的分母。

## G · 內部可觀測性(must-fix ⑦ —— 不加對客文案, 但不能沉默)
不加「經銷價待同步」給客人是對的;而 **`auth.uid()=NULL` 會正常回 general 且不產生 error**
⇒ **功能壞掉與同價商品完全同形**。⇒ 加一個**內部**訊號:RPC 判定 tier 時記錄「有沒有拿到 uid」,
零 uid 比例異常 ⇒ 進既有的 anomaly-alert。

## H · Rollback(must-fix ⑨:v1 太慢)
事故順序:**① 先 `REVOKE EXECUTE`(精確 signature)⇒ 立刻退 general** ② 確認退回生效
③ 才部署把三處改回常數 ④ **清除 / 換版相關快取**(否則錯價留在共用快取裡)。
🛑 **不 DROP 那支 RPC**(已 apply 照 ⟦01-LEDGERHASH1⟧ 紀律)。

## I · 仍未查(會改變形狀的都列出來)
`checkout` / `create_order` 那條路吃哪個價 · 變體(variant)層的 store 價分布 · 列表批次大小成本 ·
正式庫 function owner 現況 · 這片對既有 `products-new-arrivals-exclude.test.ts` 那類對帳的影響。
