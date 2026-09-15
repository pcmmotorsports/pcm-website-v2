# 登記退款後結清待退款 + 部分取消後的金額顯示(plan,待 Sean 批)

> 來源:2026-09-15 後台全流程走查 路 3(鑽機實測,PCM-2026-1009)。截圖 `~/pcm-mailbox/screens/admin-flow-20260915/p3-*`。
> 本檔**只是 plan**:不改 RPC、不寫 migration、不貼板。表單那句錯的文案另外修(審查 R2 仍有 must-fix:後台建的含稅單不會自動開列,字面待主視窗 / Sean 定)。
> 鐵則 8(動 schema / RPC)⇒ 批了才做;鐵則 12 ⇒ 實作那片要對抗審查(codex 額度到 09-20,缺 codex 那一路要寫明)。

---

## 1. 白話:發生了什麼

一張匯款單,客人付 **14,300**;員工取消其中一件 **5,080**(缺貨),把 5,080 匯回去並登記。

| 時點 | 帳本(DB) | 畫面 |
|---|---|---|
| 部分取消後 | 剩下的訂單 9,220;系統**自動開一筆待退款 5,080** | 頂部「尾款 0 · 總額 / 已收 14,300 / 14,300」、收款區「已收足」⇒ **看不出要退** |
| 登記匯款退款 5,080 後 | 已收淨額 9,220 = 剩下的訂單,**帳是對的** | 頂部「**尾款 5,080**」、收款區「應收 14,300 / 已收 9,220 **還差 5,080 元**」⇒ **像客人欠錢** |
| 同時 | 那筆待退款**仍是「未結」** | 退款異常頁多一張「待退款列跟現在的收款對不上」;每日告警會算進去 |

⇒ **錢做對了,系統兩處講錯**:待退款不會自己關、畫面的「應收」一直是原總額。

## 2. 為什麼(碼上逐條核過)

| 事實 | 出處 |
|---|---|
| 部分取消會自動開待退款:非卡淨收 − 剩餘應收 > 0 才開;有刷卡收款 / 稅算不出 / 已整單取消不開 | `supabase/migrations/20260914070000_m4b_op7_partial_cancel_pending_refund.sql` `pcm_partial_cancel_recompute`(正式站已貼) |
| 重算 trigger 只聽:取消明細新增、品項單價 / 數量變、運送方式變 —— **不聽退款登記 / 作廢** | 同檔 `pcm_partial_cancel_recompute_tg` 與三個 `*_partial_refund_*` trigger |
| `order_pending_refunds.settled_at` **沒有任何寫入端**;表上已備好 `settled_manual_refund_id`(複合 FK 到 `order_manual_refunds (id, order_id)`)、`settled_needs_ref` CHECK、`settled_ref_key` UNIQUE | `supabase/migrations/20260901080000_m4b_autorefund_pending_refunds.sql:64`「消化那一端等 #787」、`:216-266` |
| `admin_record_manual_refund` 鎖訂單列(`FOR UPDATE`)、寫退款、寫稽核 —— 不碰待退款 | `supabase/migrations/20260912040000_m4b_manrefundnoaudit_rpc_writes_audit.sql` |
| `admin_void_manual_refund` 鎖退款列、標作廢、寫稽核 —— 不碰待退款 | 同檔 |
| 對帳 view `rail_mismatch` = 逐軌比「該開的分配」vs「未結列」;退完之後該開 0、未結 5,080 ⇒ 判對不上 | `20260914070000` `pcm_partial_cancel_refund_reconciliation_v` |
| 畫面「應收」吃 `detail.total.amount`(原訂單總額);「取消 / 退款後 due 怎麼算」碼裡寫明 **Sean 未拍** | `apps/admin/src/components/orders/order-detail-money-tab.tsx:410`、`apps/admin/src/lib/orders/payment-list-view.ts:262-282` |
| 正式庫現況(2026-09-15 唯讀實查):`order_pending_refunds` **0 列**(未結 0 / 已結 0 / 作廢 0) | `scripts/readonly-prod-sql.sh`;對帳 view `pcm_readonly` 沒權限讀,未量 |

## 3. 要改什麼(Q2 選甲時)

### 3.1 結清寫在哪
**在兩支 RPC 裡做,不加 table trigger。**
- `admin_record_manual_refund`:寫完退款列之後,同一個交易、同一把訂單鎖,結清同單同軌的未結待退款。
- `admin_void_manual_refund`:作廢一筆退款時,把被它結清的待退款**解除結清**,再依規則重開。
- 理由:兩支 RPC 已經鎖訂單列、已經寫稽核;table trigger 會多一個看不見的寫入者,而且作廢那條路要讀退款列當下的狀態,放 RPC 裡順序最清楚。
- 反方(審查時要看):若未來有第三個寫 `order_manual_refunds` 的地方,RPC 內結清會漏。今天全 repo 寫入端只有這兩支(實作前再 grep 一次並寫進 migration 前置閘)。

### 3.2 怎麼配對
同一張單、同一條軌(`bank_transfer` / `cash`)、`settled_at IS NULL AND voided_at IS NULL` 的那一列(唯一索引保證同單同軌最多一列)。

| 退款金額 vs 待退款 | 做法 |
|---|---|
| 相等 | 那一列 `settled_at = now()`、`settled_manual_refund_id = 新退款 id` |
| 退得比較少(分次退) | 舊列結清並指向這筆退款;**另開一列剩下的金額**(同 `cancellation_id`、`amount_at_cancel = 差額`)⇒ 同單同軌仍只有一列未結 |
| 退得比較多 | 結清那一列;多出來的部分**不自動做任何事**,由對帳 view 照舊報出來給人看(不猜是誰的錢) |
| 那條軌沒有未結待退款 | 不動(例:沒有取消、純粹退運費) |

