# plan · 信件六列 —— **兩列已經不成立,而其中一列是「那天到了而沒有東西提醒任何人」**

> 線【權限/信件】窗 C · 2026-09-09 · **窗 C 沒有寫 migration、沒 apply、沒 push、沒改板、沒寄任何一封信。**
> 讀數 = `pcm_readonly` @ 正式庫(唯讀)+ repo 側 grep + `dig +short TXT`(唯讀 DNS,不寄信)。
> 防撞車兩把尺六個錨全跑過;行號一律用 `bash scripts/board-row-by-anchor.sh` 取,**不用 `grep` 的第一個命中**(那會抓到「提及」不是「本列」——我今天就踩了一次)。

---

## 0. 六列的判定

| # | 錨 | 判定 |
|---|---|---|
| ① | `⟦mail-TXNMAILSPAM⟧` | 🔴 **仍成立**,而卡點不是缺讀數 —— 是**沒有下一封信可看**(§1) |
| ② | `⟦f3-RECIPIENTBIND1⟧` | 🎯 **兩處已不成立**(授權在了 · 通用比對接上了);而**「有沒有空窗」我答不出來**(§2) |
| ③ | `⟦b4-MAILRENDER1⟧` | ⚠️ 仍成立,而與 ① 綁在同一個卡點上(§3) |
| ④ | `⟦mail-SKIPKEYNORETIRE⟧` | 🔵 **機制仍在,而今天零列卡住** —— 那個 0 要帶分母(§4) |
| ⑤ | `⟦mail-DEADMAILREQUEUE⟧` | ⚠️ **只有【引用可定位】那一半解決了** —— 救援那一半仍未驗(§5) |
| ⑥ | `⟦auth-MANUALORDERLIMITBURN⟧` | 🔴 **完整判準今天是 0 不是 1** —— 我原本漏了「有 confirmed 退款」那個條件(§6) |

---

## 1. ① `⟦mail-TXNMAILSPAM⟧` —— 仍成立,而卡的不是讀數

### 🛑 先講一件我【沒有做】的事,而理由是那一列自己寫的
主視窗要我量 SPF / DKIM / DMARC。**而那一列的列頭有一句警語專門治這件事**,逐字:
> **本列的 SPF / DKIM / return-path 那一組值,中段【早就有了】。** 而 2026-09-09 主視窗 A 又派 `-sync` 去量了一次 —— 📌 **答案就在它要人讀的這一列裡,而它躲過了兩個人,因為它住在一列 7,950 字元的中段。** ⇒ 🛑 **派人去量之前先問「這個數本列有沒有」,而且要讀中段,不只頭尾。**

⇒ ✅ **所以我讀中段拿讀數,只做一發【複驗今天仍成立】**,不當新量測:
```
send.pcmmotorsports.com        "v=spf1 include:amazonses.com ~all"      ← Return-Path
_dmarc.pcmmotorsports.com      "v=DMARC1; p=none;"
resend._domainkey.主網域        "p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCzg7Sf54/5FbtPM1v4Pqdg…"(在)
🟢 正對照 google.com ⇒ 17 筆 TXT   ⚪ 負對照 現造網域 ⇒ 0 筆
```
⇒ **與板列中段 09-09 01:1x 那份逐字同向 ⇒ 認證那一層【今天仍然排除】。**
🔵 主網域第一筆回的是 `google-site-verification`(`dig +short` 只取第一筆),**SPF 那筆板列中段記著是 `v=spf1 include:_spf.google.com ~all`** —— 我這發沒有把主網域全部 TXT 撈完,**那一格引板列的,不是我量的**。

### 🔴 而這一列真正的卡點,我量到一個新讀數
板列的關閉條件 ② 是「**下一封真實交易信落在收件匣(他自己看)**」,而 09-08 記著「觀察機會已經錯過一次」(09-07 15:45 那封 `order_created`)。

