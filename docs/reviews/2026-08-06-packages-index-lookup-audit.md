# packages/ 索引查表 → truthy 判斷 盲點掃描(2026-08-06)

唯讀偵察,對照事故:兩支 admin result-banner(`obj[使用者輸入]` 取到原型鏈屬性、`if (!x)` 失效,commit `b3dd951` 已修)。目標:找 `packages/` 全樹裡同型寫法。

## 1. 母數與範圍

```
find packages -name "*.ts" -o -name "*.tsx" | grep -v node_modules | grep -v dist | wc -l
```
= **201** 檔(`*.ts` + `*.tsx`,已排除 `node_modules`、`dist`;`*.d.ts` 本 repo 未生成、無需另排)。

範圍:`packages/` 全樹。`apps/` 不在範圍(2026-08-02 已掃過)。

## 2. 已試的 grep pattern 清單(逐字)

```
grep -rnE 'const [A-Z_][A-Za-z0-9_]*\s*(:\s*Record<[^>]*>)?\s*=\s*\{' packages --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v dist

for name in SUPABASE_CODE_MAP HOSTS EMAIL_SEND_ERROR_CODE_FLAGS POLICY_BY_CODE PAYMENT_TRANSITIONS FULFILLMENT_TRANSITIONS TAPPAY_REFUND_STATUS Constants; do grep -rn "$name\[" packages --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v dist; done

grep -rn "EMAIL_SEND_ERROR_CODE_FLAGS" packages --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v dist
grep -rn "TAPPAY_REFUND_STATUS" packages --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v dist
grep -rn "Constants\." packages --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v dist

grep -rn "EMAIL_SEND_ERROR_CODE_ALLOWLIST\|EmailSendErrorCode" packages --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v dist | grep -v "\.test\."
grep -n "computeEmailBackoff" packages --include="*.ts" | grep -v node_modules | grep -v dist | grep -v "\.test\."
grep -n "outcome" packages/use-cases/src/sweep-email-outbox.ts

grep -rn "Object.hasOwn" packages --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v dist
grep -rn "hasOwnProperty" packages --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v dist
grep -rln "new Map(" packages --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v dist
grep -rnE "\bin (map|obj|table|dict|record)\b" packages --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v dist

grep -rnE '[A-Za-z_][A-Za-z0-9_]*\[[a-z][A-Za-z0-9_.]*\]' packages --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v dist | grep -v "\.test\." | grep -vE '\[i\]|\[index\]|\[0\]|\[1\]|\[2\]|\[j\]|\[key\]\s*='

grep -rn "Record<string" packages --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v dist | grep -v "\.test\."
grep -n "pickString(" packages/adapters/src/supabase/mappers/order.ts

grep -rnE '(const|let)\s+[a-z][A-Za-z0-9_]*\s*:\s*(Record<|Readonly<Record<|\{)' packages --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v dist | grep -v "\.test\."
```

## 3. 命中清單(形狀 1-3:查表被索引 → truthy 判斷)

### 3-1 `packages/adapters/src/supabase/mappers/auth-error.ts:35`
```ts
? (SUPABASE_CODE_MAP[error.code] ?? 'unknown')
```
- 判定:**外部可控**
- 依據:`error.code` 是 `SupabaseAuthErrorLike.code`(同檔 :14,`code?: string`),值來自 supabase-js `AuthError.code`(Supabase Auth API 回應的 wire 字串)。`SUPABASE_CODE_MAP` 是 `Record<string, AuthErrorCode>` 物件字面表(:24-31)。
- 為何是同型坑:`??` 只在 `null`/`undefined` 才短路;若 `error.code === '__proto__'`,`SUPABASE_CODE_MAP['__proto__']` 會取到 `Object.prototype`(truthy 物件、非 null/undefined),`?? 'unknown'` **不觸發**,`code` 在執行期變成一個物件而非 `AuthErrorCode` 字面值(型別宣告在編譯期被繞過)。
- 殘餘不確定:`error.code` 名義上來自 Supabase Auth 後端而非直接使用者輸入,攻擊者是否能讓後端回傳 `code: "__proto__"` 需視 Supabase 實作,本次未查證該邊；依任務給定三分類定義(「API 回應」即算外部可控)判定為外部可控,但注明間接性。

