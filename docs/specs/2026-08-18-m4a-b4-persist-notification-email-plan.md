# Plan — M-4a **B-4:通知 email 真值持久化**(2026-08-18 G4 重寫版)

> ⚠️ **未批准。** 命中 **鐵則 8**(動 3+ 檔、跨 storefront/adapters/domain 三包)+ **鐵則 12 ①錢**
> (改 `charge-actions.ts` 成交 path)⇒ 提 plan 等 Sean 批 → 對抗審查(關卡1)→ 才實作。
>
> 🔴 **本檔取代 `docs/specs/2026-08-18-m4a-b4-b5-notification-recipient-plan.md`(該檔 R1 FAIL、只在 `notify-email` 分支)。**
> 那份是 B-4+B-5 合併片;**拆片理由 = `F4`**(B-5 要把 `service_role` 帶進結帳路徑 = 獨立的鐵則 12 判定,
> 綁在一起 = 用一個較小的批准換一個較大的權限)。B-5 見 `docs/specs/2026-08-18-m4a-b5-enqueue-scan-plan.md`。
> 舊檔的處置:**留痕不刪**,收割 `notify-email` 的人請在它檔頭加一行指向本檔(我沒有寫它的權限,它不在我的樹上)。
>
> **真權威**:PRD `docs/specs/2026-07-18-b0-order-notification-email-prd.md`(🔴 **先讀檔頭 2026-08-18 推翻 `D1=A` 那段**,在 `:15-37`)
> + B-4 plan `docs/specs/2026-07-24-m4a-b4-notification-persist-cardholder-plan.md`(檔頭下修段)。
> 🔴 **~~「那兩段只在 `notify-email` 分支、要 `git show notify-email:` 才讀得到」~~ 已作廢**(R1 `F14`):
> `55f391b5` 已把那 23 顆收進 `dev`。**照舊字面去 `git show` 拿到的是同一份的舊副本。**
> **量測環境**:主樹 `/Users/sean_1/pcm-website-v2`,branch `dev` @ `34d1754e`,2026-08-18 13:2x CST。
> 🔴 **本檔所有行號都是我在上述環境當場 `grep -n` 量的,不是抄前一版 plan 的** —— 前一版的行號量在 `notify-email` 樹上,已漂。

---

## 0. Sean 已拍(不再是岔路)

```
Q-W5-3 = 甲:LINE 客人用【他在收件地址填的 Email】;其他客人用註冊信箱。
Q-02   = 甲:🔴 推翻 PRD 的 D1=A。結帳頁那個 email 欄不用了,【留著、關著、不刪】
            (CheckoutStep1.tsx:159-183,flag 維持 off)。
```
(2026-08-18 中午,memory `project_0818-sean-eleven-rulings-noon`。)

## 1. 目標

**讓每張新單在建立當下就帶一個真的收件信箱進 `orders.notification_email`。**
本片**不寄任何信**、**不碰 outbox**、**不碰 `service_role`**。寄信是 B-5。

今天斷在一處(當場量):
```
apps/storefront/src/app/checkout/charge-actions.ts:267
  ...(notificationEmailEnabled ? { notificationEmail: null } : {}),   ← flag-on 也只送 null
packages/adapters/src/supabase/mappers/order.ts:145-147
  ...(Object.prototype.hasOwnProperty.call(input, 'notificationEmail')
      ? { p_notification_email: null } : {})                          ← 同上
```

## 2. 🔴 前一版最致命的那條(`F1`)怎麼被修掉的

前一版 §4 要把 `:267` 接成 `parsedCheckout.data.notificationEmail` —— **那是 `Q-02` 已裁定不用的結帳表單欄**;
flag off ⇒ 鍵不存在 ⇒ mapper 的 `hasOwnProperty` 為 false ⇒ 第 9 參不送 ⇒ **`notification_email` 仍然每筆都是 NULL**。
且前一版全檔**沒有任何一列寫「resolver 在哪裡被呼叫」**。

