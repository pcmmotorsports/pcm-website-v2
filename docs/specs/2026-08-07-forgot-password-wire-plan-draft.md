# 忘記密碼接線片 · plan v2(2026-08-07,site-redesign 窗)

> **狀態:v2 **已批准**(Sean 2026-08-07 深夜 Q24-a,逐字「依照建議」;信箱 `D-207-A`)。
> ✅ **開工前置三類全綠,2026-08-08 凌晨開工**(`D-213-A`)—— §4-B ✅ `NEXT_PUBLIC_SITE_URL` = `https://shop.pcmmotorsports.com` / §5 四條 dashboard ✅(兩條達成、兩條為上線前停點、不擋開工)/ §3-5 ①✅ 親讀原始碼驗證、②✅ Sean 實讀後台 **OTP = 3600** ⇒ 稿上「1 小時內有效」照留。
> ⚠️ **仍有兩個上線前停點**(不在本片內完結):重設信中文模板等 OD 文案 / SMTP 目前走 Supabase 預設寄件。詳 §5。
> 高風險片(鐵則 12 ② auth),對抗審查不降級。
> v1 寫的時候**拿不到稿**;主視窗 `D-204-A` 代取到手(路徑在 8 層深、我的 `-maxdepth 5` 搆不到),
> 四個附件在 `pcm-mailbox/`:`附件-D-忘記密碼-OD信全文.md` / `-handoff.md` /
> `-forgot-password-page.html` / `-reset-password-page.html`。**本檔 v2 已讀完四份**,v1 的 §6 缺口清掉。
>
> 依據:`D-195-A`、`D-200-A`、`D-202-A` 6.、`D-204-A`。

---

## §1 現況實查(全部附 `檔案:行號`,主對話親自開檔)

### 1-1 死連結本體

- `apps/storefront/src/components/LoginPage.tsx:144` `<a href="#" className="auth-forgot">忘記密碼？</a>`
- 同檔 `:15` 註解逐字:「忘記密碼?維持 design `<a href="#">`(該流程不在 f1 scope)。」
  ⇒ **是有意留的坑,不是漏做**。
- ⚠️ OD 說它在原型裡已把 `href="#"` 改成指向 `/login/forgot`;**真站這一行還是 `#`** ⇒ 本片要一起改。

### 1-2 路由現況:兩頁都不存在

`apps/storefront/src/app/login/` 只有 `page.tsx` / `actions.ts` / `actions.test.ts`。

### 1-3 認證架構(ports / adapters,不能繞)

| 層 | 檔 | 現況 |
| --- | --- | --- |
| port | `packages/ports/src/IAuthService.ts:24-28` | **只有 3 個方法**:`signUp` / `signInWithPassword` / `signOut`。**沒有任何密碼重設** |
| adapter | `packages/adapters/src/supabase/SupabaseAuthAdapter.ts:39/61/80` | 對應那 3 個 |
| use-case | `packages/use-cases/src/{register,login,logout}-customer.ts` | 同上 |
| composition | `apps/storefront/src/lib/auth/composition.ts` | 🔴 **全 storefront 唯一准 import `@pcm/adapters/server` 的檔**(eslint `no-restricted-imports` 擋整個 `apps/storefront/**`,該檔以 inline disable 開受控小門) |

⇒ **本片是「port + adapter + use-case + server action + 2 頁 + CSS」的縱切**,不是加兩個頁面。
⇒ **鐵則 8 必提 plan(本檔)+ 鐵則 12 ② 必跑 codex**,兩條都中。

### 1-4 可沿用的既有零件(不要重造)

- `lib/auth/safe-redirect.ts` — `sanitizeNextParam()` 同源白名單;既有 sink `app/auth/callback/route.ts:33`。
- `app/auth/callback/route.ts` — 已在做 `exchangeCodeForSession` + **相對路徑** redirect。
  檔頭 `:9-12` 記著一條 **codex 關卡2 must-fix**:redirect 用 `next/navigation` + 相對路徑,
  **不可從 request host 組絕對 URL**(host-header open-redirect)。**本片必須遵守同一條。**
