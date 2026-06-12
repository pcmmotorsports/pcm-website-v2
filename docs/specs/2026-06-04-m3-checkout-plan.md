# M-3 結帳 + 會員分級定價(原價 / 經銷價)— 動手前計畫 v6(鐵則 8 關卡1 用)

> 狀態:🟢 v6、codex 關卡1 兩輪(經銷價範圍)complete;round2 剩 3 BLOCKER+1 WARN 全為實作細節已收進 v6 → 達每片硬上限 2 輪、餘細節由逐 slice codex 關卡2 對真碼驗 → 開蓋
> 作者:Claude Code(自驅 SOP) / 日期:2026-06-04
> 衝突仲裁:STATUS.md > NORTHSTAR > ADR-0005 > 本檔
>
> **v4→v5 變更(收斂 codex v4 的 5 BLOCKER+4 WARN):** server 端真會員 tier(棄 cookie)/ server-only 取價路徑 / cart 複合鍵防撞 / RPC `REVOKE FROM PUBLIC` / 同步後硬驗 / 跨系統 least-privilege 憑證定案 / 報價單合約先 bump / premiumStore 鎖=store / CI grep 抓真數字。前版字面見 git history。

---

## 0. 拍板紀錄(Sean 2026-06-04)

- **Q1=A** 完整 M-3;**Q2=A** TapPay sandbox;**安全鑰匙=丙**(建單零 service_role、付款窄權角色);**Codex 走 IDE 登入**。
- **經銷價=A(現在做)**:`經銷價=不同會員等級登入後看的價`;兩個價、**直接搬報價單算好的、不自己算**(`原價=general`、`經銷價=store`;蝦皮/成本不搬);**等級後台手動標記**(既有);**premiumStore(再-3~5%)Phase 1 不做**(暫同 store)。

## 1. 目標

依會員等級給對的價 + 真成交:一般會員看/付原價;店家會員(後台手動設等級)看「原價畫線+經銷價」、結帳付經銷價;TapPay sandbox→訂單寫 Supabase→完成頁→會員中心查。**經銷價/成本零外洩、金額不可竄改。**

## 2. 現況

- **訂單**:近乎從零(stub + localStorage cart、變體 sku 權宜塞 color)。無 checkout/orders 表/TapPay。
- **定價真相(MCP 查證 pcm-quote-v2)**:每 RPM 商品 `price_listing(原價)>price_store(經銷價,店家折扣率算)>price_cost`,全非空。
- ⚠️ **現行同步搬錯**:網站 `price_general` 誤=來源 `price_store`(經銷價);`price_store` 欄 NULL;`price_by_tier.store`=general placeholder;來源 `price_listing`(真原價)未搬、且在來源屬 anon 受保護欄。
- **現有 tier 機制(codex v4 抓)**:`apps/storefront/src/lib/tier.ts` `resolveTierFromRequest` 依**瀏覽器 cookie `pcm-tier`**(+ dev `?tier=`)解析 tier → **真經銷價上線後是洩漏點**(一般會員設 cookie 即冒 store)。`packages/domain/src/catalog/pricing.ts` `computeEffectivePrice` premiumStore 會套 `brand.premium_extra_pct`。
- **可複用**:地址 CRUD(g);`customers.tier`(enum general/store/premiumStore、DEFAULT general、column-GRANT 擋 authenticated 改、後台手動標記);DB 內提權 pattern(SECURITY DEFINER+`search_path=''`、products.price_by_tier 不進 public view)。
- **design**:結帳 3 步 + 完成頁 + CartPage/OrdersPage(AccountPages);商品頁/卡 tier 顯示骨架。

## 3. 範圍

### 3.0 會員分級定價(核心新維度)

**(a) tier 來源 = server 真會員(棄 cookie、修 BLOCKER1)**
- 顯示價 + 結帳取價的 tier **一律 server `auth.getUser()` → 查 `customers.tier`**(DB 權威)。
- 現有 `resolveTierFromRequest` 的 cookie `pcm-tier` / `?tier=` 路徑**降為純 dev mock**(`PCM_DEV_TIER_OVERRIDE=1` gated),**禁用於任何真經銷價讀取**。

**(b) server-only 取價路徑(修 BLOCKER2)**
- 新增 **server-only 取價** use-case/RPC:依 server-驗 tier 回 `{price, originalPrice, tierLabel}`(店家才帶 originalPrice 供畫線)。
- `products_public`/`product_variants_public` **維持不含** price_store/price_by_tier;經銷價只走 server-only 路徑、絕不進公開 view。
- **tier-aware UI 價只走 (b) 的 server-only protected 取價路徑(回單一 effective price)**;🔴 **禁止把 store/premiumStore 傳進現有 public `SupabaseProductAdapter`/`toUIProduct`**(該路徑 store/premium 為 dummy 0、傳真 tier 會顯 NT$0);toUIProduct 維持只吐 general 公開價、tier 價由 protected path 疊。premiumStore 顯示鎖=store(見 e)。補 store/premium 顯示價 ≠ 0 測試。

