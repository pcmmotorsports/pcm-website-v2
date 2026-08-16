# storefront 對外曝露面**盤點**（第一輪：只盤點，不獵洞）

- **窗**：E（安全稽核）　**日期**：2026-08-16　**目標**：`apps/storefront`
- **為什麼現在做**：Sean 把「網站前台」列進**最終滲透測試**範圍，而**今晚三份報告的範圍全部是後台 + DB，前台幾乎沒碰**。
  滲透測試是**建置完成之後**的階段，**但盤點現在就能做** ⇒ **那階段一到，交出去的是一份地圖，不是一張白紙。**
- 🔴 **本輪【不獵洞】**。獵洞是那個階段的事。本輪只回答「**有哪些門、各自吃什麼、誰在守**」。

---

## 0. 量法（可重跑，附 commit）

```
commit  : 27cb1fe9
入口     : find apps/storefront/src/app -name 'route.ts'
action   : 檔案【第一個非空行】是 'use server' 指令（排除「註解裡提到」的假命中）
身分     : grep -c 'getUser()'
共用面   : 比對 storefront 與 admin 各自 import 的 @pcm/* 集合（comm -12）
```

⚠️ **`'use server'` 一定要用「第一個非空行」判定**：直接 `grep -l` 會把
**註解裡提到那個字串的檔**算進來（admin 那邊實測多算 2 個）。

---

## 1. 對外入口總表

| 類 | 數 |
|---|---|
| **Route handler**（HTTP 端點） | **9** |
| **Server action 指令檔** | **11** |

### 1.1 九個 route handler，依「誰能打」分類

| 端點 | 誰能打 | 守什麼 |
|---|---|---|
| `/api/catalog/facet-counts` | 🌐 **任何人** | 公開型錄計數 |
| `/api/auth/line/start`、`/api/auth/line/callback` | 🌐 任何人（登入流程本體） | state／nonce + 單一 redirect 點 |
| `/auth/callback` | 🌐 任何人（登入流程本體） | `sanitizeNextParam` |
| `/api/checkout/tappay-notify/[secret]` | 🌐 任何人**知道祕密路徑段**才打得到 | 祕密段 + `timingSafeEqual` + 不符回 404 |
| `/api/orders/[orderId]/payment-status` | 🔒 已登入 | `getUser()` + RLS + 應用層 `.eq(customer_user_id)` 雙軸 |
| `/api/cron/settle-sweep`、`/api/cron/email-sweep`、`/api/cron/anomaly-alert` | 🔑 持 `CRON_SECRET` | Bearer + `timingSafeEqual` |

### 1.2 十一個 server action 檔 —— **storefront 沒有 middleware，每個入口自己守**

> 🔴 這是與 admin 最大的結構差異：**admin 有 `proxy.ts` 統一擋，storefront 沒有。**
> ⇒ **「有沒有取身分」必須逐檔看，不能靠一個共同閘。**

| 檔 | actions | `getUser()` | 判讀 |
|---|---|---|---|
| `account/address/actions.ts` | 3 | 3 | ✅ |
| `account/vehicle/actions.ts` | 3 | 3 | ✅ |
| `account/profile/actions.ts` | 1 | 1 | ✅ |
| `checkout/charge-actions.ts` | 1 | 1 | ✅ |
| `checkout/reconcile-actions.ts` | 1 | 1 | ✅ |
| `login/actions.ts`、`login/forgot`、`login/reset`、`register/actions.ts` | 各 1 | **0** | ✅ **登入前流程，本來就不能要求 session** |
| `account/actions.ts` | 1 | **0** | ✅ **只有 `logoutAction`**（清 session + redirect），**登出不需要先證明自己是誰** |
| 🔍 `cart/actions.ts` | 1 | **0** | **刻意公開** —— 見 §2 |

⇒ **11 個檔裡，「沒有取身分」的 6 個【全部】有正當理由，沒有一個是漏的。**

---

## 2. 🔍 `cart/actions.ts` —— 唯一一個「不是登入流程、卻刻意不取身分」的

`resolveCartLines(lines: unknown)` 吃 **client 傳來的任意值**，回商品顯示資料。**沒有 auth gate。**

**而作者把理由寫在檔頭**（逐字）：

> 「本 action 只解析『公開 general 價』（與 `/products/[slug]` 公開頁同一資料面）、無權限升級風險；
> **不需 auth gate（任何人本就能在詳情頁看到 general 價）**。」

### 🔴 對威脅模型第二優先（經銷價）的檢查 —— **三層都排除了**

```
① public view 物理排除 price_store
② UIVariant 型別【沒有】priceByTier 欄
③ 本 action 逐欄白名單，回傳只有 unitPrice（= general 公開價）
```

