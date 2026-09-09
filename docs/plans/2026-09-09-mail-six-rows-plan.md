# plan · 信件六列 —— **兩列已經不成立,而其中一列是「那天到了而沒有東西提醒任何人」**

> 線【權限/信件】窗 C · 2026-09-09 · **窗 C 沒有寫 migration、沒 apply、沒 push、沒改板、沒寄任何一封信。**
> 讀數 = `pcm_readonly` @ 正式庫(唯讀)+ repo 側 grep + `dig +short TXT`(唯讀 DNS,不寄信)。
> 防撞車兩把尺六個錨全跑過;行號一律用 `bash scripts/board-row-by-anchor.sh` 取,**不用 `grep` 的第一個命中**(那會抓到「提及」不是「本列」——我今天就踩了一次)。

---

## 0. 六列的判定

| # | 錨 | 判定 |
|---|---|---|
| ① | `⟦mail-TXNMAILSPAM⟧` | 🔴 **仍成立**,而卡點不是缺讀數 —— 是**沒有下一封信可看**(§1) |
| ② | `⟦f3-RECIPIENTBIND1⟧` | 🎯🎯 **兩處已不成立,而【那天到了】** —— 板列自己寫的觸發條件今天滿足了(§2) |
| ③ | `⟦b4-MAILRENDER1⟧` | ⚠️ 仍成立,而與 ① 綁在同一個卡點上(§3) |
| ④ | `⟦mail-SKIPKEYNORETIRE⟧` | 🔵 **機制仍在,而今天零列卡住** —— 那個 0 要帶分母(§4) |
| ⑤ | `⟦mail-DEADMAILREQUEUE⟧` | 🎯 **已不成立** —— 它說「這個錨在板上不存在」,而它今天在(§5) |
| ⑥ | `⟦auth-MANUALORDERLIMITBURN⟧` | 🔵 **卡點那句過期了** —— 它說「缺一發唯讀量測」,而 09-08 就量到了;我今天複量,數字一格沒變(§6) |

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
⇒ 🎯 **所以「觀察機會又錯過了嗎」的答案是【沒有】—— 因為兩天內一封新的交易信都沒有。**
⇒ 📌 **這比「沒有人在看」更精確:今天不是沒人看,是【沒有信】。** 而板列自標「多久會有下一次答不出來」—— 現在有讀數了:**兩天,零封。**

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

⇒ 📌 **那天到了**(改信箱的碼在 `apps/admin/src/lib/customers/email-change-action.ts:327` 逐字 `.update({ email: finalEmail }, { count: 'exact' })`),**而確實沒有東西提醒任何人** —— 我是**去量才發現的**。

### ✅ 而板列要求的那個「硬順序」——**滿足了,沒有空窗**
板列逐字:「**順序是硬的**:那道比對要**先於**改信箱功能上線 —— 反過來的話,中間那段時間**每一封付款信與出貨信都可能寄到舊地址**,而沒有任何東西會叫。」
**實測(UTC commit 時間)**:
```
收件人比對接線  2026-09-07 12:05  4093e8879
改信箱功能      2026-09-08 11:04  92f4d31a9
email 欄級 GRANT 貼入日           2026-09-08
⇒ 比對【早了約 23 小時】 ✅ 順序對,沒有空窗
```

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
⇒ 🎯 **那個錨今天【在板上,而且在錨欄】** ⇒ **標題那句話已經不成立。**
🔵 **而那正是這一列自己要的東西** —— 它是「指標落地」型的列:`20260907060000:11-12` 那支 migration 把一件事交給 `⟦mail-DEADMAILREQUEUE⟧`,而當時沒有那一列。**現在有了。**
🛑 **而它指的那個缺口仍由 `⟦mail-FAILEDMAXNORESCAN⟧` 擋著**(板列自己寫的 ⟨不擋⟩ 理由)⇒ **本列可以收,而那個缺口不會因此消失。**
⇒ ✅ **建議:主視窗判它能不能翻 `done`。** 🛑 **窗 C 不改板。**

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
⇒ ✅ **1 筆,與 09-08 一致。**
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
8. 讀數是 2026-09-09 12:0x–12:3x UTC 那幾發的。

---

## 8. 建議給主視窗的四件(窗 C 都沒動)

1. **⑤ 可以翻 `done`** —— 那個錨今天在板上、在錨欄(§5)。
2. **② 板上那兩句要訂正**(§2):「連授權都沒有」與「那三種信沒有這道比對」都不成立了;而**要加一句**:板列自己預言的「那天」到了,**而確實沒有東西提醒任何人**。
3. **⑥ 誰欄那句「缺唯讀連線」要撤** —— 09-08 就量到了,我今天複量一致(§6)。剩下的是**選邊**,要人裁。
4. 🔴 **①③ 綁一起排一次觀察** —— 下一封真實交易信寄出時,**先講好看什麼**(落在哪個匣 = ① · 版面對不對 = ③),否則會像 09-07 那次:信寄了而沒有人在看。**而今天量到:兩天內零封新的交易信。**