**(c) 資料運送(跨系統,修 mismap + WARN1/2)**
- 修 mismap + 搬兩價:網站 `price_general:=來源 price_listing(原價)`;網站 `price_store:=來源 price_store(經銷價)`;`price_by_tier={general:原價, store:經銷價}`;**直接搬不重算**。
- 🔴 經銷價安全運送:**不走 anon 公開鑰匙**;同步(GitHub Actions、server-only)用**最小權限來源憑證**讀兩價。
- **報價單側依賴(我出規格、Sean 橋接)**:① 先 **bump `STOREFRONT_CATALOG_CONTRACT.md`** 釘死 `price_listing→website.price_general`、`price_store→website.price_store`(消除現行「price_retail=零售」字面衝突);② 建**最小權限唯讀 role + 受保護 view**(只投 price_listing/price_store、只 RPM、**不含 cost/shopee/PII**),只給網站同步憑證(非 anon);③ 該 secret **只進 rpm-sync GitHub Actions、不進 storefront/Vercel runtime**。報價單側就緒前經銷價無法搬(階段 ⓪ 卡此;訂單地基/結帳填寫可先行)。

**(d) 同步後硬驗(修 BLOCKER5)**
- 同步寫入後**全量硬驗 RPM**:`price_general=price_listing > price_store > 0`、product+variant 價皆非 NULL、`price_by_tier.store.amount=price_store`(防 store 被錯填成 general);任一不過 → abort + 不上線。

**(e) 等級→價 + premiumStore 鎖(修 WARN3)**
- `general`→原價;`store`/`premiumStore`→經銷價(price_store)。
- premiumStore **顯示 + 建單都鎖=store**;保證 seed brands `premium_extra_pct=0` + 補測試鎖住(額外折扣 Phase 1 不算)。

**(f) 三層防護(鐵則 12)**
1. 經銷價只存受保護欄、不進 products_public / 任何 anon 面。
2. tier server 解析(a);client 永不收非自己等級的價(逐欄白名單、RSC/Flight payload 不夾經銷價給一般會員)。
3. **CI build 後 gate(修 WARN4)**:以**一般會員 session** 抽樣 build 後 HTML/RSC/Flight payload,grep **真經銷價數字 + 敏感欄名**(`price_store|price_by_tier|priceByTier`+既有)= 0 命中;店家 session 只含自己單一價、不得含完整 tier 結構。

### 3.1 做(訂單 / 結帳)

**Supabase migration(Sean `db push`):**
- `orders`+`order_items`:雙軸 `payment_status`(DEFAULT unpaid)+`fulfillment_status`(DEFAULT notOrdered)、enum 依 `domain/order/types.ts`;`tappay_rec_trade_id text UNIQUE`、`paid_at`。
- DDL:`REVOKE ALL FROM anon, authenticated`;`GRANT SELECT TO authenticated`;anon 0。RLS:orders `customer_user_id=(select auth.uid())`、order_items via parent;無 view 投射經銷價/cost。
- **建單 RPC(零 service_role、tier-aware、防撞、修 BLOCKER3/4)**:`create_order(p_lines jsonb, p_address_id uuid, p_shipping_method text, p_invoice jsonb)` `SECURITY DEFINER`:
  - `v_uid:=auth.uid()`;驗地址歸屬(`customer_addresses.id=p_address_id AND customer_user_id=v_uid` 否則 raise);
  - **line 收 `variant_id`(或 `(supplier_slug,sku)` 複合鍵)+ qty**(S3a 後 sku 非全域唯一、防撞錯變體/錯價);有變體商品必帶 variant、否則 fail-closed;**不收價**;
  - 依 `customers.tier`(v_uid 查)取價:general→price_general、store/premiumStore→price_store;**有變體商品一律 join `product_variants` 取該 variant 自己的價(群層價=群內最低、只給無變體商品、不可當變體價)**;**驗 parent `products.delisted_at IS NULL` + availability 訂購政策(防舊 cart 送已下架/缺貨)**;**fail-closed:價 NULL/0 / 已下架 / 找不到對應 variant → raise**;補測試(高價變體不被群最低價結帳、delisted stale-cart 建單失敗);
  - 寫 order(unpaid/notOrdered)+items+快照(§5.4 含 tier_at_checkout);
  - `SET search_path=''`、禁動態 SQL(`= ANY($1)`)、**`REVOKE EXECUTE FROM PUBLIC, anon`**、只 `GRANT EXECUTE TO authenticated`;交易模擬(含驗 anon/未登入不能呼叫)。
