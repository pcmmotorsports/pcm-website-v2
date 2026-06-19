# M-3 3DS-6 — charge-actions flag 分岔 + client redirect plan(2026-06-19、鐵則 8 + 鐵則 12、待 Sean 批准)

> **真權威**:master plan v5 `docs/specs/2026-06-13-m3-3ds-webhook-master-plan.md` §1(啟動/結算雙半段)/ §2(Phase II 子片 3DS-6/3DS-7)/ §6(影響面)。
> 上承 `docs/specs/2026-06-19-m3-3ds-5ab-charge-initiate-plan.md`(5a/5b 已完成 + 審查 sign-off PASS;5b migration `20260619120000` 已 db push 落 prod)。
> **5a/5b 已交付的可消費介面**(本片接線、不改):
> - `initiatePayment(deps, input): Promise<InitiatePaymentOutcome>`(`packages/use-cases/src/initiate-payment.ts`、export 在 index.ts L42)。
> - `InitiatePaymentInput = { prime; orderId; amount: Money; cardholder; frontendRedirectUrl; backendNotifyUrl }`、`InitiatePaymentOutcome = redirect | charge_unknown | settlement_required | locked | init_failed`(`packages/domain/src/payment/types.ts` L283-325)。
> - `isThreeDSEnabled(): boolean`(`apps/storefront/src/lib/payment/three-ds-flag.ts`、嚴格只認 'true')。

---

## 0. 為什麼

- 5a/5b 已把 3DS 啟動引擎(adapter `initiateThreeDSCharge` + `initiatePayment` use-case + 寫入 RPC)建好,但**沒接任何 live 路徑**(中間態誠實:部署 ≠ 開放結帳)。
- 3DS-6 = **把引擎接到 delivery 層**:charge-actions 依 `isThreeDSEnabled()` 分岔 —— flag on 走 `initiatePayment`(回 `{ redirectUrl }`)、flag off 維持**現有同步** `confirmPayment`(現況、零改);client 收 redirectUrl 後 `window.location` 整頁跳轉 TapPay payment_url(銀行 OTP → 3DS-3 callback 收尾)。
- 接線後仍**不開放 prod 結帳**(§8 中間態誠實):flag 僅 sandbox/staging;prod 真實刷卡 = Phase I + 5a/5b + **6** 全到位 + flag on + sandbox 3DS 端到端過 + Sean 肉眼驗(同一決策點、Sean 拍)。

---

## 1. 範圍邊界(本 plan = 3DS-6 only;🔴 鐵則 4 拆 6a server + 6b client)

master plan §2 把 3DS-6 列為單一子片;依鐵則 4(15-45min 可中斷)+ 5a/5b 拆片前例,本片實作**拆兩個獨立 commit/checkpoint**,各自三綠 + code-reviewer + 鐵則 12 codex 關卡2。依賴序:**6b consume 6a 的回傳 shape → 先 6a 後 6b**。

| 子片 | 本 plan 做 | 不做(後續 / 不屬本片) |
|---|---|---|
| **3DS-6a**(server delivery) | charge-actions `isThreeDSEnabled()` 分岔:flag on 組 result_url + 呼 `initiatePayment` + 映 `InitiatePaymentOutcome` → 新 `{ redirect, redirectUrl }` 回傳;新 `lib/payment/three-ds-urls.ts`(URL 組裝 + base URL https 守門 + secret 讀取);flag off 路徑零改 + 對應測 | charge / confirm / settleCharge 引擎(5a/5b/Phase I 已成);client 跳轉(6b) |
| **3DS-6b**(client) | `useChargePayment` 加 `redirect` 態;`CheckoutView` 加 redirect early-return;新 `CheckoutRedirecting` 元件(整頁 `window.location` 跳轉 + interstitial)+ 對應測 | cart_session_id client 整合(3DS-7);成功頁 regenerate cart key(3DS-7) |
| 3DS-7 | ✗ | client CartContext cart_session_id UUID(現 charge-actions L136 per-call `randomUUID()` 過渡);成功頁 regenerate;TTL 24h |

**🔴 中間態誠實(master plan §2、§8)**:6a/6b 純接線。flag off = 現有同步路徑(=現況、prod 4 merchant 強制 3D 會被 status 75 拒、非可營運態);flag on = 3DS(僅 sandbox/staging)。本片**不開放 prod 結帳**、**不設 TapPay env**(`TAPPAY_3DS_ENABLED` / `TAPPAY_NOTIFY_PATH_SECRET` / `NEXT_PUBLIC_SITE_URL` 由 Sean 在 flag-on 前設、§4)。