**我唯讀量 `email_outbox`(2026-09-09)**:
```
event_type          status  n  first                    last
bank_order_created  sent    2  2026-09-06 14:50:01Z     2026-09-06 15:00:01Z
order_created       sent    2  2026-09-02 02:55:00Z     2026-09-07 15:45:00Z
order_shipped       sent    2  2026-09-02 03:05:00Z     2026-09-02 03:30:03Z
⇒ 全表 6 筆,全部 sent,last_error_code 全空
🔴 created_at > 2026-09-07 15:45:02Z 的 ⇒ 0 筆
⚪ 負對照 現造 event_type ⇒ 0
```
🔴 **而我這個判準用錯欄位了**(codex R1 must-fix ③,我複量確認):`created_at` 是**入列**時間,而成功標記寫的是 `sent_at`(`SupabaseEmailOutboxAdapter.ts:786`)⇒ **「早已入列、這兩天才重試成功」的信會被我漏掉。**
✅ **改用 `sent_at` 重問,結論相同而理由不同**:
```
sent_at > 2026-09-07 15:45:02Z ⇒ 1 筆 —— 而那 1 筆就是 09-07 那封自己(sent_at 15:45:02.365,壓在邊界上)
逐列最新的 sent_at:2026-09-07 15:45:02.365Z(order_created)
⇒ 全表 6 筆的 sent_at 最晚就是那一封
```
⇒ 🎯 **所以「觀察機會又錯過了嗎」的答案是【沒有】—— 兩天內沒有任何一封信被寄出。**
⇒ 📌 **這比「沒有人在看」更精確:今天不是沒人看,是【沒有信】。**
🛑 **而射程要收窄**(codex 提的):這只是 **`email_outbox` 這張表答得出來的範圍**。repo 搜尋未見已寄信的定期清理、也未見另一條直寄路徑,**而正式庫有沒有另設清理工作我沒核**。

### 🔴 而主視窗給我的那筆起點讀數,對本列【不適用】
主視窗說:Sean 2026-09-09 下午按忘記密碼,信**進 Gmail 收件匣**(寄件者 `no-reply@pcmmotorsports.com`)。
**我去追那封信走哪條路**:
```
apps/storefront/src/app/login/forgot/actions.ts:14  import { requestPasswordReset } from '@pcm/use-cases'
packages/adapters/src/supabase/SupabaseAuthAdapter.ts:97 逐字
    await this.supabase.auth.resetPasswordForEmail(params.email, { … })
⚪ 那支檔 grep -c 'email_outbox' ⇒ 0      🟢 正對照 sweep-email-outbox.ts ⇒ 2
⚪ email_outbox 的 event_type 只有三種,沒有任何 password reset
```
⇒ 🎯 **忘記密碼信是【Supabase Auth 自己寄的】,不進 `email_outbox`、不走 `ResendEmailSenderAdapter`、不用 `ORDER_EMAIL_FROM`。**
⇒ 🛑 **所以那封信落在收件匣,【不能】用來關這一列** —— 它是另一條寄信路徑。
⚠️ **而它可能仍有旁證價值**:若兩條路共用同一個寄件網域,網域信譽是共用的。🛑 **而那要看 Supabase 的自訂 SMTP 設定,我看不到** ⇒ **要問 Sean:那封忘記密碼信的寄件網域,與交易信是不是同一個。**

### ⇒ ① 的結論
**仍成立。** 關閉條件 ② 沒有進展,**而原因是沒有交易信可看**,不是沒人觀察。
📌 **要動這一列,得先有一張新單。** 那不是工程窗做得到的事。

---

## 2. ② `⟦f3-RECIPIENTBIND1⟧` —— 🎯🎯 **板列自己寫的那個「那天」到了**

板列 09-07 逐字寫著兩件,而**今天兩件都不成立了**:

