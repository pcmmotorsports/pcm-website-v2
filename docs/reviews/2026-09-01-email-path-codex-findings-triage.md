> 🔵 **本檔原本只在 `~/pcm-mailbox/`, 2026-09-01 收進 repo。**
> 🔴 **為什麼**:板 `docs/launch-todo.md` 有一列**指過來**(那 12 條真 finding 只開 2 列, 其餘指這裡)——
> ⇒ **而一個指向信箱的指標, 在信箱被清掉的那一刻會安靜地失效, 而板上那一列讀起來完全正常。**
> ⇒ ⇒ 📌 **指標的壽命不能比它指的東西長。**

# triage · `codex-findings-寄信路徑-20260901.md` · 由 `-15`(當時名 `-a0`)複核 · 2026-09-01 22:3x

> ⚠️ **名字那一格**:本檔寫成時我叫 `-a0`,重開機後改名 `-15`。**舊名不是錯的, 它當時就是我。**
> 🔴 **而留著它有一個具體風險**:艦隊裡的主視窗叫 **`-0a`** —— **與 `-a0` 只差字元順序**,
> 而板上 `-0a` 出現 **63** 次 ⇒ 讀的人有一半機率把這份複核算到主視窗頭上。
> ⇒ 所以正文改用 `-15`,而**這一句留著**, 讓搜 `-a0` 的人同一發撞到對照。

量測戳:指令逐字在各格 · 工作樹 `/Users/sean_1/pcm-wt-auth`(`agent/line-auth` HEAD `fbbd7282`)· 22:1x–22:3x
🛑 **而有一格我證不到**:codex 跑的是 `-5b` 的 `/Users/sean_1/pcm-wt-account`,**它讀的是哪一顆 commit 我不知道**
⇒ 所以「碼裡有 X」我量的是**我這棵**;兩棵在寄信路徑上是否逐位元相同,**未查**。

---

# 🔴 第一件事:52 條裡沒有 52 個問題 —— 有 18 個

```
python3 逐字去重(只取 ^L\d+: 開頭的行)
  finding 行            = 52
  逐字不同的 body       = 34
  🔴 而語意不同         = 18   (block1 用「具體情境:」開頭, block2/3 是同一批的摘要)
  16 條各印 3 次 · 2 條各印 2 次  ⇒ 16×3 + 2×2 = 52  ✅ 閉合
  must-fix 標記 43 次   ⇒ 實際 **15** 條   (13×3 + 2×2 = 43 ✅)
  nit      標記  9 次   ⇒ 實際  **3** 條   (3×3 = 9 ✅)
```
📌 **三個數字各自對得上 ⇒ 這不是我猜的分組, 是算式閉合。**
🔵 **⇒ `-5b` 標的「43 不要當成 43 個缺陷」是對的, 而理由比它自己講的強** ——
不只是「未複核」, 是**分母本身重複計了三遍**。

## 而那 3 條 nit **根本不是 finding**
codex 對它們逐字寫「**這一格我沒有找到**」⇒ 它在回報一個乾淨結果, 不是在報缺陷。
(env 未 redeploy / 其他唯一鍵會 throw / 金額格式)⇒ **不入三堆。**

---

# 🎯 三堆(分母 = 15 條真 must-fix 候選)

## 🔵 丙 —— 已經被今晚的工作做掉了(1 條)· 判準 = commit hash

### 丙-1 ⟦原 [20]⟧「關出貨線時已有出貨列 ⇒ 每輪 attempts+1、留 sending ⇒ 約 5 次後永久死信」
```
✅ 已修 · b1b7b6f5 + bab8c83d(claimDue 收 excludeEventTypes ⇒ 線關著時【連認領都不認領】)
證據 sweep-email-outbox.ts:772 逐字「✅✅ 2026-09-01 ⟦b4-SHIPGATE1⟧ 已修」
     sweep-email-outbox.ts:622-624 `opts.allowOrderShipped ? undefined : { excludeEventTypes: ['order_shipped'] }`
```
🔴 **而 codex 看不到它** —— 那兩顆在 `agent/line-auth` 上, 而 codex 跑的是 `agent/line-account`。
📌 **⇒ 這一條不是 codex 錯, 是【它讀的那棵樹沒有這個修法】。**
⚠️ **而 codex 連時程都算對了**(「約 5 次後」)—— 它只是不知道那條路已經被關掉。

