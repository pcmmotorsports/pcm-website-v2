# Supabase 登入類信件換成 PCM 外框 —— Sean 照貼步驟

> 2026-09-12 · 施工窗 A · Sean 09-12 02:3x 信件 plan Q2 拍乙:「你產 HTML,Sean 貼,你不碰 Supabase 後台」。
> 外框與付款成功信同一套(`packages/use-cases/src/customer-email-shell.ts`):PCM LOGO(點了連到 https://www.pcmmotorsports.com/)、LINE、公司頁尾。
> 範本清單與變數出處:Supabase 官方文件 <https://supabase.com/docs/guides/auth/auth-email-templates>(2026-09-12 查)。

## 白話

- 這些信是 Supabase 幫我們寄的(註冊驗證、忘記密碼…),範本放在 Supabase 後台,不在我們的程式裡,所以要你手動貼。
- 貼錯最壞的情況:客人收到的信連結點不開。所以第 1 步要先看舊範本,**有一種情況要停下來**。
- 一次只貼一支,貼完用自己的信箱測一次,再貼下一支。

## 步驟

**0. 先看舊的(每一支都要)**
Supabase 後台 → 專案 → 左邊選單 **Authentication** → **Emails**(官方文件叫 Email Templates 頁)→ 點要換的那支範本 → 看 **Message body**。

```
舊範本裡的連結是 {{ .ConfirmationURL }}  ⇒ 可以貼,往下做
舊範本裡是 {{ .TokenHash }} 或自己組的網址(例:{{ .SiteURL }}/auth/confirm?...)
  ⇒ 🛑 停,不要貼,截圖給窗 A
```
理由:網站的忘記密碼走 `/auth/callback` 換 session(`apps/storefront/src/app/login/forgot/actions.ts:8`),那是 `{{ .ConfirmationURL }}` 那種連結。如果舊範本用的是別的,代表有人另外設計過,換掉會讓連結失效。

**1. 貼**
1. 打開這個資料夾裡對應的 `.html` 檔(用文字編輯器,不是瀏覽器),全選、複製。
2. 貼進 **Message body**,把舊的整段換掉。
3. **Subject** 可以順便換成下表的建議主旨(不換也可以)。
4. 按 **Save**。

**2. 測**
- 忘記密碼:到 www 登入頁 → 忘記密碼 → 用你自己的信箱 → 收信 → 看有沒有 PCM LOGO → 點「重設密碼」要能進到設定新密碼的畫面。
- 註冊驗證:用一個沒註冊過的信箱註冊一次 → 收信 → 點「確認我的 Email」要能登入。

**3. 退回**
貼壞了就把第 0 步看到的舊內容貼回去(建議第 0 步先把舊內容複製存一份到記事本)。

## 範本對照

| Supabase 範本 | 檔案 | 建議主旨 | 用到的變數 |
|---|---|---|---|
| Confirm sign up(註冊驗證) | `1-confirm-signup.html` | PCM 會員 Email 驗證 | `{{ .ConfirmationURL }}` |
| Invite user(邀請) | `2-invite-user.html` | PCM 會員邀請 | `{{ .ConfirmationURL }}` |
| Magic link or OTP(免密碼登入) | `3-magic-link.html` | PCM 會員登入連結 | `{{ .ConfirmationURL }}` |
| Change email address(換信箱) | `4-change-email.html` | PCM 會員 Email 更換確認 | `{{ .ConfirmationURL }}` `{{ .Email }}` `{{ .NewEmail }}` |
| Reset password(忘記密碼) | `5-reset-password.html` | PCM 會員重設密碼 | `{{ .ConfirmationURL }}` |
| Reauthentication(再次驗證) | `6-reauthentication.html` | PCM 會員驗證碼 | `{{ .Token }}` |

最先要貼的是 **5 忘記密碼** 和 **1 註冊驗證**,這兩支客人一定會收到。2、3、4、6 網站目前有沒有用到,**窗 A 未查**;貼了沒有壞處(沒用到就不會寄)。

變數一律照 Supabase 的寫法,**原樣保留**,不要改空格或大小寫(`{{ .ConfirmationURL }}` 前後各有一個空格)。

## 沒做的:安全通知 7 支

Supabase 另外有 7 支「安全通知」範本:Password changed · Email address changed · Phone number changed · Sign-in method linked · Sign-in method removed · Verification method added · Verification method removed。
官方文件寫明:**專案層級有打開對應的安全通知,才會寄**。我們有沒有打開,窗 A 看不到後台,未查。要做的話跟窗 A 說,同一套外框產給你。

## 已知限制

- 這 6 支 HTML 是 2026-09-12 用當時的外框產生的。以後外框改了,這裡**不會自動更新**,要重產、重貼。
- 範本是用程式產生的(外框共用),而產生用的小腳本沒有放進 repo。重產時用 `renderCustomerEmailShell`(`packages/use-cases/src/customer-email-shell.ts`)。