- `lib/auth/field-validation.ts` — 逐欄錯雙通道(`fieldErrors` / `formError`);密碼規則 **≥8 碼**(`:75`/`:115`)。
- `lib/site-url.ts:6-10` — `resolveSiteUrl()`:設了 `NEXT_PUBLIC_SITE_URL` 用它;未設且非 prod → localhost;
  **未設且 prod → `undefined`**。
  ✅ **正式站已設** = `https://shop.pcmmotorsports.com`(Sean 2026-08-08 凌晨查 Vercel 後台回報,`D-211-A`)
  ⇒ prod 走第一條分支、不會落到 `undefined`。
  ⚠️ **來源紀律照舊**:這個值來自 Sean 讀 dashboard,不是 repo 可驗事實(`.env*` 在禁止清單、本機看不到);
  repo 內只有條件句(「未設會怎樣」)。日後若有人要重新確認,**去 Vercel 後台看,不要從 repo 推**。

---

## §2 稿的內容(讀完四附件後的實況)

### 2-1 兩頁五狀態

| 路由 | 稿 | 狀態 |
| --- | --- | --- |
| `/login/forgot` | `forgot-password-page.html` | **A** 填 Email(`N°01 · Reset password`)/ **B** 已寄出(`N°02 · Check your inbox`) |
| `/login/reset` | `reset-password-page.html` | **A** 設新密碼(`N°03 · New password`)/ **B** 連結失效(`Link expired`)/ **C** 完成(`Done`) |

🔴 **只做前半不行**(OD 逐字):客人收信點進來沒有著陸頁就是白畫面。**兩頁同一片。**

### 2-2 🔴 絕不可搬進真站的東西

兩支 HTML 各有 **3 處** `?state=` 預覽參數與 `<script>` 示意 JS(`grep -c` 實查)。
`?state=sent` / `?state=invalid` / `?state=done` **是原型的狀態切換器,不是真站契約** ——
真站的狀態由 recovery session 有效性與 server action 結果決定。同理 `prototype-router.js` 不搬。

### 2-3 CSS:**10 個沿用、15 個要新增**(2026-08-08 開工時機械複核更正)

🔴 **本節原寫「9 個沿用、14 個要新增」= 兩個數都錯**,漏列 `.auth-submit-ghost`(forgot 頁「沒收到?再寄一次」那顆)。
**病根=手眼盤點**;開工時改用機械 diff 重來一次才抓到:
`grep -o 'class="[^"]*"' 兩支稿 → 拆詞 → 只留 auth-/ap- → sort -u`(25 個)
`comm -23` 對 `grep -oE '\.(auth|ap)-[a-z-]+' auth.css | sort -u`(10 個)⇒ 差集 15 個。
⚠️ **教訓**:清單類斷言不要用眼睛數,能機械求差集就機械求。

**站上已有(10,直接沿用)**:`ap-mono` `ap-page` `auth-card` `auth-err` `auth-field` `auth-field-err`
`auth-foot` `auth-main` `auth-sub` `auth-submit`
(`auth.css` 另有 `auth-check` `auth-check-full` `auth-divider` `auth-forgot` `auth-row` `auth-social`
`auth-social-line` 共 7 個本片兩頁用不到 —— 其中 `auth-forgot` 是本片要修的那個死連結的 class。)

**要新增(15)**:`auth-back` `auth-eye` `auth-hint` `auth-icon-ok` `auth-icon-warn` `auth-input-wrap`
`auth-linkbtn` `auth-meter` `auth-meter-bar` `auth-meter-bars` `auth-meter-t` `auth-note` `auth-steps`
`auth-submit-ghost` `auth-submit-link`

#### (以下為原文,保留備查)

### 2-3 v2 原文:CSS:9 個沿用、14 個要新增

`auth.css` 實查既有:`.auth-card` `.auth-check` `.auth-check-full` `.auth-divider` `.auth-err`
`.auth-field` `.auth-field-err` `.auth-foot` `.auth-forgot` `.auth-main` `.auth-row` `.auth-social`
`.auth-social-line` `.auth-sub` `.auth-submit`

| 缺 | 用在 |
| --- | --- |
| `.auth-back` `.auth-hint` `.auth-note` `.auth-steps` `.auth-icon-ok` `.auth-linkbtn` | forgot 兩狀態 |
| `.auth-eye` `.auth-input-wrap` `.auth-icon-warn` `.auth-meter` `.auth-meter-bar` `.auth-meter-bars` `.auth-meter-t` `.auth-submit-link` | reset 三狀態 |

⚠️ `.auth-linkbtn` 是 OD **自己踩過坑才加的**(handoff 刻意決定 5:「換一個 Email」第一版寫成
`<a href="#">` 死連結、被 `audit-site.js` 抓到)⇒ **真站也不准用 `<a href="#">` 當按鈕**
(何況本片存在的理由就是去修一個 `<a href="#">`)。

