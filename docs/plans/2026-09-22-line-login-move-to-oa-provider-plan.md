# LINE 登入換到官方帳號所在的 provider —— plan(鐵則 8,等 Sean 批准)

> 前台窗 2026-09-22 寫。本檔只寫計畫,不改程式、不改 env、不寫資料庫。
> 前情:`docs/plans/2026-09-14-line-friend-and-order-push-plan.md:22` 寫明「Login 頻道與官方帳號不在同一個 provider ⇒ LINE 推播整案不能用」。

## 0. 一句話

現在網站的 LINE 登入頻道(ID 2010190266)放在 provider「PCM MOTOR PARTS LTD」,官方帳號「PCM 重機零件販售」放在 provider「Chatisfy」。
兩邊不在同一個 provider,所以登入時不會跳出「加入好友」,我們也拿不到能推播用的 LINE 使用者編號。
Sean 已選甲:在 Chatisfy 底下新建一個 LINE 登入頻道,網站改用它,再把它連到官方帳號。

**程式不用改**,只換兩個設定值(env)並重新部署顧客站。

## 1. 會影響哪些客人(正式庫唯讀實查,2026-09-22)

LINE 給每個人的使用者編號(程式裡叫 `sub`)**是依 provider 分開的**。換到 Chatisfy 之後,同一個人拿到的是另一個編號。
網站用這個編號認人:登入帳號的 email 是 `line_<編號>@line.pcmmotorsports.local`(`apps/storefront/src/lib/auth/line.ts:63-65`),
身分另外記在登入資料的 `app_metadata.pcm_line_user_id`(`apps/storefront/src/lib/auth/line-admin.ts:83`)。
⇒ **舊客人換頻道後第一次用 LINE 登入,網站會幫他開一個全新的空帳號**,看不到舊帳號的訂單。舊帳號和訂單不會被刪。
(例外:撞號時會登入失敗,見本節最後。)

實查結果(只數筆數,沒有讀任何名字或編號):
```
customers 全部                         14 位
用 LINE 註冊的客人(合成 email 網域)   2 位
  其中有訂單的                          1 位,共 1 張訂單
  其中有電話 / 儲值金                    0 位 / 0 位
customers.line_user_id 有值             1 位(就是上面有訂單那一位;編號與合成 email 一致)
customers.line_friend_at 有值           0 位
```
🔴 查不到的:這 2 位是真客人還是 Sean 的測試帳號。唯讀帳號讀不到登入資料表(`auth` schema 權限不足),我也刻意不讀姓名。
⇒ **請 Sean 在後台客人清單看一眼這 2 位**(email 結尾是 `@line.pcmmotorsports.local`)。

### 接回舊帳號的做法(只有真客人才需要)
LINE 沒有提供「舊 provider 編號 ⇒ 新 provider 編號」的查詢,只能等客人用新頻道登入一次,才拿得到他的新編號。
- **甲(推薦):本計畫不定接回做法,確認是真客人後另寫一份 plan。** 那份 plan 是正式庫與登入資料寫入,要 Sean 另外批准;
  要等 §5 說的「確定不退回」之後才做。Codex 兩輪審查已找出那份 plan 必須處理的限制(寫在這裡,不要重踩):
  1. 包裹的客人欄位有資料庫檢查,建立後不能改(`supabase/migrations/20260805170100_m4b_e10_b2_s1a2_shipments_guards.sql:155-157`)
     ⇒ 單純「把訂單搬到另一個帳號」會讓訂單和包裹分屬兩個帳號。今天那 1 張訂單的包裹數是 0(2026-09-22 唯讀實查),但之後可能不是。
  2. 客人用新頻道登入後,新編號已寫在新帳號 B 的 `customers.line_user_id`,而這一欄有唯一限制
     (`supabase/migrations/20260914040000_m4b_line_friend_and_outbox_channel.sql:69`);新的合成 email 也被 B 佔住
     ⇒ 不能直接把舊帳號 A 改成新編號,要先處理 B 佔住的這兩個值。
  3. B 不一定是空帳號:客人可能在等待期間用 B 下單、產生包裹;訂單刪除帳號時會被擋(`supabase/migrations/20260604120000_m3_s2a_orders_order_items.sql:95` `ON DELETE RESTRICT`)
     ⇒ 動手前要查 B 有沒有訂單、包裹;有的話要另定讓客人看得到兩邊訂單的方法。
  4. 要寫中途失敗怎麼復原,以及做完之後客人登入會落在哪個帳號。
- 乙:改程式,讓新帳號登入時自動找回舊帳號。LINE 沒有對照表,程式認不出兩個編號是同一人,做不到自動,**不建議**。

如果這 2 位都是測試帳號 ⇒ 不用接回,放著不影響任何人。