### 3-2 `packages/use-cases/src/email-backoff.ts:101`
```ts
const policy = POLICY_BY_CODE[errorCode];
```
- 判定:**內部封閉**
- 依據:`errorCode: EmailSendErrorCode`(union 型別,`@pcm/ports` `IEmailOutbox.ts:58`)。唯一呼叫點 `packages/use-cases/src/sweep-email-outbox.ts:227` 的 `outcome.errorCode` 來自 `IEmailSender.send()` 回傳,實作 `ResendEmailSenderAdapter.ts` 只會回 `ERROR_CODE_BY_STATUS`(封閉表、數字鍵)或 `classify429()` 的 `QUOTA_ERROR_CODE_BY_NAME.get()`(見 3.4 安全慣例,`Map.get` 不查原型鏈)算出的值,不會回傳任意字串。`POLICY_BY_CODE` 本身是 `Record<EmailSendErrorCode, BackoffPolicy>` 窮舉表(:66-84),`switch` 對 `policy` 三值窮舉、無 truthy 判斷。

### 3-3 `packages/adapters/src/tappay/endpoints.ts:30`
```ts
const host = HOSTS[env];
```
- 判定:**內部封閉**
- 依據:`env: TapPayEnv`(:17,`'sandbox' | 'production'` union),`HOSTS: Record<TapPayEnv, string>`(:19-22)窮舉表,TS 索引簽章即為聯集型別、無自由字串輸入面。且下游直接字串插值、無 truthy 判斷。

### 3-4 `packages/domain/src/order/state-machine.ts:62` / `:70`
```ts
return PAYMENT_TRANSITIONS[from].includes(to);
return FULFILLMENT_TRANSITIONS[from].includes(to);
```
- 判定:**內部封閉**
- 依據:`from: PaymentStatus` / `FulfillmentStatus`(domain union 型別,`./types`),兩表為 `Record<聯集型別, readonly 聯集型別[]>` 窮舉表(:38-44、:50-55)。即使 `from` 被餵入 `'__proto__'`,`PAYMENT_TRANSITIONS['__proto__']` 會是 `Object.prototype`(物件無 `.includes` 方法)→ **直接 throw TypeError**,不是靜默 truthy 通過 —— 與事故的「靜默放行」失效模式不同形狀(仍建議守門在更上游 DB→domain 邊界擋非法字串,但非本次要找的「index → truthy」坑)。

### 3-5(近似但已安全)`packages/adapters/src/supabase/mappers/order.ts:574`
```ts
const value = (obj as Record<string, unknown>)[key];
return typeof value === 'string' && value !== '' ? value : null;
```
- 判定:**內部封閉**(`key` 於所有呼叫點 `pickString(item.product_snapshot, 'title')` 等皆為 call-site 字面字串,非外部變數;見 order.ts:278/637-651/672)
- 備註:即使 `key` 未來被改成外部可控,此處守門用 `typeof value === 'string'` **型別窄化**而非 truthy 判斷,`obj['__proto__']` 取到的 `Object.prototype`(`typeof` 為 `'object'`)會被正確擋下回 `null`。屬於「即使踩到原型鏈也安全」的寫法,列出作對照。

**0 筆「外部可控 + truthy 放行」的第二例**——3-1 是本次唯一同型高風險命中,其餘 index-lookup 命中皆為內部封閉聯集/窮舉表,或已用型別窄化而非 truthy 判斷。

## 4. 既有安全慣例清單

