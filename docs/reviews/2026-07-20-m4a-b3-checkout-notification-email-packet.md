# Codex Review Packet — M-4a B-3 結帳通知 Email 四層 gate

日期：2026-07-20
執行角色：Codex 實作 session
審查狀態：**獨立 review R3 PASS；R1 的 4 項與 R2 的 1 項 must-fix 均已銷案；本片由本 commit 收錄，未 push、deploy、開 flag**

## 1. 白話摘要

本片把結帳通知 Email 的安全通道接好，但刻意不把 Email 寫進訂單：

- flag off：畫面不顯示、client 不送、server 不要求、RPC 精確維持 8 鍵。
- flag on：畫面必填、client 才送、server 用同一 schema 重驗、RPC 改 9 鍵；第 9 鍵固定 `null`。
- canonical Email 真值持久化與 TapPay `cardholder.email` 三分支留 B-4。

這是 B-3/B-4 邊界 Q1=A 的實作，不代表通知功能已上線。

## 2. 審查基準

- PRD：`docs/specs/2026-07-18-b0-order-notification-email-prd.md` §3.1、§3.3、§3.4、§4、§5、§6。
- B-1 CHECK：`supabase/migrations/20260718120000_m4a_b1_orders_notification_email.sql:127-134`。
- B-2 RPC：`supabase/migrations/20260719120000_m4a_b2_create_order_notification_email.sql`。
- 本片 plan：`docs/specs/2026-07-20-m4a-b3-checkout-notification-email-plan.md`。
- Sean 拍板：Q1=A；B-3 flag-on 走 9-param 但只送 `null`，真值留 B-4。

## 3. 主要資料流

```text
/checkout page
  → strict env flag + session Email 安全預填
  → CheckoutView / CheckoutStep1
  → useChargePayment（flag-on 才帶 notificationEmail）
  → chargePaymentAction（重新讀 flag + server schema）
  → PlaceOrderInput marker
  → mapper（marker absent=8 keys / present=9 keys）
  → SupabaseOrderAdapter.rpc('create_order', args)
```

## 4. 六條件對照

| DB CHECK／PRD | app 實作 | 測試 |
|---|---|---|
| 頭尾 ASCII space canonical | 只用 `/^ +| +$/g` 移除 U+0020 | padded、純空白、全形空白 |
| printable ASCII | `^[!-~]+$` | CR/LF、Unicode、全形字元 |
| UTF-8 octet ≤254 | `TextEncoder().encode(value).byteLength` | 254 pass／255 reject |
| 一個 `@` + domain 有點 | 基本 shape regex | 無 @、雙 @、無點 |
| 擋 synthetic 本體，大小寫／尾點防繞 | domain lower + trailing dots remove 後比對 | exact、uppercase、FQDN trailing dot |
| 擋 synthetic 子網域、相似域放行 | suffix 比對 | subdomain reject、相似不同域 pass |

Client 與 server 共用 `NotificationEmailInput`。錯誤只回固定欄位文案，不含輸入原值。

## 5. 檔案範圍

新增：

- `packages/schemas/src/notification-email.ts`
- `apps/storefront/src/lib/email/notification-email-gate.ts` + test
- `apps/storefront/src/components/CheckoutStep1.tsx` + test
- `apps/storefront/src/app/checkout/page.test.tsx`
- `apps/storefront/src/styles/checkout.test.ts`
- B-3 plan 與本 Review Packet

修改：

- schema index/test
- checkout page、View/test、form error type、charge action/test、checkout CSS
- charge hook/test
- domain PlaceOrderInput
- mapper/test、SupabaseOrderAdapter/test
- design manifest、STATUS、CURRENT

明確未動：

- `.env*`／Vercel env／feature flag 實際值
- migration／production DB
- `packages/adapters/src/supabase/database.types.ts`（Sean Q2=A，留 B-4）
- TapPay cardholder／40-41 octet 分支
- `CheckoutStep3`、`#288-b`、作廢 E2a-2

## 6. 驗證證據

- TDD：先見 schema、gate、Step1、page、hook、action、mapper、adapter 對應紅燈，再補實作。
- targeted 最終複驗：10 個關聯測試檔、222 tests 全綠。
- mutation：以下五種故意破壞都讓對應測試轉紅，之後已 patch 還原：
  1. 移除 synthetic 子網域 suffix 阻擋。
  2. 關掉 flag-on UI。
  3. 移除 client payload Email。
  4. server 永遠選 flag-off schema。
  5. mapper 永遠不輸出第 9 鍵。