**本版的答案:收件人不從表單來,從【建單當下已經在手上的兩個值】來。**
```
charge-actions.ts:190-192  buildCardholder(deps, { user: { id, email }, addressId })
apps/storefront/src/lib/payment/cardholder.ts:82(findById) 與 :87(listByCustomer)
   → 它【已經】讀了 customer 與 address 兩張表(R1 `F20` 修行號,原寫 :83,90-92)
   → cardholder.ts:113  pickUsableEmail([address.email, input.user.email])
```
⇒ **零額外查詢、零新 port、零新 env。** 呼叫點就是 `charge-actions.ts:267`,**一個**。

## 3. 收件人解析(對應 `Q-W5-3`=甲)

新 `apps/storefront/src/lib/email/resolve-notification-recipient.ts`(≈12 行)。
🔴 **簽章收 `readonly (string | null | undefined)[]`**(R1 `F18`):`charge-actions.ts:192` 傳的 `user.email` 是
`string | null | undefined`(`cardholder.ts:80`);在呼叫端補 `?? ''` 等於長出第二套正規化 —— `cardholder.ts:46-48` 明文禁止那件事。
```
候選依序:[ session user.email , address.email ] → 各跑 NotificationEmailInput
        → 回第一個 parse 過的 canonical 值;全不過回 null
```
驗證**只用既有** `NotificationEmailInput`(`packages/schemas/src/notification-email.ts:42`)——
本片**不長出第二套 email 規則**,也**不寫任何 `if (是 LINE 客人)`**:
```
一般客人  session email = 真信箱          ⇒ 第一個候選就過 ⇒ 用註冊信箱 ✅
LINE 客人 session email = 合成假信箱       ⇒ 被 isSyntheticEmailDomain 擋 ⇒ 落到 address.email ✅
```

### 3.1 🔴 為什麼用 session email、**不用** `customers.email`(這是 `F10` 的解)

`F10` 指出 `customers.email` 是**註冊當下的凍結快照**:`handle_new_auth_user` 只掛 `AFTER INSERT ON auth.users`,
全樹零 UPDATE 同步 ⇒ **auth email 事後改過的客人,`customers.email` 是舊的**。
`session user.email` 是 auth 的**現值**,且**建單當下就在手上**(`charge-actions.ts:192` 已經傳它給 `buildCardholder`)。
⇒ 用現值:**又便宜又正確**,而 `F10` 的那個縫直接消失。
⚠️ **證據等級(R1 `F13` 收窄)**:這條是**推出來的**,不是量到的 —— 全樹改 email 的路徑只有
`packages/adapters/src/supabase/SupabaseAuthAdapter.ts:99` 的 `{ password }`,**repo 內今天產不出那個分岔**。
⚠️ **而且沒有查**:`getUser()` 到底是每次打 auth server 還是本機驗 JWT ⇒ **「session email = auth 現值」本身未證實**,
只證了「repo 內沒有讓它們分岔的路」。⇒ 本條的價值是「不會壞」,不是「今天在救誰」。
⚠️ **但 B-5 的 NULL fallback 仍然照 PRD §3.2 用 `customers.email`**(那是真權威明文規定的形狀)
⇒ **凍結快照的風險在 B-5 那一片仍然在**,已寫進 B-5 plan **§7** 的誠實揭示(R1 `F21` 修:§6 是驗證),**不要以為本片把它解掉了**。

### 3.2 🔴 順位與 `cardholder` **刻意相反** —— 申報(這是 `F8` 的解)

```
cardholder(送 TapPay)   cardholder.ts:113  pickUsableEmail([address.email, user.email])  ← 地址優先
notification(寄通知信)  本片                [user.email, address.email]                  ← 註冊信箱優先
```
**不同是刻意的,理由不同**:
· cardholder 的地址優先是 **2026-08-09 LINE 3DS 修復**的產物(地址 email 是為這次收件親手填的、語意最準)。
· notification 的註冊信箱優先是 **Sean 2026-08-18 拍板逐字「通知信寄會員註冊信箱」**(memory `project_0818-sean-six-rulings`)。
⇒ **同一張單的 `cardholder.email` 與 `notification_email` 可能是不同信箱,這是預期行為。**
⇒ 要寫進兩支檔的註解 + **一格測試專門斷言兩者可以不同**(不然下一個人會「順手統一」它們)。

