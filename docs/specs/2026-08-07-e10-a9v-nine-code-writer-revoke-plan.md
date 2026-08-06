# A9v — 九碼 writer 停寫(收線片)plan v1

> **狀態:自寫 plan;高風險片(鐵則 12②③)⇒ apply = Sean 手動停點。**
> **真權威 = 母 plan `docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md:454`(row 62)逐字:**
>
> > 🔴 **九碼 writer 停寫(R16 修正誤殺)**:**REVOKE `admin_update_order_item_workflow`**(item 支)
> > + 🔴 **R18 補:撤 `order_status_options` 的 service_role INSERT/UPDATE 寫權 + ACL 終態斷言**
> > (否則 P3 停寫不真 —— UI 下架了、寫權還在)—— `admin_update_order_workflow` **保留**……
> > 前置 = **grep 驗證全部 consumer 零引用**;`order_items.workflow_status` 欄**凍結不 DROP**。
>
> 🔴 **派工單 `E-134-A:8` 說「DROP 該 RPC 與 `order_status_options` 讀取函式族」,與真權威不符**:
> 真權威說的是 **REVOKE**,不是 DROP;而「`order_status_options` 讀取函式族」**查無此物**
> (它是一張**表**、直接讀,全 migration 樹零專屬讀取函式)。派工單自己寫「照母 plan row 62 字面,
> **實查為準**」⇒ 照真權威 + 實查做。**差異已在此標明,不靜默改口。**
> 事實一律實查於拋棄式 PG17 叢集(`d1t2-rehearsal.sh provision`),ff 追平 `origin/dev` @ `8841c86e`。

---

## §1 實查現況(全部量自活的資料庫,不是讀 migration 猜的)

| 物件 | 現況 | A9v 要做 |
|---|---|---|
| `admin_update_order_item_workflow(uuid, integer, jsonb, text, text)` | `service_role:EXECUTE` | **撤掉這個 EXECUTE** |
| `admin_update_order_workflow(...)` | `service_role:EXECUTE` | 🔴 **保留**(D-2 已收窄:送 `workflow_status` key 會 RAISE;現管運送方式與發票四欄)|
| `order_status_options` **表級** ACL | `service_role:INSERT` + `service_role:SELECT` | 撤 **INSERT**;**SELECT 保留**(真權威只說撤寫權)|
| `order_status_options` **欄級** ACL | 🔴 **5 個欄位各有 `service_role:UPDATE`**(`label` / `color` / `text_color` / `sort_order` / `is_active`)| 撤掉 |
| `order_items.workflow_status` | `text` 欄仍在 | 🔴 **凍結不 DROP**(真權威字面)|

### 1.1 🔴 兩個實查發現(都會讓「照字面寫」出錯)

**① 「UPDATE 寫權」是欄級的,不是表級的。**
表級 ACL 只有 `INSERT` + `SELECT`;真正的策展寫權是**五個欄位各自的 `UPDATE`**。
⇒ 只看表級 ACL 會以為「沒有 UPDATE 可撤」。
(memory `reference_pg-table-acl-flatten-blind-to-column-grants` 這一族。)

**② 表級 `REVOKE UPDATE` **會**連帶清掉欄級授權 —— 實測,不是假設。**
在拋棄式叢集上以交易模擬量過:

```
欄級 ACL 起始 = 5 欄
表級 REVOKE UPDATE 之後,欄級 ACL 還剩 = 0 欄
  service_role 對 label 欄還有沒有 UPDATE = f
ROLLBACK 後 = 5 欄(零留痕)
```

⇒ 一句表級 REVOKE 就夠,**不必再補欄級 REVOKE**(補了是冗餘)。
🔴 **但終態斷言必須檢查欄級** —— 那才是「日後有人在欄級重新授權」的觀察面(表級斷言對它全盲)。

### 1.2 前置與相容性(實查)

- **零 app 層消費端**:`admin_update_order_item_workflow` 與 `order_status_options` 在
  `apps/` + `packages/` 的命中**全部是註解**,零實際呼叫(A9w1-4c + A11 重建後)。
- **零 DB 內部消費端**:唯一在 `prosrc` 命中的是 `admin_update_order_workflow`,
  但那是**註解**(「狀態唯一寫入面=admin_update_order_item_workflow」)、不是呼叫
  ⇒ **撤權不會打壞合法改單**。