### 2-4 三個刻意設計決定(照做、不要「優化」)

1. **重設頁不放社交登入鈕** — Google / LINE 帳號沒有 PCM 密碼可重設,放了會讓人以為點下去能救回帳號。
2. **卡片左上角「回登入」** — 密碼流程是死路,一定要留退路。
3. **強度是三段實心格、不是漸層彩條** — 彩條像血條,黃色會讓人誤以為不安全,但 8 碼就已通過規則。

---

## §3 🔴 安全面(這節才是本片的重點)

### 3-1 帳號列舉 —— 稿與我獨立盤點的結論一致

`/login/forgot` **不論 Email 存不存在都回同一畫面**。稿的字面「**如果** your@email.com 有註冊過…」
那個「如果」是刻意的。🔴 **`resetPasswordForEmail` 回什麼都走同一畫面,錯誤不得透出。**

我補兩條 OD 沒寫的:

- **Supabase 的 429 也要收斂成同一句** —— 否則節流本身變成探測管道。
- **不能靠回應時間洩漏** —— 寄信成功/失敗不得改變 server action 的回傳形狀。

### 3-2 「再寄一次」節流 —— ✅ 秒數已定

**同 Email 60 秒一次 + IP 層限制**(Sean Q24-D 照 OD 建議拍板);倒數期間鈕 disable 並顯示剩幾秒。
🔴 **倒數 UI 稿沒畫**(OD 當時在等秒數)⇒ **秒數定了,開工時要回報 OD 補畫倒數態**,走 OD 信箱。

### 3-3 token 必須在**渲染前**驗

OD 逐字:「不能讓人填完兩次新密碼才說過期,那是把人耍一輪。」
而且狀態 B **不是邊緣案例、是最常發生的**(隔天才點、點第二次、複製時斷行)。
⇒ `/login/reset` 由 **server 端先驗 recovery session**,無效直接渲染狀態 B;不是 client 端事後才判。

### 3-4 `redirectTo` 從哪來 —— ✅ A 案已批准(與稿的分歧,Sean Q24-a 依建議)

稿的接線對照寫 `resetPasswordForEmail(email, { redirectTo: '<origin>/login/reset' })` —— **直接指 `/login/reset`**。
但真站已有一支**被 codex 審過**的 `app/auth/callback/route.ts` 在做 `exchangeCodeForSession` + `sanitizeNextParam`。

| 案 | 做法 | 取捨 |
| --- | --- | --- |
| **A(建議)** | `redirectTo = <base>/auth/callback?next=/login/reset` | 沿用已審過的交換與白名單;`/login/reset` 只讀 session、不碰 code |
| B | 照稿直指 `/login/reset` | 該頁得自己做 code 交換 = **把一段安全敏感邏輯複製第二份** |

**已拍板走 A**(少寫一份、少一面攻擊面)。**A 對客人看到的東西零差異 ⇒ 不需要回 OD 改稿。**
🔴 無論哪案,`<origin>` **絕不可從 request header 組**(§1-4 那條 codex must-fix),只能來自 `resolveSiteUrl()`。

### 3-5 ✅ 兩項全數驗畢,稿上兩句可見文案**都照留**(2026-08-08 凌晨)

**① 「改完密碼,其他裝置會被登出」= 真的,稿上那句字面照留。**
主對話**親讀原始碼**(非引用 subagent 回報):`supabase/auth` repo `internal/models/user.go:455-461` 逐字 ——
`sessionID == nil → Logout(tx, u.ID)`(全踢)/ `else → LogoutAllExceptMe(tx, *sessionID, u.ID)`(踢其他)。
本片流程正好落在 else:客人點信中連結 → `exchangeCodeForSession` 建**新** session → 用它 `updateUser({password})`
⇒ **其他裝置全踢、當前這台留著**,與稿的描述一致。同函式還會 `ClearAllOneTimeTokensForUser`(recovery token 一併作廢)。
⚠️ 兩點如實記:(a) 這是讀 **master 分支**原始碼,不是對本專案實跑;(b) `supabase/auth#1579` 顯示這是**行為變更**
(回報者稱 v2.149 之前不撤銷),**確切生效版號查無 changelog 佐證 = 未確認**。
⇒ 若日後客訴「其他裝置沒被登出」,先查 hosted 版本,再考慮顯式 `signOut({ scope: 'others' })`
(該 API 存在,`scope` 三值 `global`/`local`/`others`,依據 supabase.com/docs/reference/javascript/auth-signout)。