### 3.3 🔴 這條分流掛在誰身上(這是 `F9` 的解)

真正保證 LINE 客人有 `address.email` 可落的,**不是**「從 schema 推」,是這兩行:
```
apps/storefront/src/app/checkout/charge-actions.ts:190   建單前無條件跑 buildCardholder
apps/storefront/src/lib/payment/cardholder.ts:113-115    pickUsableEmail 全不過 ⇒ ok:false 'email_unusable' ⇒ 零單
```
⇒ **建得成單 = 至少一個候選通過過 `AddressEmailInput`**(= `NotificationEmailInput` + ≤40,`packages/schemas/src/index.ts:110`)。
🔴 **而這個保證是掛在 `buildCardholder` 上的,不是掛在型別上** ——
哪天有人把地址 email 改成非必填、或把 `email_unusable` 從拒單改成放行,**本片會靜默失效而沒有任何測試會紅**。
⇒ 所以 §6 有一格**專門釘住這個前提**的測試(拆掉 `email_unusable` 拒單 ⇒ 那格必須紅)。

### 3.4 樹上到底有幾套 email 規則(這是 `F11` 的更正,前一版數錯)

```
底層一套    NotificationEmailInput   packages/schemas/src/notification-email.ts:42
  ├ 疊加   AddressEmailInput        packages/schemas/src/index.ts:110   = 上面那支 + ≤40 octets
  ├ 鏡像   DB CHECK orders_notification_email_valid  20260718120000_*.sql(同六條件)
  └ 窄化   isSyntheticEmail         packages/adapters/src/email/SupabaseEmailOutboxAdapter.ts:163
                                    ← 🔴 只做【完全等值】比對,不認子網域(F12)
另有一套    z.email()  packages/schemas/src/index.ts(Login/Register)← 註冊時的把關,比上面鬆
```
⇒ **不是四套標準,是一套 + 兩個衍生 + 一個窄化 + 一個註冊用的鬆版。** 本片**一套都不改**。
🔴 **`F12` 的那道縫(adapter 只認等值、放行子網域)本片不修** —— 理由與唯一入口的論證寫在 B-5 plan **§4.2**(R1 `F22` 修:§5 是失敗語意),
**不是「不重要」,是它只在 B-5 那一片才有可達路徑。**

## 4. 範圍(**九處** —— R1 抓到我漏了三個會編不過 / 會紅的測試檔)

| 檔:行 | 改動 |
|---|---|
| 新 `apps/storefront/src/lib/email/resolve-notification-recipient.ts` | §3 的解析(≈12 行) |
| `apps/storefront/src/lib/payment/cardholder.ts:63-65` **與** `:118` | 🔴 **兩處**(R1 `F15`):`:63-65` 型別宣告、`:118` `return { ok: true, ... }`。ok 分支多一個 `addressEmail: string \| null`(**原值、未驗**)。**不動** `pickUsableEmail` / `email_unusable` fail-closed |
| `apps/storefront/src/app/checkout/charge-actions.ts:267` | `...(notificationEmailEnabled ? { notificationEmail: null } : {})` → **無條件** `notificationEmail: resolveNotificationRecipient([user.email, built.addressEmail])` |
| `packages/domain/src/order/types.ts:1429` | `notificationEmail?: null` → `notificationEmail?: string \| null` |
| `packages/adapters/src/supabase/mappers/order.ts:79,145-147` | `p_notification_email?: null` → `string \| null`;`? { p_notification_email: null }` → `? { p_notification_email: input.notificationEmail ?? null }` |
| 🔴 `packages/adapters/src/supabase/mappers/order.test.ts:77,83` | 兩個 `@ts-expect-error`(逐字「B-4 才會擴型」)在擴型之後**變成 unused ⇒ `TS2578` ⇒ typecheck 直接紅**(R1 `F2`;`packages/adapters/tsconfig.json:7` 的 `include` 含 `.test.ts`)⇒ 該格改成**斷言真值進得去**,不是刪掉了事 |
| 🔴 `apps/storefront/src/app/checkout/charge-actions.test.ts:178-183` | `not.toHaveProperty('notificationEmail')` §4.1 之後必紅(R1 `F3`)。⚠️ **它是唯一在 `PlaceOrderInput` 邊界斷言「client 偷塞的 email 到不了建單」的守門** ⇒ **不可順手刪**,改成「client 塞的值 ≠ 實際送出的值(送的是 server 解出來的)」 |
| 🔴 `apps/storefront/src/app/checkout/charge-actions.test.ts:200-206` | `expect(...notificationEmail).toBeNull()` 必紅(R1 `F4`);第二行 `not.toContain('Member@example.com')` 的字面**正好是新行為的正確值** ⇒ 反過來斷言 |
| ⚠️ `apps/storefront/src/app/checkout/charge-actions.test.ts:139` | mock 回 `{ ok: true, cardholder }` **沒有 `addressEmail`**,而 mock 是 `unknown[]` ⇒ **typecheck 不會紅**(R1 `F16`)⇒ 既有格會靜默跑在 `addressEmail === undefined` 上;LINE 那格**必須**自己改這個 mock |
| 📌 註解字面(不是 code) | 本片會讓五處註解變假(R1 `F24`/`F25`):`types.ts:1425-1428`、`mappers/order.ts:43,79`、`SupabaseOrderAdapter.ts:507`、`charge-actions.ts:7,266`、`scripts/verify-create-order-9param.sh:15-16`(逐字「送出去的一直是 8 參呼叫」)⇒ commit 前跑 `literal-sweep.sh` |