### 少見但會擋住登入的情況:帳號撞號
程式用「合成 email 已存在」判斷是不是老客人,並檢查那個帳號的 `app_metadata` 是不是同一個 LINE 編號
(`apps/storefront/src/lib/auth/line-admin.ts:88-97`)。如果新編號對應的合成 email 已經被一個身分不符的帳號佔走,
程式會拒絕登入(原因碼 `collision_not_line`,`apps/storefront/src/app/api/auth/line/callback/route.ts:125-127`),**客人重按也一樣失敗**。
可能的成因:有人事先偽造那個 email、程式產生登入連結時留下沒有身分資料的帳號(`line-admin.ts:67` 寫的「孤兒」)、
或有人手動建立或修改帳號時漏填身分資料。這是既有的防冒用檢查,換頻道不會讓它變多,但也不會自己消失。
- 怎麼發現:客人反映「LINE 登入一直失敗」;登入回呼紀錄會記原因碼 `collision_not_line`。
- 怎麼處理:人工查那個佔用帳號是誰建的,確認後再處理。🛑 **不可**為了讓他登入而跳過身分檢查,也不可只清 `customers.line_user_id`。

### 已存的那 1 個 `line_user_id`
它是舊 provider 的編號,新官方帳號推不到它。目前 `line_friend_at` 是空的,推播程式本來就不會推給它(推播條件要有 `line_friend_at`),
所以換頻道**不會多出推播失敗**。處理方式跟上面甲一起做。

## 2. 員工登入會不會受影響:**不會**

- `apps/storefront/src/lib/auth/line-admin.ts` 是**顧客站**用 LINE 登入時的後端那一段:用 `service_role`(資料庫管理權限)幫客人建立或找回帳號、
  發登入憑證,並把 LINE 編號記到 `customers`。它只被顧客站的 `/api/auth/line/callback` 使用。名字裡的「admin」指的是 Supabase 的管理 API,不是員工後台。
- 員工後台(`apps/admin`)是從報價單網站單一登入(`apps/admin/src/lib/sso/`);報價單網站用帳號密碼登入
  (報價單 repo `origin/main` 的 `lib/identity.ts:180` `signInWithPassword`),**兩邊都沒有用 LINE 登入頻道**。
  `apps/admin` 裡也沒有讀 `LINE_CHANNEL_ID`(`git grep` 只在 `apps/storefront` 命中)。
- 不受影響的 LINE 功能(它們用的是官方帳號的 Messaging API,本來就在 Chatisfy,這次不換):
  老闆告警推播(`LINE_CHANNEL_ACCESS_TOKEN` / `LINE_ALERT_TO`)、官方帳號 webhook(`LINE_WEBHOOK_CHANNEL_SECRET`、`LINE_WEBHOOK_FORWARD_URL` 轉發給報價單)。

## 3. 要改的設定

| 變數 | 改不改 | 放哪裡 |
|---|---|---|
| `LINE_CHANNEL_ID` | **改成新頻道的 Channel ID** | Vercel 專案 `pcm-website-v2`(顧客站)Production + Preview;本機 `apps/storefront/.env.local` |
| `LINE_CHANNEL_SECRET` | **改成新頻道的 Channel secret** | 同上 |
| `LINE_REDIRECT_URI` | 不改(網址沒變) | — |
| `LINE_CHANNEL_ACCESS_TOKEN` / `LINE_ALERT_TO` / `LINE_WEBHOOK_CHANNEL_SECRET` / `LINE_WEBHOOK_FORWARD_URL` / `LINE_PUSH_ENABLED` | 不改 | — |

- 新頻道的 Callback URL 填:`https://www.pcmmotorsports.com/api/auth/line/callback`
  (與現在的 `LINE_REDIRECT_URI` 同一個;依 `docs/handoff/CURRENT.md:1444`,舊頻道另留了 `shop.` 那一行,新頻道要不要也加,見 §4 第 5 步)。
- 改完 env 要**重新部署顧客站**才會生效。員工後台不用重新部署。
- 🔴 未確認:Vercel 上目前這兩個變數是不是真的叫這兩個名字、在哪幾個環境有設。換之前請在 Vercel 專案設定頁看一眼名稱(不用看值)。

## 4. Sean 在 LINE Developers 要做的步驟

1. 登入 LINE Developers(developers.line.biz),左邊選 provider **Chatisfy**。
   ⚠️ 先確認兩件權限:你在 Chatisfy 可以新增頻道,而且你是官方帳號「PCM 重機零件販售」的管理員(第 6 步連結時兩邊都要是管理員)。
   如果 Chatisfy 是外包廠商建的、你只有部分權限,先停下來告訴主視窗。