- `packages/adapters/src/email/ResendEmailSenderAdapter.ts:110-117,196`:`QUOTA_ERROR_CODE_BY_NAME` **刻意用 `ReadonlyMap` 不用物件字面量**,檔頭 :80-108 逐字寫明原因就是本次要找的原型鏈坑(`name='toString'`/`__proto__`/`constructor`/`valueOf`/`hasOwnProperty` 會查到繼承函式、讓 `?? 'http_429'` 不觸發)。`classify429()` 用 `QUOTA_ERROR_CODE_BY_NAME.get(name) ?? 'http_429'`(`Map.get` 不查原型鏈)。對應測試 `ResendEmailSenderAdapter.test.ts:146` 逐一餵 `['toString','constructor','valueOf','hasOwnProperty','__proto__','isPrototypeOf']` 六個原型鏈鍵名做負測。**這是全 repo 對此坑唯一一處主動防禦 + 有名字的既有慣例**,可作為未來同型修法的範本。
- `packages/adapters/src/email/SupabaseEmailOutboxAdapter.ts:91,330`:`EMAIL_SEND_ERROR_CODE_ALLOWLIST = new Set<string>(Object.keys(...))`,用 `Set.has(errorCode)` 而非物件索引來做 runtime allowlist 校驗(`Set.has` 同樣不查原型鏈)。
- `packages/adapters/src/supabase/mappers/order.ts:143`:`Object.prototype.hasOwnProperty.call(input, 'notificationEmail')` —— 顯式呼叫 `hasOwnProperty` 而非 `in` 或直接索引,避開原型鏈屬性誤判。
- `packages/adapters/src/supabase/mappers/order.ts:572-576` `pickString()`:見 3-5,型別窄化(`typeof value === 'string'`)取代 truthy 判斷的慣例。
- 沒找到 `Object.hasOwn(...)`(ES2022 API)用法、沒找到 `in` 運算子用於此類查表守門 —— repo 現有慣例是 `Map`/`Set` + `.get()`/`.has()`,或 `Object.prototype.hasOwnProperty.call()`,不是 `Object.hasOwn` 或 `in`。

## 5. 誠實邊界:沒搜到的形狀 / 為什麼

- **動態產生的物件字面表**(非 `const X = {…}` 宣告,而是 function 內建構後被索引、或跨檔案二次組裝的表)——本次搜尋起點是「先抓 `const [A-Z_]... = {` 宣告再逐一查 `NAME[`」,對於表本身是執行期組裝(如 `Object.fromEntries(...)`)的情況不會被這條 pattern 抓到。已用較寬的 `[A-Za-z_]+\[[a-z][A-Za-z0-9_.]*\]` 全樹掃過一輪(§2 最後一條 pattern)、且逐一過濾陣列索引(`[i]`/`[0]` 等)後結果與窄 pattern 一致,但**不保證窮盡**——沒有對每一個檔案人工逐行讀過。
- **物件展開/解構後再索引**(例如 `const { ...rest } = TABLE; rest[key]`)——未特別搜這種二階寫法,存量抽查沒發現但沒有專門 pattern 針對它。
- **透過變數別名間接索引**(`const t = TABLE; t[key]`,而非直接 `TABLE[key]`)——grep 是抓字面表名稱後綴 `[`,若查表先被賦值給另一個變數名再索引,不會被抓到。抽查 `for name in SUPABASE_CODE_MAP HOSTS ...` 那批時只测了原名,没有对每個表另外搜「被賦值給別名」的模式。
- **`apps/` 目錄**——依交辦範圍明確排除,未掃(2026-08-02 已掃過)。
- **`.test.ts` 測試檔內部的查表寫法**——本次聚焦「production 程式碼路徑」,對測試檔內部同型 pattern(如各 adapter test 的 fixture map)沒有逐一分類,只在 grep 結果中看到但未深入判定其可控性(測試 fixture 通常本就是硬編碼、風險模型不同)。