**明確不動**:`create_order` RPC 本體 / migration / `cardholder.ts` 的 fail-closed 與候選順位 /
`CheckoutStep1.tsx` 那個關著的欄位(`Q-02`:留著關著不刪)/ `database.types.ts`(**已是 9 參**,`:3595`)/
outbox / `service_role` / 金額 / tier / RLS。

### 4.1 🔴🔴 本片把「送第 9 個參數」從 flag 底下拿出來 —— **這是對 B-3 四層 gate 契約的申報偏離**

`Q-02` 說 flag 維持 off,而 flag off ⇒ 現行 code **不送第 9 參**。
⇒ 想讓 `notification_email` 有值,**只能讓持久化不再受那個 flag 管**。
```
改前:flag on  → 送 9 參(值恆為 null)      flag off → 送 8 參
改後:一律送 9 參(值 = resolver 結果或 null)  UI/client/server-schema 三層仍受 flag 管、仍 off
```
🔴 **後果一(必須被批准的那個)**:PRD §4 B-3 列的「單一 env flag 同時翻四層」變成**三層**。
🔴 **後果二(硬前置,見 §7)**:**正式站從此每一筆結帳都走 9 參呼叫。**
   若 prod 的 `create_order` 其實還是 8 參 ⇒ `PGRST202` / `42883` ⇒ **結帳整條斷**。
   ⇒ **`scripts/verify-create-order-9param.sh` 從「建議」升級為【部署前硬閘】**(理由見 §7)。

## 5. 失敗語意

resolver 全不合格 ⇒ 回 `null` ⇒ `p_notification_email` 送 `NULL` ⇒ **建單照常成功**。
🔴🔴 **而 R1 `F7` 指出:這個分支【上游產不出來】,要照實寫**:
```
建得成單 ⇒ 至少一個候選過了 AddressEmailInput（§3.3）
AddressEmailInput = NotificationEmailInput + ≤40 octets（packages/schemas/src/index.ts:110-113）
⇒ resolver 的接受集【嚴格包含】buildCardholder 的，候選集合又完全相同
⇒ 新單的 p_notification_email 不可能是 NULL
```
⇒ **這條 null 分支是防腐,不是活路徑**(舊單、未來有人改動 `cardholder.ts` 的順位或閘時才會走到)。
⇒ **§6 不得用一格「兩者皆不合格」的測試假裝驗過它** —— 那要 mock 掉 `buildCardholder` 才餵得出來,
   而那正是 memory `feedback_green-in-a-world-that-cannot-happen` 講的那種格。改法見 §6 #3。
