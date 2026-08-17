# LINE 推播給客人 · 可行性盤點與規格(唯讀盤點,**未寫任何 code**)

- **窗**:E(資安稽核,唯讀)　**日期**:2026-08-17　**狀態**:**規格,未實作、未執行**
- **觸發**:Sean 拍板 —— 那句「簡訊」是**口誤,實指 LINE**;`Q-C5`＝丙 的意思因此變成「**追蹤碼走 LINE／Email,不印在紙上**」。
- 🔴 **這份規格在兌現一條【早就存在】的政策**,不是新政策:
  `docs/patterns/pcm-specific.md:381` 逐字「**不用簡訊(成本)、所有通訊走 Line(主)+ Email(fallback)**」。
  ⇒ **與政策零衝突;缺的一直是「LINE 那條主管道從來沒有被實作成對客人的管道」。**

---

## 🔴 0. 一句話結論(**2026-08-17 深夜已更正 —— 原版的 blocker 判錯了**)

> 🔴🔴 **更正紀錄(本節與 §2 都被改寫,舊版結論不得再引用)**
> 原版寫「硬 blocker ＝ Login channel 與 Messaging channel 是否同 Provider」。
> **那條是【推出來的】,而且判錯了 —— 真正的 blocker 比它硬得多,且與 Provider 無關。**
> 依據＝**Sean 2026-08-17 逐字回答(B8)**,正本 `docs/security/2026-08-17-questions-for-sean.md`。
> 舊版另有一句「userId 編碼在合成信箱裡 ⇒ 不需 migration、直接可推播」—— **那句是假的**,見 §2-a。

**Sean 逐字(照抄,未改寫)**:
> **用Line登入網站後,我們官方帳號是看不到這個人,除非客人主動點擊網站上的line連結加入好友後,再傳訊息。登入網站跟加入line 好友是不同東西,而官方line 帳號是無法加好友主動聯繫客人,除非客人有先發訊息給官方帳號過,不然永遠不知道客人line id**

```
✅ 推播機器      已存在且在跑（官方帳號 Messaging API push）
🔴 身分那一半    我們手上的是【LINE Login 的 sub】，不是【可推播的 Messaging userId】
                 —— 那是兩個不同的東西，不是同一個值的兩種寫法
🔴🔴 真正的前提鏈（比原規格窄很多）:
     客人點網站上的 LINE 連結 → 加官方帳號好友 → 主動發一則訊息
     → 我們才拿得到那個人的【可推播 id】
```

⇒ 🔴 **這不是技術問題,是【要客人做三個動作】的轉換率問題。**
   來源＝上面那段 Sean 逐字(本檔 §0),**非我方量測**;三個動作的完成率**未量**。
⇒ 🔴 **LINE cohort(用 LINE 登入的人)【不自動等於】可推播的人。**
   兩個集合各有多少人、交集多少 —— **未量**(可量:合成信箱數見 §2-a 的 pattern;
   可推播數**我方無管道量**,要 Messaging API 側資料)。
⇒ 🔴 **「LINE 當主要通知管道」對【還沒做過那三步的客人】不可行** ——
   依據同為 Sean 逐字(§0),**我方未獨立驗證 LINE 平台行為、未查官方文件 ⇒ 標【未確認】**;
   缺的檢查＝讀 Messaging API 官方文件關於「主動 push 的對象從哪來」那一節。

**連帶(政策層的洞,要 Sean 拍)**:`docs/patterns/pcm-specific.md:381` 政策逐字
「不用簡訊(成本)、所有通訊走 Line(主)+ Email(fallback)」——
**對「用 LINE 登入而信箱是合成假信箱」那群人,兩條路現在都不通**(Email 是假的、LINE 推不到)。

---

## 1. 現有機器能做到哪裡(**量到的**)

**檔案**:`packages/adapters/src/payment/LineAlertNotifierAdapter.ts`(`#250`、M-3 Q1=A)

```
端點      https://api.line.me/v2/bot/message/push   （原生 fetch、零新依賴）
認證      Authorization: Bearer <channel access token>   （server-only，:16 `import 'server-only'`）
收件人    cfg.to = 【Sean 的 LINE userId 或 groupId】，單一固定值（:32-33 型別註解）
訊息      messages: [{ type:'text', text: `${subject}\n\n${text}` }]
          :50 註解逐字「純文字訊息(零 PII、只含計數)」
失敗      非 2xx / transport 失敗 → throw 通用訊息 + status
          :55 註解逐字「絕不含 token / 對象 id」
          ⇒ use-case 計入 error ⇒ cron route 503（「壞掉的管道必須可見」）
```