- **A10c2 無資料相依**(主視窗指定要確認的那條):母 plan `:450` row 58 逐字
  「依供應商單號搜尋畫面(**消費 A9b2**)」⇒ 消費的是供應商單號搜尋,**零九碼消費端**。

---

## §2 要做什麼

| # | 內容 |
|---|---|
| **M1** | `REVOKE EXECUTE ON FUNCTION admin_update_order_item_workflow(...) FROM service_role` |
| **M2** | 🔴 **同批顯式 `REVOKE ALL ... FROM PUBLIC, anon, authenticated`** —— 不是因為它們現在有,而是 Supabase default-grant 家族坑:函式 `proacl` **若變成 NULL 就等於 EXECUTE TO PUBLIC**。照 S1b 寫法,顯式寫死 |
| **M3** | `REVOKE INSERT, UPDATE ON TABLE order_status_options FROM service_role`(UPDATE 那句連帶清欄級,§1.1②)**+ 同批 REVOKE PUBLIC/anon/authenticated** |
| **M4** | 🔴 **ACL 終態斷言(fail-closed)**:①該函式 `proacl` **非 NULL** ②非 owner 授權**恰 `<無>`** ③`has_function_privilege` 對 service_role/anon/authenticated **全 false** ④`order_status_options` 表級恰 `service_role:SELECT` ⑤**欄級 ACL 數 = 0** ⑥`admin_update_order_workflow` 的 `service_role:EXECUTE` **仍在**(誤殺防護) |
| **M5** | 🔴 **`order_items.workflow_status` 欄仍在**的斷言(真權威要求凍結不 DROP,加一條擋「順手清乾淨」)|
| **M6** | `nine-code-rpc-retired.test.ts` 把 `order_status_options` 加進守門(主視窗採納我的建議)|

**不做**(刻意):不 DROP 任何函式或表、不動 `order_items.workflow_status`、
不撤 `order_status_options` 的 SELECT、不碰 `admin_update_order_workflow`。

## §3 驗收

1. migration 檔內 DO 全過(M4/M5 六 + 一條)。
2. 交易模擬 `BEGIN → 套用 → 驗 → ROLLBACK` 零留痕。
3. **突變證(四顆)**:①欄級 UPDATE 被重新授權(= 忘了寫表級 REVOKE UPDATE)⇒ 欄級斷言紅;
   ②誤撤 `admin_update_order_workflow` ⇒ 誤殺防護紅;③`workflow_status` 欄被 DROP ⇒ 凍結斷言紅;
   ④**item RPC 的 EXECUTE 被重新授權 ⇒ 停寫失效,3b 紅**(關卡2 codex nit 1:v1 漏列這顆)。
   **各自只紅該紅的、訊息各不相同。**
4. `nine-code-rpc-retired.test.ts` 擴充後:把 `order_status_options` 重新接回任一原始碼 ⇒ 該格紅。
5. 三綠 `--force` + 全套;Δ 實數對帳。
6. 🔴 **關卡2 = codex 正牌 `-m gpt-5.5`**(復役後本線第一片)+ sha256 前後比對。
7. **不 apply、不 db push**;commit 押分支。

## §4 鐵則

- **鐵則 12②③ 觸發**(權限 + DB 結構)⇒ 關卡2 codex 不降級;apply = Sean 停點。
- 鐵則 8:migration + 一支測試 = 2 檔,但**動權限** ⇒ 仍走全 9 步。
- L 分級不觸發(零使用者可見內容)。

## §5 誠實邊界

1. **REVOKE ≠ DROP**:函式與表都留著,只是叫不動 / 寫不進。這是真權威的選擇(可逆、留回滾餘地)。
2. 🔴 撤權後,`admin_update_order_workflow` 體內那句註解
   「狀態唯一寫入面=`admin_update_order_item_workflow`」**會變成過期字面** ——
   它在**已 apply 的 migration** 裡、本片不改(改它要 `CREATE OR REPLACE` 整支函式 = 擴張範圍)。
   **寫進本片 migration 檔頭與 STOP,不靜默留著。**
3. 本片零 app 行為改動 ⇒ 全套測試 Δ 只來自 M6 那支守門。

— E 窗(九碼退場窗),2026-08-07