⚠️ **本片不在這裡寫任何 log/告警** —— 通知信的可觀測性(落 `skipped_no_real_email` 一列)是 **B-5** 照 PRD §3.2 做的事。
🔴 **本片不得使用 `fail-closed` 這個詞**(PRD 明文:那是相反語意)。

## 6. 驗證(不降級)

三綠 `TURBO_FORCE=1 pnpm typecheck / lint / build` + **vitest**(不在三綠內,自己跑)。
🔴 **`build` 對本片主戰場的判別力有限**:`build` script 只有 2 支(`apps/storefront`、`apps/admin`),
`typecheck` 有 8 支 —— 但本片改的 `packages/domain` 與 `mappers` **會被 storefront build 連編到**,
所以**不是零覆蓋**;判別力我沒有量過 ⇒ 一律當「未確認」,驗收掛 typecheck + vitest。

**必要格(每格都配一發突變,看到紅才算數)**:
> 🔴 **R1 打掉了我原本的 #2/#3/#6/#7 四格**(`F7`/`F8`/`F9`)—— 下表是修正後的。
> 被打掉的理由各不相同,**寫在這裡而不是刪掉**:#2/#7 的突變**不是局部的**(要去改共用 schema 檔,會一次打紅一堆
> 無關格);#3 測的是**上游產不出來的狀態**;#6 在 `cardholder.test.ts` 已經有 **8 格**(`:103,177,218,235,265,298,309`)
> 加 `charge-actions.test.ts:246-252` 一格 ⇒ 我原本那格是**重複格**,而它讓 §3.3 的「釘子」讀起來已裝、其實沒裝。