**要改成對客人推播,實際差幾件(推出來的,不是量到的)**:
```
① 收件人   從「單一固定 cfg.to」→「每筆訊息一個 to」＝ 介面改動（IAlertNotifier 不合用）
② 訊息     從「零 PII 固定格式」→「含訂單/品項/追蹤碼」＝ 設計約束被推翻（見 §3）
③ 失敗語意 從「一發失敗 ⇒ 整個 cron 503」→「單一收件人失敗 ≠ 系統故障」（見 §4）
④ 節流     push API 有速率與月額度限制 ⚠️ **未查證，未讀官方文件**
```
🔴 **①②③ 是三個不同方向的改動,不是同一支 adapter 加參數** ——
`IAlertNotifier` 是**告警**介面(系統對維運者),客人通知是**通知**介面(系統對使用者)。
**建議新介面,不要撐大這一支**;`LineAlertNotifierAdapter` 的零 PII 約束值得原樣保留(§3)。

### 1-b 檔頭那句「舊 LINE Notify 2025 已停用」今天還成立嗎?
```
:11 註解逐字「🔴 注意:舊「LINE Notify」2025 已停用,本 adapter 走官方帳號 Messaging API push」
```
⚠️ **我方未查證官方文件 ⇒ 未確認。** 但**本規格不依賴它**:
現有 adapter **本來就走 Messaging API**,不是 Notify ⇒ **Notify 停不停用都不改變本規格的結論**。
⇒ 🔴 **這一格標「未確認、且不影響結論」,不要為了補它去開一輪查證。**

---

## 2. userId 從哪來

### 2-a 已量到:**它是推導出來的,不是欄位**
```
apps/storefront/src/lib/auth/line.ts:48
  lineSyntheticEmail(sub) = `line_${sub}@line.pcmmotorsports.local`
:36 逐字「LINE 用戶 auth.users.email = line_{sub}@此域」
:41 sub 格式 /^U[0-9a-f]{32}$/（LINE 規格，boundary 已驗）

專用欄位 line_user_id：179 支 migration 【零命中】
  pattern: line_user_id|line_uid|line_sub|providerAccountId
  🔴 正向對照（同範圍）:CREATE TABLE 命中 33 檔、email_outbox 命中 2 檔 ⇒ 量具是活的
```
⇒ **可以從合成信箱還原出那個 `sub`,不需新增欄位、不需 migration。**

> 🔴🔴 **更正(2026-08-17 深夜)**:原版這裡寫的是
> 「**userId** = email 的 local-part 去掉 `line_` 前綴 ⇒ 直接可推播」。
> **那句是假的。** 還原得出來的是 **LINE Login 的 `sub`**,
> **不是 Messaging API 的可推播 userId** —— 見 §0 與 §2-b。
> ⇒ **本小節證明的是「我們留得住登入身分」,不是「我們推得到那個人」。兩件事。**

**要不要落成欄位?(規格建議:先不落,但把理由寫死)**
```
不落的代價  · 每次要推播都要解析 email 字串 ⇒ 解析規則散出去（現在只有 line.ts 一處知道格式）
            · 🔴 哪天改網域或改前綴，所有解析點一起壞，而它們沒有共用判定式
              —— #626 已經是這個病的實例（兩份判定式語意不同）
落成欄位的代價 · 一支 migration + 回填 + 從此有兩個真相要同步
建議         **先不落，但【解析只准有一個出口】**：在 `auth/line.ts` 加一支
             `lineUserIdFromSyntheticEmail()`，與 `lineSyntheticEmail()` 成對、同檔、同測試。
             ⇒ 對稱的產生/還原放在一起，是 #626 那個病的解藥
```

### 2-b 🔴🔴 真正的 blocker:**我們根本沒有那個人的可推播 id**

> 🔴🔴 **本小節整段改寫(2026-08-17 深夜)。**
> **舊版的 blocker ＝「兩個 channel 是否同一個 Provider」—— 判錯了,已作廢,不得引用。**
> 舊版還附了一個「一發定案」的驗法(拿 Login `sub` 去打 push 看回不回 `Invalid to`)——
> 🔴 **那一發現在也不該跑當定案用**:它就算成功,證的也是「那個測試帳號**已經加過好友並發過訊息**」,
> **不是**「Login sub 普遍可拿來推播」。**同一發請求,在兩個世界會印一樣的東西 ⇒ 它不是量具。**