---

## 2. 3DS-6a — charge-actions flag 分岔 + redirect 回傳

### 2.1 要改什麼(`apps/storefront/src/app/checkout/charge-actions.ts`)

現行 chargePaymentAction ①登入 →②a/b/c safeParse →③ buildCardholder →④ placeOrder →⑤ findTotal →⑥ `confirmPayment`(同步)。

**改動 = ① 讀 flag 一次;② flag on 時在 placeOrder「前」preflight 驗 base+secret(codex k1 #3:base/secret 缺時不留 unpaid 垃圾單);③ findTotal 後 flag on 走 initiatePayment 分岔**。①-⑤(getUser / parse / cardholder / placeOrder / findTotal / per-call cart_session_id `randomUUID()`)**兩條路徑共用、零改**(同一張單、同一金額來源):

```
const threeDS = isThreeDSEnabled();
... ① getUser  ②a/b/c safeParse  ③ buildCardholder(built) ...
if (threeDS) {
  cfg = resolveThreeDSConfig();   // 🔴 preflight(placeOrder「前」):base(https、new URL 驗)+ secret(≥32 URL-safe)
                                  //   缺/不合 → throw → 既有 catch → MSG.generic、零扣款、零建單(codex k1 #3)
}
④ placed = placeOrder(...)        // 共用
⑤ total = findTotal(placed.orderId)   // null → MSG.generic(零扣款、現有)
if (threeDS) {
  const { frontendRedirectUrl, backendNotifyUrl } = buildResultUrls(cfg, placed.orderId);  // 純 interpolate orderId(已驗 cfg、不 throw)
  const outcome = await initiatePayment(
    { tappay: getTapPayAdapter(), attempts: await getChargeAttemptStore() },
    { prime, orderId: placed.orderId, amount: total, cardholder: built.cardholder,
      frontendRedirectUrl, backendNotifyUrl },
  );
  return mapInitiateOutcome(outcome, placed.displayId);   // §2.3
}
⑥ const outcome = await confirmPayment(...同現有...);   // 🔴 flag off:逐字不動
   return mapOutcome(outcome, placed.displayId);
```

- 🔴 **catch 安全不變**:`initiatePayment` 只在 `attempts.begin` infra throw 時上拋(零 charge,與 confirmPayment 同),charge 後的失敗已由 use-case 收斂為 outcome、不 throw(5b 已驗);`resolveThreeDSConfig` throw 在 placeOrder「前」→ 零扣款 + **零垃圾單**(codex k1 #3);`buildResultUrls` 純 interpolate(已驗 cfg、不 throw)。故既有檔頭「走到 catch 全屬零扣款路徑」對 3DS 分岔仍成立(commit body 補註)。
- **新 import**:`isThreeDSEnabled`(`@/lib/payment/three-ds-flag`)、`initiatePayment`(`@pcm/use-cases`)、`buildThreeDSResultUrls`(`@/lib/payment/three-ds-urls`)。`getTapPayAdapter`/`getChargeAttemptStore` 已 import(現給 confirmPayment 的 `tappay`/`attempts`)→ 復用,無新 composition factory。
- **新回傳 variant**(`ChargePaymentActionResult` union 加一支):`{ redirect: true; redirectUrl: string }`。**非 `ok:true`**(付款未完成、是「導向 TapPay」的 navigation,語意 ≠ paid)。
- 🔴 **payment_url 不入 log**(redirectUrl = TapPay payment_url、含 token query):action 不 `console.log` redirectUrl;它**必須**回給 client(client 唯一能跳轉的依據)→ 「回給 client」≠「log」,網路回應帶它是 3DS redirect 的本質、非外洩。
- **不動**:`MSG` 既有常數(redirect 無文案、client 跳轉);`mapOutcome`(同步路徑映射)逐字不動;`mapCardholderFail` 不動。

### 2.2 URL 組裝(新檔 `apps/storefront/src/lib/payment/three-ds-urls.ts`、server-only)

🔴 **拆兩段(codex k1 #3 preflight)**:`resolveThreeDSConfig()` 驗 base+secret(placeOrder「前」呼、throw 即零垃圾單)、`buildResultUrls(cfg, orderId)` 純 interpolate(findTotal 後呼、不 throw)。

```ts
import 'server-only';
import { requireNotifySecret } from './notify-secret';   // 🔴 Q1=A:單一真相(3DS-2 route 同源)
type ThreeDSConfig = { base: string; secret: string };

export function resolveThreeDSConfig(): ThreeDSConfig {
  return { base: resolvePaymentBaseUrl(), secret: requireNotifySecret() };  // 任一不合 → throw(fail-closed)
}
export function buildResultUrls(cfg: ThreeDSConfig, orderId: string): { frontendRedirectUrl; backendNotifyUrl } {
  return {
    frontendRedirectUrl: `${cfg.base}/checkout/callback?order=${orderId}`,  // 對齊 3DS-3 callback 讀 sp.order(UUID)
    backendNotifyUrl: `${cfg.base}/api/checkout/tappay-notify/${cfg.secret}`, // 對齊 3DS-2 webhook 祕密路徑段
  };
}

// 🔴 N1(審查側必折入):base 與 payment_url 用「兩個不同 predicate」、payment_url 較鬆。
// resolvePaymentBaseUrl = origin-only(嚴);isHttpsUrl = 允許 path/query/hash(鬆、給 TapPay payment_url)。
function resolvePaymentBaseUrl(): string { /* origin-only、見下 bullet;不 export(只 resolveThreeDSConfig 用) */ }
export function isHttpsUrl(url: string): boolean { /* https + hostname + 無 credential、允許 path/query;見下 bullet */ }
```

- **`resolvePaymentBaseUrl()`(origin-only、嚴;preflight 用、不 export)**:讀 `process.env.NEXT_PUBLIC_SITE_URL`(復用既有 SEO env、5b plan §4「查既有 env」);🔴 **`new URL()` 解析驗**(codex k1 #1,非裸 `^https://` regex):`protocol==='https:'` + 有 `hostname` + **無** `username/password`(擋 `https://user@evil`)+ **無** `search/hash` + path 須空或 `/`(限 base=origin);任一不合或 parse throw → **throw**(charge-actions catch → MSG.generic、零扣款)。回傳 origin(去尾斜線);🔴 **不 fallback localhost**(`resolveSiteUrl()` dev 的 `http://localhost` 對 3DS 不可用、TapPay server 連不到 localhost、且非 https)。
  - ⚠️ 含意:flag-on 的 sandbox/staging 必設 `NEXT_PUBLIC_SITE_URL` = TapPay 可達的公開 **https** 網域(ngrok/staging);未設/非 https → 3DS 分岔 fail-closed(零扣款 + 零建單、誠實 generic),非靜默壞單。本機 dev 開 flag 而無公開 https → 同樣 fail-closed。
- 🔴 **`isHttpsUrl(url)`(較鬆、顯式 export;N1 審查側必折入)**:給 §2.3 `mapInitiateOutcome` 驗 TapPay **payment_url**。`new URL()` 解析 → `protocol==='https:'` + 有 `hostname` + 無 `username/password`;🔴 **必須允許 `search`(query)與 path**(payment_url 本質帶 `?token=…`)。**絕不可**誤用 origin-only base 檢查驗 payment_url(會把每筆合法 redirect 都判壞 → 全掉 processing、無人能跳轉付款、happy-path 全壞、表面 code-review 看不出)。
  - 🔴 mapInitiateOutcome **import 本 `isHttpsUrl`**(別在 charge-actions 另寫一份 `new URL` 邏輯)。
- 🔴 **`requireNotifySecret()`(Q1=A、抽 `lib/payment/notify-secret.ts`)**:讀 `process.env.TAPPAY_NOTIFY_PATH_SECRET`、enforce `≥32(MIN_SECRET_LEN=32)+ URL-safe(^[A-Za-z0-9_-]+$)`、否則 throw。🔴 從 3DS-2 route(route.ts L55-61)**byte 等價抽出**(同 MIN_SECRET_LEN / URL_SAFE_RE / throw 條件);3DS-2 route 改 `import { requireNotifySecret }`、移除本地副本、**行為零變**;three-ds-urls 同源 import → 單一真相、零漂移。改完跑**完整** route.test.ts + 完整 vitest(審查側 caveat:防 cross-effect 紅)。

### 2.3 `InitiatePaymentOutcome` → `ChargePaymentActionResult` 映射(`mapInitiateOutcome`)

| InitiatePaymentOutcome | action result | client(6b)行為 | 理由 |
|---|---|---|---|
| `redirect{redirectUrl}`(payment_url **是合法 https URL**) | `{ redirect:true, redirectUrl }` | 整頁跳轉、**不清車**、UI submit 鎖定(🔴 付款狀態**非終態**=跳轉中) | 導向 TapPay;abandon 可回頭重結帳(成功清車交 3DS-3 callback、master B) |
| `redirect{redirectUrl}`(payment_url **非合法 https URL**) | `{ ok:false, payment:'processing', displayId, message: MSG.settlementRequired }` | 清車 + 終態鎖 + 勿重複 | 🔴 codex k1 #2:TapPay 已回 status=0(可能 OTP 後成交)、但 payment_url 壞 → **不可** `window.location.assign` 壞值、**不可**走 generic 可重試錯(誤導重刷雙扣);當「狀態確認中」、settleCharge 經 bank_txn 收斂 |
| `charge_unknown{orderId}` | `{ ok:false, payment:'processing', displayId, message: MSG.settlementRequired }` | 清車 + 終態鎖 + 勿重複 | initiate 非成功、bank_txn 已 durable、可能已登記交易 → 保守當「狀態確認中」(用 settlementRequired 文案「確認中」非 processing「已收」、更誠實);settleCharge 經 bank_txn 收斂 |
| `settlement_required` | `{ ok:false, payment:'processing', displayId, message: MSG.settlementRequired }` | 清車 + 終態鎖 + 勿重複 | 同步路徑同名態同映射(option A per-call cart_session_id 下 dormant) |
| `locked{user_in_flight}` | `{ ok:false, payment:'in_flight', message: MSG.inFlight }`(🔴 無 displayId) | 釋鎖 + 留車 + 稍候 | 此請求零扣款、無單號(對齊同步 round3 C) |
| `locked{order_locked\|not_unpaid}` | `{ ok:false, payment:'processing', displayId, message: MSG.processing }` | 清車 + 終態鎖 + 勿重複 | 同單已有 active attempt / 非 unpaid(對齊同步) |
| `init_failed` | `{ ok:false, payment:'charge_failed_wait', displayId, message: MSG.chargeFailedWait }` | 釋鎖 + 留車 + 稍候 | bank_txn 未 durable → **零 TapPay 呼叫、零扣款**(誠實「未扣款、系統忙碌、約 10 分鐘後再試」);鎖殘留 expirer/sweeper 清、稍後可重試 |

- 🔴 **redirect 的 payment_url 防線(codex k1 #2)**:`mapInitiateOutcome` 對 `redirect` outcome **先驗** `redirectUrl` 是合法 https URL(復用 three-ds-urls 的 `isHttpsUrl()` `new URL()` 驗、protocol/hostname、不限定 TapPay 網域以免擋掉合法子網域變動)→ 合法才回 `{ redirect:true }`、否則回 `processing`(上表)。理由:上游 adapter 僅保證 `payment_url` 是字串(非空、非 0、wire 解析),不保證形狀 → delivery 層補 https URL guard,防壞值整頁導向 / open-redirect。
- 🔴 **無 `ok:true`(paid)分支**:3DS 啟動半段不回扣款結果(master plan §1)→ initiate 永不回 paid;paid 只在同步 `mapOutcome`。
- 🔴 **文案複用既有 `MSG` 常數**(無新文案除非必要):`charge_unknown`/`settlement_required` 用 `MSG.settlementRequired`;`order_locked`/`not_unpaid` 用 `MSG.processing`;`init_failed` 用 `MSG.chargeFailedWait`;`user_in_flight` 用 `MSG.inFlight`。redirect 無文案(client 跳轉)。

### 2.4 6a 測試(`charge-actions.test.ts` 擴 + 新 `three-ds-urls.test.ts`)

- **charge-actions.test.ts**(鏡像既有 mock 結構;新 mock `isThreeDSEnabled` / `initiatePayment` / `resolveThreeDSConfig` + `buildResultUrls`):
  - flag off → 走 `confirmPayment`(既有測零改、回歸驗 `initiatePayment` + `resolveThreeDSConfig` 零呼叫)。
  - flag on:`redirect`(合法 https payment_url)→ `{ redirect:true, redirectUrl }` + 斷言 `initiatePayment` 收 server 值(orderId=placeOrder 回、amount=findTotal 回、cardholder=helper 回、frontendRedirectUrl/backendNotifyUrl=builder 回)、client 塞 amount/orderId 不被採信(防竄回歸)。
  - 🔴 flag on:`redirect` 但 payment_url 非 https(壞值)→ `processing`(settlementRequired 文案、帶 displayId、**非** generic;codex k1 #2)。
  - flag on 各 outcome → 對應 result(§2.3 全列:charge_unknown / settlement_required / locked×2 / init_failed)。
  - 🔴 flag on + `resolveThreeDSConfig` throw(base/secret 缺)→ MSG.generic + **`placeOrder` 零呼叫 + `initiatePayment` 零呼叫**(零扣款 + 零垃圾單、preflight 在建單前;codex k1 #3)。
- **three-ds-urls.test.ts**(@vitest-environment node、`vi.stubEnv`):
  - base:`https://host` / `https://host/`(origin)通過;`http://…` / `https://user@host`(含 credential)/ `https://host/path` / `https://host?x=1` / `https://host#h` / 相對 / 空白 / 未設 → throw(`new URL()` 驗、codex k1 #1)。
  - secret:≥32 URL-safe 通過;<32 / 含非 URL-safe(`/`,`.`,空白)/ 未設 → throw。
  - `buildResultUrls(cfg, orderId)` shape:frontend `<base>/checkout/callback?order=<orderId>`、backend `<base>/api/checkout/tappay-notify/<secret>`(純函式、不讀 env)。

---

## 3. 3DS-6b — client redirect(useChargePayment + CheckoutView + CheckoutRedirecting)

### 3.1 `useChargePayment.tsx` 加 `redirect` 態

- **新 ChargeState**:`{ status: 'redirect'; redirectUrl: string }`。
- **submit 內**(在 catch 之後、`'ok' in res` 之前加分支;redirect shape 無 `ok`/`payment` 鍵,不加會 fall-through 到驗證層誤判):
  ```ts
  if ('redirect' in res && res.redirect) {
    // 🔴 3DS 啟動成功 → 即將整頁跳轉 TapPay。不清車(callback 成功頁才清、abandon 可回頭);
    //    UI submit 鎖定維持(防導向前重送),🔴 付款狀態**非終態**(跳轉中、待 OTP→callback 裁決、master「啟動成功=跳轉中非終態」)。
    setState({ status: 'redirect', redirectUrl: res.redirectUrl });
    return true; // 維持 UI 鎖:呼叫端(View primeBusyRef)不釋放(即將導向、不得重送)
  }
  ```
- **清車政策補檔頭**:redirect → **不 clear**(對齊「server 明確、可能未完成、留車可重結帳」;清車交 3DS-3 callback paid/pending);其餘 6 態(paid/processing/unknown/in_flight/wait/error)政策逐字不動。
- 🔴 **payment_url 不入 log**:redirectUrl 經 state 流向 CheckoutRedirecting 跳轉,hook 不 log。

### 3.2 `CheckoutView.tsx` 加 redirect early-return

- 在現有 `paid`/`processing`/`unknown` 終態 early-return 群(L143-159)**之後、cart loading 之前**加:
  ```ts
  if (charge.state.status === 'redirect') {
    return <CheckoutRedirecting redirectUrl={charge.state.redirectUrl} />;
  }
  ```
- 🔴 **不在 CheckoutView 內做 `window.location` 副作用**(render 期不可副作用;且 CheckoutView 388 行、加 effect+interstitial 會破鐵則 6 的 400 行硬上限)→ 導向副作用**封裝進 CheckoutRedirecting**(§3.3)。CheckoutView 淨增 = 1 import + 3 行 early-return(維持 < 400 行)。
- **新 import**:`CheckoutRedirecting`。

### 3.3 新元件 `apps/storefront/src/components/CheckoutRedirecting.tsx`(client)

- 職責:`useEffect` 整頁 `window.location.assign(redirectUrl)`(或 `.href =`)導向 TapPay 3DS payment_url + 渲染 interstitial「正在前往安全付款頁面…」。
  ```tsx
  'use client';
  export function CheckoutRedirecting({ redirectUrl }: { redirectUrl: string }) {
    useEffect(() => {
      // 🔴 整頁導向 TapPay 3DS 付款頁(payment_url 含 token query、絕不 log/螢幕顯示原值)。
      window.location.assign(redirectUrl);   // deps:[redirectUrl];無 disable
    }, [redirectUrl]);
    return (/* co-page 殼 + co-success-card「正在前往安全付款頁面,請稍候…」*/);
  }
  ```
- 🔴 **視覺零新 CSS**:復用既有 `co-page`/`co-main`/`co-success`/`co-success-card`/`co-success-eyebrow`/`co-success-title`/`co-success-note` class(沿用 CheckoutSuccess 已驗 pattern)+ Header/HomeFooter。不顯 redirectUrl 原值(只顯文案)。→ 滿足肉眼驗跳判據(純導向中間態 + 沿用已驗 pattern + 零新 CSS + 視覺可預期 + 無新風險);仍 raise Sean 拍是否跳肉眼驗。
- 🟡 **N2(審查側 nit、本片不做、記 backlog)**:`window.location.assign` 無 fallback、導向被瀏覽器擋時使用者卡 interstitial → Phase II 補「N 秒後手動點此繼續」連結(指向同 redirectUrl)。Phase I(0 真流量、sandbox-only)可接受。

### 3.4 6b 測試

- **useChargePayment.test.tsx** 擴:redirect result → state `redirect` + redirectUrl 透傳 + **不 clear**(斷言 cart.clear 零呼叫)+ submit 回 true(終態)。
- **CheckoutView.test.tsx** 擴:`charge.state.status==='redirect'` → 渲染 CheckoutRedirecting(帶 redirectUrl)、不渲染 step UI。
- **CheckoutRedirecting.test.tsx** 新(jsdom):mock `window.location.assign`(或 delete+重設)→ 斷言以 redirectUrl 呼一次 + interstitial 文案渲染 + redirectUrl 原值不出現在 DOM 文字。

---

## 4. env(flag-on 前置;🔴 本片不設、Claude 不碰 .env*)

| env | 用途 | 本片 | flag-on 前(Sean 設) |
|---|---|---|---|
| `TAPPAY_3DS_ENABLED` | 3DS live 分岔開關 | helper 已存(5b)、本片 charge-actions 消費 | 設 `'true'`(僅 sandbox/staging) |
| `NEXT_PUBLIC_SITE_URL` | result_url base(復用既有 SEO env) | builder 讀、https 守門 | 設 TapPay 可達公開 **https** 網域(sandbox=ngrok/staging) |
| `TAPPAY_NOTIFY_PATH_SECRET` | webhook 祕密路徑段(對齊 3DS-2) | builder 讀、≥32 URL-safe 守門 | 設 ≥32 URL-safe(STATUS 已列待設) |

無新密鑰(TapPay key 已備)。base URL 復用 `NEXT_PUBLIC_SITE_URL`(非密、可入 client bundle;builder 在 server 讀無洩漏);若日後要與 SEO canonical 解耦再換獨立 env(trivial、非本片)。

---

## 5. 預期影響面(鐵則 8)

- **改寫檔**(只增不減、flag off 行為零變):
  - `apps/storefront/src/app/checkout/charge-actions.ts`(+ flag 分岔 + redirect variant + mapInitiateOutcome;同步路徑逐字不動)。
  - `apps/storefront/src/hooks/useChargePayment.tsx`(+ redirect 態 + 分支 + 清車政策註)。
  - `apps/storefront/src/components/CheckoutView.tsx`(+ redirect early-return + import)。
  - (Q1=A 時)`apps/storefront/src/app/api/checkout/tappay-notify/[secret]/route.ts`(import 抽出的 `requireNotifySecret`、行為零變、route.test.ts 守)。
- **新增檔**:`lib/payment/three-ds-urls.ts`(+ test)、`components/CheckoutRedirecting.tsx`(+ test);(Q1=A 時)`lib/payment/notify-secret.ts`。
- **不動**:`initiate-payment.ts` / `confirm-payment.ts` / `settle-charge.ts` / adapter / port / migration / `three-ds-flag.ts` / `CheckoutSuccess.tsx` / `ClearCartOnSuccess.tsx`(屬 5a/5b/Phase I/3DS-7)。
- **DB / migration / db push**:🔴 **零**(純 delivery + client 接線、無 schema 動)。
- **影響部署**:無新 route、無 cron;env 由 Sean flag-on 前設(§4、本片不設)。經銷價 / RLS / schema 零影響。

---

## 6. rollback(鐵則 8)

- forward 接線、不 revert 既有 commit。`TAPPAY_3DS_ENABLED` flag **off = 現有同步路徑(現況、零行為差)**;flag off ≠ prod 可刷卡 rollback(prod 4 merchant 強制 3D、同步被 status 75 拒 → flag off 在 prod 非可營運態、僅 sandbox/staging 滾動控制)。
- 6a / 6b 各獨立 commit、未 push 可 reset;零 migration → 零 db push → 零 DB rollback。
- 🔴 **prod 真實刷卡 = Phase I + 5a/5b + 6 全到位 + flag on + sandbox 3DS 端到端過 + Sean 肉眼驗**(同一決策點、Sean 拍)。

---

## 7. 內容分級 + 鐵則判定 + 三視角

- **內容分級**:N/A(純 delivery/client 接線、interstitial 文案是 L1 系統態文字非商品內容)。
- 🔴 **鐵則 8 重大改動**:動共用 payment server action(charge-actions)+ 消費 flag/env + 跨 3+ 檔 → 本 plan 等 Sean 批准才實作。
- 🔴 **鐵則 12**:金流 delivery(接 live charge 分岔 + redirect)→ 6a / 6b **各 commit 前 codex 關卡2 必跑**;本 plan **codex 關卡1 必跑**(動手前審)。
- **三視角**:擴充性(flag 分岔 isolate、同步路徑零污染、redirect variant 加性);可維護性(URL 組裝單一真相 three-ds-urls、interstitial 封裝 CheckoutRedirecting、文案複用 MSG);bug 可追蹤性(payment_url 零 log、charge_unknown 帶單號供客服、fail-closed throw 全零扣款)。

---

## 8. 中間態誠實(master plan §2、codex r2 #3)

- flag off = 現有同步路徑(現況、本片零改);flag on = 3DS(僅 sandbox/staging)。
- 本片接線 ≠ 開放 prod 結帳;**不存在「prod checkout 開著但 flag 關走同步」的營運態**(prod 強制 3D)。
- 部署 6a/6b 到 prod 不等於開放結帳(現況 stage 2 未上線、0 流量自然滿足);prod 真實刷卡與「開放結帳」同決策點、Sean 拍。

---

## 9. 驗收(yes/no)

**6a**
- [ ] flag off → `confirmPayment` 路徑零行為差(既有測全綠 + `initiatePayment` 零呼叫)。
- [ ] flag on → 組正確 result_url(frontend `…/checkout/callback?order=<UUID>`、backend `…/tappay-notify/<secret>`)+ `initiatePayment` 收 server 值(零 client 竄改)。
- [ ] `InitiatePaymentOutcome` 各態 → §2.3 對應 result(redirect-合法/redirect-壞 payment_url→processing / charge_unknown / settlement_required / locked×2 / init_failed)。
- [ ] base 非 https(含 `user@host`/query/hash/path)/ secret 缺或 <32 → `resolveThreeDSConfig` throw → MSG.generic + **`placeOrder` 零呼叫 + `initiatePayment` 零呼叫**(零扣款 + 零垃圾單)。
- [ ] payment_url 零 log(server + client);三綠 + full vitest + bundle grep(server keys/經銷價零命中)+ codex 關卡2 PASS + code-reviewer PASS。

**6b**
- [ ] redirect result → `useChargePayment` redirect 態、**不清車**、submit 回 true(終態鎖)。
- [ ] CheckoutView redirect 態 → 渲染 CheckoutRedirecting、不渲染 step UI。
- [ ] CheckoutRedirecting → `window.location.assign(redirectUrl)` 呼一次 + interstitial 文案 + redirectUrl 原值不出現在 DOM。
- [ ] 零新 CSS(沿用 co-success pattern);三綠 + full vitest + codex 關卡2 PASS + code-reviewer PASS + Sean 肉眼驗(或拍跳)。

---

## 10. 拆片(鐵則 4;依賴序 6a → 6b)

- **6a**(server delivery、~30-40min):three-ds-urls.ts(+ Q1 secret 抉擇)+ charge-actions 分岔 + mapInitiateOutcome + 測 → 三綠 + code-reviewer + codex 關卡2 → commit(不 push)。
- **6b**(client、~30-40min):useChargePayment redirect 態 + CheckoutView early-return + CheckoutRedirecting + 測 → 三綠 + code-reviewer + codex 關卡2 → commit(不 push)。
- 每片 commit 後通知審查 session、sign-off 前不 push。

---

## 11. 決策題(Sean 批准 + 一處抉擇;prose multi-select)

```
Q0(批准本 plan):3DS-6 接線(flag 分岔 + client 跳轉、拆 6a server + 6b client、零 migration、flag 僅 sandbox)
A: 批准、照 plan 開 6a    B: 批准但有修改(說明)    C: 不批准 / 先討論

Q1(notify 祕密段規則要不要抽單一真相):
A: 抽 lib/payment/notify-secret.ts、3DS-2 route 改 import(去重防漂移、route.test.ts 守回歸;代價=動一支已部署 webhook route、行為零變)
B: builder 內聯同規則 + 交叉引用 3DS-2 route 註解 + backlog 記未來 DRY(不碰已部署 route、代價=兩處各一份 ≥32 URL-safe 規則)
   (Claude 建議 A;codex 關卡1 亦判 A —— secret 規則是安全邊界、應單一真相防漂移、route 行為零變且 route.test.ts 守回歸。兩審一致 → 預設 A,Sean 可否決改 B。)
```

---

## 12. codex 關卡1 收斂紀錄(2026-06-19、`codex exec -s read-only` gpt-5.5、唯讀零留痕)

**裁決 = PASS**(0 must-fix);3 consider + 2 nit + Q1 判斷全採納折入:
1. (consider)base URL 守門用 `new URL()` 驗 protocol/hostname/無 credential/origin、非裸 `^https://` → §2.2 + §2.4 測案。
2. (consider)client 直接 `window.location.assign(payment_url)` 前須 https URL guard;壞值 + TapPay 已 status=0(可能成交)→ 回 processing 終態(非 generic 可重試、防誤導重刷)→ §2.3 redirect 雙列 + payment_url 防線 bullet。
3. (consider)base/secret 缺在 placeOrder 後 throw 會留 unpaid 垃圾單 → preflight `resolveThreeDSConfig()` 移到建單前 → §2.1 flow + §2.2 拆兩段 + §2.4/§9 測案。
4. (nit)redirect「終態鎖」混淆 master「啟動成功=跳轉中非終態」→ §2.3/§3.1 改「UI submit 鎖定;付款狀態非終態」。
5. (nit)「卡資料零進 server」字面過強 → 禁止清單改「PAN/CVV/有效期零進我方 state/DOM/server/log;prime/cardholder 只進 server 記憶體不 log」。
6. (Q1 判斷)codex 選 A(抽 notify-secret 單一真相)→ §11 Q1 預設 A、Sean 可否決。

**審查側關卡1 sign-off(2026-06-19、PASS-with-notes)**:Sean 批 Q0=A / Q1=A;8 接線錨點 grep 實證對上真權威、5b migration 20260619120000 已在 prod。額外釘死折入:
- 🔴 N1:`isHttpsUrl` 顯式 export + 與 base origin-only **分開較鬆**(允許 payment_url 的 path/query)、mapInitiateOutcome import 它、6a 測釘「帶 token query→redirect / 壞值→processing」兩案(§2.2/§2.3/§2.4)。
- 🟡 Q1=A caveat:notify-secret 抽出 byte 等價、route 改 import 行為零變、跑**完整** route.test.ts + 完整 vitest(§2.2)。
- 🟡 N2:CheckoutRedirecting fallback 記 backlog、本片不做(§3.3)。

---

## 禁止清單(基線 + 本 plan)

— 不改既有同步 `charge`/`confirmPayment` 與其測試(flag off 路徑逐字不動)/ 不動 initiate-payment·settle-charge·adapter·port·migration·three-ds-flag(屬 5a/5b/Phase I)/ 不接 prod 結帳(中間態誠實)/ payment_url 不入 log(server + client)/ 卡號·CVV·有效期(PAN)零進我方 state·DOM·server·log(prime/cardholder 只進 server action 記憶體、不 log)/ 金額整數零浮點 / 經銷價零外洩 / base URL 必 https(new URL 驗)fail-closed / secret 必 ≥32 URL-safe fail-closed / 不採信 client 送值(orderId/amount/cardholder 全 server 權威)/ 密鑰 server-only / 不動 .env*(Sean flag-on 前設)/ 不新增 migration / 不 db push / 不改已套用舊 migration / 不用 git add .·-A / 不自動 push —
— 禁止清單結束 —
