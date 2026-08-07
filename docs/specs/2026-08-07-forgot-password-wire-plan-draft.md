# 忘記密碼接線片 · plan 草稿(2026-08-07,site-redesign 窗)

> **狀態:草稿、未批准。** 高風險片(鐵則 12 ② auth),對抗審查不降級。
> **🔴 一半的資訊拿不到**:OD 出的兩頁稿(`/login/forgot` + `/login/reset`、三個狀態)在 OD 信箱
> `outbox/2026-08-07-忘記密碼流程-出稿請接起來.md`(18:18 出稿)。
> 本機 `find` 找不到那個 `outbox/`,Open Design MCP `list_projects` 回**空陣列** ⇒ **我沒讀到稿**。
> ⇒ 本檔**只寫站上現況與安全面**(不依賴稿),版面/文案/狀態機字面一律留白待稿。
>
> 依據:`D-195-A`(排隊尾)、`D-200-A`(Q22=A 後的下一片)、`D-202-A` 6.(可先做唯讀偵察+plan 草稿)。

---

## §1 現況實查(全部附 `檔案:行號`,我親自開檔)

### 1-1 死連結本體

- `apps/storefront/src/components/LoginPage.tsx:144`
  `<a href="#" className="auth-forgot">忘記密碼？</a>`
- 同檔 `:15` 註解逐字:「忘記密碼?維持 design `<a href="#">`(該流程不在 f1 scope)。」
  ⇒ **它是有意留的坑,不是漏做**;本片就是來填的。

### 1-2 路由現況:兩頁都不存在

`apps/storefront/src/app/login/` 只有 `page.tsx` / `actions.ts` / `actions.test.ts`。
**`/login/forgot` 與 `/login/reset` 都要新建。**

### 1-3 認證架構(ports / adapters,不能繞)

| 層 | 檔 | 現況 |
|---|---|---|
| port | `packages/ports/src/IAuthService.ts:24-28` | **只有 3 個方法**:`signUp` / `signInWithPassword` / `signOut`。**沒有任何密碼重設** |
| adapter | `packages/adapters/src/supabase/SupabaseAuthAdapter.ts:39/61/80` | 對應那 3 個 |
| use-case | `packages/use-cases/src/{register,login,logout}-customer.ts` | 同上 |
| composition | `apps/storefront/src/lib/auth/composition.ts` | 🔴 **全 storefront 唯一准 import `@pcm/adapters/server` 的檔**(eslint `no-restricted-imports` 擋整個 `apps/storefront/**`,此檔以 inline disable 開受控小門) |

⇒ **本片必然是「port + adapter + use-case + server action + 2 頁」的縱切**,不是加兩個頁面而已。
⇒ **跨 3+ 檔 + 動 port 介面 ⇒ 鐵則 8 必提 plan(本檔)+ 鐵則 12 ② 必跑 codex。**

### 1-4 可直接沿用的既有零件(不要重造)

- `apps/storefront/src/lib/auth/safe-redirect.ts` — `sanitizeNextParam()` 同源白名單。
  既有 sink:`app/auth/callback/route.ts:33`。
- `app/auth/callback/route.ts` — 已在做 `exchangeCodeForSession` + 相對路徑 redirect。
  檔頭 `:9-12` 記著一條 **codex 關卡2 的 must-fix 教訓**:
  「redirect 用 `next/navigation` redirect() + **相對路徑**(非 `NextResponse.redirect` + request origin)
  —— 避免從請求 host 組絕對 URL 的 **host-header open-redirect**」。**本片重設連結的落地點必須遵守同一條。**
- `apps/storefront/src/lib/auth/field-validation.ts:93` — 逐欄錯雙通道(`fieldErrors` / `formError`)、
  密碼規則現為 **≥8 碼**(`:75`/`:115` 註解)。重設表單沿用同一份、不寫第二套規則。
- `apps/storefront/src/lib/site-url.ts:6-10` — `resolveSiteUrl()`:設了 `NEXT_PUBLIC_SITE_URL` 就用它;
  未設且非 production → `http://localhost:3000`;**未設且 production → 回 `undefined`**。
  ⚠️ **正式站到底設了沒 = 未確認**:那是 Vercel 後台的值,本機看不到(`.env*` 在禁止清單裡)。
  repo 內只有兩處**條件句**(`lib/site-url.ts:11-18` 說「Sean 在 Vercel 後台設」、`lib/seo.ts:7-11` 說
  「未設 → robots 全擋」)—— **那是「未設會怎樣」,不是「現在未設」**,不可當事實引用。
  **這會直接決定重設信連結的絕對網址,開工前必須先問 Sean 實際值**,見 §3-1。

---

## §2 建議做法(待批)

**用 Supabase 內建 `resetPasswordForEmail` + `updateUser`,不自建 token。**

理由:自建 token 要自己處理產生/雜湊/存放/過期/一次性/時序比對,那是一整面新的攻擊面;
Supabase 那條是官方支援路徑、token 不落我們的 DB。**這是「少寫 code」與「少攻擊面」同向的少數情形。**

流程:

1. `/login/forgot` — 輸入 Email → server action → `auth.resetPasswordForEmail(email, { redirectTo })`。
2. 客人收信點連結 → 落在 **既有** `app/auth/callback/route.ts`(帶 `?next=/login/reset`)
   → `exchangeCodeForSession` 換到 **recovery session** → redirect `/login/reset`。
