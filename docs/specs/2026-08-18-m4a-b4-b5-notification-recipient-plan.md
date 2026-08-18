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
(`packages/schemas/src/notification-email.ts`)—— **本片不長出第二套 email 規則**。

### 3.1 🔴 而第二套【已經在了】,而且它就守在 `Q4=甲` 的那個來源上

本節第一版寫「不長出第二套」時,我沒有量過樹上有幾套。量完是**兩套**:
```
量法:grep -rn "z\.email\|\[^@\]+@" --include='*.ts' --include='*.tsx' apps packages | grep -v '\.test\.'
  packages/schemas/src/index.ts:33   LoginInput.email    = z.email()
  packages/schemas/src/index.ts:43   RegisterInput.email = z.email()      ← 🔴 註冊信箱是這一套把關的
  packages/schemas/src/notification-email.ts:16  NotificationEmailInput   ← 寄信是這一套把關的
```
🔴 **`Q4=甲` 的收件人 = `customers.email` = 註冊時由 `z.email()` 驗過的值**,
而寄信時要過的是 `NotificationEmailInput` —— **兩套的嚴格度不同,且差在四個地方**:
```
NotificationEmailInput 有、z.email() 沒有:
  ① 只允許可列印 ASCII ^[!-~]$      ② <=254 octets
  ③ 拒 LINE 合成域(含子網域、去尾點)  ④ canonicalize(domain 轉小寫)
```
⇒ **一個【註冊時被接受】的信箱,可能在【寄信時被拒】。**
⇒ 而依 §5「enqueue 全 catch 不上拋」,那個拒絕**不會有任何人看到**:
   付款正常、畫面正常、沒有東西紅、客人沒收到信。**第五張臉。**

🔴 **⇒ 本片的驗收必須包含一格:餵一個「`z.email()` 過、`NotificationEmailInput` 不過」的值,
   斷言系統留下【可觀測的痕跡】。** 光寫「落一行 log」不算 —— **沒有人在看的 log 與沒有 log 是同一件事**
   (STATUS 已記:CI 紅了目前不會通知任何人)⇒ 觀測點要指得出「誰會看到、在哪裡看到」。

⚠️ **本片不去統一那兩套**(動 `RegisterInput` = 動註冊路徑,範圍外)。**只登記這個縫,並要求它有觀測點。**

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
| 🔴 **新增**:`packages/ports/` + `packages/adapters/` 一支窄查詢 | **`confirm` 的回傳拿不到 enqueue 要的東西**(見 §4.1)⇒ 成交後補讀一次 `orders` 的 `display_id` / `paid_at` / `notification_email` |
| 測試 | 見 §6 |

### 4.1 🔴 掛點當下【拿不到】enqueue 需要的資料 —— 這是本 plan 第一版漏的一格

當場量到的三件(可重跑:`grep -n "return {" packages/use-cases/src/confirm-payment.ts`):
```
enqueue 需要   : orderId + displayId + paidAt + recipientEmail
                 (buildOrderCreatedPayload 對 displayId / paidAt 都跑 requireNonEmptyString)

confirmer.confirm 回傳 = { confirmed, idempotent }        ← 兩個都沒有
confirm-payment.ts:164 return { kind:'paid', idempotent } ← displayId 沒有、paidAt 沒有
settle-charge.ts:535   return { kind:'paid', idempotent, displayId: attempt.orderDisplayId }
                                                          ← displayId 有、**paidAt 仍然沒有**
```
⇒ **兩個掛點都必須在 `confirm` 成功之後補讀一次 orders 列**(`display_id` / `paid_at` / `notification_email`)。

🔴🔴 **而這一格漏掉的後果,正好是 `#633` 在防的那個形狀**:
`buildOrderCreatedPayload` 對空的 `paidAt` **會 throw**,而 §5 規定 enqueue **全 catch 不上拋**
⇒ **付款照常回 `paid`、畫面完全正常、沒有任何東西紅,而信一封都不會排進去。**
⇒ 🔴 §6 必須有**專門一格**:**`paidAt` 讀不到時,系統做了什麼、留下什麼可觀測的痕跡**。
   「它被 catch 掉了」不是答案 —— 那正是「看起來成功」的定義。

⚠️ **這一格是我自己量出來的,不是審查抓的**(codex 兩輪都沒吐出結論,見 §11)。