### 不成立① 「`customers.email` 連授權都沒有」
板列逐字:「`customers.email`:…而 `:208` 記著 DB GRANT 是 `UPDATE (name, phone, birthday, updated_at)` ⇒ **連授權都沒有**。」
**2026-09-09 唯讀實測** `customers` 的欄級 `UPDATE` 授權清單:
```
birthday · birthday · email · gender · gender · name · name · phone · phone · updated_at · updated_at
                       ↑ 🔴 email 在裡面
```
⇒ 來源:`supabase/migrations/20260908100000_m4b_customers_email_update_grant.sql`,`APPLIED.tsv` 記著 **2026-09-08 貼入**。檔頭逐字「把 `email` 加進 `customers` 的**欄級** UPDATE GRANT」。
🔵 而 `SupabaseCustomerAdapter.ts:207-208` 的**註解還在講舊的 GRANT** ⇒ 那段註解今天過期了(本片不改,只記)。

### 不成立② 「付款信 / 出貨信 / 更正單號信【沒有這道比對】」
板列 09-07 逐字:「`recipientEmail` **全檔只有那兩處**」⇒ 所以那三種信沒有新鮮度比對。
**2026-09-09 實測**:`packages/use-cases/src/sweep-email-outbox.ts` 的 `recipientEmail` ⇒ **6 處**,其中 `:2103-2116` 是一道**通用**的比對:
```ts
if (cur.email !== job.recipientEmail) {
  const owned = await outbox.markSkippedRecipientStale(job.id, job.attempts, job.dedupKey);
  …
  continue;
}
```
✅ **而它接上了**:`apps/storefront/src/lib/email/composition.ts:207` `new SupabaseOrderCurrentRecipientAdapter(serviceClient)`、`:210` 放進 deps ⇒ `sweep-email-outbox.ts:2081` `if (deps.currentRecipient !== undefined)` 那道閘**過得去**。
⇒ 🎯 **那道比對【已經蓋到所有信】,不只匯款單。**

### 🎯🎯 而板列自己寫死的那句話,今天應驗了
逐字:
> 🔴🔴 **修好 RECIPLIVEVALUE 的那一天,本列會【自動變成活的】** —— **而那天沒有東西會提醒任何人。**

⇒ 📌 **那天到了**(改信箱的碼在 `apps/admin/src/lib/customers/email-change-action.ts:327` 逐字 `.update({ email: finalEmail }, { count: 'exact' })`)。
🛑 **而「沒有東西提醒任何人」這句要收窄**(codex 提的,對):**我今天才發現** ≠ **沒有東西提醒過任何人** —— 板列本身就記著「比對要先行」這個協調,那也是一種提醒。
⇒ ✅ **能寫的是**:那個觸發條件滿足了,而**板上那一列到今天還寫著「今天靠另一列的缺陷而安全」**。

### 🛑 而板列要求的那個「硬順序」—— **我原本寫「滿足了,沒有空窗」。撤回。**
板列逐字:「**順序是硬的**:那道比對要**先於**改信箱功能上線 —— 反過來的話,中間那段時間**每一封付款信與出貨信都可能寄到舊地址**,而沒有任何東西會叫。」

**我原本的讀數(UTC commit 時間)**:比對 `2026-09-07 12:05 4093e8879` · 改信箱 `2026-09-08 11:04 92f4d31a9` ⇒ 早 23 小時。
🔴🔴 **而那個推論有三個洞(codex R1 must-fix ①c,全部成立)**:
1. **`commit` 時間不是【部署生效】時間。** —— 📌 **這是我今天第二次踩同一族**(第一次:拿 git commit 時間當 migration 的貼入時間,那次是 `APPLIED.tsv` 才是答案)。
2. **後台與 storefront 是【不同的部署】** ⇒ 完全可能後台先上、寄信服務後上。
3. 🔴 **而 `92f4d31a9` 不是首次加入改信箱功能的那一顆** —— codex 指出首次是 **`99306a306`**,`92f4d31a9` 是後續的「放寬成任何登入員工」。**我拿了錯的那一顆去比。**
⇒ ✅ **正確講法:repo 側的先後我量到了,而【上線先後】我答不出來** —— 要核**寄信服務與後台各自的部署版本與生效時間**,以及那道 GRANT 的生效時間。**那三樣施工窗都看不到。**
⇒ 🛑 **所以「沒有空窗」這句撤回。** 空窗有沒有發生過,今天**未確認**。