檔頭逐字：**「絕不夾帶 `priceByTier`/`store`/`cost`」**、
**「價格欄只有 `unitPrice`（general、整數元位 number）、無任何 tier/經銷結構」**。

✅ **與 DB 層的量測互相印證**：`products.price_by_tier` 對 `anon` 與 `authenticated` 都是 `f`
（外部曝險稽核檔 §7d）。**⇒ 經銷價在 DB 層與 app 層【各自獨立】排除，不是同一道防線的兩個說法。**

⚠️ **本輪沒有驗的**：`resolveCartLines` 吃 `unknown` ⇒ **它的輸入驗證強度我沒有逐條測**
（陣列長度上限？重複 id？超長字串？）。**那是獵洞階段的事，本輪標未做。**

---

## 3. 🔴 與後台**共用**的東西 —— 「最容易被兩邊都假設對方守著」的地方

**storefront 與 admin 都 import 的 `@pcm/*`：**

```
@pcm/domain      @pcm/schemas      @pcm/adapters      @pcm/adapters/server
```

（storefront 獨有 4 個、admin 獨有 1 個。）

### 3.1 `@pcm/adapters/server` 是**被 eslint 全面禁止**的那個 —— 而它有**受控例外**

`eslint.config.js` 禁止 `apps/storefront/**/*.{ts,tsx}` import `@pcm/adapters/server`
（理由：ADR-0005 §6「storefront 公開讀走 RLS public、不該繞 RLS 拿 `service_role`」）。

**實測：15 處提到它，但【真 import】只有 4 處** —— 其餘 11 處是**解釋這條規則的註解**。

⚠️ **這正是「`grep` 命中數 ≠ 事實」的一個乾淨例子**：
**一條規則被遵守得越徹底，提到它的註解就越多，而註解會讓命中數膨脹。**

**四個真 import 全部是「受控單檔」（composition root），每個都有 inline `eslint-disable` + 逐字理由：**

| 檔 | 持有的憑證類別 |
|---|---|
| `lib/auth/composition.ts` | Supabase auth adapter（+ service client） |
| `lib/auth/line-admin.ts` | 🔴 **`service_role`** |
| `lib/email/composition.ts` | Resend API key（+ service client） |
| `lib/payment/composition.ts` | **`PAYMENT_CONFIRMER_DB_URL`**（不是 service_role）+ TapPay Partner Key |

### 3.2 📌 一個數字口徑，先講清楚免得被當成矛盾

Phase 1 寫「storefront 只有 **3 處** `service_role` 受控小門」，而我這輪數到 **4 個** composition root。
**兩個都對，數的是不同東西：**

```
呼叫 createSupabaseServiceClient 的檔  = 3   ← Phase 1 的 3（service_role）
import @pcm/adapters/server 的檔       = 4   ← 本輪的 4（受控 composition root）
```

**第 4 個（`payment/composition.ts`）持的是 `payment_confirmer` 的 DB 憑證，不是 `service_role`。**
⇒ **不是矛盾，是分母不同。** 📎 今晚第五次同族（`28 vs 31`、`11 vs 20`…）。

🔴 **而這第 4 個值得單獨記**：它持的正是**今晚 F2 那條的主角** ——
`payment_confirmer` 的憑證**住在 storefront 的一個檔裡**。
**F2 的前提是「那把憑證外流」，而這裡就是它在前台的落點。**
⚠️ **我沒有查它怎麼被載入、有沒有可能進到 client bundle**（檔頭宣稱 `server-only`）⇒ **獵洞階段要打這裡。**

---

## 4. 本輪**沒有**做的（誠實邊界）

| 沒做 | 說明 |
|---|---|
| **獵洞** | 本輪只盤點。輸入驗證、XSS、IDOR、越權**都沒打** |
| **頁面（page.tsx）層** | 只盤了 route handler 與 server action，**沒有盤 page 的 searchParams／params 吃什麼** |
| `resolveCartLines` 的**輸入驗證強度** | 吃 `unknown`，長度／重複／超長字串**未測** |
| `payment/composition.ts` 會不會進 **client bundle** | 檔頭宣稱 `server-only`，**我沒有驗** ⇒ 🔴 **獵洞階段第一個要打的** |
| 共用 `@pcm/domain`／`@pcm/schemas` 的**內容** | 只確認「兩邊都用」，**沒有逐一看哪些函式被兩邊用、語意是否一致** |
| 第三方 script／CSP／cookie 屬性 | 完全沒碰 |

---

## 5. 獵洞階段的建議打擊順序（**依「外部可達 × 有沒有第二道」排**）