**Sean B8 講的是平台行為,不是設定選項**(逐字見 §0):
```
LINE 官方帳號【看不到】只是用 LINE 登入網站的人
⇒ 官方帳號不能主動加好友、不能主動聯繫
⇒ 客人【先發過訊息】給官方帳號，我們才拿得到他的 id
```

⇒ 🔴 **所以「同不同 Provider」這題【就算答案是同一個,也救不了這條路】** ——
   缺的不是命名空間對不對得上,**缺的是「那個人從來沒把自己交給官方帳號」。**

**這條路要成立,真正要做的是(下列四步,**未經審查、是我方從 Sean B8 推出來的**,不是官方文件的步驟表):**
```
① 在網站上放官方帳號的加好友入口（客人要點）
② 客人加好友（客人要做）
③ 客人主動發第一則訊息（客人要做）      ← 🔴 最容易掉的一階
④ 我們在收到訊息的 webhook 上，把那個 Messaging userId 綁到我們的會員
   —— 🔴 這一步【需要新增欄位或對照表】。舊版「不需 migration」的結論
      在【推播】這個用途上不成立（§2-a 還原得出來的是 Login sub，不是這個 id）
```
⚠️ 上表第 ④ 步的實作面**我方未盤點**(webhook route 在不在、綁定要落哪張表)⇒ **未查**。

⇒ **§3/§4 的前提隨之改變**:它們原本假設「有一批人現在就推得到」。
   **那批人有多少 —— 未量,且很可能是 0**(沒有人被要求做過那三個動作)。
⇒ 🔴 **在 ①〜④ 這條鏈有結論之前,§3/§4 不要開工。**

---

## 3. 🔴 PII 與安全面(本節是資安窗的本行)

### 3-a 推到 LINE 上的內容算不算 PII?
Sean 已拍 `Q2=乙`:出貨通知要**放品項清單** ⇒ 推到 LINE 上的是**商品名稱 + 訂單編號 + 追蹤碼**。

**我方判斷(推出來的,要 Sean 或法遵確認)**:
```
商品名稱單獨看     不是 PII
綁在一個【可識別到人的 LINE userId】上推出去   ⇒ 是【個人資料的處理】
                   （誰在什麼時候買了什麼，本來就是個資法意義下的個人資料）
```
⇒ 🔴 **這不是「要不要加密」的問題,是「這些內容會留在 LINE 的伺服器上,而我們刪不掉」。**
**要 Sean 拍的一題**:出貨通知在 LINE 上要多細?
```
甲  完整品項清單（與 Email 同內容）      —— 最方便，最多資料留在 LINE
乙  只給訂單編號 + 追蹤碼 + 一個連結     —— 內容留在我們這邊，LINE 上只有指標
丙  只給「您的訂單已出貨」+ 連結          —— 最少
```
**我方傾向乙**,理由:**它同時解掉 §3-a 與「訊息長度/格式」兩件事**,
且**連結可以要求登入**⇒ 真正的內容仍受我們的授權控制。**但這是 Sean 的商業取捨,我不代拍。**

### 3-b 現有的零 PII 約束是刻意的嗎?改掉要付什麼?
```
:5  逐字「送固定格式**零 PII** 告警訊息到 Sean 的 LINE」
:50 逐字「純文字訊息(零 PII、只含計數)」
:55 逐字「錯誤訊息只含通用描述 + status,絕不含 token / 對象 id」
```
⇒ **刻意,而且寫了三次。**
🔴 **建議:不要改它,新開一支。** 理由:
那三行約束是**告警管道**的約束(告警會進 log、會被轉貼、Sean 可能在群組裡看)。
**客人通知管道的約束不同**(必須含 PII 才有用)。
⇒ **兩支 adapter、兩組約束、兩組測試。撐大同一支 = 讓零 PII 那個約束失去意義。**

### 3-c channel token 的爆炸半徑
```
現況  單一 channel access token，server-only（`import 'server-only'` :16）
      錯誤訊息明文規定不含 token（:55）——【這一點現在就做對了】
洩漏後可做什麼  以官方帳號身分【對任何已加好友的用戶推播】
                ⇒ 🔴 爆炸半徑 = 我們全部的 LINE 客人，而且是【以我們的名義】
                ⇒ 釣魚訊息掛我們的官方帳號發出去，客人無法分辨
輪換            ⚠️ **未查:現行 token 放哪、有沒有輪換程序** —— 我未讀 env 設定（不讀 .env）
                ⇒ 要 Sean 或有 Vercel 面板權限的人回答
```
🔴 **這一格要進上線前必關清單**:token 洩漏的損害**不是資料外洩,是冒名對客人發訊**,
而那是**對外不可回收**(鐵則 12⑤)。

