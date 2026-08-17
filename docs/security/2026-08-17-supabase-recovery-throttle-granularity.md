# §1#8 收口:Supabase 密碼重設節流的粒度(login/forgot 嚴重度)

- **窗**:E(資安稽核,唯讀)　**日期**:2026-08-17　**面**:網站庫 storefront login/forgot
- **承接**:`E-698` §1 第 8 條(「login/forgot 嚴重度取決於節流粒度:per-email 難燒 / 全專案好燒,我沒查」);缺的檢查=「讀官方文件即可,不必動正式站」。
- **來源**:Supabase 官方 `https://supabase.com/docs/guides/auth/rate-limits`,當場查證(2026-08-17)。字面值三來源律 ②。

## 量到的(官方文件)

| 端點 | 預設上限 | 🔴 粒度 | 可調? |
|---|---|---|---|
| **密碼重設/recovery 信**(`/auth/v1/recover` 與 signup/user 合計) | **2 封 / 小時** | **🔴 專案全域(project-wide)** | 只有換自建 SMTP 才可調 |
| Magic link / OTP | 同一 user 60 秒冷卻;OTP 30 個/小時 | user + 專案全域混合 | 可 |
| 登入 / token refresh | 1800 次/小時(爆量 30) | **per-IP** | 否 |

## 判定:嚴重度掛在一個 Dashboard 事實上 —— 而現有證據傾向較輕那一支

🔴 **粒度確定了:密碼重設的 email-send 是【全域 project-wide】限流,不是 per-email** —— 這回答了 E-698 #8 / `storefront-hunt-round1` §10.4 第三格留的問題。**但那個「2 封/小時」只在【內建 email provider】成立**,而 provider 是哪個決定了整條的嚴重度:

**分支甲(內建 provider ⇒ 較嚴重)**
- **後果一(自我 DoS)**:任何人在一小時內觸發 2 次重設,**整個專案在該小時內誰都收不到重設信**。觸發成本=2 個請求,無需登入、無需 per-email 針對性。
- **後果二(與既有 finding 相乘)**:`storefront-hunt-round1` §10 的防列舉設計讓 forgot 回應**一律相同**。全域額度用光後,**信沒寄出、但使用者拿到的還是「已寄出」** ⇒ 合法使用者無從得知重設默默失敗(§10 commit body 自己點名的病)。

**分支乙(自建 SMTP ⇒ 較輕,而且證據偏向這支)**
- 若接自建 SMTP,「2 封/小時」不適用,上限改由 SMTP 設定決定(通常高很多)⇒ **後果一(全域 DoS)基本消失**,只剩 §10 原本那條「防列舉隱藏寄信失敗」(仍在,但不是全域 DoS)。
- 🔴 **證據偏向乙**:`storefront-hunt-round1` §10.4 記 memory「2026-08-08 曾設定 Gmail Workspace SMTP」(§10 作者標**未查證現況**)。**若那個自建 SMTP 仍在,PCM 就不是內建 provider ⇒ 走分支乙。**

⇒ **誠實口徑(落筆當時):我把粒度查明了(全域、非 per-email),但這【不足以】把嚴重度定成高** —— 它還卡在「內建還是自建 SMTP」這個 Dashboard 事實。
   ✅ **2026-08-17 該 Dashboard 事實已由 Sean 讀出=自建 SMTP(見下方「已確認」段)⇒ 走分支乙、不上調。上面分支甲僅存為推理紀錄。**

📎 這仍是「三段相乘、沒有人寫在一起」的形狀,只是第三段(provider)是**未確認且偏向讓前兩段失效**的:①全域 2/小時(官方文件,確定)②防列舉=回應一律相同(§10,確定)③內建 provider 才受此限(**未確認,證據偏自建**)。

## ✅ 已確認(2026-08-17 Sean 讀 Dashboard 截圖,主視窗轉述)—— 缺的那道檢查補上了,判定=分支乙

> a4 照「人也是量具」的規矩要 Sean 回**兩個世界會不同的值**(那一頁上的字),不是「有沒有設好」。回傳的字:

```
Enable custom SMTP            = 開(綠色)
Host / Port                   = smtp.resend.com / 465
Sender                        = no-reply@pcmmotorsports.com(顯示名「PCM 重機零件販售」)
🔴 Minimum interval per user  = 60 秒
```

⇒ **PCM 走【自建 SMTP(Resend)】= 分支乙**。**「全域 2 封/小時」不適用**(那個數只在內建 provider 成立)⇒ **後果一(全域 DoS)不成立、嚴重度不上調**。殘留只剩 §10 原本那條「防列舉隱藏寄信失敗」(LOW,已在 `storefront-hunt-round1` §10)。
⇒ 這也把 §10.4 第二格(「哪個 SMTP」)與第三格(粒度)一起收口了。

### 🔴 而截圖多量到一個之前沒人量過的東西:`Minimum interval per user = 60 秒`

- 這是一道 **per-user 節流**(同一使用者兩次重設請求至少隔 60 秒),**存在於 Dashboard、repo 內查不到**。
- 它讓「對單一 email 快速灌信」也被擋(強化分支乙的輕判)。
- 🔴 **它屬於「環境值依賴」那一族(同 `db-max-rows`:後台點一下就能改、零監控、repo 看不到)** ⇒ 應進 `docs/reference/environment-values-and-what-stands-on-them.md` 依賴表(該表歸 I 窗落,E 出文字)。

## 口徑

粒度量自 **Supabase 官方文件**;provider 與 60 秒 per-user 間隔量自 **Sean 2026-08-17 Dashboard 截圖**(主視窗轉述,非我親見畫面,但那是「兩個世界會不同的值」)。最終判定=**分支乙(自建 SMTP)、嚴重度不上調**,殘留為 §10 的防列舉隱藏寄信失敗(LOW)。