## 6. 主對話覆核:唯一命中(3-1)的下游爆炸半徑

> 偵察由 subagent 執行,以下為主對話**親查**的補充 —— subagent 只追到 `auth-error.ts` 為止,
> 沒有往下游追「那個被污染的 `code` 最後會怎樣」。這一段決定它該排成一片還是記成 nit。

`AuthError.code` 的唯一消費端有兩處,形狀相同:

| 檔案:行號 | 寫法 |
|---|---|
| `apps/storefront/src/app/login/actions.ts:65` | `return { formError: authErrorCopy(e.code) }` |
| `apps/storefront/src/app/register/actions.ts:68` | 同上 |

`authErrorCopy`(`login/actions.ts:29-38`)是 **`switch` + `default`**,不是查表:
非預期的 `code` 一律落 `default` 回「登入失敗,請稍後再試」。

⇒ **結論:今天這個坑不可觀察。** 就算 `error.code` 真的是 `'__proto__'`,
`code` 在執行期變成 `Object.prototype` 物件,`switch` 比不中任何 case、落 `default`,
使用者看到的字面與 `'unknown'` 完全相同,**沒有空框、沒有洩漏、沒有行為差異**。

⇒ 它仍然值得修,但理由不是「現在會壞」,而是兩件事:
1. **型別謊言**:`const code: AuthErrorCode = ...` 在執行期可以是一個物件,型別宣告被繞過。
   任何人讀這段 code 都會以為 `AuthError.code` 一定是那幾個字面值之一。
2. **未來消費端的陷阱**:下一個人若把 `switch` 改成查表(`COPY[e.code]`)、或把 `code` 送進 log /
   監控 / 錯誤分類,污染就會現形。現在的安全是**下游剛好用了 switch**,不是這道守門擋住了。

修法一行:`Object.hasOwn(SUPABASE_CODE_MAP, error.code) ? SUPABASE_CODE_MAP[error.code] : 'unknown'`。
建議**不單開片**,併進下一個動 `packages/adapters/supabase/` 的片順手收。

### 另一條主對話覆核發現(不在 subagent 的三分類裡)

`packages/domain/src/order/state-machine.ts:58` 的 docstring 逐字寫「付款軸:from → to 是否合法(**不 throw**)」,
但 3-4 已證:`from` 若是原型鏈鍵名,`PAYMENT_TRANSITIONS[from]` 取到 `Object.prototype`、
它沒有 `.includes` ⇒ **TypeError**。型別擋得住正常呼叫端,但那句「不 throw」的承諾在
「有人把外部字串 `as PaymentStatus` 硬轉進來」時不成立。
⇒ 屬於「防護的名字大於它的能力」同族(memory `feedback_control-named-beyond-its-actual-power`)。

**可達性實查(我第一版寫錯,已更正)**:我原本寫「全 repo 未見 `as PaymentStatus` 強制轉型」——
grep 打臉,實際有兩處:`packages/adapters/src/payment/PgChargeAttemptAdapter.ts:341` 與 `:353`,
且來源是 DB 回來的 `o.order_payment_status`(外部值)。

但那條路徑**擋得住**,理由要講精確:`:341` 的守門是
`!PAYMENT_STATUSES.includes(o.order_payment_status as PaymentStatus)` ——
`PAYMENT_STATUSES` 是**陣列**、`Array.prototype.includes` 做的是元素比對,
**不是物件索引、不吃原型鏈**;`'__proto__'` 不在陣列裡 ⇒ 比對失敗 ⇒ throw `ChargeAttemptParseError`。
fail-closed,`:353` 那個 cast 被 `:341` 嚴格保護。

⇒ 結論不變(**無已知可達路徑、記錄不排片**),但成立的理由是「上游用陣列 allowlist 擋掉了」,
不是「沒有人強制轉型」。這兩句話的差別很重要:前者會隨那道守門被改寫而失效,後者是我編的。