---

## 4. 送達語意(🔴 這一節有一句必須原字保留)

> **「有存」可推導;「還有效」DB 完全答不出來** —— 失效原因是**用戶封鎖／取消追蹤官方帳號**,
> 那個狀態**不在我們的庫裡**,**只有真的 push 一次才會知道**。
> ⇒ **任何「我們有 N 個可推播用戶」的數字都是上限,不是可達數。**

**⇒ 規格上的直接後果**:
```
· 不可以做「推播成功率」儀表板然後相信它的分母
· 不可以在後台顯示「此客戶可推播」——我們不知道
· 🔴 可以做的是【推完之後】記錄結果，讓分母從行為長出來
```

**推失敗要怎麼處理?(🔴 列出來給 Sean 拍,我不代選)**
```
甲  退回 Email    —— 但 LINE cohort 的 Email 是合成假信箱 ⇒ 【對這群人無效】
                     ⚠️ 這一格看起來最合理，而它對【正好是這群人】剛好不成立
乙  標記後靜默     —— 客人不知道、我們知道
丙  標記 + 後台顯示「此單通知未送達」 ⇒ 讓員工用電話或其他方式補
我方傾向丙        理由:Sean 的北極星是「員工能獨立跑完一天」，
                  而「通知沒送到」是需要人介入的事，不是可以靜默的事
```
🔴 **注意甲那格**:它是最直覺的答案,而**對 LINE cohort 恰好無效**(他們的 Email 是合成的)。
**這正是「看起來最合理的選項對這群人剛好不成立」** —— 不要讓它在會議上被順口選走。

---


---

## 4-b 🔴 現況必讀:**這條寄信路今天整個【沒有接通】**

**規格讀者最容易誤讀的一格,寫在這裡**:
```
email_outbox 的 enqueue() 全 repo 【零 production caller】
  數法:`git grep -n '\.enqueue(' apps packages | grep -v test` ⇒ 空（rc=1）
  🔴 正向對照:含 test 一起掃 ⇒ SupabaseEmailOutboxAdapter.test.ts 命中 9 次 ⇒ 量具是活的
```
⇒ **outbox 有表、有 adapter、有測試,但【沒有任何 production 程式碼在呼叫它】。**
🔴 **那不是缺陷,那是「還沒做」** —— 而規格讀者會以為它在跑。
⇒ **本規格談的所有「通知」,前提是那條路先被接通。**

## 4-c 🔴🔴 接通那天的**單一決定**:`recipient_email` 綁哪一欄(**這是開關,不是細節**)

```
綁 customers.email          ⇒ 🔴 路2 引爆:公開 anon signUp 可註冊
                               x@sub.line.pcmmotorsports.local（denylist 漏子網域，見 #627）
                               而 adapter 的 isSyntheticEmail 是【等值比對、不含子網域】
                               ⇒ 認成真信箱 ⇒ 真的送去 Resend ⇒ 退信（#626 成立）
綁 orders.notification_email ⇒ ✅ 路3 擋死:DB CHECK（20260718120000:132-133）
                               <>域 AND NOT LIKE '%.域' ⇒ 子網域與尾點 FQDN 都擋
                               ⇒ #626 不成立
```
**設計意圖目前強指 `customers.email`**:
`supabase/migrations/20260717020000_m4a_email_outbox.sql:28` 逐字
「LINE 會員 `customers.email` = 合成假信箱 `line_{sub}@line.pcmmotorsports.local`」。

🔴 **⇒ 規格拍板(要主視窗或 Sean 確認,我不代拍)**:
> **接通時 `recipient_email` 應綁 `orders.notification_email`,不綁 `customers.email`。**
> 理由:**那一欄有 DB 層 CHECK,而 DB 層是四份判定式裡唯一「攻擊者繞不過」的一層** ——
> app 層的判定式可以被繞(`#627` 就是),DB CHECK 不行。
> ⚠️ 代價:`notification_email` 若為空要有 fallback 規則,**而 fallback 回 `customers.email` 會把這道保護還回去**
> ⇒ **fallback 規則本身要一起拍,不能留給實作者臨場決定。**

---


### 4-c-2 🔴 fallback 決策題(**盤點結果推翻了提問的前提,先看這格**)