- **付款確認窄權(修 BLOCKER4)**:`payment_confirmer`(NOINHERIT LOGIN、無 table 權限);`confirm_order_payment(p_order_id,p_amount,p_rec_trade_id)` `SECURITY DEFINER`、`search_path=''`、**`REVOKE EXECUTE FROM PUBLIC, anon, authenticated`** 後只 `GRANT EXECUTE TO payment_confirmer`:驗 unpaid+`p_amount=orders.total`+rec_trade_id 唯一→paid;重放 idempotent;不符拒;交易模擬驗 anon/authenticated 不能呼叫。

**packages/前台/CI**:domain Order 行為+雙軸狀態機+guards;use-cases(create-order/calculate-shipping/confirm-payment/list/get/server-only 取價);IOrderRepository 去 Medusa;Supabase order 只讀 adapter+TapPayChargeAdapter(server-only);schemas zod;前台搬 購物車/結帳3步/完成頁/訂單列表+詳情+tier-aware 價;CartContext 改 variant_id 線契約;CI grep gate(§3.0f)。

### 3.2 不做 / 先留位

premiumStore 再折(暫=store)/ 經銷商自動申請審核+管理 UI(手動設 tier、M-2-06/M-4a 延)/ 儲值金 / 優惠券 / 合作店家取貨 / 完成頁安裝 CTA / ATM(隱藏)/ 發票自動開立(只收存)/ 免運門檻套 NT$5,000(L2)。偏離一律註解+commit body+manifest override 揭示。

> 🆕 **2026-06-11 Sean override:TapPay webhook(notify)移出「不做」→ 改做**(理由=金流穩健優先、原排除僅 Phase-1 省事非硬擋)。處置 = C 主(TapPay 後端 notify webhook 自動補正孤兒單〔charge 成功但 confirm 未達〕)+ A 輔(charge-attempt 紀錄防 webhook 也失敗)。落 **階段②-⑥ webhook 片**(公開端點翻 paid = 鐵則 8+12 安全要害:驗來源防偽造 + 金額對 orders.total + 走冪等 confirm RPC;動手前獨立 mini-plan + codex 關卡1 + 關卡2;notify 機制 context7/官方文件確認;sandbox 測需 Vercel preview/通道非本機)。詳 docs/handoff/2026-06-11-m3-stage2-tappay-kickoff.md §3.7 PF-X1 + §7 ②-⑥。

### 3.3 Phase 2 預留:fulfillment_method 超商/店家;display_id 生 QR;premium 三層折扣;member_discount_overrides。

## 4. 架構與影響面(鐵則 8)

- 跨層 domain→ports→use-cases→adapters→storefront。
- 動 schema:orders/order_items+RLS+grant+create_order RPC+payment_confirmer 角色+confirm RPC+price_store/price_by_tier 寫入(NULL→真經銷價)。
- **跨系統**:報價單側 bump 合約 + 最小權限 role/view(我出規格、Sean 橋接);同步 rpm-fetch/transform 改(讀兩價 + server-only 高權憑證 + price_general↔price_listing 修正 + 同步後硬驗);新 GitHub secret(來源最小權限憑證、**只 rpm-sync GHA**)。
- 動共用:packages 多檔;CartContext variant_id;tier.ts 改 server 真會員;toUIProduct 去釘 general;pricing.ts premiumStore 鎖 store。
- 動 storefront:cart/checkout/order-complete/account-orders + charge/confirm route + 全站 tier-aware 價(server-only 取價)。
- 動 config:ci.yml grep gate。
- env(Sean 後台、不入 git):TapPay APP_ID/APP_KEY(public)+Partner Key/Merchant(server-only)+payment_confirmer 連線+來源經銷價讀取憑證(server-only、只 rpm-sync)。

## 5. 鐵則 12 紅線

1. 金額整數(Money)、禁浮點。
2. **經銷價零外洩**:server tier 解析(棄 cookie)+ server-only 取價路徑 + 不進 public view + 逐欄白名單 + RSC payload 過濾 + CI 抓真數字 + 雙 grep(static+live)。
3. 價格 server 權威 + tier server 重驗:create_order DB 內依 customers.tier 取價;client 只送 variant_id+qty、永不送價/tier。
4. 歷史凍結+快照:tier_at_checkout/subtotal/shipping_fee/discount_total/total/unit_price/line_total/product_snapshot(白名單)/variant_sku;禁 price_by_tier/price_store/cost。
5. 建單零 service_role;所有 DEFINER RPC `REVOKE EXECUTE FROM PUBLIC` 再精準 grant;付款窄權角色;charge 前 server 重算;Partner Key server-only。
6. 經銷價運送:同步 server-only 最小權限憑證、絕不經 anon、secret 不進 storefront/Vercel。
7. RLS 客人只讀自己;anon 0。Fluid Compute 不長存憑證。