| # | 斷言 | 突變(必須紅) |
|---|---|---|
| 1 | 一般客人:session email 真值 ⇒ `p_notification_email` = **那個具體值**(不是「非 null」) | 把 `:267` 改回 `null` |
| 2 | LINE 客人:session 是合成域 ⇒ 落到 `address.email` **那個具體值**。⚠️ 要**自己改** `charge-actions.test.ts:139` 的 mock 補 `addressEmail`(`F16`) | **把 resolver 的候選順位反過來**(局部、只打紅這一格族) |
| 3 | 🔴 **§3.3 的真釘子**(取代原 #6):`buildCardholder` 回 ok 的**任何**輸入下,resolver **必非 null** —— 用 `cardholder.test.ts` 那批既有的 ok 樣本逐個餵 | 把 resolver 的驗證換成比 `AddressEmailInput` 嚴的(例如再加一條長度限制)⇒ 這格必須紅 |
| 4 | **flag off 時第 9 參的值 = 那個具體 email**(🔴 `F17`:只斷言「鍵存在」擋不住日後有人寫成 `flag ? resolved : null`) | 把 `:267` 包回 flag 條件 |
| 5 | 🔴 同一張單的 `cardholder.email` 與 `notification_email` **可以不同**(§3.2) | 把 resolver 順位改成地址優先(與 #2 同一發,一發打兩格) |
| 6 | `mappers/order.test.ts:77,83` 那兩格**反過來**:真值**進得去** domain / wire(原本是 `@ts-expect-error` 擋它) | 把 mapper 改回 `p_notification_email: null` |
| 7 | `charge-actions.test.ts:178-183` **改寫後仍在守**:client 偷塞的 `notificationEmail` **不等於**實際送出的值 | 讓 `:267` 直接吃 `raw.notificationEmail` ⇒ 這格必須紅 |

🔴 **突變紀律(R1 `F9` 的教訓)**:**突變要打在本片改的那幾行上**。
要去改 `packages/schemas/src/notification-email.ts` 才紅的,**不是本片的突變** —— 它會一次打紅一堆無關格,
而「一發紅很多格」與「守門有效」長得一樣(`docs/patterns/guard-and-instrument-traps.md`)。

🔴 **`#633` 驗收條款照抄不改**:❌ 不可寫「有列 = 成功」;✅ 要斷言**不是 null 且等於某個具體值**。

## 7. 🔴 部署前硬閘:`create_order` 的第 9 參在 prod 到底在不在

**證據現況(不要升級措辭)**:
```
量到的:N3b migration `20260730120100_*.sql:181-190` 是 9 參的 CREATE OR REPLACE(檔頭逐字「本片不改簽章(仍是 9-param)」)
       正式站三個單號 5HGMC5 / RCPVVJ / 2SQH2P 全匹配 N3b 的 6 碼字集
       🔴 ~~「STATUS.md:684 + backlog:13045 兩筆各自落檔的 prod 查詢」~~ **更正(R1 `F1`,我當場複量)**:
          三個單號同時出現的只有 `docs/phase-1-backlog.md:13045` **一筆**;`STATUS.md` 全檔只有 `:35`
          出現 `2SQH2P`,而那句是 Sean「這筆是我測的」的轉述、**不是一次 prod display_id 查詢**
          ⇒ **證據是一筆不是兩筆,獨立性沒有我原本寫的那麼強。**
       補強(R1 `F26`,可重跑):6 碼只可能由 `pcm_generate_display_id()` 產,而它就在 N3b 版 `create_order` 體內
          (`20260730120100_*.sql:434`)⇒ 有 6 碼單 ⇒ 跑過的是 N3b 版 ⇒ 9 參
       ⇒ N3b 進得去 ⇒ 9 參必然存在
🔴 而:prod 簽章的【最後一次直接觀察】是 2026-07-19 preapply snapshot,量到的是 **8 參**。之後全是推論。
⇒ 依 §6-b:**「吻合但未證實」。** 這是強推論,不是量測。
```
**`F15` 說「不該當擋板」;本 plan 不採納,理由是本片自己把賭注放大了**:
§4.1 讓**每一筆**結帳都走 9 參 ⇒ 猜錯的代價從「一個沒接上的功能」變成「**結帳整條斷,而 repo 內三綠與 vitest 全部看不到**」
(同形狀 2026-08-07 讓正式站壞了約 8 小時,memory `feedback_app-layer-must-not-ship-before-migration-apply`)。
留閘 ≈ 零成本(跑一次腳本),拆閘賭的是結帳整條。**代價不對稱 ⇒ 留閘。**

**要 Sean 或有 prod access 的窗跑一次**(🔴 **env 形式,不要把連線字串放進 argv**):
```
read -rs PGURL && export PGURL
bash scripts/verify-create-order-9param.sh
unset PGURL
```
🔴 **判準寫死(R1 `F11`)**:**只有 `exit 0` 才可部署。** 那支腳本分得開五種 rc,而
`rc=1`(工具壞了/連不上)與 `rc=2`(用法錯)**都不是檢查結果** —— 沒有這一句,拿到 rc=1 的人會讀成「沒紅就是過」。
```
rc=0 恰一支且含第 9 參 ⇒ 可部署        rc=3 只有 8 參 ⇒ 不可部署
rc=5 8 參與 9 參 overload 並存 ⇒ 不可部署(會撞 PGRST203)
rc=4 找不到函式 ⇒ 你可能連錯庫        rc=1 / rc=2 ⇒ 這不是檢查結果,重跑
```
🔴 **落點(R1 `F12`:不然它是提醒不是閘)**:跑完的**時間 + rc + 是哪個庫**要寫進
①該次 commit 的 body ②`STATUS.md` 的「Sean 待決策 / Blocker」欄,直到部署完成為止。
**真正的部署動作是 Sean 手動 `push dev:main`,那條路上沒有任何機制會提到這支腳本** ——
所以它只能靠「寫在他按下去之前會看到的地方」。
⚠️ **那支腳本目前只在 `notify-email` 分支上**(`git show notify-email:scripts/verify-create-order-9param.sh`),
且它有一條待修的 nit(`F17`:`grep -q` 在「8 參與 9 參 overload 並存」時仍回 rc=0)⇒ 見 §9 待辦。

## 8. rollback

零 migration ⇒ `git revert` 本片 + 重部署。`orders.notification_email` 欄**保留**(PRD §5:`DROP COLUMN` 不是日常 rollback)。
⚠️ **revert 之後已寫入的值不會消失** —— 那是 PII,保留政策照 PRD §7(orders 欄長期保留、遮罩處理)。

## 9. 誠實揭示 / 待辦

- 🔴 **本片做完,一封信都不會寄。** 本片只讓值進 `orders`。寄 = B-5,而 B-5 做完**也不會自己寄**(排程是 PRD §6 gate #1)。
- 🔴 **本片做完,「通知孤兒已消滅」仍不得宣稱**(投遞真相要 C-2,PRD §1 明文)。
- ⚠️ **未量**:正式庫 LINE 登入客人的筆數/分母(repo 側量不到)⇒ `Q-W5-3` 的**嚴重度**未知、**機制**確定。
- ⚠️ **未量**:`CHECKOUT_NOTIFICATION_EMAIL_ENABLED` 在正式站的現值(env,我沒有讀的管道)。
  🔴 **本片的正確性不依賴它**(§4.1 把持久化拿出 flag 之外),但**要確認它仍是 off**,否則結帳頁那個欄會顯示。
- 🔴 **後台看到的 email 與實際寄信的 email 可能不同,而沒有任何地方會顯示後者**(R1 `F19`):
  後台/客服看的是 `customers.email`(`packages/domain/src/order/types.ts:1197`),本片寫進 `orders.notification_email`
  的是 session 現值。兩者一旦分岔,**客人說「我沒收到」時,後台查不到信到底寄去哪裡**。
  ⇒ 修法在 admin 顯示那一片(不在本片),**登記在此**。
- ✅ ~~待辦:舊合併 plan 檔頭指標 / `verify-create-order-9param.sh` 的 `grep -q`~~ **兩條都已做完**
  (`be8d4649`:新增 `rc=5` 分支,判定改成「恰一支且含第 9 參」;舊 plan 檔頭已標「已被取代」)。
- 📌 **下一輪送審(FRAME-1,硬要求)**:把 **PRD §3.2 / §3.4 / §4 / §5 R3 / §6 的內文**與
  **B-4 plan 檔頭下修段的內文**直接貼進 prompt。**只貼檔頭或檔名,審查者看不到同一批契約**
  —— 上一輪就是這樣漏掉 V1/V2 兩條 must-fix 的。

## 11. 🔴🔴 R1 抓到的一個【死結】:`Q-02` 之後,PRD 的 cutoff 取不到值(要 Sean 拍)

**PRD `:125,136` 把 cutoff 釘死成「flag **實際開啟**時戳」**,而 `Q-02` 裁定**那個 flag 永遠不開**。
⇒ **cutoff 這個值永遠不存在** ⇒ 下面三件全部卡住:
```
· B-6 收緊片的 CHECK           created_at >= <切換時戳>     ← 取不到值
· C-1 對帳的下界                                              ← 取不到值
· PRD §6 上線 gate 第 6 條「B-6 必填收緊已完成」            ← 因此不可達
```
🔴 **而 PRD 訂那條規則的【理由】也同時死了**(R1 `F5`):`:126` 逐字的理由是
「B-4 部署後、flag 開啟前建立的單**仍是 NULL**」—— 本片 §4.1 之後,**那個中間狀態不存在了**
(部署完就開始有值)。**規則字面還活著,它的前提已經沒了。**
📎 這正是 memory `feedback_a-rule-does-not-know-its-premise-vanished` 的形狀。

**要 Sean 拍(本片不自己選)**:
```
Q-G4-5  PRD 那個「cutoff = flag 開啟時戳」現在取不到值（因為 flag 永遠不開了），要換成什麼？
        甲（推薦）改成【B-4 這一片部署上線的時戳】
                 理由：本片之後建的單就開始有真值，界線正好落在這裡；語意跟原本一樣
                 代價：要改 PRD 的字面（真權威），而它是被 codex R3 釘過的一條
        乙       等 B-6 那一片再決定
                 代價：C-1 對帳的下界現在就取不到值 ⇒ 那條兜底繼續是空的
        A: 甲 | 乙
```
⚠️ **本片不因為這題卡住** —— B-4 自己不需要 cutoff(它是 B-6 與 C-1 要用的)。
**但這題沒答之前,不得宣稱「通知線可以往 B-6 走」。**

## 10. 估時

實作 ≈ 20 分鐘;測試(7 格 + 7 發突變)≈ 25 分鐘 ⇒ **≈ 45 分鐘**,合鐵則 4。