**② 「1 小時內有效」= ✅ 成立,照留。** Sean 2026-08-08 凌晨**實讀後台**:**Email OTP expiration = 3600**(`D-213-A`)。以下為當初的查證脈絡,保留備查:
官方逐字:「a user can only request an OTP once every 60 seconds, and they expire after **1 hour**」,
且同頁明說「The Email OTP Expiration setting **also governs** … password recovery … links」
(來源 supabase.com/docs/guides/auth/auth-email-passwordless)⇒ 重設連結吃的就是這顆設定。
🔴 **但它是專案層可調的**(dashboard:**Authentication → Sign In / Providers → Email → Email OTP expiration**;
CLI 對應 `auth.email.otp_expiry`,預設 `3600`)。
⇒ **本機查不到本專案現值**,當時卡 Sean 開後台讀值 —— **已讀,= 3600 ⇒ 照留**(見本節開頭)。
⚠️ 另有一則 2022 年舊討論(`supabase/auth#6603`)聲稱雲端寫死 24 小時、不可調,**與現行官方文件矛盾**;
判為已過期、以現行文件為準,但兩者都列出備查。

---

#### (以下為 v2 原文,保留備查)

#### ⛔【已被上方取代,勿引用】3-5 v2 原文:「其他裝置會被登出」—— OD 說是 Supabase 預設,我沒有驗證

稿的 reset 狀態 A 有一句可見文案:「改完密碼之後,**其他裝置上的登入會被登出**,需要用新密碼重新登入一次。」
OD 說那是 Supabase 撤銷 session 的預設行為。

⚠️ **這是別人給的外部事實,我沒有親驗**(要 Supabase 專案/後台才驗得到)。
**若實際不撤銷,這句就是對客人說謊。** ⇒ **開工前的驗證項,不是可以拿來相信的前提。**
兩條出路:①實測為真 → 字面照留;②實測為否 → 要嘛我們顯式撤銷(`signOut({ scope: 'others' })`)、
要嘛回 OD 拿掉那句(OD 信裡自己交代了這條退路)。

同理:**「1 小時內有效」也是 Supabase 預設值**(稿的 forgot 狀態 B 與 reset 狀態 B 都寫死這個數字),
若後台調過要回 OD 改字面。**一併實測、不憑轉述。**

### 3-6 LINE 合成帳號

`field-validation.ts:51` 逐字:「LINE OAuth 用合成 email `line_{sub}@此域`、不可被一般 email/password 註冊佔用」。
⇒ 對合成 email 送重設信會寄到不存在的信箱,而且那是不該有密碼的帳號。
**特判會洩漏「這是 LINE 帳號」、與 §3-1 衝突** ⇒ 建議**不特判、統一回應**。
稿在 forgot 狀態 A 已有對應文案(「用 Google 或 LINE 註冊的話沒有密碼可以重設 —— 直接回登入頁…」),
那是**事前說明**、不是事後判定 ⇒ 與不特判相容。

### 3-7 寄信管道

站上有自己的 email 基礎設施(`lib/email/composition.ts` 等),但本片**是 Supabase 寄信、不走那條**。
⇒ ①Supabase 專案 SMTP 是否已接自有寄件網域(預設 SMTP 額度嚴、不適合正式站)
②重設信模板文案 **OD 沒設計**(明說不在 HTML 稿範圍,要的話可再出一份)。兩者見 §5。

---

## §4 拍板結果(Sean 2026-08-07 深夜 Q24,信箱 `D-207-A`)

| 題 | 結果 | 連動 |
| --- | --- | --- |
| **A. plan 是否批准** | ✅ **批准**(含 §3-4 A 案沿用 `/auth/callback`、§6 不拆片,全照本檔) | 開工前提之一達成 |
| **B. `NEXT_PUBLIC_SITE_URL` 正式站設了沒** | ✅ **已設**,值 = `https://shop.pcmmotorsports.com`(Sean 2026-08-08 凌晨查 Vercel 回報,信箱 `D-211-A`) | **開工阻斷解除**;重設信絕對網址組得出來 |
| **C. `/login/reset` 完成後導去哪** | ✅ **導回登入頁**(照稿狀態 C 的「前往登入」) | 無 |
| **D. 「再寄一次」冷卻秒數** | ✅ **60 秒 + IP 層** | 🔴 **要回報 OD 補畫倒數態**(秒數定了他才畫得出);走 OD 信箱、排開工時 |
| **E. 兩句新錯誤字面** | ✅ **照稿用**:「請再輸入一次密碼」/「兩次輸入的密碼不一樣」 | 併進 `field-validation.ts` 既有那份、不寫第二套 |

