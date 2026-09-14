# 刷卡失敗摘要帶第一筆單號 · plan(鐵則 8:改 RPC;等主視窗批)

板列 `launch-todo:1148` ⟦b4-CARDFAILNOALERT⟧。主視窗 2026-09-14 派施工窗第 3 件。

## 1. 現況(量到的)
- 刷卡失敗**已經**在響:`get_daily_charge_failure_counts()`(`20260906980000`, 貼板 65)回 5 key;
  adapter `PgAnomalyAlertReaderAdapter.ts:1830-1855` 讀 ⇒ 長信 `check-anomaly-alerts.ts:914-929` 三行 + LINE 短版 `owner-line-digest.ts:132-142`「刷卡失敗 N 筆、3DS 沒過 M 筆(共 T 筆)」。
- 缺的只有「第一筆單號」:RPC 只回計數, 沒有任何一筆的識別。長信那段逐字「這裡不放單號」(09-06 寫的, 不是拍板)。
- 失敗事件的表 = `payment_charge_attempts.status='failed'`(`20260612150000:87`);人看的單號 = `orders.display_id`。

## 2. 改什麼(最短路)
1. migration `20260914120000`(版本號已掃 ✅、已佔 stub):`CREATE OR REPLACE FUNCTION get_daily_charge_failure_counts()`
   多一個 key `first_failed_display_id`(text | null)= 窗內 `status='failed'` 依 `created_at` 最早那筆 join orders 的 `display_id`;沒有 ⇒ null。
   🔴 OR REPLACE 會把 SET 子句整組換掉 ⇒ 重寫 `SECURITY DEFINER / STABLE / SET search_path = ''`;ACL 不動(斷言 payment_confirmer 有、三角色沒有)。
   rollback = 重貼 `20260906980000` 那一代的函式體(down.sql 內含)。
2. `anomaly-alert-key-contract.test.ts:91` pin 5 → 6。
3. adapter 多讀 `dc['first_failed_display_id']`(字面, 給契約尺看)⇒ 域 `dailyChargeFirstFailedDisplayId: string | null`(不進 sane 判斷)。
4. LINE 短版:`刷卡失敗 N 筆(第一筆 <display_id>)、3DS 沒過 M 筆(共 T 筆)`;N=0 或讀不到 ⇒ 不印括號。**守 6 行上限:同一行加字, 不加行**。
5. 長信不動(它那句「不放單號」留著;要改另議)。
- 不動:`payment_charge_attempts` 表、排程、收件人、任何 GRANT。

## 3. 風險
- RPC 是 SECURITY DEFINER 讀 orders.display_id ⇒ 只回一個單號, 不回金額 / 客人。
- 沒貼之前 key 缺 ⇒ adapter 讀到 undefined ⇒ null ⇒ 短版不印括號, 三個計數照常(不 fail-closed 整組)。

## 4. 驗收(yes/no)
1. 拋棄式 PG:窗內 2 筆 failed ⇒ 回最早那筆的 display_id;0 筆 ⇒ null;5 個舊 key 值不變。
2. 短版單測:有單號 ⇒ 那行含 `(第一筆 X)`;0 筆 / 讀不到 ⇒ 不含;行數不變。
3. 三綠 + 契約測試綠;codex 一輪(碰錢)。
