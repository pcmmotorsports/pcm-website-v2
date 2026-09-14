# plan · 手動建單可替這張單選會員等級 —— 2026-09-14

> Sean 2026-09-14 10:3x 逐字「手動建立訂單的時候可以選擇車行會員還是經銷的選項才對」。主視窗假設(已回 Sean):預設帶客人現在的等級、只改這張單的 `tier_at_checkout`、客人帳號等級不動。
> 盤查:主視窗派 Plan subagent(opus)唯讀盤查, 主視窗謄寫。數字附檔:行。

## 0. 前提訂正
- 手動建單走的 RPC 是 **`admin_create_manual_order`(11 參)**, 唯一呼叫端 `apps/admin/src/lib/orders/manual-order-repository.ts:283`;不是顧客站的 `create_order`(整條不動, 與 090000 DROP 10 參無關)。
- 表單今天**沒有**「會員等級」那一格(`manual-order-form-body.tsx` tier 0 命中)⇒ 是新增一格。
- tier 現在由 RPC 自己抄:`20260910090000_…taxed_line_residual.sql:369` `SELECT c.tier INTO v_tier … WHERE user_id = p_customer_user_id`, `:887` 進 `INSERT … tier_at_checkout`。
- **零價格連動**:該函式 `v_price_tax_mode` 只由 `v_invoice_requested` 決定(`:712-720`), `v_tier` 只出現在 `:369/:887`;premiumStore 不觸發取價 / 稅(有連動的是顧客站 `create_order` `20260907040000:203`, 本片不碰)。

## 1. 改什麼
### 1-a migration `20260914030000_m4b_manual_order_tier_override.sql`(B 窗)
- **DROP 11 參 + CREATE 12 參**(逐字照 `20260905130000` 那次加第 11 參的形狀:同檔 DROP + CREATE + §6 三行 REVOKE/GRANT + §6b `COMMENT ON` —— 🔴 DROP 會帶走 ACL 與 comment `:806-830`)。不用 CREATE OR REPLACE(簽章含參數列, 加參數 = 第二支多載, 舊 11 名呼叫 PGRST203);不做薄包裝多載。
- 新參數 `p_tier text DEFAULT NULL`(NULL = 照客人現在的)⇒ 舊 TS 送 11 個名字仍唯一命中 ⇒ **DB 先貼、UI 後上**, 中間態合法。
- 函式內:`IF p_tier IS NOT NULL AND p_tier NOT IN ('general','store','premiumStore') THEN RAISE`;`v_tier := COALESCE(p_tier::public.member_tier, <:369 查到的>)`(enum 已存在 `20260523034911:8`);`:369` 那段查詢**保留**(兼「客人存不存在」G3 閘)。
- audit `:1098` 的 `after` 加 `'tier_at_checkout', v_tier` + `'tier_overridden', (p_tier IS NOT NULL)`。
- 冪等指紋 `v_canonical`(`:776`)**加 tier**(主視窗裁, 理由同第④代 invoice_requested:它改變落表內容;代價 = 舊 request_id 重送被判 P858B, 檔內 `:783-795` 已述)。
- 後置閘照該檔 `:1146` 形狀:`to_regprocedure` 換 12 參簽章 + md5 + 三段新碼 + `service_role=X/` + 負對照。
- rollback `supabase/rollbacks/20260914030000-rollback.sql` = DROP 12 參 + 逐字貼回 `20260910090000:213-1143` 那版 11 參 + 它的 REVOKE/GRANT/COMMENT。**回滾順序 = 先 revert code 再回 DB**(DB 回舊版時新 UI 建不出單)。
- 版本號 `20260914030000` 2026-09-14 掃過 8 worktree 無撞;貼的當天重掃。

### 1-b UI(A 窗)
- `manual-order-form-body.tsx:192` 訂單來源旁加「會員等級」`<select name='tier_at_checkout'>` 三項, 字面取 `MEMBER_TIER_LABEL`(`order-list-view.ts:300`);**預設選中客人現在的等級**(主視窗裁做:客人候選投影加 tier —— `manual-customer.ts:350`、`ManualCustomerCandidate`/`PickerCandidate:42`、picker `data-tier`、client state 四處);客人還沒選 ⇒ 下拉 disabled;現場新建的客人 ⇒ 預設 general。
- 解析 `manual-order-form.ts:43/896/1122` 照 `orderSource` 那條複製一份(白名單三值);repository `:283` 加 `p_tier`;test `:130` 同步。送出時**一律帶值**(= 選中的那個), 不靠 NULL 繼承 —— 畫面上看到什麼就存什麼。
- 客戶帳號等級仍只有 `tier-edit-form.tsx` 能改, 零交集。

## 2. 影響
- 新單 `tier_at_checkout` 可與 `customers.tier` 不一致 —— 正是要的;列表 / 匯出(`order-export.ts:173`)/ 只看篩選(`SupabaseOrderAdapter.ts:249`)都讀單上那格。舊單不動、無回填。
- 顧客站零影響。

## 3. 切片
| 片 | 窗 | 內容 | 依賴 |
|---|---|---|---|
| T1 | B 窗 | migration + rollback + 拋棄式 PG(apply / down / 冪等三發 + 負對照 tier 白名單)+ codex | — |
| T2 | A 窗 | 表單一格 + 客人候選帶 tier + 解析 + repository 一參 + 兩支 test + 1440 一張 | T1 寫好(本機驗要 T1 套在鑽機) |
**貼**:DB 先貼(Sean 點名)再推 UI。