⚠️ **v1 的「改完要不要踢其他裝置」不在本表** —— 它不是選擇題,是 §3-5 的**驗證項**,見下。

## §4a 🔴 開工前置檢查表(三類全綠才動手)

- [x] **§4-B** `NEXT_PUBLIC_SITE_URL` = `https://shop.pcmmotorsports.com`(Sean 2026-08-08 凌晨查 Vercel,`D-211-A`)
- [x] **§5** 四條 dashboard 動作(Sean 2026-08-08 凌晨回報,`D-211-A`)—— **兩條達成、兩條判定不擋開工**,逐條見 §5
- [x] **§3-5 ①** 改密碼是否真的撤銷其他 session —— ✅ **是**,主對話親讀 `supabase/auth` 原始碼確認,稿上那句照留(詳 §3-5)
- [x] **§3-5 ②** recovery link 是否真的 1 小時 —— ✅ **是**。Sean 2026-08-08 凌晨**實讀後台**:
      **Email OTP expiration = 3600**(位置:Authentication → Sign In / Providers → Email;信箱 `D-213-A`)
      ⇒ 稿上「1 小時內有效」**照留**。⚠️ 來源=Sean 讀 dashboard,非 repo 可驗事實;日後重新確認要回後台看。

✅ **三類全綠,已開工(2026-08-08 凌晨)。**

## §5 外部硬前置(Sean 的 dashboard 動作,我做不了)

**全數已回(Sean 2026-08-08 凌晨,信箱 `D-211-A`):**

- [x] Supabase:Redirect URL allow-list —— `https://shop.pcmmotorsports.com/auth/callback` **已在清單** ⇒ §3-4 A 案路徑暢通
- [x] Vercel:`NEXT_PUBLIC_SITE_URL` —— **已設** `https://shop.pcmmotorsports.com`(同 §4-B)
- [x] Supabase:重設信模板文案 —— 現為**預設英文**;Sean 拍板要中文,已向 OD 要文案(OD 稿 §八自己提議過)。**不擋開工**:英文模板先能動,文案到了 Sean 貼進後台。⚠️ 這代表**上線前有一個文案停點**,不是本片內就完結。
- [x] Supabase:SMTP —— **關**,用 Supabase 預設寄件。Sean 說可以開。**不擋開工,但 🔴🔴 它擋「上線」** —— 見下。

### 🔴🔴 §5-1 SMTP 那條的嚴重度,比原本寫的「額度嚴、容易進垃圾桶」高一個量級(2026-08-08 開工後查到)

官方文件逐字(主對話**親自**向 `https://supabase.com/docs/guides/auth/rate-limits` 核對,非引用 subagent):

> Endpoints that trigger email sends(`/auth/v1/signup` `/auth/v1/recover` `/auth/v1/user`)
> Limited By:**Sum of combined requests project-wide**
> Limit:**"2 emails per hour with the built-in email provider. You can only change this with a custom SMTP setup."**

⇒ **整站每小時只能寄 2 封重設信**,且與註冊確認信**共用**額度。

🔴 **為什麼這不只是「慢」**:§3-1 要求「不論成敗都回同一畫面」、429 也必須收斂
⇒ **第 3 個客人會看到「信寄出去了」,而信根本沒寄**。他會去翻垃圾桶、等一小時,然後認定這功能是壞的。
⚠️ **而且分不出來**:per-user 60 秒冷卻與 project 層 2/hr **都回 429 + 同一個 `over_email_send_rate_limit`**;
而 per-user 429 本身**會洩漏帳號存在**(只有存在的帳號才會被冷卻)⇒ 依 §3-1 必須收斂
⇒ **沒有辦法只把「系統額度滿了」這種對客人無害的情況挑出來另外講**。

**已排 Sean(Q26,信箱 `D-297-STOP` / `D-216-A` 2.)**,三選項:A 先接自訂 SMTP 再對客人開放(推薦)/
B 照上、接受每小時 2 人 / C 做完擺著等 SMTP。**在他拍板前,`/login` 的入口連結雖已接上,是否對外開放由他決定。**

### §5-2 節流:Sean 要的「IP 層」Supabase 沒有,且現在做沒有意義