**主視窗的顧慮是**:「若 LINE 客人根本填不進 `notification_email`,那綁它對他們就是永遠是空的
⇒ fallback 對他們不是邊緣情況,是唯一情況。」
**盤點結果:相反。他們【必須】填,而且填的是真信箱。**

```
量到的（逐層）:
① CHECK 允許 NULL      20260718120000:127 逐字 `notification_email IS NULL OR ( … )`
   ⇒ 空值合法；而非空時，精確域那半 `<>'line.pcmmotorsports.local'` 會擋掉合成信箱
   ⇒ 🔴 合成假信箱【根本存不進這一欄】
② 它不是衍生欄，是【結帳當下客人填的】
   COMMENT 逐字「客人結帳當下填寫、凍結於訂單層,不隨會員檔變動」
③ 🔴 flag 開啟時它是【必填】，不是選填
   packages/schemas/src/index.ts:201-203
     CheckoutInputWithNotificationEmail = CheckoutInputBase.extend({
       notificationEmail: NotificationEmailInput,      ← 無 .optional()
     })
   函式參數名就叫 `notificationEmailRequired`（:206/:209/:214）
④ 而它驗的是【四份裡最完整那份】
   NotificationEmailInput 的 superRefine 用 !isSyntheticEmailDomain（notification-email.ts:55）
   ⇒ 含子網域、含尾點 FQDN ⇒ #627 那個繞過在這一欄【不成立】
```
⇒ **`CHECKOUT_NOTIFICATION_EMAIL_ENABLED` 開著時,每一筆新訂單的 `notification_email`
都是客人親手填的、通過完整判定式的真信箱 —— LINE 客人也一樣。**
⇒ 🔴 **「綁 notification_email 對 LINE 客人無效」這個顧慮不成立。對他們一樣有效。**

**⇒ 那 NULL 什麼時候會出現?(範圍縮小成兩種,都不是「LINE 客人」)**
```
甲 flag 開啟【之前】建的舊單
   COMMENT 逐字「NULL=B-3/B-4 上線前的舊單或過渡窗單（見 PRD §5 R3 舊 cohort）」
乙 flag 關閉期間建的單（schema 走 CheckoutInputWithoutNotificationEmail，根本不收這欄）
```
⚠️ **`CHECKOUT_NOTIFICATION_EMAIL_ENABLED` 現值 = `true`,但那是 Sean 回報 → 主視窗轉述,
我方未親眼看面板 ⇒ 標「轉述,待親驗」。若其實是關的,乙 就不是歷史情況而是【現在進行式】。**

**🔴 決策題(要 Sean 或主視窗拍,我不代選)**
```
Q  notification_email 為 NULL 的訂單（舊單／flag-off 期間單），通知要怎麼送？

甲  fallback 回 customers.email
    ✅ 最簡單，舊單也送得出去
    🔴 代價:把 DB CHECK 那道保護【整個還回去】——customers.email 沒有域 CHECK（#627 活證據）
       ⇒ 合成假信箱與被灌入的子網域信箱都會流回寄信路徑

乙  不 fallback，NULL 就不寄
    ✅ 保護完整；且這批是有限的歷史集合，不會再增加（只要 flag 保持開啟）
    🔴 代價:那批舊單的客人收不到通知，而【沒有人會知道】除非後台顯示

丙  不 fallback，但後台把「此單無通知信箱」顯示出來，讓員工人工處理
    ✅ 保護完整 ＋ 失敗可見（對齊 Sean 北極星「員工能獨立跑完一天」）
    🔴 代價:要做一片後台 UI

丁  對 NULL 的舊單做一次性回填（人工確認每一筆的真信箱）
    ✅ 一次解決
    🔴 代價:要有權限的人逐筆處理；且回填來源若是 customers.email，等於甲
```
⚠️ **這四個選項的差別只在「那批 NULL 舊單」有多少。**
🔴 **而那個數字我查不到**(`pcm_audit_ro` 被鎖出業務表)⇒ **要有權限的角色跑一句
`SELECT count(*) FROM orders WHERE notification_email IS NULL`** 才知道這題值不值得做 丁。
**在有那個數字之前,我不建議先選。**


---

## 5. 與既有政策對齊(逐條核,無衝突)

