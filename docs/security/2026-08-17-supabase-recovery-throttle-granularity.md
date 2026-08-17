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

⇒ **誠實口徑:我把粒度查明了(全域、非 per-email),但這【不足以】把嚴重度定成高** —— 它還卡在「內建還是自建 SMTP」這個 Dashboard 事實,而現有(未查證的)記憶指向自建。**不要拿「全域 2/小時 DoS」當已成立的 finding 遞出去。**

📎 這仍是「三段相乘、沒有人寫在一起」的形狀,只是第三段(provider)是**未確認且偏向讓前兩段失效**的:①全域 2/小時(官方文件,確定)②防列舉=回應一律相同(§10,確定)③內建 provider 才受此限(**未確認,證據偏自建**)。

## 未確認(缺哪一道檢查)

🔴 **上面「2 封/小時」只在【內建 email provider】成立。** PCM 若已接自建 SMTP,則上限改由 SMTP 設定決定(通常高很多),後果一大幅減弱。

- **缺的檢查**:PCM 這個專案用的是內建 provider 還是自建 SMTP。
- **在哪查**:Supabase Dashboard → Authentication → Emails / SMTP Settings(**Dashboard 動作,唯讀窗 + DB 端都看不到;pcm_audit_ro 讀不到 auth schema config**)。
- ⇒ 這條的最終嚴重度**卡在一個 Dashboard 事實**:內建 ⇒ 真 DoS + 隱形失敗;自建 SMTP ⇒ 降為「防列舉隱藏寄信失敗」單獨那一條(仍在,但不是全域 DoS)。

## 口徑

本檔數字量自 **Supabase 官方文件**,非正式站探測;PCM 專案的 provider 設定**未確認**,已標明缺的那道檢查。