| 層 | 實況(官方 rate-limits 頁逐列核對) |
|---|---|
| 同 Email 60 秒 | ✅ **Supabase 內建**(`/auth/v1/recover`「Last request of the user」、預設 60 秒、可調)⇒ 本片只做 **UI 倒數 + 429 收斂**,不自建 |
| per-IP | 🔴 **查無** —— 官方 IP-based 限流只涵蓋 `/auth/v1/verify`、`/token`、MFA、匿名註冊四條,**`/auth/v1/recover` 不在內** |

⇒ 真要 IP 層得自建(edge middleware / KV)。**但在 §5-1 解決前它被更緊的閘遮蔽**(2/hr project-wide 遠比任何 IP 節流緊)
⇒ **本片刻意不做、排到「接了自訂 SMTP 之後」**。這是判斷、不是漏掉。
⚠️ **一則需要更正的轉述**:實作 subagent 回報時寫「IP 層本來就是 Supabase 側 `over_request_rate_limit` 已兜底」——
**那句是錯的**(`/auth/v1/recover` 沒有 per-IP)。該句**沒有進 code**,僅存在於回報中,在此更正備查。

## §8 施工結果(2026-08-08 凌晨;🔴 **尚未 commit**,原因見 §8-3)

### 8-1 落地了什麼(**27 檔** dirty,ownership = site-redesign 窗)

⚠️ **檔數更正**(對抗審查 R1 nit;本欄原寫 24、我 STOP 一度寫 22,**兩個都錯**):
`git status --porcelain` 是 **22 行**,但其中兩行是**被摺疊的未追蹤目錄**(`app/login/forgot/`、`app/login/reset/`);
`git status --porcelain -uall` 展開才是 **27 檔**。
**病根 = 量錯東西**:我拿 `wc -l` 數「行數」卻叫它「檔數」。要數檔就用 `-uall`。

| 層 | 檔 |
|---|---|
| port | `IAuthService.ts` +`sendPasswordResetEmail` / `updatePassword`(純加法) |
| adapter | `SupabaseAuthAdapter.ts` 兩個薄包;`mappers/auth-error.ts` +3 code、`domain/identity/auth.ts` +2 union 成員(皆純加法、既有分支零改動)|
| use-case | `request-password-reset.ts` / `reset-password.ts` |
| 驗證 | `field-validation.ts` +`validateForgot` / `validateResetPassword`(重用 `LoginInput.shape.{email,password}`,不另寫 regex/min)|
| 頁 | `app/login/forgot/{page,actions}.ts(x)`、`app/login/reset/{page,actions}.ts(x)`、`components/{Forgot,Reset}PasswordPage.tsx` |
| CSS | `auth.css` 末段 15 個 class **逐字直接搬** OD `pcm-auth.css:84-197`(接上時 `diff` 驗 byte-identical、既有 309 行零改動)|
| 死連結 | ⛔ **已做又撤回,不在本片** —— 見 §8-6 |

四綠 exit=0(typecheck+lint 18/18、build 2/2,皆 0 cached);全套 **386 檔 / 5650 綠 / 1 todo**(基準 378/5582/1)。
⚠️ 撤回入口連結後由 5651 掉到 5650(正好是被撤掉的那 1 條 smoke test),數字對得上。
`build` 輸出實見 `ƒ /login/forgot`、`ƒ /login/reset`。

### 8-2 對稿的偏離(逐條申報)

1. **60 秒冷卻的倒數態 = 本片自訂,稿沒畫**(OD 當時在等秒數)。沿用同一顆 `.auth-submit-ghost`、
   文字動態換成「沒收到？再寄一次（NN 秒）」,倒數完回復原字面。**待 OD 補圖後對齊**;code 內同址已註明。
2. **兩支 `<form>` 補 `noValidate`**(稿的 HTML 本來就有 `novalidate`,第一版漏抄)——**不補會讓自訂逐欄驗證整條跑不到**,見 §8-4。
3. **內部導覽改用 `next/link`**(對齊 `LoginPage.tsx` 既有 adaptation 慣例,非逐字保留 `<a href>`)。
4. **狀態 B(連結失效)沒有拆成獨立元件**:純靜態 markup、無互動,直接寫在 `app/login/reset/page.tsx` 的 server 分支。
5. **IP 層節流未做** —— 判斷,非漏掉,理由見 §5-2。

### 8-3 🔴 為什麼還沒 commit