1. 🔴 **`payment/composition.ts` 的 bundle 邊界** —— 它持真 DB 憑證，而 storefront **沒有 middleware**
2. **`resolveCartLines`** —— 唯一吃 `unknown` 且刻意無 auth 的 action
3. **`/api/checkout/tappay-notify/[secret]`** —— 唯一「靠祕密路徑段」當認證的端點（無簽章）
4. **page 層的 `searchParams`** —— 本輪完全沒盤
5. 共用 `@pcm/*` 的雙邊語意假設

📎 方法沿用今晚驗證過的四條：**先數入口 → 型別／結構分流 → 控制組必紅 → 「誰在用它 ≠ 誰打得到它」**。

---

# 第二輪：page 層（`searchParams` / `params`）+ `/dev-preview/*`

- **日期**：2026-08-16　**commit**：見本輪 commit　**仍然只盤點，不獵洞**

## 6. page 總覽

```
storefront page.tsx 總數        = 28
吃 searchParams 的               =  6   （/、/products、/products/[slug]、/login、/register、/checkout/callback）
動態路由 [param] 的              =  4   （/brands/[slug]、/products/[slug]、+ 兩個 /dev-preview/*）
```

⚠️ **本輪只列「吃什麼」，沒有逐一驗它們怎麼驗證那些值** —— 那是獵洞階段。

## 7. 🔴 `/dev-preview/*` —— 21 個檔的預覽區。**有閘，而且是 fail-closed 的**

**這是本輪最值得看的一塊**：一個 21 個檔、8 個預覽頁的區域，**在正式站是 404**。

**閘在 `dev-preview/layout.tsx`**（不是 middleware）：

```ts
export function isDevPreviewReachable(env) {
  if (env.VERCEL_ENV !== undefined) return new Set(['preview','development']).has(env.VERCEL_ENV);
  return env.NODE_ENV !== 'production';        // 🔴 讀不到 VERCEL_ENV ⇒ 退回 NODE_ENV ⇒ production 一律關
}
```

**三件做得好的，值得當範例：**

| | |
|---|---|
| **選 layout 不選 middleware** | 巢狀 layout 天然包住**整個 segment 底下每一頁**，**以後新增的自動繼承** ⇒ 一處守門、零遺漏；且不動 `next.config`（那會把純前台守門升成鐵則 12④ 高風險片） |
| **fail-closed 的支點** | **讀不到 `VERCEL_ENV` 不是放行，是退回看 `NODE_ENV`**。檔內逐字：「拿掉它，任何讀不到系統變數的正式部署都會變成全開」 |
| 🔴 **作者自己寫了「本閘擋不住什麼」** | 在命名這道控制之前先列出它的射程外 —— 引的是 `feedback_control-named-beyond-its-actual-power` |

### 7.1 作者列的射程外，我去驗了最實質的那條

> 「擋不住『有人把不該公開的東西寫進 `dev-preview/*/fixtures.ts`』——
> **那些字面仍在 git 與 JS bundle 裡**；本閘只讓**正式站的網址**進不去，**不等於內容沒外流**。」

🔴 **這句是對的，而且它指向一個 404 完全管不到的面。所以我去看了那個檔。**

`dev-preview/brands/fixtures.ts`（192 行）**內容 = 報價單 view 的真實商品快照**：
料號、中文品名、分類、圖片 URL、適用車款、**價格**。

**掃描結果（附控制組）：**

```
priceByTier|price_store|dealer|cost   ⇒ 0
09xxxxxxxx（手機）                    ⇒ 0
email                                 ⇒ 0
sk_ / pk_ / eyJ / PRIVATE KEY         ⇒ 0
CONTROL: 'price'                      ⇒ 60   ← pattern 是活的
```

**型別層也排除了**：`FixtureProduct` 只有 `price: number | null` **單一價格欄，沒有任何 tier 結構**。
而該檔**檔頭自己就宣告了**：逐字「**欄位皆公開安全（view 無經銷價）**」。

⇒ ✅ **不是 finding**：那是**已經公開在商品頁上的型錄資料**，零 PII、零經銷價、零憑證。
⇒ 📌 但**作者的警告仍然成立**：**這個檔的內容視同公開**（backlog `#385` C 案已立案要在檔頭寫明）。
**本輪的貢獻是把「視同公開」從假設變成量過的事實。**

## 8. 第二輪的誠實邊界

| 沒做 | 說明 |
|---|---|
| 6 個吃 `searchParams` 的 page **怎麼驗證那些值** | 只列了「吃」，**沒驗** |
| `/brands/[slug]`、`/products/[slug]` 的 **slug 驗證** | 沒驗（`dev-preview/brand-page/[slug]` 有 `Object.hasOwn` 白名單，**正式那兩支我沒看**） |
| 其餘 20 個 dev-preview 檔的內容 | **只掃了 `fixtures.ts` 一個檔** —— 它是唯一叫 fixture 的，**但「其他 20 個檔裡沒有硬寫資料」我沒驗** |
| JS bundle 實際內容 | **沒有 build 過、沒有翻 bundle** ⇒ 「fixtures 會進 bundle」是**讀作者的話**，不是我量的 |