🔴 **明確不動**:`cardholder.ts`(08-09 的 fail-closed **保留**;B-4 plan §4 叫人移除 `email_missing` 分支 ⇒ **不照做**)、
`create_order` RPC、migration、B-3 的 UI/schema、`database.types.ts`(**已是 9 參**,`:3595`)、金額 / tier / RLS。

## 5. 失敗語意(照 PRD §3.2,不自己發明)

**付款結果優先**:enqueue 整段 `catch` **不上拋** —— 付款已成功,不得因為信沒排進去而回錯誤(會誘發客人重刷)。
⚠️ **用詞不得寫 `fail-closed`**(PRD 明文:那是相反語意)。缺列由 `C-1` 對帳補寄兜底。
**形狀直接抄同檔既有的 `bestEffortRecordInvoice`**(`settle-charge.ts:534`)—— 同一個成交點、同一種 best-effort 語意,
**不新發明一種**。

## 6. 驗證(不降級)

三綠 `TURBO_FORCE=1` + **vitest**(不在三綠內,自己跑)。

🔴 **`build` 對本片的主戰場【幾乎沒有判別力】,不要拿它當驗收**(我當場量的,不是讀來的):
```
量法:逐個 package.json 看有沒有 build / typecheck script
  build     ⇒ 2 支   apps/storefront、apps/admin
  typecheck ⇒ 8 支   上面兩支 + packages/{ui,schemas,adapters,use-cases,ports,domain}
```
⇒ **本片的 enqueue 掛點在 `packages/use-cases`,那裡【沒有 build】。**
真正在守它的是 **typecheck + vitest**,不是 build。
⚠️ 誠實邊界:app build 會連編到被 import 的 workspace code,所以**不是零覆蓋**,
但那條路徑的判別力**我沒有量過** ⇒ 一律當「未確認」,不寫進驗收。

🔴 **`#633` 的驗收條款是硬規定,照抄不改**:
```
❌ 不可寫「寄出成功」或「email_outbox 有列 = 成功」
   —— recipient_email 是 null 時那一列照樣進得去 ⇒ 在兩個世界印同一個東西
✅ 要斷言 recipient_email 【不是 null 且等於某個具體值】
```
- `resolve-notification-recipient`:甲/乙 各候選命中 + **合成域候選被跳過** + 全不合格回 `null`。
- `charge-actions` / `mapper`:flag-on **送真值(非 null)**;flag-off 回歸不變。
- enqueue 掛點 —— 🔴 **下面這份入口清單是【我當場量的】,不是抄 PRD §3.2 的**。
  **PRD 那份漏了一個、也少數了一個**(它寫於 2026-07-18,之後長出新 caller):
  ```
  量法(可重跑):
    grep -rn "settleCharge(" --include='*.ts' --include='*.tsx' apps packages | grep -v '\.test\.'
    grep -rn "confirmPayment(" --include='*.ts' --include='*.tsx' apps packages | grep -v '\.test\.'

  confirmPayment ← 1 個 caller(與 PRD 一致 ✅)
    charge-actions.ts:310                      同步刷卡

  settleCharge ← 9 個【實際呼叫點】(PRD 列 7 路)
    charge-actions.ts:391                      preflightReleaseSibling 後
    charge-actions.ts:538                      adjudicateSettlement / needs_settle
    callback/page.tsx:125                      3DS 前台導回
    payment-status/route.ts:143                輪詢
    tappay-notify/[secret]/route.ts:210        webhook
    reconfirm-expired-orphans.ts:96            孤兒再確認
    sweep-settlements.ts:173                   cron ② due inbox      🔴 PRD 把 sweeper 當一路,實際兩個呼叫點
    sweep-settlements.ts:211                   cron ③ stuck unsettled
    🔴 reconcile-actions.ts:101                【PRD 清單裡沒有這一路】
       檔內自稱「第 N 路 caller」⇒ 它是 PRD 定稿之後才長出來的
    (composition.ts:165 是注入包裝、不是第 10 路 —— 它包的就是 preflight 那一路)
  ```
  🔴 **這件事本身要寫進 commit body**:我第一版 §6 直接抄了 PRD 的七路,
  **抄的時候它讀起來完全正確** —— 一份三週前的清單,漏掉的那一路不會有任何東西提醒你。
  ✅ **對正確性的影響 = 零**:enqueue 掛在 `settleCharge` / `confirmPayment` **內部**
  (`confirmer.confirm` 成功之後)⇒ 幾路 caller 都會經過它。
  ❌ **對【測試矩陣】的影響 = 有**:PRD 逐字「測試須覆蓋全部上述入口」,
  照抄那份就會**少一格 `reconcile-actions`、少一格 sweeper 的第二個呼叫點**,
  而那兩格缺席時測試**照樣全綠**。