⚠️ 分次退會讓「一筆退款 ⇔ 一列待退款」變成一對一鏈;`settled_ref_key` UNIQUE 允許(每筆退款只結一列)。

### 3.3 作廢退款時
- 找 `settled_manual_refund_id = 被作廢那筆` 的列 ⇒ 清掉 `settled_at` / `settled_manual_refund_id`。
- 若同單同軌此刻已經有另一列未結(分次退開出來的差額列)⇒ 合併:差額列作廢(`void_reason = 'merged_on_refund_void'`),被解除那列金額加回。
- 然後呼叫 `pcm_partial_cancel_recompute`,讓金額照 Q13 重算一次(它已經會作廢多餘、覆寫金額)。

### 3.4 對帳 view
**不用改。** 退完之後「該開」= 非卡淨收 − 剩餘應收 = 0,「未結」也 = 0 ⇒ 不出現。分次退時「該開」= 剩下要退的,「未結」= 差額列 ⇒ 對得上。實作時用鑽機把四種情況(相等 / 分次 / 多退 / 作廢)各跑一次,對帳 view 逐格對。

### 3.5 補資料(backfill)
正式庫今天 0 列 ⇒ **不需要**。migration 仍寫一段「未結列且之後已有同軌退款」的**計數前置閘**:貼板當下 > 0 就停,不自動補(讓人看)。

### 3.6 影響
| 影響到 | 怎麼變 |
|---|---|
| 退款異常頁 / 每日告警 | 正確退款後不再多一張「對不上」 |
| 待退款相關畫面(現在沒有列表) | 無;若 Q1 選「加一行待退款 X 元」,那一行會在結清後消失 |
| 刷卡 | 不動(卡的退款走 `order_refunds` 自己的狀態機;本片只碰非卡) |
| 整單取消開的待退款 | 同一張表、同一套配對 ⇒ 一起受惠 |

### 3.7 Rollback
- 兩支 RPC `CREATE OR REPLACE` 回 `20260912040000` 的版本(rollback 檔逐字存舊定義,md5 前置閘)。
- ⛔ ~~已被結清的列:`UPDATE … SET settled_at = NULL, settled_manual_refund_id = NULL WHERE settled_at >= <貼板時間>`;差額列依 `void_reason` 還原。~~
  ✅ 實作時改為**列不動**(`supabase/rollbacks/20260916130000-rollback.sql` 檔頭):結清列 / 差額列 / 併回列都與帳本對得上;改回未結會讓正確退過的單又變假異常,而且差額列存在時會撞活列唯一索引。退回後的缺口由對帳 view(部分取消)與補開排程的「活列金額少」計數(整單取消)看得到。
- 走 `docs/patterns/revoking-function-execute-in-supabase.md` 的 ACL 前後快照。

### 3.8 測試 / 驗收
- 拋棄式 PG:相等 / 分次 / 多退 / 無待退款 / 作廢退款(含分次後作廢)/ 整單取消開的列 —— 每格斷言 `order_pending_refunds` 與對帳 view。
- 鑽機:照路 3 走一次,退款異常頁要是「0 張要看」。
- 不寫 table trigger ⇒ 另寫一格「全 repo 寫 `order_manual_refunds` 的地方只有這兩支」的 grep 閘(實作那片決定放測試還是 migration 前置閘)。

---

## 4. 要 Sean 拍的兩題

```
Q1:部分取消 / 退款之後,訂單頁頂部與收款區的「應收」「尾款」怎麼顯示?
    (碼裡記的四個選項 + 主視窗補的一行,翻成白話)
A: 甲 應收改用「取消後剩下的金額」:取消完顯示「多收 5,080 待退」,退完顯示「已收足」
   乙 已取消 / 部分取消的單,不印「尾款」「還差」,只列數字
   丙 應收維持原總額,但字改掉,不再叫「尾款 / 還差」(例:「原訂單 14,300 · 已取消 5,080 · 已收淨額 9,220」)
   丁 維持現況(會叫員工去催客人一筆不存在的錢)
   ＋ 不管選哪個,可另加一行唯讀「待退款 X 元(已開,尚未退)」
推薦:甲 + 那一行。員工看到的數字 = 帳本真的在算的數字;只動畫面(讀既有 view),不動 RPC。
     ⚠️ 與 09-08「已收改顯示淨額」不衝突:那題管「已收」扣退款;這題管「應收」扣取消。兩個一起才對得起來(14,300 付、5,080 取消、5,080 退 ⇒ 應收 9,220 / 已收 9,220 / 已收足)。

Q2:員工登記退款之後,系統開的那筆待退款要不要自動結清?
A: 甲 要:同單同軌自動結清,分次退留差額(本檔 §3,要改兩支 RPC,過審查、你批才貼)
   乙 不要自動:訂單頁給一顆「這筆待退款已退」讓員工手動結案(也要 DB 寫入)
   丙 先不做:退款異常頁會多一張假的「對不上」,值班人工結案
推薦:甲。員工已經做對一次,不該再被叫去處理假異常;每日告警也會一直算它。
```

## 5. 不在本檔
- 出貨區「款項已收足」吃另一個口徑(`apps/admin/src/components/orders/shipment-section.tsx`),Q1 拍完要一起對齊。
- 表單「部分取消不會自動列待退款」那句錯字 —— 另外修成照實講(不承諾結清);審查發現還要講「後台建的含稅單不會自動開列」(`pcm_order_remaining_receivable` 對手動含稅單回 NULL)、以及有刷卡收款的單根本取消不了(`20260914050000:541-545`),字面待定。