🔴 **最後一列要特別留著**：我驗的是**檔案內容**，不是**bundle 內容**。
**兩者今天大概率一致，但那是推論。**

---

# 第三輪：**補掉我自己標的誠實缺口** —— 持 DB 憑證的模組會不會進瀏覽器

- **日期**：2026-08-16
- **為什麼提前做**：第一輪我把它列進「獵洞階段第一個要打的」，並標「**我沒有驗**」。
  🔴 **主視窗指出它不是誠實缺口，是【`Server 端鐵則` 的驗證缺口】** ——
  鐵則逐字：**「Client component 不得 import 任何洩漏經銷價的模組」**，
  而 `lib/payment/composition.ts` **持 `PAYMENT_CONFIRMER_DB_URL`（raw DB 憑證）**。
  ⇒ **成本低、價值可能很高 ⇒ 提前。**

## 9. 結論：**進不去，而且有三層各自獨立的理由**

### 9.1 第一層：`import 'server-only'`（**build 期強制，不是慣例**）

```
apps/storefront/src/lib/payment/composition.ts:15   import 'server-only';
apps/storefront/package.json:27                     "server-only": "^0.0.1"   ← 真的裝了
```

`server-only` 的機制是：**一旦這個模組落進 client 的模組圖，build 直接失敗。**
⇒ **它不是註解、不是約定，是編譯期的錯誤。**

🔴 **而「build 會過」這件事本身就是證據** —— 鐵則 11 的三綠對動 `.ts`/`.tsx` 的片**要求跑 build**
⇒ **若有人把它 import 進 client component，那一片在 commit 前就會紅。**

### 9.2 第二層：**它的消費端沒有一個是 client component**（實測）

```
消費 lib/payment/composition 的檔（排除測試與它自己）：6 個
其中含 'use client' 的：0
CONTROL：同一個判定對 contexts/CartContext.tsx → 命中 ✓（判定是活的）
分母：storefront 全部 'use client' 檔 = 103
```

**六個消費端全部是**：`'use server'` action ×2、route handler ×3、**server component page** ×1
（`checkout/callback/page.tsx` —— 第一行是註解，**不是** `'use client'`）。

### 9.3 🔴 第三層：**憑證的【值】也到不了** —— 這一層才是 `server-only` 管不到的

**`server-only` 擋的是【模組】。它擋不住「有人把值當 prop 傳給 client component」。**
⇒ **所以要另外查【值】的流向。**

```
PAYMENT_CONFIRMER_DB_URL 全 repo 命中（排除 node_modules / 測試）：
  turbo.json:26                             ← build env 白名單
  packages/adapters/src/payment/*.ts ×7     ← 全部檔頭標 server-only
  apps/storefront/src/**                    ← 【0 命中】
```

⇒ **那個變數名在整個 storefront 原始碼裡一次都沒出現。**
它是在 `@pcm/adapters/server` 底下被讀的，**而那個 subpath 本身被 eslint 全面禁止**（§3.1）。

**順帶把 `NEXT_PUBLIC_*` 也數了**（那是「刻意送進瀏覽器」的那一組）：

| 變數 | 該不該公開 |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | ✅ |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ 設計上就印在每個訪客瀏覽器裡 |
| `NEXT_PUBLIC_TAPPAY_APP_ID` / `APP_KEY` / `ENV` | ✅ TapPay 的**前端**元件憑證（Partner Key 才是祕密，**不在這裡**） |

⇒ **6 個，零敏感。** 與 Phase 1 的結論一致，**這次是各自數的**。

## 10. ⚠️ 這一輪**沒有**做的

| | |
|---|---|
| **沒有真的 build 完翻 bundle** | 我用的是**三層靜態證據 + 「build 會過」這個既有事實**。
🔴 **兩者的差別要講清楚**：`server-only` 保證「模組不在 client 圖裡」，**它不保證「沒有任何祕密以別的形式被序列化進 RSC payload」**。§9.3 是我對後者的**間接**檢查（變數名零命中），**不是翻 bundle 的直接證據。** |
| **`fixtures.ts` 會進 bundle** 那句 | 仍然是**讀作者的話**，我沒翻過 bundle 證實。⚠️ **但它的內容我掃過（零 PII／零經銷價／零憑證）** ⇒ **就算進了 bundle 也不構成曝露** ⇒ 這個缺口的**重要性降低**，但**沒有消失** |

🔴 **⇒ 兩個缺口裡，重的那個（DB 憑證）已收；輕的那個（fixtures）仍開著，但已證明它的內容無害。**
