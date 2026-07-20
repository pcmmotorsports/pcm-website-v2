# M-4a B-3：結帳通知 Email 四層 gate 實作計畫

日期：2026-07-20
狀態：Sean 已批准 Q1=A；實作與三輪獨立審查完成，R3 PASS，本片由本 commit 收錄
內容分級：L1（固定欄位標籤、錯誤訊息與付款驗證揭露，預期極少變動）

## 1. 白話目標

在結帳第一步加入通知 Email，但先用預設關閉的單一開關包住。開關關閉時，現有結帳仍走原本 8 個 RPC 參數；開關開啟時，畫面、client payload、server 必填與 RPC 第 9 參數一起切換，不會出現只開一半的中間狀態。

B-3 只建立安全通道：flag-on 的第 9 參數固定送 `null`。客人輸入的 canonical Email 真值要到 B-4 才會寫進訂單，TapPay `cardholder.email` 三分支也留在 B-4。

## 2. 依據與邊界

- production DB CHECK：`20260718120000_m4a_b1_orders_notification_email.sql`。
- production 9-param RPC：`20260719120000_m4a_b2_create_order_notification_email.sql`。
- 產品規格：B-0 PRD §3.1、§3.3、§3.4、§4 B-3/B-4。
- design-reference 沒有通知 Email 欄，因此這是已核准的 business override；視覺沿用 `.auth-field` 與既有 checkout token。
- 不改 migration、`database.types.ts`、TapPay cardholder、Vercel env、`.env*`、production DB。
- 不做 `#288-b`，不恢復已作廢的 E2a-2。

## 3. 四層資料流

```text
CHECKOUT_NOTIFICATION_EMAIL_ENABLED === "true"
  ├─ UI：顯示 Email 欄與揭露文案
  ├─ client：payload 才帶 notificationEmail
  ├─ server：factory schema 才要求並重新驗證 notificationEmail
  └─ RPC：PlaceOrderInput 有 marker → mapper 產第 9 鍵 p_notification_email:null

flag off
  └─ 欄位不顯示 / payload 不帶 / server strip 偷塞值 / mapper 精確 8 鍵
```

## 4. canonical 與六條件

順序固定如下：

1. 只移除頭尾半形空白 U+0020，不使用會吞其他 Unicode 空白的 `.trim()`。
2. 找到第一個 `@` 後，只將 domain 轉小寫；local-part 保留原字面。
3. 空值回 `請填寫 Email`；其餘失敗只回 `Email 格式不正確`，不回顯輸入。
4. 驗 `^[!-~]+$`，拒絕控制字元、CR/LF、NBSP、全形與非 ASCII。
5. 以 `TextEncoder` 的 UTF-8 bytes 驗 `<=254`，不用 JS `.length`。
6. 驗唯一一個 `@` 且 domain 至少一個 `.`。
7. synthetic 比對時將 domain 小寫並去尾點，拒絕本體與任何子網域；相似不同域不得誤擋。

client 與 server 使用同一個 `NotificationEmailInput`；client 只改善 UX，server 才是安全閘。

## 5. 檔案影響面

主要新增：

- `packages/schemas/src/notification-email.ts`
- `apps/storefront/src/lib/email/notification-email-gate.ts`
- `apps/storefront/src/components/CheckoutStep1.tsx`
- 上述相稱 tests 與 `/checkout` server route test

主要修改：

- `packages/schemas/src/index.ts`
- `apps/storefront/src/app/checkout/page.tsx`
- `apps/storefront/src/components/CheckoutView.tsx`
- `apps/storefront/src/hooks/useChargePayment.tsx`
- `apps/storefront/src/app/checkout/charge-actions.ts`
- `packages/domain/src/order/types.ts`
- `packages/adapters/src/supabase/mappers/order.ts`
- `packages/adapters/src/supabase/SupabaseOrderAdapter.ts`
- 對應 tests、`checkout.css`、design manifest、STATUS、CURRENT、Review Packet

## 6. 11 項舊字面核銷

| # | 位置 | 狀態 | 說明 |
|---|---|---|---|
| 1 | mapper `CreateOrderRpcArgs` 8 鍵型別 | B-3 修改 | 第 9 鍵改 optional null-only，屬性不存在仍精確 8 鍵；B-4 才擴成真值。 |
| 2 | mapper 組參數物件 8 鍵 | B-3 修改 | 依 `notificationEmail` null-only marker 決定是否加入第 9 鍵。 |
| 3 | adapter 唯一 `.rpc('create_order', …)` | B-3 修改 | RPC 名稱不變，測試鎖定 8/9 兩種 args。 |
| 4 | `database.types.ts` `create_order.Args` | B-4 刻意延後 | 依 Sean Q2=A 不手改 generated file。 |
| 5 | domain `PlaceOrderInput` 8-param 說明 | B-3 修改 | 加 optional marker 與 B-3/B-4 邊界。 |
| 6 | mapper test 硬編碼 8 鍵 | B-3 修改 | 保留 off=8，再加 on=9/null 與 domain／wire 禁字串型別防線。 |
| 7 | adapter test mock 8 鍵 | B-3 修改 | 保留既有 8 鍵測試，再加 9th null；移除掩蓋型別的 `as never`。 |
| 8 | schemas 對齊 RPC 註解 | B-3 修改 | 已更正為 flag-off 舊契約與 flag-on Email schema，不再宣稱只有三欄。 |
| 9 | B-0 PRD F3 歷史 8-param | 歷史事實保留 | 不重寫已發生的歷史盤點。 |
| 10 | STATUS／PROGRESS／backlog／manifest | B-3 修改 | STATUS 與 manifest 記現況；PROGRESS/backlog 不複製本片細節。 |
| 11 | `shipping-rpc-drift.test.ts` 舊說明 | 已由 B-2 修正 | live grep 未見待改的 8-param `CREATE OR REPLACE` 說明。 |

## 7. 驗收與 rollback

驗收：targeted tests、六條件負向矩陣、四層 mutation、typecheck、lint、build、full Vitest、`design-mirror --validate` 全綠；元件與 hook 不超過硬上限。另以本機 process-only flag 跑真 `CheckoutView` 桌機／手機瀏覽器流程，臨時 harness 驗完即刪；肉眼發現的手機錯誤訊息遮蔽已用 focus + 置中捲動修正。R2 另抓到 iOS Safari 的 `<16px` 聚焦縮放風險，已在 mobile breakpoint 釘 16px，加 CSS 靜態守門並用 `agent-browser` 驗 computed style、焦點與零水平溢出。

rollback：維持或切回 flag off 即回舊 8-param 行為；若需回退程式，反向還原本片 app/schema/type/mapper 變更即可。B-1/B-2 production schema 保留，不做破壞性 rollback。

本片完成後仍不開 flag、不 push、不 deploy；先交獨立 Codex review。