### ⇒ ② 的結論
**兩處已不成立,而順序也對。** 🛑 **而本列【不因此關掉】** —— 它真正要的東西沒變:
> `PaidEmailContext` **只有 `orderDisplayId`,沒有 `orderId`** ⇒ 沒有東西問得出「這份內容是不是這張單的」。

⇒ 那個**不變式**今天仍然不存在。而板列自己標了「復活條件」:`PaidEmailContext` 的來源哪天不再是當場現撈 ⇒ 升回 ⟨擋⟩。
🛑 **本片不動它** —— 修法是 4 檔 + 動寄信路徑 ⇒ 鐵則 8 + 12⑤,要 Sean/主視窗批 + codex 對抗審。

---

## 3. ③ `⟦b4-MAILRENDER1⟧` —— 與 ① 綁在同一個卡點

板列:「付款成功信【沒有一格是在真的信箱裡看過的】」。
⇒ 📌 **它要的東西與 ① 的關閉條件 ② 是同一種:一封真的信 + 一個人去看。**
⇒ 而 §1 量到 **09-07 之後零封交易信** ⇒ **③ 今天也沒有進展的材料。**
🛑 **而要驗它必須真的寄** ⇒ **本片不做**(零寄信;Sean 那次一次性授權已用完)。
🔴 **而「沒有新信就沒有材料」這句過頭了**(codex R1 提的,我核了板列 `:934`):**Sean 已經回答過一個環境「版面對」** ⇒ 剩下的是**信件身分確認**與**另一個 mail client 環境**。
⇒ ✅ **而合併觀察那件要指名**:③ 要驗的是**付款成功那封 HTML 信**,**任意一封交易信不夠** —— 板列自己寫著「HTML 只有 `order_created` 一種有」。
⇒ ✅ **本片能給的只有一句**:③ 與 ① **不是兩個獨立的等待,是同一封信** —— 下一封真實交易信寄出時,**同一個人同一次觀察可以同時關掉兩列的一半**(落在哪個匣 = ①;版面對不對 = ③)。
🔵 **而那一次觀察【要先講好看什麼】**,否則會像 09-07 那次:信寄了,而沒有人在看。

---

## 4. ④ `⟦mail-SKIPKEYNORETIRE⟧` —— 機制仍在,而今天零列卡住

板列自標未量:「第三族那三碼今天各卡住幾列」。
**2026-09-09 唯讀量**:
```
email_outbox 全表 6 筆 · status 全部 sent · last_error_code 全部空
⇒ 卡在 skip 的列 = 0
⚪ 負對照 現造 event_type ⇒ 0
```
⇒ 🛑 **而這個 0 一定要帶分母**:整表只有 6 筆,而且**全部一次就寄成功**(`attempts` 那一欄板列 09-07 量過是 1)。
⇒ 📌 **「今天零列卡住」不是「機制沒問題」,是【還沒有機會發生】** —— 六封信沒有一封走進 skip 那條路。
⇒ ✅ **所以板列的機制分析(五個 skip 碼分三族、第三族鍵不退休)今天仍然成立,而它的優先序讀數是 0。**
🛑 **本片不修** —— 板列自己寫「動六個 writer + 五支 scanner,**不是 45 分鐘的片**」。

---

## 5. ⑤ `⟦mail-DEADMAILREQUEUE⟧` —— 🎯 **已不成立**

