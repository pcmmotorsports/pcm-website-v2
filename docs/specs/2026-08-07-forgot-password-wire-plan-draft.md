# 忘記密碼接線片 · plan v2(2026-08-07,site-redesign 窗)

> **狀態:草稿 v2、未批准。** 高風險片(鐵則 12 ② auth),對抗審查不降級。
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
  ⚠️ **正式站設了沒 = 未確認**(Vercel 後台的值,`.env*` 在禁止清單、本機看不到)。
  repo 內只有條件句(「未設會怎樣」),**不是「現在未設」**,不可當事實引用。見 §4-A。

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

### 2-3 CSS:9 個沿用、**14 個要新增**

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

### 3-2 「再寄一次」節流(稿等我們給數字)

OD 建議:**同 Email 60 秒一次 + IP 層限制**;倒數期間鈕 disable 並顯示剩幾秒。
🔴 **倒數 UI 稿沒畫** —— 因為秒數要我們先定。⇒ §4-C。

### 3-3 token 必須在**渲染前**驗

OD 逐字:「不能讓人填完兩次新密碼才說過期,那是把人耍一輪。」
而且狀態 B **不是邊緣案例、是最常發生的**(隔天才點、點第二次、複製時斷行)。
⇒ `/login/reset` 由 **server 端先驗 recovery session**,無效直接渲染狀態 B;不是 client 端事後才判。

### 3-4 `redirectTo` 從哪來 —— 🔴 我與稿有一處分歧,要決定

稿的接線對照寫 `resetPasswordForEmail(email, { redirectTo: '<origin>/login/reset' })` —— **直接指 `/login/reset`**。
但真站已有一支**被 codex 審過**的 `app/auth/callback/route.ts` 在做 `exchangeCodeForSession` + `sanitizeNextParam`。

| 案 | 做法 | 取捨 |
| --- | --- | --- |
| **A(建議)** | `redirectTo = <base>/auth/callback?next=/login/reset` | 沿用已審過的交換與白名單;`/login/reset` 只讀 session、不碰 code |
| B | 照稿直指 `/login/reset` | 該頁得自己做 code 交換 = **把一段安全敏感邏輯複製第二份** |

**推薦 A**(少寫一份、少一面攻擊面)。**A 對客人看到的東西零差異 ⇒ 不需要回 OD 改稿。**
🔴 無論哪案,`<origin>` **絕不可從 request header 組**(§1-4 那條 codex must-fix),只能來自 `resolveSiteUrl()`。

### 3-5 🔴 「其他裝置會被登出」這句 —— **OD 說是 Supabase 預設,我沒有驗證**

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

## §4 待決題(plan 批准後一次批次問 Sean)

- **A. `NEXT_PUBLIC_SITE_URL` 正式站設了沒?** 沒設 → 重設信連結組不出絕對網址,本片直接卡住。
- **B. `/login/reset` 完成後導去哪?** 稿的狀態 C 是「前往登入」⇒ 預設照稿;確認即可。
- **C. 節流秒數?** OD 建議 60 秒 + IP 層。定了 OD 才畫得出倒數 UI。
- **D. 兩句新錯誤字面**(註冊頁沒有確認密碼欄、沒有現成的):
  「請再輸入一次密碼」/「兩次輸入的密碼不一樣」—— 稿已擬,確認即可。

⚠️ **v1 的「改完要不要踢其他裝置」已從待決題移除** —— 它不是選擇題,是 §3-5 的**驗證項**。

## §5 外部硬前置(Sean 的 dashboard 動作,我做不了)

- [ ] Supabase:Redirect URL allow-list 加 `/auth/callback`(§3-4 A 案)
- [ ] Supabase:重設信模板文案(OD 未設計,§3-7)
- [ ] Supabase:SMTP 是否已接自有寄件網域(§3-7)
- [ ] Vercel:`NEXT_PUBLIC_SITE_URL`(§4-A)

## §6 片界建議

**不拆、一片做完**。兩頁互為前提(只做前半=白畫面),拆點會落在「使用者收信之後」這條動線上、
拆了會產生一個不可驗的中間態。體積超過鐵則 4 的 45 分鐘是必然,**寧可一片長,不切在動線中間**。
若 Sean 批准時要求拆,建議拆點 = **「後端(port/adapter/use-case/action)」與「兩頁 UI」**,
而不是「forgot 一片、reset 一片」。

## §7 收工銷帳

memory `project_m4b-admin-preview-decisions` 記的「前台忘記密碼死連結=後台寄信鈕硬前置」,本片是它的解。

---

**未批准、未開工、零程式碼改動。** — site-redesign 窗,2026-08-07
