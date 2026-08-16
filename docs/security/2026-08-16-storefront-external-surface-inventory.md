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