3. `/login/reset` — 已有 recovery session 才可進 → 輸入新密碼 → `auth.updateUser({ password })` → 導回登入或首頁。

port 擴充(**兩個方法,不多加**):

```ts
requestPasswordReset(email: string, redirectTo: string): Promise<void>
updatePassword(newPassword: string): Promise<void>
```

---

## §3 🔴 安全面:必須在實作前決定的事(這節才是本片的重點)

### 3-1 重設信裡的網址從哪來

`redirectTo` 必須是**絕對網址**。可選來源:

(a) `NEXT_PUBLIC_SITE_URL` — ⚠️ **正式站設了沒 = 未確認**(Vercel 後台的值,本機看不到;repo 內只有條件句,見 §1-4)。**開工前先問 Sean。**
(b) 從 request header 組 — 🔴 **明文禁止**,`auth/callback/route.ts:9-12` 那條 codex must-fix 就是這個。
(c) Supabase dashboard 的 Site URL + Redirect allow-list。

⇒ **(a)+(c) 兩邊都要**:app 側用 env 組、Supabase 側把 `/auth/callback` 加進 allow-list
(否則 Supabase 會退回它自己的 Site URL,連結指向錯的站)。
**(c) 是 Sean 的 dashboard 動作、我做不了。** 這是本片的**外部硬前置**。

### 3-2 帳號列舉(user enumeration)

`/login/forgot` **不論 Email 存不存在都必須回同一句、同一個狀態**,
否則這頁就是一支「這個 Email 有沒有註冊」的查詢 API。
⇒ 成功文案固定為「**若這個 Email 有帳號,我們已寄出重設信**」這一類措辭(實際字面等 OD 稿)。
⚠️ **也不能靠回應時間洩漏**:寄信成功/失敗都不要改變 server action 的回傳形狀。

### 3-3 節流

Supabase 對同一 Email 有內建寄信頻率限制,但**那不是我們的節流**:
連打會拿到 Supabase 的 429 → 若我們把它照實回給前端,又變成一支列舉/探測管道。
⇒ 429 也要收斂成 §3-2 那句同一個成功文案。是否要另加 app 層節流(如 `lib/cron/rate-limit.ts` 那類)= **待決**。

### 3-4 recovery session 的權限邊界

拿到 recovery session 的人**就已經是登入狀態**。要決定:
- `/login/reset` 是否只接受「recovery 來源」的 session,還是任何 session 都能改密碼?
- 改完密碼要不要**踢掉其他所有 session**(Supabase `signOut({ scope: 'others' })`)?
  ⇒ 忘記密碼的常見情境就是「帳號可能被別人拿到」,不踢等於重設了也沒趕走人。**我傾向要踢,但這要 Sean 拍。**

### 3-5 LINE 合成帳號

`field-validation.ts:51` 逐字:「LINE OAuth 用合成 email `line_{sub}@此域`、不可被一般 email/password 註冊佔用」。
⇒ **對合成 email 送重設信會寄到一個不存在的信箱**,而且它是不該有密碼的帳號。
`/login/forgot` 要不要擋這個網域?**擋的話又會洩漏「這是 LINE 帳號」** ⇒ 與 §3-2 衝突。
建議:**不特判、照 §3-2 統一回應**(寄不到就是寄不到),但這條要寫進紀錄、不要當沒看到。

### 3-6 寄信管道

站上已有自己的 email 基礎設施(`apps/storefront/src/lib/email/composition.ts`、
`packages/adapters/src/payment/EmailAlertNotifierAdapter.ts`、`api/cron/email-sweep`)。
但 §2 的做法**是 Supabase 寄信、不走我們這條**。
⇒ 兩件事要確認:①Supabase 專案的 SMTP 是否已接自有寄件網域(預設 SMTP 有嚴格額度、不適合正式站)
②重設信的模板文案在 Supabase dashboard 設定 = **又一個 Sean 的 dashboard 動作**。

---

## §4 待決清單(要問 Sean 的)

1. 改完密碼要不要踢掉其他裝置的登入?(§3-4)
2. `/login/reset` 完成後導去哪:登入頁重新登入、還是直接進會員中心?
3. 要不要加 app 層節流?(§3-3)

## §5 外部硬前置(不是我能做的)

- [ ] Supabase dashboard:Redirect URL allow-list 加 `/auth/callback`(§3-1)
- [ ] Supabase dashboard:重設信模板文案(§3-6)
- [ ] Supabase 專案 SMTP 是否已接自有網域(§3-6)
- [ ] Vercel:`NEXT_PUBLIC_SITE_URL` 設正式網域(§3-1;`lib/site-url.ts:6` 已備好讀取)

## §6 本檔還缺什麼

- **OD 兩頁稿的字面**(版面 / 文案 / 三個狀態分別是什麼)—— 拿不到,見檔頭。
- 有了稿才寫得出:片界怎麼切、要不要拆成兩片、測試矩陣、突變設計。
- ⚠️ **收工時要銷帳**:memory `project_m4b-admin-preview-decisions` 記的
  「前台忘記密碼死連結=後台寄信鈕硬前置」,本片是它的解。

---

**未批准、未開工、零程式碼改動。** — site-redesign 窗,2026-08-07