---

## 🔵 乙 —— 事實錯:碼裡有 codex 沒讀到的前提(2 條 + 1 條的一半)

### 乙-1 ⟦原 [31]⟧「正常付款信仍以 `paid=null` 寄舊純文字, `paid-email-html.ts` 的品項與金額不會出現」
🔴 **前提在 `packages/use-cases/src/sweep-email-outbox.ts:89-91`, 逐字:**
> 🔴 **選用,而「不給」是一個【有意義的狀態】,不是尚未接線的預設值**:
> 不給 ⇒ `order_created` 維持**今天的行為** —— 寄那封 6 行純文字信,POST body 逐位元不變。

**⇒ codex 判的那個症狀就是設計上的預設態。**
🔵 而 `:903` 另寫「沒注入 `paidContext` 的環境, 寄出去的東西**逐位元與今天相同**」。
🛑 **而它有一格是真的, 只是不是 codex 說的那格**:`:733-736` 逐字
> 「**今天不可達**:①`paidContext` 還沒有人注入(`composition.ts` 未建構)」
> 「**而『今天不可達』不是理由, 是【期限】**」

⇒ 我實量:`paidContext` 的落點全部在 use-cases 與 port 內, **route / composition 一處都沒有**。

> 🔴 **⛔ ~~原句寫「6 處」~~ —— 那個數字 2026-09-02 已經不對了**(code-reviewer 量到 7,我用更寬的尺量到 39)。
> 🛑 **而它為什麼要被刪掉而不是更新**:它從來**不承重** —— 承重的是「composition 零命中」那一格。
> 📌 **⇒ 而更難看的是:這一段【本身就是在講「我的尺錯了」】, 而我把同一句裡另一個沒重量的數字原封留著。**
> ⇒ **一段自我更正, 只更正了它注意到的那一半。**

> 🔴 **2026-09-02 更正 —— 結論不變, 而【當時那把尺證不出它】**
> ⛔ ~~原句寫「**route 零命中**」~~ —— 那把尺的分母錯了一層:**deps 不是在 `route.ts` 建的**,
> 是在 `apps/storefront/src/lib/email/composition.ts` 建好之後整包傳進去。
> ⇒ 我用同一把尺量 `ineligibleScanner` 也得到「零命中」, **而它接得好好的**(`composition.ts` 有一行建它)。
> ✅ **重驗(對的分母)**:`grep -c 'paidContext\|PaidEmailContext' composition.ts` ⇒ **0**;
>    🟢 正對照 同檔 `shippedContext` ⇒ **4** ⇒ 尺會動。⇒ **`paidContext` 確實沒接。**
> 📌 **⇒ 【結論對】與【證明它的那把尺對】是兩件事, 而我當時以為是一件。**
📌 **⇒ 真正的那一列不是「它寄純文字」, 是【那個期限沒有落點】。** ⇒ 建議另開一列, 不是修這條。

### 乙-2 ⟦原 [28]⟧「Resend 收下信、DB 故障一天以上 ⇒ 恢復後同列再送, provider 不保證攔住第二封」
🔴 **前提在 `sweep-email-outbox.ts:34-36`, 逐字:**
> - 🔴 **at-least-once、不宣稱不重複**(E2a-a codex 擊破「擊不破」後的正確定性):Resend
>   Idempotency-Key 只保 24h → 「已送出未 markSent → 回收 → 停擺 >24h → 重送」的第二封會真的
>   寄出 = 極窄非零重複率(**Sean S3 認可**)

**⇒ 它不只被記過, 它是被 Sean 拍板接受的殘餘風險。**
🛑 **⇒ 這一條不得當缺陷修 —— 修它等於推翻一個拍板。**
🔵 **而有意思的是:那段話裡寫著「E2a-a codex 擊破『擊不破』之後」** ⇒ **同一個工具, 同一個洞, 第二次。**
📌 **⇒ 而它第二次不知道自己第一次就找過了 —— codex 沒有記憶, 而我們的記憶寫在它讀得到的檔裡而它沒讀。**