2. 按「Create a new channel」,類型選 **LINE Login**。
3. 填資料:地區 Taiwan、頻道名稱(例如「PCM MOTOR PARTS 網站登入」)、說明、App types 勾 **Web app**、Email 填 sean@。其餘不用勾。
4. 建好後進入新頻道,在「Basic settings」找到 **Channel ID** 和 **Channel secret**,
   把這兩個值貼到 Vercel 顧客站專案的 `LINE_CHANNEL_ID` / `LINE_CHANNEL_SECRET`(不要貼到對話裡)。
5. 到「LINE Login」分頁,Callback URL 填 `https://www.pcmmotorsports.com/api/auth/line/callback`。
   如果舊頻道也有 `shop.pcmmotorsports.com` 那一行,照抄一行過來。
6. 回到「**Basic settings**」分頁,找「**Linked LINE Official Account**」,選「PCM 重機零件販售」。這一步就是這次要的:登入時會跳出加好友。
7. 頻道最上面的狀態從 **Developing** 改成 **Published**。🔴 沒改的話,只有你自己測得到,客人登不進來。
8. 回 Vercel 顧客站專案重新部署。
9. 用手機走一次:網站 ⇒ 登入 ⇒ 用 LINE 登入 ⇒ 看到同意畫面 ⇒ 回到網站已登入。
   「加入好友」畫面要用**還沒加官方帳號好友**的 LINE 測;如果你的 LINE 早就是好友,不會再跳出來,那是正常的。
10. 舊頻道(2010190266)**先不要刪**,至少留兩週,出事要退回用。

## 5. 出事怎麼退回

- 做法:把 Vercel 的 `LINE_CHANNEL_ID` / `LINE_CHANNEL_SECRET` 換回舊頻道的值,重新部署顧客站。程式不用動。
- 退回後各種客人會怎樣:
  - **換頻道前就有帳號的客人**:用舊編號登入,回到原本的舊帳號,看得到原本的訂單。
    🔴 但他如果在換頻道期間用新頻道帳號下過單,**那些訂單留在新頻道帳號,退回後他看不到**。
  - **換頻道期間才第一次用 LINE 登入的客人**:退回後舊頻道給的是另一個編號,網站會再幫他開一個新帳號;
    他在換頻道期間下的訂單同樣看不到。
  - ⇒ 退回之後要做的事:唯讀查「換頻道期間新建、而且有訂單的 LINE 帳號」有幾個;有的話,逐一另寫 plan 接回(限制同 §1 甲)。
    員工後台照樣看得到這些訂單,出貨不受影響;受影響的是客人自己在網站上看不到。
  - **正在登入途中的客人**(換設定那一刻剛好在 LINE 同意畫面上)會看到登入失敗,重新按一次就好。換過去時也一樣。
- 🔴 **§1 甲的接回一旦做了,單純換回 env 就退不乾淨** ⇒ 所以接回要等換頻道穩定、確定不退回之後才做(至少等到舊頻道保留期兩週結束)。
- 所以:換設定挑客人少的時段,換完馬上照 §4 第 9 步走一次;有問題當下就退,受影響的人最少。

## 6. 沒做 / 證不到

1. 那 2 位 LINE 客人是不是測試帳號:未確認(要 Sean 看後台)。
2. Vercel 上兩個變數的實際名稱與環境:未確認(我沒有讀 Vercel 設定)。
3. 你在 Chatisfy provider 的權限:未確認。
4. 「換 provider 之後 `sub` 會變」是 LINE 官方文件寫的規則(使用者編號依 provider 發);本窗沒有實測。
5. 報價單 repo 是讀 `origin/main`(`63eb684d`)判斷它沒用 LINE 登入,不是讀正式站。
6. 登入資料表(`auth.users`)唯讀帳號讀不到 ⇒ 有沒有「身分不符而佔住合成 email」的帳號(§1 撞號)沒查。
7. Codex 審查 R1:FAIL(3 項必修、2 項小修)⇒ 照修。R2:FAIL(3 項必修、1 項小修),全部針對 §1 接回做法與 §5 退回漏項
   ⇒ 本版把接回做法移出本計畫(改列為另案必須處理的限制)、補上退回漏掉的客人。**依鐵則 12 不跑 R3,修改後的版本沒有再審。**
   全文:`~/pcm-mailbox/codex-LINE登入換provider-plan審-R1-20260922.txt`、`…-R2-20260922.txt`。

## 7. 要 Sean 決定

```
Q1: 批不批准照 §4 換 LINE 登入頻道?
A1: 甲 批准,挑客人少的時段換(推薦)| 乙 先不換

Q2: 那 2 位用 LINE 註冊的客人(1 位有 1 張訂單)怎麼處理?
A2: 甲 先看後台:是測試帳號就不管;是真客人,等換頻道穩定兩週後,另寫 plan 接回(推薦)
    | 乙 換之前先聯絡那位客人
```
