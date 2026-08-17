# LINE 推播給客人 · 可行性盤點與規格(唯讀盤點,**未寫任何 code**)

- **窗**:E(資安稽核,唯讀)　**日期**:2026-08-17　**狀態**:**規格,未實作、未執行**
- **觸發**:Sean 拍板 —— 那句「簡訊」是**口誤,實指 LINE**;`Q-C5`＝丙 的意思因此變成「**追蹤碼走 LINE／Email,不印在紙上**」。
- 🔴 **這份規格在兌現一條【早就存在】的政策**,不是新政策:
  `docs/patterns/pcm-specific.md:381` 逐字「**不用簡訊(成本)、所有通訊走 Line(主)+ Email(fallback)**」。
  ⇒ **與政策零衝突;缺的一直是「LINE 那條主管道從來沒有被實作成對客人的管道」。**

---

## 🔴 0. 一句話結論(先講,免得下面被讀成「可以做了」)

**機器有一半、身分有一半、而中間那一格【我查不到,且它決定整件事成不成立】。**

```
✅ 推播機器      已存在且在跑（官方帳號 Messaging API push）
✅ 客人的 LINE userId  已存在（編碼在合成信箱裡，可推導，不需 migration）
🔴 中間那一格    這兩個 userId 是不是【同一個】？
                 —— 取決於 LINE Login channel 與 Messaging API channel
                    是否掛在【同一個 Provider】底下。
                 ⇒ 那是 LINE Developers Console 的設定，**我讀不到**（Sean 手上）
                 ⇒ 不同 Provider ⇒ userId 不互通 ⇒ **整條路不成立，要重做身分綁定**
```
⇒ **§2-b 是這份規格的唯一硬 blocker。其他每一節都在它之後才有意義。**

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
⇒ **對客人推播不需要新增欄位、不需要 migration**:userId = email 的 local-part 去掉 `line_` 前綴。

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

### 2-b 🔴🔴 硬 blocker:**兩個 userId 是不是同一個?**

我們手上的 `sub` 來自 **LINE Login(OIDC id_token)**(`auth/line.ts:12` 註解自述)。
要 push 用的是 **Messaging API 的 userId**。
🔴 **這兩者只有在 Login channel 與 Messaging channel 掛在【同一個 Provider】底下時才相同。**

```
⚠️ 上一句是我方【依 LINE 平台常識推出來的，未查官方文件、未看 Console】⇒ 標【未確認】
   缺的檢查有兩道，我一道都做不到：
   ① 官方文件確認 userId 的 scope 規則（可查，但要查證，不要憑記憶）
   ② 看 Sean 的 LINE Developers Console：兩個 channel 在不在同一個 Provider
      ⇒ 我沒有那個存取權
```
**兩個世界會不同的值**:拿一個**已知有加官方帳號好友**的測試 LINE 帳號,
用它的 Login `sub` 去打 push ⇒ **成功 = 同一個命名空間;回 400 `Invalid to`(或等價)= 不是。**
🔴 **這一發要 Sean 或有 Console 權限的人跑,而且它只要一發就能定案。**

⇒ **在這一發跑完之前,下面 §3/§4 都不要開工。**

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

## 6. 要 Sean 拍的(批次,四題)

```
Q1 §2-b 那一發測試（用一個已加好友的測試帳號驗 Login sub 能不能 push）
   —— 這是硬 blocker，一發定案。要他跑或授權有 Console 權限的人跑。
Q2 §3-a LINE 上的出貨通知要多細？甲完整品項／乙訂單編號+追蹤碼+連結／丙最簡
Q3 §4 推播失敗怎麼處理？甲退 Email（🔴 對這群人無效）／乙標記靜默／丙標記+後台顯示
Q4 §3-c channel token 現在放哪、有沒有輪換程序？（我讀不到 env，也不該讀）
```

## 7. 口徑
`LineAlertNotifierAdapter` 的行為、`auth/line.ts` 的合成規則、179 支 migration 零命中(附正向對照)、
`pcm-specific.md:381` 政策原文 = **當場實查**。
**§2-b 的 userId 命名空間規則 = 推出來的、未查官方文件、未看 Console ⇒ 未確認,且它是硬 blocker。**
`#250` 檔頭「LINE Notify 2025 已停用」= **未查證,且不影響本規格結論**。
§3-a 的個資判斷 = **我方判斷,非法遵意見**。**本規格未寫任何 code、未執行任何 push。**