本片 = **鐵則 12 ② auth = 高風險,對抗審查不降級**。codex 目前是**免費帳號、額度鎖到 9/5**
(主視窗親測讀檔階段即撞牆);而「auth 片能不能用 Fable 代 codex」**Sean 尚未裁定**
(主視窗明說 Part B 的 fable 前例**不自動沿用**到 auth 片)。
⇒ 產出全部留在工作樹,**ownership = 本窗、不是無主 dirty**。

### 8-4 🔴 順帶查到的既有 bug(非本片造成、**未修**、已轉 Sean)

**`/login` 與 `/register` 的表單缺 `noValidate`,而 Email 欄是 `type="email"`**
(`LoginPage.tsx:112` / `RegisterPage.tsx:69`;`type="email"` 在 `:118` / `:84`)
⇒ 瀏覽器原生驗證會先擋掉 submit,**#181 Sean 釘死的逐欄「Email 格式不正確」在真瀏覽器從來沒顯示過**。
單元測試看不到,因為 **jsdom 不跑 constraint validation**。

**這條是真瀏覽器實測、不是推論**(dev server + Playwright,正負對照):

| 同樣輸入 `not-an-email` | 結果 |
|---|---|
| `/login/forgot`(有 `noValidate`) | 「Email 格式不正確」**有出現**(可及名稱 + 欄位錯誤元素兩處) |
| `/login`(無 `noValidate`) | **完全沒有**,Email 欄變 `[active]`(=原生驗證聚焦第一個不合格欄位) |

唯一差別就是那個屬性 ⇒ 因果確立。**未修**:動登入/註冊表單超出本片範圍、且它自己要走一輪審查。

### 8-5 驗證缺口(如實列,交 Sean 肉眼驗)

- `/login/reset` 的**三個狀態都沒有真瀏覽器證據**:本 worktree 無 `NEXT_PUBLIC_SUPABASE_URL`,
  `createServerSupabaseClient()` 在 `getUser()` **之前**就丟 ⇒ 該路由本機恆 500(**本機 env 缺,不是「沒 session 就 500」**;
  正式站 env 已設,走的是 `getUser()` 回 `user: null` → 狀態 B,該路徑目前只有 mock 單元測試蓋著)。
- `/login/forgot` 狀態 A 已真瀏覽器渲染(HTTP 200 + 逐欄錯實測);**狀態 B(已寄出)與 60 秒倒數未在真瀏覽器走過**(需要真的寄出一封信)。
- 兩頁的**視覺**(間距/字級/RWD)全部未肉眼驗。

### 8-6 ⛔ 入口連結**已做又撤回**,拆成收尾小片(Sean Q26=A 的連動,`D-217-A`)

Sean 拍 **Q26=A**:先接自訂 SMTP(公司是 **Google Workspace 網域**,走 `smtp.gmail.com` + 應用程式密碼,
每日數千封 ⇒ §5-1 的 2/hr 問題根治),接好才對客人開放。

⇒ 主視窗指示把「`/login` 入口接線」拆成**收尾小片**。我原本已經做完並實測過(真瀏覽器見過
`<a class="auth-forgot" href="/login/forgot">`),**依指示 `git checkout --` 撤回**了
`LoginPage.tsx` 與 `LoginPage.test.tsx`,回到 `<a href="#">` 原狀。
**理由成立**:SMTP 沒好之前把入口露出來,等於讓客人摸到一個會靜默失敗的功能 —— 正是 §5-1 要避免的那件事。

**收尾小片的內容(交接用,前置=Sean 設好 SMTP + 實際寄一封測試信收到)**:

1. `LoginPage.tsx:144` `<a href="#" className="auth-forgot">忘記密碼？</a>` → `<Link href="/login/forgot" className="auth-forgot">`
2. 同檔 `:15` 那句「維持 design `<a href="#">`(該流程不在 f1 scope)」= **過期註解,同 commit 更新**
3. `LoginPage.test.tsx` 補一條 smoke:連結指向 `/login/forgot` 且**不是** `href="#"`(突變=改回 `#` 必須紅)
4. ⚠️ 順帶可一併評估 §8-4 那條 `noValidate` 既有 bug(同檔、同一輪審查較省)

⚠️ **§5-1 那條「畫面說謊」的因果鏈在 SMTP 接上後消解**(Gmail 額度下 project 層 429 幾乎不可構造),
但 **429 收斂的程式照 §3-1 保留、不因此省** —— 防帳號列舉本來就需要它,那與額度無關。