板列的標題逐字:「一支 migration 把『死信怎麼救』交給這個錨 —— **而這個錨在板上【不存在】,直到現在**」。
**2026-09-09 實測**(用專用工具,不用 `grep`):
```
bash scripts/board-row-by-anchor.sh mail-DEADMAILREQUEUE
  ⇒ 1638  open  ⟦mail-DEADMAILREQUEUE⟧
  ⇒ 🟢 錨欄命中 —— 本工具最強的那一種答案(不經整行比對)
```
⇒ ✅ **那個錨今天【在板上,而且在錨欄】** ⇒ **「引用指不到」這件事已經解決。**

🔴🔴 **而我原本據此建議「可以翻 `done`」—— 撤回**(codex R1 must-fix ②,它去讀了全文而我沒讀完):
- 板列雖自稱「指標落地」,**而它同時保留了一件事**:**本列管【救法夠不夠】,另一列管問題本身;不要合併,否則「救法是人工的」會消失。**
- **列尾仍寫著沒量**:人工重排是否真的存在 · 誰按得動 · 按下去是否真的重排。
- 而標題那句「不存在,直到現在」描述的是**開列當時**補上指標,**不是一個今天被推翻的現況宣稱**。
⇒ 🛑 **所以只能說「引用已可定位」,不能關掉一個尚未驗證的救援事項。** 📌 **我把「追蹤位置補上了」推成「追蹤事項完成了」。**

### ✅ 而「執行條件」那一格我補量了(codex must-fix ⑤ 指出它唯讀就查得到)
```
admin_requeue_dead_email(uuid)   secdef = t · owner = postgres
  proacl 逐字 {postgres=X/postgres, service_role=X/postgres}
  has_function_privilege ⇒ service_role t · postgres t · anon f · authenticated f
⚪ 負對照 現造函式名 ⇒ 0
```
✅ **那支 RPC 在,而且 EXECUTE 給對了角色**(後台走 service_role;`apps/admin/src/lib/mail/dead-letter-actions.ts:46` 另要求 manager 授權)。
🛑 **而這只證明【執行前提具備】,不證明【有人按過】或【按下去真的重排】** —— 那要真的跑一次,而那不是唯讀。
⇒ ✅ **建議:主視窗把這一列的標題那句改成「引用已可定位」,而**態不動** —— 救援那一半仍未驗。**

---

## 6. ⑥ `⟦auth-MANUALORDERLIMITBURN⟧` —— 卡點那句過期了