### 乙-3(只有理由那半)⟦原 [19]⟧「關 `CRON_SWEEPER_ENABLED` 並 redeploy ⇒ pg_cron 仍呼叫 ⇒ 付款信照寄」
🔴 **結論成立, 而理由整個是錯的 —— 而這一種最貴。**
```
實量:grep -rn 'CRON_SWEEPER_ENABLED'
  唯一落點 = apps/storefront/src/app/api/cron/settle-sweep/route.ts:164   ← 那是【結算】sweeper
  email-sweep 相關檔 ⇒ 零命中
  而 apps/storefront/src/app/api/cron/email-sweep/route.ts:8 逐字:
      「本片**不設** *_ENABLED gate,理由見 docs/specs/2026-07-18-m4a-email-e2a-c-plan.md」
```
📌 **⇒ 不是「pg_cron 繞過了那個旗標」, 是【那條線從來沒有那個旗標】—— 而那是拍板。**
🛑 **⇒ 照 codex 的理由去修 = 去查 pg_cron 為什麼不看 env ⇒ 查一個不存在的東西。**
🔵 **⇒ 而它的結論那半仍然成立且值得一列**:**寄信線今天沒有任何 kill switch**。
⚠️ 而那是**有拍板的**(plan 檔在) ⇒ ⇒ **要開一列的話是「拍板要不要改」, 不是「這是 bug」。**

---

## 🎯 甲 —— 真 finding(12 條)· 每條都有落點

> 🔴 **落點分兩種, 不要混**:【**變成不會發生**】vs【**變成會被看見**】。
> 而別條線的 `0ddd156d`(訊號4「order_created 卡住」接進告警鏈)今天做掉的是**後者**。
> 📌 **⇒ 甲-6 / 甲-8 / 甲-9 現在【會被看見】了, 而它們仍然【會發生】。**

