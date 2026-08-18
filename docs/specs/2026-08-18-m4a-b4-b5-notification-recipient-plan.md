# Plan — M-4a B-4 + B-5 合併片:通知信收件人接通(2026-08-18 W5)

> ⚠️ **未批准。** 命中 **鐵則 8**(動 3+ 檔 + 跨 storefront/adapters/use-cases 三包)+ **鐵則 12 ①錢**
> (改 `charge-actions.ts` 成交 path)⇒ **提 plan 等 Sean 批 → codex 關卡1 審 plan → 才實作**,審查不降級。
> **真權威**:PRD `docs/specs/2026-07-18-b0-order-notification-email-prd.md`(🔴 **先讀它的檔頭衝突段**)
> + B-4 plan `docs/specs/2026-07-24-m4a-b4-notification-persist-cardholder-plan.md`(🔴 **先讀它的檔頭下修段**)。
> **背景信**:`~/pcm-mailbox/W5-001-*` / `W5-002-*`。

---

## 0. 🔴 開工前必須先答的一題(`Q-W5-3`,已送 Sean)

`Q4=甲`「通知信寄到**會員註冊的信箱**」⇒ 而 **LINE 客人沒有註冊信箱**
(`handle_new_auth_user` 把 `auth.users.email` 原封抄進 `customers.email`,
`20260523034911_init_customers_and_subtables.sql:284`;LINE 的是合成假信箱 `line.ts:38,48`)。

- **甲(推薦)**:LINE 客人回落到**收件地址的 Email**(該欄已必填);其餘客人用註冊信箱。
- **乙**:純註冊信箱,LINE 客人不寄。

**§3 的收件人解析寫了兩案,他答哪個就刪另一節。其餘各節與答案無關,可先審。**

---

## 1. 目標

讓「付款成功通知」**寄得到一個真的信箱**。今天斷在兩處:
```
B-4  packages/adapters/src/supabase/mappers/order.ts:144-146   p_notification_email: null   ← 寫死
     apps/storefront/src/app/checkout/charge-actions.ts:266-267 notificationEmail: null      ← 寫死
B-5  .enqueue( 在 production code 零呼叫點
     量法 grep -rn '\.enqueue(' --include='*.ts' apps packages | grep -v '\.test\.'  ⇒ 0 行
```
⚠️ **本片不解「出貨通知信」**:`order_shipped` 卡在 `E4` 模板未落地
(`packages/use-cases/src/sweep-email-outbox.ts:113` fail-closed throw),**不在收件人**。

## 2. 分級與片型

L 級 N/A(非內容)。**高風險片**(鐵則 12 ①)。零 migration / 零 db push / 零 env / **flag 維持 off**。
🔴 **B-5 原文照抄:「可部署但不得宣稱功能上線」**(PRD §4)。commit / STATUS **不得**寫「通知功能上線」。

## 3. 收件人解析(唯一一段依賴 `Q-W5-3`)

單一 server-only 函式,**一個呼叫點、一份規則**;驗證一律走既有 `NotificationEmailInput`
(`packages/schemas/src/notification-email.ts`)—— **不在本片長出第二套 email 規則**。

**若 `Q-W5-3=甲`**:候選依序 `customers.email` → `address.email`,取第一個 parse 過的。
**若 `Q-W5-3=乙`**:只看 `customers.email`。

兩案共同:全部候選皆不合格 ⇒ **不 enqueue**,寫一行結構化 log(**只帶 `orderId`,禁帶 email 原值**,PRD §7)。
⚠️ **合成域由 `NotificationEmailInput` 自己擋**(`isSyntheticEmailDomain`)⇒ LINE 的假信箱在甲/乙都不會被選中,
**差別只在它之後有沒有下一個候選。**

## 4. 範圍

| 檔 | 改動 |
|---|---|
| `apps/storefront/src/app/checkout/charge-actions.ts:266-267` | `notificationEmail: null` → `parsedCheckout.data.notificationEmail`(flag-on 時才有值;B-3 zod 已產 canonical) |
| `packages/adapters/src/supabase/mappers/order.ts:144-146` | `p_notification_email: null` → `input.notificationEmail ?? null` |
| 新 `packages/use-cases/src/resolve-notification-recipient.ts` | §3 的解析(≈15 行) |
| `packages/use-cases/src/confirm-payment.ts` `:141` 後 / `settle-charge.ts` `:534` 後 | enqueue,**掛在 `confirmer.confirm` 成功之後**(PRD §3.2:嚴禁掛 `charge-actions`) |
| 測試 | 見 §6 |