板列 `⟨已量 2026-09-09 · B⟩` 逐字:「卡在:🔧我們 —— 缺的是【唯讀連線】(誰欄先寫 db 就是這個理由)」。
🛑 **而那句過期了**:板列中段自己記著 `-db` **2026-09-08 04:0x 已經量到了**(命中 1 筆)。
**我 2026-09-09 複量,逐格相同**:
```
orders 全表                                        4
手動單(order_source LIKE 'manual_%')              1
  其中 notification_email 空                       1     ← 板列要的那個數
  其中 notification_email 有值                     0
🟢 正對照(板列自己提醒要挑「有獨立理由相信有資料」的類別)
  products 26,425 · customers 15                        ⇒ 尺不是恆回 0
⚪ 負對照 現造 order_source ⇒ 0
```
🔴🔴 **而那不是板列指定的【完整】判準 —— codex R1 must-fix ④ 抓到,我補量之後答案變了:**
板列逐字要的是:`order_source LIKE 'manual_%'` AND `notification_email` 空白 AND **`customers.email` 非空白** AND **那張單有 confirmed 的 `order_refunds`**。
```
manual                                   1
  + notification_email 空白              1
  + customers.email 非空白               1
  + 有 confirmed 的 order_refunds        0   ← 🔴 完整判準命中【0】,不是 1
🟢 正對照 order_refunds 全表 1 列且 status = confirmed ⇒ 尺撈得到,而那張單不是這一張
⚪ customers.email 是空白字串的 ⇒ 0 / 15 —— 📌 codex 提醒「NOT NULL ≠ 非空白」,
   在這個庫上兩者今天剛好一致,而那是【量到的】不是【推的】
```
⇒ 🛑 **所以我上一稿寫「1 筆,與 09-08 一致」是【漏了退款條件的 1】。**
⇒ ✅ **正確講法:查詢連線可用、前三個條件命中 1,而【完整判準今天是 0】。**
🛑 **而要證明「目前真的佔用部分退款掃描名額」還不只這樣** —— 還要套 `20260908080000_…:138` 那張 view 的付款方式 / 部分退款狀態 / 未取消 / 非補登 / outbox 排除 / scanner cutoff。**那一層我沒套。**
⇒ 📌 **所以不能說「完整量測已完成、只剩選邊」。**
⇒ 🎯 **而板列自己寫死了這個 1 的讀法**(`-db` 推翻主視窗原判準給的):
> **不是「今天有 1 個客人被丟掉」,是【這個形狀是手動單的預設形狀 ⇒ 上線後每一張都會命中】。**
⇒ 📌 **所以「量到了可以選邊了」那句 09-08 就成立** —— 而板上到今天還寫著在等那一發量測。
🛑 **本片不選邊** —— 那是甲(移出掃描面)與乙(判準住 domain 不重寫)兩條都有實錘的規矩在打架,**要主視窗或 Sean 裁**。

---

## 7. 🛑 我證不到什麼

1. **① 那封忘記密碼信與交易信是不是同一個寄件網域** —— 要看 Supabase 的自訂 SMTP 設定,**施工窗看不到**。⇒ **要問 Sean。**
2. **① 主網域的 SPF 那一筆我沒撈全** —— `dig +short` 只取第一筆(回的是 `google-site-verification`)。SPF 那筆**引板列中段的**,不是我量的。
3. **② 我沒有跑過任何一條真實寄信路徑** —— 全部讀碼與讀 DB。那道通用比對「接上了」是從 `composition.ts` 的注入推的,**沒有看它在正式站真的跑過一次**。
4. **③ 完全沒有新讀數** —— 它要的是「在真的信箱裡看過」,而本片零寄信。
5. **④ 那個 0 的分母是 6 封信** —— 樣本太小,推不出機制的可靠度。
6. **⑥ 我只複量了那一個判準,沒有查「上線後每張手動單都會命中」那句** —— 那是板列的推論,我沒有獨立驗。
7. 🔴 **今天我又踩了一次同一族**:用 `grep` 找板列,抓到的是**「提及」不是「本列」**(`⟦f3-RECIPIENTBIND1⟧` 真正在 1484 而 `grep` 給我 1483)。⇒ ✅ 改用 `bash scripts/board-row-by-anchor.sh`(它會明講是「錨欄命中」還是「整行比對」)。
8. 🔴 **② 的「上線先後」我答不出來** —— 要核寄信服務與後台**各自的部署版本與生效時間**,以及那道 GRANT 的生效時間。**三樣施工窗都看不到。**
9. **⑤ 的救援那一半只證到【執行前提】** —— RPC 在、EXECUTE 給對角色;而「有人按過」「按下去真的重排」要真跑,不是唯讀。
10. **⑥ 沒有套那張 view 的完整述詞**(付款方式 / 部分退款狀態 / 未取消 / 非補登 / outbox 排除 / scanner cutoff)⇒ 「有沒有真的佔用掃描名額」仍未答。
11. **① 的 `email_outbox` 射程**:正式庫有沒有另設已寄信清理工作,我沒核。
12. 🔴 **今天我踩了【第二次】「commit 時間當生效時間」** —— 第一次是拿它當 migration 的貼入時間(那次 `APPLIED.tsv` 才是答案),這次是拿它當部署上線時間。**兩次都是「用一個看得到的時間軸,去回答一個它答不了的問題」。**
13. 讀數是 2026-09-09 12:0x–12:4x UTC 那幾發的。