- `pnpm typecheck`：8/8 tasks 成功。
- `pnpm lint`：10/10 tasks 成功。
- `pnpm build`：admin + storefront 2/2 成功。
- `pnpm test`：235 files；2589 passed，1 todo。
- `node scripts/design-mirror.mjs --validate`：26 components／214 path tokens／24 reachable commits 全通過；既有 1 個 ProductPage 無-token 描述欄警告。
- 檔案上限：`CheckoutView.tsx` 383 行；`CheckoutStep1.tsx` 123 行；`useChargePayment.tsx` 194 行。
- `git diff --check`：通過。
- flag-on 實際瀏覽器：只對本機 dev process 暫時帶 `CHECKOUT_NOTIFICATION_EMAIL_ENABLED=true`，未改 `.env*`；以真 `CheckoutView`、假地址及公開商品跑 1280×1000 桌機與 390×844 手機流程，2/2 通過。覆蓋預填、揭露、地址切換、無效 Email 阻擋、canonical 後前進／返回保值、返回購物車、手機固定列、零水平溢出與 browser error/console error。R2 修正後另用 `agent-browser` 重量手機 computed style=`16px`、active element=Email、scrollWidth=innerWidth=390、錯誤訊息存在。臨時 preview／Playwright harness 驗完已刪除。
- 手機肉眼初驗曾發現錯誤訊息被固定 buybar 遮住；以 RED test 補上失敗時 focus + `scrollIntoView({ block: 'center' })`，重跑後錯誤紅字完整可見。

環境註記：sandbox 內的首次 build／full test 因 Turbopack/tsx 嘗試 bind 本機 port/IPC pipe 而 EPERM；未改碼，改在 sandbox 外重跑同命令後皆全綠。這不是產品測試失敗。

## 7. 請獨立審查者優先攻擊

1. `canonicalizeNotificationEmail` 是否精確只移除 U+0020，且 DB 最終收到的值不會含 padding。
2. synthetic suffix 判斷是否和 SQL `NOT LIKE '%.line.pcmmotorsports.local'` 同義，沒有誤擋相似域。
3. flag off 是否真的四層相容：尤其 client 偷塞 Email 會被 server strip，mapper 恰 8 鍵。
4. flag on 是否真的四層同步：尤其 server 必填與 mapper 恰 9 鍵／第 9 值為 `null`。
5. B-3 官方 app 結帳路徑是否可能把 canonical 真值寫入 DB；預期答案必須是「不會」。B-2 的 authenticated direct RPC 本來即可自行送合法第 9 參，不得把該既存能力誤寫成 B-3 app 路徑。
6. `database.types.ts` 未更新在目前 TypeScript 結構下是否安全，且沒有手改 generated file 的必要。
7. Email 是否可能進 log、error response、STATUS、CURRENT 或 Review Packet。
8. 抽出 CheckoutStep1 是否改壞既有地址、配送、desktop/mobile 下一步行為。

## 8. 已知未執行

- 未改正式 flag／`.env*`，也未在正式 authenticated `/checkout` 做 flag-on 驗收；本輪瀏覽器證據來自本機 process-only flag + 真 `CheckoutView` 的臨時安全 harness。
- 未打真 `create_order`、未連 production DB、未做 migration apply。
- 本片由本 commit 收錄；未 push、未 deploy。
- 未做 B-4 真值持久化或 TapPay 行為。

部署相容註記：頁面與 server action 各自在執行時讀同一 env；若使用者停留在舊頁期間剛好跨部署切 flag，可能需重新整理才取得一致 UI。正式開 flag 前須把這項納入操作／觀察窗，不把「同一 env」誇寫成跨部署零窗口。

型別註記：`database.types.ts` 依 Sean Q2=A 延至 B-4 重生，因此 B-3 暫時沒有 generated RPC 第 9 鍵的 drift guard；本片改以 null-only domain／wire 型別、8/9 鍵測試與 adapter mock 守門，B-4 更新 generated type 是硬 gate。

## 9. 審查紀錄與結論欄

R1 verdict：`FAIL`。4 項 must-fix 均已處理：

1. domain／wire marker 改成 null-only，並加 compile-time 負向型別測試；B-3 app 路徑與 B-2 direct RPC 能力分開陳述。
2. manifest 正式 component 清單補 `CheckoutStep1`，移除非 schema 欄位，更新日期與 path token。
3. 補 flag-on 桌機／手機實際瀏覽器操作與肉眼驗證；另修掉肉眼發現的手機錯誤訊息遮蔽。
4. 清除 active code/test 內過時的三欄 schema／8-param pending db push 字面；歷史文件事實保留。

R2 verdict：`FAIL`。R1 四項已由 reviewer 確認銷案；新增 1 項 must-fix 與 1 nit 均已處理：

1. 手機 Email input 原本繼承 `.auth-field` 的 14px，iOS Safari 聚焦可能自動放大；已在 checkout mobile breakpoint 釘 16px，新增 CSS RED→GREEN 守門，並用 `agent-browser` 重驗 computed style、焦點、錯誤紅字與零水平溢出。
2. `charge-actions.ts` 檔頭前端契約補齊 `cartSessionId`、`agreed` 與 flag-on `notificationEmail`。

R3 結論：

- Verdict：`PASS`
- Must-fix：`0`
- Nits：`1`（`STATUS.md` 既有「Sean 待決策」兩項同編號 `⓪`；與本片無關、不阻擋）
- 是否可 commit：`是`；仍不得 push、deploy、開 flag或修改 env／DB