| # | 原 | 一句話 | 我實量到的機制(檔案:行號) | 落點 |
|---|---|---|---|---|
| 甲-1 | [17] | cutoff 前舊單被手動插一列 due `order_created` ⇒ 下輪仍寄 | 閘在 **enqueue** 不在 **send**;`sweep-email-outbox.ts:127-131` 逐字承認同一機制(它講的是 `order_shipped` 那半)⇒ **`order_created` 那半今天連那道 claim 閘都沒有** | 板列 · 與丙-1 同型, 而**修法已經有現成的**(`excludeEventTypes`) |
| 甲-2 | [18] | 刪 `B4_DEPLOY_CUTOFF` + redeploy ⇒ 新排信停, 既有付款信照寄 | 同上;`email-sweep/route.ts:135` 只在排信端讀 | 板列 · 與甲-1 同一顆修法 |
| 甲-3 | [21] | 要填 2026 貼成 2025 ⇒ 一年份舊單大量補寄 | `packages/use-cases/src/deploy-cutoff.ts:34-38` **逐字寫過同一個情境**:「填【早】了 ⇒ 客人收到一封關於幾個月前那張單的通知信,**而 repo 內不會有任何東西紅**」 | 🔴 **已知而未防** ⇒ 板列;修法方向 = 排信前先報「這一發會寄幾封」等人點頭 |
| 甲-4 | [22] | 同一舊單插兩列不同 dedup key ⇒ 兩封都寄 | 唯一索引 = `(event_type, dedup_key)`(`20260717020000_m4a_email_outbox.sql:377`)⇒ **換 key 就繞過** | 板列 · 而它需要人工寫 DB ⇒ 優先度低於甲-1/2 |
| 甲-5 | [23] | 付款信 failed@max 後 scanner 不重排、sweeper 不再 claim ⇒ 客人永遠收不到 | scan view 的 anti-join **不看 status**(`20260822010000_...sql:271-276`);同檔 `:260-267` **自己警告過這會永久漏信** | 🔴 已知未修 ⇒ 板列 |
| 甲-6 | [24] | 201 個 `failed@max` 排前面 ⇒ 新 pending 永遠進不了掃描窗 | `DUE_SCAN_CAP = 200` **寫死**(`SupabaseEmailOutboxAdapter.ts:77`);`:405` 註解說取大窗是為了「不被恆最老的死列餓死活信(R1 Critical)」 | 🔴 **那道保護只在死列 <200 時成立** ⇒ 板列 |
| 甲-7 | [25] | `attempts=4/5` 時 DB 短暫 timeout ⇒ 下輪回收成 `failed@5` ⇒ **從未送出就永久死亡** | `:938` catch ⇒ 只 `errors++`、不補標不重試、列留 `sending` | 板列 |
| 甲-8 | [26] | 永久 join 錯誤每輪送 provider 前退出 ⇒ 最後只剩通用死信 | 🔴 **比 codex 說的重**:`grep 'console\.\|logger\.\|\.log('` 於 `sweep-email-outbox.ts` ⇒ **零命中** ⇒ 不是「只剩通用死信」, 是**執行期完全沒有記錄為什麼** | ⚠️ 而那是**刻意的**(檔頭鐵則「零 PII counts only」)⇒ **這是設計張力不是 bug** ⇒ 板列寫成拍板題 |
| 甲-9 | [27] | claim 50 封後第一封 fetch 卡到平台 kill ⇒ 其餘 49 封白燒 attempt | `ResendEmailSenderAdapter.ts` grep `AbortSignal\|AbortController\|signal:\|timeout` ⇒ **零命中**;`:296-320` 的 `fetch` 無 `signal` | 🔴 **我判這條最該先修** —— 一行 `AbortSignal.timeout()`, 而它擋掉整批死信 |
| 甲-10 | [29] | 箱作廢再復原 ⇒ 新 UUID / 新 dedup key ⇒ 同一批可再寄一次 | 與乙-2 同族, **而這條唯一索引擋不到**(key 變了) | 板列 · 但**先確認「箱作廢再復原」是不是真的存在的流程** ⇒ 不確認就是在防一個想像 |
| 甲-11 | [30] | 付款後、排信前帳號 email 被改 ⇒ **另一個人收到訂單交易資訊** | 收件地址在 **enqueue 當下凍住**(`enqueue-order-shipped-emails.ts:136,145,155` ⇒ 寫進列);寄送用 `job.recipientEmail`, **不重讀** | 🔴 **這條牽 PII 外洩** ⇒ 我建議它排在甲-9 之後第二 |
| 甲-12 | [19]結論 | 寄信線沒有任何 kill switch | `email-sweep/route.ts:8` 逐字「本片**不設** `*_ENABLED` gate」 | ⚠️ **拍板題不是 bug**(見乙-3) |

---

# 🔴 而 triage 過程中我自己撞到一次同一個病

量「兩側的東西在自動合併後還在不在」時, 我用 `getOrderCreatedStuck` 當 dev 側的正對照 ⇒ **印 0**。
📌 而在那個位置, **一個 0 讀起來是「合併把它弄丟了」**。
🔵 真相:dev 側**沒有加新方法**, 它是在既有方法上**加了第七個參數** `orderCreatedStuckMinutes`。
⇒ **那個名字是我從記憶打的, 不是從 diff 抄的。**
🛑 **而我發現它的方式不是機制 —— 是那一格 0 在另外三格都非零的旁邊顯得突兀。⇒ 那是運氣。**
✅ 改用從 diff 逐字抄的名字重量 ⇒ `orderCreatedStuckMinutes` = 1 · 我方 = 1 · 負對照 = 0。

---

# 📎 待辦(給 `-f3` 貼板 / 給主視窗排)
```
🔴 先修  甲-9  (fetch 沒有 timeout ⇒ 一封卡住可整批死信)  ← 一行修法, 爆炸半徑最大
🔴 次修  甲-11 (收件地址在排信當下凍住 ⇒ 換過 email 的人會收到別人的單)  ← PII
   板列  甲-1/2 (同一顆修法, 而 excludeEventTypes 已經在了)
   板列  甲-3/5/6/7/10
   拍板題 甲-8(要不要為了可查根因放寬「零 PII」)· 甲-12(寄信線要不要 kill switch)
   另開  乙-1 的真那半:「paidContext 的期限沒有落點」
   🛑 不動  乙-2(Sean S3 已認可的殘餘風險)· 3 條 nit(codex 自己說沒找到)
```