---

## 8. 建議給主視窗的四件(窗 C 都沒動)

1. ⚠️ **⑤ 不要翻 `done`**(我原本這樣建議,已撤回)—— 只有「引用可定位」那一半解決了,救援那一半仍未驗(§5)。**建議只改標題那句。**
2. **② 板上那兩句要訂正**(§2):「連授權都沒有」與「那三種信沒有這道比對」都不成立了。🛑 **而不要寫「沒有空窗」** —— 那要部署時間軸,施工窗答不出來。
3. 🔴 **⑥ 要訂正的是【數字】不是誰欄** —— 板列指定的**完整**判準(含「有 confirmed 退款」)今天命中 **0**,不是 1(§6)。而板列自己說「0 只決定急不急,不決定對不對」⇒ **選邊仍要人裁,而急迫性比 09-08 讀起來的低。**
4. 🔴 **①③ 綁一起排一次觀察** —— 下一封真實交易信寄出時,**先講好看什麼**(落在哪個匣 = ① · 版面對不對 = ③),否則會像 09-07 那次:信寄了而沒有人在看。**而今天量到:兩天內零封新的交易信。**


---

## 9. codex R1 —— 5 個 must-fix,逐條怎麼修

| codex 意見 | 怎麼修 |
|---|---|
| ①(b)**無問題/已驗** · 那道通用比對真的蓋到所有信 | codex 去讀了 `sweep-email-outbox.test.ts:3202` —— **測試補齊出貨 / 更正單號 / 匯款三族,各自斷言地址改變不寄、相同才寄** ⇒ 比它在 `:2081`、唯一 `sender.send` 在其後的 `:2192`、**沒有 event type 排除**。✅ 我原本只有 `composition.ts` 的注入當證據,現在有第二個 |
| ①(c)**must-fix** · 「早 23 小時所以沒空窗」不成立 | 🔴 **整段撤回**(§2)。三個洞:commit ≠ 部署生效 · 後台與 storefront 不同部署 · **而我比錯了 commit**(首次是 `99306a306`,`92f4d31a9` 是後續放寬) |
| ②**must-fix** · ⑤ 不能因錨存在就翻 `done` | 🔴 **建議撤回**(§5)。板列保留「本列管救法夠不夠」,列尾仍寫沒量人工重排。改成「引用已可定位,態不動」;並**補量**那支 RPC 的執行條件 |
| ③**must-fix** · `created_at` 查零推不出「零封寄出」 | **改用 `sent_at` 重問**(§1):結論相同而理由不同;並收窄成「`email_outbox` 這張表答得出來的範圍」 |
| ④**must-fix** · ⑥ 的 1 筆不是完整判準 | 🔴 **補量之後答案變了:完整判準命中 0**(§6)。板列還要「`customers.email` 非空白」與「有 confirmed 退款」;另量到 `customers.email` 空白 0/15(codex 提醒 NOT NULL ≠ 非空白) |
| ⑤**must-fix** · 缺了唯讀就查得到的「救援執行條件」 | **補量了**(§5):`admin_requeue_dead_email(uuid)` 在 · secdef t · `proacl {postgres=X, service_role=X}` · anon/authenticated 皆 f |
| 附帶 · 「沒有新信就沒有材料」過頭 | §3 修正:Sean 已答過一個環境「版面對」;而合併觀察**要指名付款成功那封 HTML 信** |

🛑 **codex 結論是「不可拿去建議改板」。本稿把五條都修了**,而其中兩條**改變了結論**:⑤ 從「可翻 done」降成「只改標題」、⑥ 從「1 筆」變成「完整判準 0 筆」。
🛑 主視窗 2026-09-09 定:**純 .md 只跑 R1,不跑 R2。**