```
docs/patterns/pcm-specific.md:381  「不用簡訊(成本)、所有通訊走 Line(主)+ Email(fallback)」
⇒ 本規格【正在兌現】這句的前半，而前半從來沒被實作成客人管道
⇒ 🔴 而它的後半「Email(fallback)」對 LINE cohort 【結構性失效】——
   他們的 Email 是合成假信箱（SupabaseEmailOutboxAdapter.ts:198 gate ⇒ skipped_no_real_email）
   ⇒ **政策寫的是雙管道，這群人實際是零管道** ⇒ 這是政策與現實的落差，不是實作 bug
```
**沒有找到與本規格相反的政策**(掃描範圍:`docs/patterns/pcm-specific.md`、`docs/PHASE-1-NORTHSTAR.md`;
pattern `簡訊|sms|Line|LINE|通訊`)。⚠️ **掃描範圍僅這兩檔,不是全 docs。**

---

## 6. 要 Sean 拍的(**2026-08-17 深夜已改寫 —— 舊四題的前提錯了,不要用舊版問**)

> 🔴🔴 **舊版四題已作廢,列在下方「作廢區」供對帳,不得端給 Sean。**
> 作廢原因:舊 Q1 問的「那一發測試」建立在錯的 blocker 上(見 §2-b),
> 而**它是舊四題的第一題** ⇒ 後面三題都被它框成「技術可行,只差確認」。
> **真實情況是這條路的前提在【客人的行為】那一端,不在我們的設定裡。**

**現在該問的(三題;第一題不答,其餘兩題沒有意義)**
```
Q1 🔴 樞紐題:要不要做「引導客人加官方帳號好友」這條漏斗？
   甲 要做 —— 接受它是產品/轉換率工程（網站放入口、客人要點+加+發訊息 → 才推得到）
   乙 先不做 —— 那麼【LINE 推播給客人】這條在可預見期間內不成立，
      通知管道回到 Email 一條；而 🔴 LINE 登入那群人的信箱是合成假信箱 ⇒ 他們兩條路都不通
      ⇒ 選乙的話，要一併決定那群人怎麼收通知（見下方連帶題）
   丙 只對【已經加過好友並發過訊息】的人推 —— 現在有幾個人？🔴 未量，很可能是 0

   連帶（選乙必答）:用 LINE 登入的客人怎麼收出貨通知？
   甲 註冊/結帳時要一個真信箱   乙 只在後台顯示、由人工聯繫   丙 不通知

Q2 §3-a LINE 上的出貨通知要多細？甲完整品項／乙訂單編號+追蹤碼+連結／丙最簡
   （🔴 前置:Q1 選甲或丙才需要答本題;見本檔 §6 Q1）
Q3 §3-c channel token 現在放哪、有沒有輪換程序？（我讀不到 env，也不該讀）
   ⚠️ 已知一半:Sean B7 答「token 放在【報價單專案】」⇒ 缺的只有輪換流程
```

**舊版四題(作廢區,對帳用)**
```
❌ Q1 §2-b 那一發測試 —— 作廢，blocker 判錯（§2-b）
   ⚠️ 且那一發【在兩個世界會印一樣的東西】⇒ 它本來就不是量具
✅ Q2 出貨通知細度 —— 仍成立，保留為新 Q2
❌ Q3 推播失敗怎麼處理 —— 作廢
   原因:Sean B3 實測 orders_without_notify_email = 13 ⇒ 🔴 這題【不必寫程式，人工處理就好】
   （正本 docs/security/2026-08-17-questions-for-sean.md 的 B3）
✅ Q4 channel token 輪換 —— 仍成立，收斂為新 Q3（B7 已答一半）
```

## 7. 口徑
`LineAlertNotifierAdapter` 的行為、`auth/line.ts` 的合成規則、179 支 migration 零命中(附正向對照)、
`pcm-specific.md:381` 政策原文 = **當場實查**。
🔴 **§0/§2-b 的前提鏈(加好友 → 發訊息 → 才拿得到 id)= Sean 2026-08-17 B8 逐字口述**,
**我方未查 LINE 官方文件、未看 Console ⇒ 對平台行為本身標【未確認】**;
缺的檢查＝讀 Messaging API 官方文件「主動 push 的對象從哪來」那一節。
⚠️ **但這條【未確認】不能拿來當「所以還是可以做」的理由** ——
它的方向是「Sean 說做不到,我們沒去獨立證實」,不是「我們證實了可以做」。
🔴 **舊版口徑那句「§2-b 的 userId 命名空間規則是硬 blocker」已作廢**(那條不是 blocker)。
`#250` 檔頭「LINE Notify 2025 已停用」= **未查證,且不影響本規格結論**。
§3-a 的個資判斷 = **我方判斷,非法遵意見**。**本規格未寫任何 code、未執行任何 push。**