⚠️ **本 §8 排在 §6 之前**,是為了 append 安全(不動既有編號、不製造交叉引用過期);閱讀順序 §5 → §8 → §6 → §7。

### 8-7 對抗審查 R1(Fable,Sean Q29=A 裁定用 Fable 代 codex)—— **PASS-with-comments,0 must-fix**

依輪次紀律 R1 PASS(含 nit)⇒ **不跑 R2**,nit 順手清完 commit。codex 恢復後補跑背書(同 Part B 模式)。

**審查者實際驗過並確認屬實的**(不是背書、是他自己跑的):CSS 那段與 OD 稿 `diff` **byte-identical**;
稿 25 個 class 全部有樣式、兩支 `.tsx` 沒用到不存在的 class、搬進的 15 個全被用到(無死樣式);
3 個新 error code 在 `@supabase/auth-js@2.105.3` 實存;§8-5 驗證缺口自述**未高估亦未低估**。

**已修的 nit**:

1. `reset/actions.ts` 的 `authErrorCopy` 缺 `password_too_weak` ⇒ 專案密碼政策比 client 的 ≥8 更嚴時,
   客人只看到「請稍後再試」——**那句是錯的,再試一百次也不會過**。已補專屬字面。
2. `ForgotPasswordPage` 沒接住 action 的 `throw`(站台設定錯誤那條刻意例外)⇒ `setPending(false)` 不執行、
   **鈕永久卡 disabled、畫面停在轉圈**。已補 `try/catch/finally` + 頂部 `.auth-err` 通道
   (🔴 **那個通道稿本來就有**〔`<div class="auth-err" id="form-error" hidden>`〕,是第一版漏搬)。
   新字面 `系統暫時無法寄出重設信，請稍後聯絡客服` **刻意不寫「請稍後再試」**——設定沒改前再試都一樣。
   兩條回歸測試 + 兩個突變釘住;**M2 特別重要**:只拿掉 early return(保留錯誤顯示)⇒ 客人會**同時**
   看到錯誤與「已經再寄一次了」= 對客人說謊,測試抓得到。
3. §8-1 檔數 24 → **27**(見該節更正)。

**未修、記錄在案的**:

- **consider:`/login/reset` 不區分 recovery session 與一般登入 session**。`page.tsx:26-30` 只驗「有無任一有效 user」,
  ⇒ 任何已登入者到 `/login/reset` 都拿得到改密碼表單、不需輸舊密碼。
  **與本檔 §3-3 的口徑有落差**(§3-3 寫「驗 recovery session」,實作是「驗有無 session」)。
  可達性低(入口已撤回、登入區無任何連結指向它),且 Supabase `updateUser` 預設本就不要求 reauth
  ⇒ **審查者判非 must-fix**。**但字面要對齊事實**:本片實作的是「有 session 才給表單」,不是「只有 recovery session 才給」。
  要收緊得靠 session 的 AMR/驗證方法判別 —— 那需要另外查證,**不在本片猜著做**,轉 Sean 決定要不要排。
- **nit:60 秒倒數是 client 端的,伺服器冷卻才是真源。** 客人重整頁面 ⇒ state 重置、倒數消失、可立即再送;
  此時若伺服器 429,依 §3-1 會被靜默吞、畫面仍顯示「已經再寄一次了」。**安全上可接受**(防列舉優先),
  但**那句話那時不是事實**。稿的字面照留(鐵則 1),在此如實記錄。
  ⚠️ 接了自訂 SMTP 之後 project 層 2/hr 消失,只剩 per-user 60 秒;而正常路徑有倒數擋著,
  要撞到只能靠「重整後立刻再送」⇒ 窄,但不是零。

## §6 片界 —— ✅ 不拆已批准

**不拆、一片做完**。兩頁互為前提(只做前半=白畫面),拆點會落在「使用者收信之後」這條動線上、
拆了會產生一個不可驗的中間態。體積超過鐵則 4 的 45 分鐘是必然,**寧可一片長,不切在動線中間**。
(Q24-a 已批「不拆」。備選拆點留檔備查:若日後真要拆,拆點是**「後端(port/adapter/use-case/action)」與「兩頁 UI」**,
而不是「forgot 一片、reset 一片」。)

## §7 收工銷帳

memory `project_m4b-admin-preview-decisions` 記的「前台忘記密碼死連結=後台寄信鈕硬前置」,本片是它的解。

---

**已批准(Q24-a)、未開工(卡 §4a 三類前置)、零程式碼改動。** — site-redesign 窗,2026-08-07