## 6. 內容分級:運費門檻 L2(hardcode+backlog);價格資料(原價/經銷價)動態源自同步;訂單狀態/發票類型 L1。

## 7. 階段切片(Sean 肉眼檢查點;內部多 slice、各自三綠+codex 關卡2)

- **階段 ⓪ 定價就位+分級顯示**(🔴 **硬 gate:報價單合約 bump v2 + protected dealer view + least-privilege 憑證 三者就緒前,不得改網站 `price_store` 同步、不得開店家價 checkout**):合約 bump + 最小權限管道 → 同步修+搬兩價+同步後硬驗 + 經銷價防護 + server 真會員 tier + server-only 取價 + 全站 tier-aware 顯示(原價畫線+經銷價)。**Sean 玩**:一般帳號看原價;後台設某帳號「店家」→ 看原價畫線+經銷價;**雙 grep 證一般瀏覽器零經銷價**。
- **階段 ① 購物車+結帳填寫+建單地基**:domain Order+雙軸狀態機+tests;orders migration+RLS+create_order(tier-aware/防撞/REVOKE PUBLIC)RPC(交易模擬);use-case+只讀 adapter+calculate-shipping;CartContext variant_id;前台 購物車+結帳 step1-3(選 TapPay 不送出)。**Sean 玩**:一般/店家兩帳號 走到付款前、價依身分正確。
- **階段 ② TapPay 成交+完成頁**:TapPayChargeAdapter+charge route+payment_confirmer+confirm RPC(交易模擬);送出→刷卡→完成頁。**Sean 前置**:sandbox 金鑰。**Sean 玩**:兩帳號各刷測試卡、金額依等級正確、零洩漏、重放/竄改/越權呼叫被拒。
- **階段 ③ 訂單查詢**:list/get+只讀 adapter;會員中心訂單列表+詳情。**Sean 玩**:看自己的單、金額(凍結)/狀態正確。

## 8. 審查計畫

鐵則 8+12 → codex 關卡1(本版)+ 每階段 commit 前 /slice-checkpoint 三綠 + code-reviewer + codex 關卡2(經銷價/migration/付款 slice 必跑);DB 改動前 Supabase MCP 交易模擬(只查 count/欄名不取金額);codex 紀律 main session/`-s read-only`/porcelain 零留痕/每 slice 硬上限 2 輪。

## 9. Rollback

各 package 可保留;經銷價運送/TapPay 走不通 → 結帳暫退 LINE/匯款人工對帳、顯示暫退單一原價;每 migration 自帶 rollback+先交易模擬;觸發 ADR-0005 §6.1#1 → 暫停 raise Sean。

## 10. 待 Sean 後續

- **報價單側**(階段 ⓪ 依賴、我出規格 Sean 橋接):bump 合約 + 最小權限 role/view 曝兩價 + secret 給 rpm-sync。
- 階段② 前:TapPay sandbox 金鑰。M-3 中途:發票 A3、premiumStore 再折時機。

## 11. 風險

跨系統依賴(報價單管道)→ 階段 ⓪ 卡、訂單地基先行;經銷價洩漏面大(全站條件顯示)→ server tier + server-only 取價 + 白名單 + RSC 過濾 + CI 真數字 grep + 雙 grep;mismap 修正(price_general 經銷價→原價)動既有 933+ 價值 → 同步後硬驗 + MCP 抽驗 + 肉眼;create_order fail-closed 防錯價;cart 複合鍵防多供應商撞 sku;TapPay → 階段② 前 context7。

## 12. codex 關卡1 收斂史

v1(10)→v2 走丙(7 解)→v3 收斂 round2(地址歸屬/釘general fail-closed/payment_confirmer/CI grep/不建webhook/冪等/雙軸)→v4 範圍擴張經銷價→**v5 收斂 v4 5BLOCKER+4WARN**:server 真會員 tier(棄 cookie)/server-only 取價路徑/cart 複合鍵/RPC REVOKE PUBLIC/同步後硬驗/least-privilege 跨系統憑證/報價單合約先 bump/premiumStore 鎖 store/CI grep 真數字。→ 跑 codex 關卡1 round2。

— END —