- **外加 idempotent replay 不重複 enqueue**(dedup_key = orderId,`order_created` 一單一封)。
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

## 11. 🔴 審查缺口(誠實認列,不假裝跑過)

**codex 關卡1 跑了兩輪,兩輪都沒有產出 findings** ⇒ 依 `codex-adversary` 紀律「同一件事 2 輪封頂,
第 2 輪仍零 findings = 認列缺口回報主視窗,不跑第 3 輪」,**本 plan 目前【沒有】通過任何外部對抗審查。**

```
R1  2026-08-18 02:16  白名單 5 檔  ⇒ 12 分 watchdog 逾時被殺;輸出 3798 行【全是它自己讀檔的內容】,零 findings 段
R2  2026-08-18 02:18  零開檔、code 全貼進 prompt ⇒ 輸出 246 行【只有 prompt 回音 + skill 警告】,零 assistant 回合
兩輪皆 `-s read-only`;跑前後 `git status --porcelain` 逐次比對 ⇒ 零留痕(diff 空)
```
🔴 **「零 findings」在這裡不是「沒問題」,是「沒跑出來」** —— 兩者在輸出檔上長得很像
(都沒有 must-fix 那幾個字),而意義相反。

⇒ **本 plan 送 Sean 批准時必須連這一節一起送。** 補救路徑二選一,由主視窗裁:
① 換模型(Fable / adversarial-reviewer subagent)審同一份 plan;
② 等實作後在關卡2 審 diff 時補回來 —— **但那時候 code 已經寫了**,關卡1 要擋的東西擋不到。

📌 **本片命中鐵則 12 ①錢 ⇒ 對抗審查不降級**(CLAUDE.md 明文)⇒ **①、②至少要跑掉一個,不能兩個都不跑。**

## 12. 🔴 上線前置:**沒有人送過第 9 個參數上正式站**

§2 寫「零 migration / 零 db push」,那句成立的前提是 **9-param `create_order` 已經在 prod**。
當場查那個前提,證據等級**比想像的弱**:
```
supabase/APPLIED.tsv:92
  20260719120000  a778c484…  backfill  backfill-P七代
                             ^^^^^^^^  🔴 日期欄是 "backfill" 不是真日期
⇒ 這一列是【事後補登】的,不是 apply 當下觀察到的。
   對照:同檔近期列長這樣 → 20260816050000 … 2026-08-16 主視窗-c9d6080c(有真日期 + 落檔者)
```
🔴 **而「B-3 已經上線且正常」不能替它背書** —— B-3 的 flag 是 **off**,flag off ⇒ 不送
`notificationEmail` 這個鍵 ⇒ **送出去的一直是 8 參呼叫。**
⇒ **本片會是史上第一次真的送第 9 個參數上正式站。**

**若那支函式在 prod 其實還是 8 參**:`PGRST202` / `42883` ⇒ **結帳整條斷**,
而且斷的時機是**部署之後**、repo 內三綠與 vitest **全部看不到**
(memory `feedback_app-layer-must-not-ship-before-migration-apply`:同一形狀 2026-08-07 讓正式站壞了約 8 小時,
且它是那一夜**唯一逃逸出審查鏈**的一條)。

⇒ 🔴 **加一道 preflight,列為本片交付物、不是建議**:
```
部署前(或部署後、開 flag 前)對 prod 跑一次具名參數 smoke:
  確認 create_order 的簽章確實含 p_notification_email
兩個世界要印不同的東西:8 參 ⇒ 報錯;9 參 ⇒ 成功。
❌ 不可以用「B-3 結帳跑得動」當通過 —— 那條路走的是 8 參,在兩個世界印同一個東西。
```
⚠️ **這道 preflight 我這個窗做不到**(無 prod access)⇒ **需要 Sean 或有 access 的窗執行**,
在他跑之前,§2 的「零 migration」只能寫成「**帳本說已 apply,但那是補登的、未經觀察**」。