🔴 **明確不動**:`cardholder.ts`(08-09 的 fail-closed **保留**;B-4 plan §4 叫人移除 `email_missing` 分支 ⇒ **不照做**)、
`create_order` RPC、migration、B-3 的 UI/schema、`database.types.ts`(**已是 9 參**,`:3595`)、金額 / tier / RLS。

## 5. 失敗語意(照 PRD §3.2,不自己發明)

**付款結果優先**:enqueue 整段 `catch` **不上拋** —— 付款已成功,不得因為信沒排進去而回錯誤(會誘發客人重刷)。
⚠️ **用詞不得寫 `fail-closed`**(PRD 明文:那是相反語意)。缺列由 `C-1` 對帳補寄兜底。
**形狀直接抄同檔既有的 `bestEffortRecordInvoice`**(`settle-charge.ts:534`)—— 同一個成交點、同一種 best-effort 語意,
**不新發明一種**。

## 6. 驗證(不降級)

三綠 `TURBO_FORCE=1` + **vitest**(不在三綠內,自己跑)。

🔴 **`#633` 的驗收條款是硬規定,照抄不改**:
```
❌ 不可寫「寄出成功」或「email_outbox 有列 = 成功」
   —— recipient_email 是 null 時那一列照樣進得去 ⇒ 在兩個世界印同一個東西
✅ 要斷言 recipient_email 【不是 null 且等於某個具體值】
```
- `resolve-notification-recipient`:甲/乙 各候選命中 + **合成域候選被跳過** + 全不合格回 `null`。
- `charge-actions` / `mapper`:flag-on **送真值(非 null)**;flag-off 回歸不變。
- enqueue 掛點:**PRD §3.2 全部上游入口各一格** —— 同步刷卡 / `checkout/callback` / `tappay-notify` webhook /
  payment-status 輪詢 / `settle-sweep` cron / `preflightReleaseSibling` / `adjudicateSettlement` /
  `reconfirmExpiredOrphans`,**外加 idempotent replay 不重複 enqueue**。
- **enqueue throw ⇒ 付款仍回 `paid`**(§5 那條要有自己的一格,不能只靠讀 code 相信)。

🔴 **突變自驗(每一條都要真的跑、看到紅)**:
1. 把 `notificationEmail: null` 改回去 ⇒「送真值」那格**必須紅**。
2. 拿掉合成域那道 ⇒ LINE 樣本那格**必須紅**。
3. 把 enqueue 的 `catch` 拿掉並讓它 throw ⇒「付款仍回 paid」那格**必須紅**。
⚠️ **加一道斷言就當場配一發突變** —— 不配的話「我加了守門」與「守門是恆綠的」長得一樣
(memory `feedback_trigger-metadata-survives-a-gutted-function`)。

## 7. 跨片順序(PRD codex R3 #7,唯一合法)

```
B-1/B-2 ✅ → B-3 ✅ → 本片(B-4+B-5)部署但 flag 保持 off
→ 開 flag 並記錄【flag 實際開啟時戳】 → 觀察窗 → B-6 收緊
```
🔴 **cutoff = flag 實際開啟時戳,不是部署時戳**(PRD §5 R3 已釘死,兩者容易弄反)。
🔴 **本片完工後不得代開 flag。**

## 8. rollback

零 migration ⇒ `git revert` 本片 + 重部署即可。`orders.notification_email` 欄**保留**
(PRD §5:`DROP COLUMN` 不是日常 rollback)。

## 9. 誠實揭示(不藏在下面)

- 🔴 **本片做完,「通知孤兒已消滅」仍不得宣稱** —— 投遞真相要 `C-2`(Resend bounce webhook),PRD §1 明文。
- 🔴 **本片做完,出貨通知信仍然一封都不會寄**(卡 `E4` 模板)。
- 🔴 **`Q4=甲` 與 PRD `D1=A` 的衝突本片不裁** —— 我照 `Q4` 寫 §3,而 B-3 那個結帳欄位
  **flag 維持 off、欄位留著不拆**(對客人零可見,拆它是純風險零收益)。
- ⚠️ **未量**:正式庫 LINE 登入客人的筆數 / 分母(repo 側量不到)⇒ `Q-W5-3` 的**嚴重度**未知、**機制**確定。
- ⚠️ **未量**:`CHECKOUT_NOTIFICATION_EMAIL_ENABLED` 在正式站的現值(env,我沒有讀的管道)。

## 10. 估時

實作 + 測試 ≈ 50–70 分鐘(掛點 8 個入口的測試是主要耗時);加 codex 關卡1/2 + code-reviewer。
