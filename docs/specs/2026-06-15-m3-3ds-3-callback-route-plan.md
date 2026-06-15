# M-3 3DS-3 — callback 完成頁 plan(2026-06-15、鐵則 8 + 鐵則 12、待 Sean 批)

> **真權威**:master plan v5 `docs/specs/2026-06-13-m3-3ds-webhook-master-plan.md` §1(a)/§2(3DS-3)/§4 + v5 B/D。
> **前序已成**:settleCharge 對帳脊椎(3DS-1b)+ getSettleChargeDeps cookieless factory + webhook route(3DS-2)皆已 commit。
> **流程**:本 plan → codex 關卡1(read-only 審 plan vs master/design)→ 自修 → 決策批次問 Sean → 批准才實作。

---

## ① 任務目標(1-2 句)

建 **3DS 結帳成功/失敗的瀏覽器導回完成頁**(TapPay `frontend_redirect_url` 的落地頁):零信任解析 → 歸屬閘 → 共呼 `settleCharge`(Record API 唯一權威)→ 依結果渲染「訂單已成立 / 處理中 / 失敗」三終態,成功才清購物車品項。**吸收原 ②-⑤ 完成頁素材的功能面**(視覺 polish 交 Sean)。

---

## ② 前置檢查

```
git branch --show-current   # = dev
git status                  # 僅 untracked 允許清單:.playwright-mcp/ + docs/reviews/m3-3ds-review-log.md + 本 plan 檔(docs/specs/2026-06-15-m3-3ds-3-*.md);無已追蹤檔被改
git log --oneline -3        # HEAD = 1f1e187 (3DS-2b) 對齊 STATUS
```
三者綠才繼續(本 plan 檔屬允許 untracked;與 slice code 同一次 commit、不另開)。

---

## ③ 執行模式

mode B / conductor: main session / subagent_chain: code-reviewer(commit 前必跑)/ fix_attempt_max: 2 / `/slice-checkpoint`: 跑 / `/codex-review`: **觸發**(關卡1 審本 plan;關卡2 審 diff — 命中鐵則 12 payment/order)。寫審分離 ROLE=A:本(執行)session 實作 + commit;審查 session 哨兵逐 commit fresh-context 複驗。

---

## ④ Manifest Impact + Review 觸發

- **動到的 storefront 元件**:新增 `app/checkout/callback/page.tsx`(Server Component)+ `components/CheckoutCallbackResult.tsx` 或復用 `CheckoutSuccess`(加 `failed` 變體)+ 小 client `ClearCartOnSuccess`;改 `CheckoutSuccess.tsx`(加 `failed` 變體)。
- **對應 design 源**:`design-reference/components/OrderCompletePage.jsx`(只有成功態 `N°ORDER · CONFIRMED` / `訂單已成立`;processing/failed 為 PCM 自撰、同 ②-④b 既例)。
- **業務 override**:callback 路徑採 **page route**(非 master plan §2 字面 `app/api/...`,理由見 §5.0);IDOR 歸屬閘(master plan 未展開、本 plan 補)。
- **未解決偏離**:🟡 TapPay 失敗/放棄是否導回 frontend_redirect_url + 是否保留我方 query(Sean D、待 sandbox 驗;非擋批准、失敗釋鎖由 retry-action〔3DS-5b〕兜底)。
- **review_triggers**:slice_review / code_review / **security_review_required**(鐵則 12 payment/order)/ **codex_review_required**(關卡1 plan + 關卡2 diff)。

---

## ⑤ 執行步驟

### 5.0 🔴 架構修正:callback 是「瀏覽器 GET 導回的 page」,不是 api route

- TapPay 3DS 流程兩個回程:`backend_notify_url`(server→server POST = webhook、3DS-2 已建)/ `frontend_redirect_url`(銀行 OTP 後**把使用者瀏覽器 GET 導回**)。後者是整頁導航 → 落地頁必須能渲染 HTML = **Next.js page(Server Component)**;`app/api/.../route.ts` 回 `Response` 無法渲染完成頁。
- 故實作為 **`app/checkout/callback/page.tsx`**(與 `app/checkout/page.tsx` 同層、語意清楚);master plan §2 的 `app/api/checkout/tappay-callback` 字面為 label、以本修正為準(commit body 標字面 vs 事實)。
- **URL 合約**(3DS-5b Phase II 構造 result_url 時遵守):`frontend_redirect_url = ${APP_BASE_URL}/checkout/callback?order=${orderId}`。我方只認 `order`(orders.id UUID);TapPay 可能附加 rec_trade_id 等 → **零信任、不採信**(成交權威 100% 在 settleCharge 內 Record API)。

### 5.1 page.tsx 處理序(Server Component、`runtime='nodejs'` + `dynamic='force-dynamic'` + 不快取)

> page 設定:`export const runtime = 'nodejs'`(對齊 webhook route、settleCharge deps 走 pg)+ `export const dynamic = 'force-dynamic'`(讀 cookie/searchParams、不快取、不 prefetch settle 結果)。**Record 重打放大防線**(codex 關卡1 consider):settleCharge step2「order 已 paid → 不打 Record」短路 → paid 後刷新廉價;pending 重複刷新仍會重打 Record,**跨路徑 per-order recently-settled skip 由 3DS-4 統一補**(本片不另寫限流、同 webhook「限流交 Vercel WAF / sweeper」誠實邊界)。

```
1. getUser()(向 auth server 驗 JWT、對齊 checkout/page.tsx)→ 無 → redirect('/login')。
2. 讀 searchParams.order → 零信任:非 UUID 形狀 → 渲染「處理中」泛用態(無單號、不打 Record)。
3. 🔴 IDOR 歸屬閘:createServerSupabaseClient()(使用者 cookie)讀
     orders.select('display_id').eq('id', orderId).eq('customer_user_id', userId).single()
     (只取 display_id:id 已知=orderId、payment_status 權威由 settleCharge 內 orderPaymentStatus 判定 → 不需;
      🔴 應用層縱深〔codex 關卡2〕:RLS orders_select_own 已守、再顯式 .eq customer_user_id、RLS 萬一誤設亦不洩)
   — RLS orders_select_own(USING customer_user_id = auth.uid())只回「本人單」;
   無 row(PGRST116 / 非本人 / 不存在)→ 渲染「處理中」泛用態(不洩他人 display_id、不打 Record)。
4. 歸屬通過 → settleCharge(getSettleChargeDeps(), { orderId })(cookieless 主軌、Record 權威):
     - getSettleChargeDeps()/settleCharge throw 全 try/catch → 視為 pending(fail-closed、不 500)。
5. outcome → 變體(displayId 一律取自 §3 歸屬讀的 orders.display_id、不依賴 settleCharge):
     paid                       → CheckoutSuccess variant=paid       + <ClearCartOnSuccess/>(清品項)
     pending / no_attempt       → CheckoutSuccess variant=processing  + <ClearCartOnSuccess/>(處理中、留單號;🔴 見 Q4)
     failed                     → CheckoutSuccess variant=failed      (PCM 自撰 + 返回購物車 CTA;🔴 不清車)
```

- 🔴 **清車政策(Q4、codex 關卡1 consider、建議 A)**:`pending` ≠ 明確未扣款(含 Record unreachable / auth_or_pending / unverified、鎖仍持、可能已扣)→ **paid + pending/no_attempt 都清品項**(對齊既有 `useChargePayment` 的 processing 清車政策、防殘車誘導重複扣款);**僅 `failed`(settleCharge markFailed 已釋鎖、明確未成功、可立即重結帳)不清車**(Sean D4 失敗不清車)。3DS-7 cart_session_id 前無 cross-tab dedup 兜底 → 寧清勿留。
- **零信任 + 歸屬閘雙保險**:URL status 參數一律忽略;orderId 先過 RLS 歸屬(防 IDOR)再 settleCharge(防誤觸 Record 放大 rate-limit、對齊 webhook「對不上本機 order 直接丟」)。
- **settleCharge 在 GET 頁渲染內副作用(markCharged/confirm 寫入)** 為 payment-callback 標準型:settleCharge 冪等(markCharged FOR UPDATE + confirm paid no-op)+ 權威=Record → 重入/prefetch 安全;callback 經外部 redirect 抵達、非 `<Link>` prefetch。

### 5.2 CheckoutSuccess 加 `failed` 變體

- 現有 `variant: 'paid' | 'processing' | 'unknown'` → 加 `'failed'`。COPY:`failed: { eyebrow: 'N°ORDER · FAILED', title: '付款未完成' }`(PCM 自撰、對齊 processing/unknown 既例;design 無此態)。
- failed 渲染:note=message(常數文案「這筆付款未完成,購物車已為您保留,可重新結帳。」)、顯 displayId(供客服)、CTA 文字/連結 → 「返回購物車」`/cart`(非「繼續購物」`/products`;失敗保留車可重結帳、對齊 Sean D4 失敗不清車)。
- ⚠️ CheckoutSuccess 仍被 CheckoutView(Phase II 同步殼)復用 → 變體擴充**不得改動 paid/processing/unknown 既有渲染**(回歸測釘住)。

### 5.3 ClearCartOnSuccess(小 `'use client'` 元件)

- 🔴 **must-fix(codex 關卡1):清車必 gate `isHydrated`**。CartProvider mount effect 先 `setItems(readStorage())` + `setIsHydrated(true)`,寫回 localStorage 又被 `isHydrated` gate。若 `useEffect(()=>clear(),[])` 在 hydrate 「前」跑(子元件 effect 早於 provider effect),`clear()` 設空後會被 provider 的 readStorage **覆寫回舊車** → 成功未清。
  - 正解:`const { clear, isHydrated } = useCart(); useEffect(() => { if (isHydrated) clear(); }, [isHydrated, clear]);`(hydrate 完成才清、寫回生效;`clear`/`isHydrated` 入 deps、無 disable)。
  - 測試:**預塞 localStorage** → 完整 `CartProvider` 包 `<ClearCartOnSuccess/>` remount → 斷言 items / localStorage / header count 三者皆清空(非只測 clear() 被呼叫)。
- 🔴 **cart_session_id regenerate 留 3DS-7**:CartContext 目前**無** cart_session_id(Phase II 3DS-7 才引入)→ 本片只做「清品項」;regenerate 在 3DS-7 接 cart_session_id 時於此處掛上(plan 留 TODO + backlog 連結)。對齊 Sean B 拆兩片落地(見 Q2)。
- 不渲染視覺(`return null`)。🔴 **只掛在 `app/checkout/callback/page.tsx` 的 paid/processing 渲染樹**(codex 關卡1 consider):**不** 塞進 `CheckoutSuccess` 預設分支(共用元件、CheckoutView 同步路徑復用、清車已由 useChargePayment 政策做、避免雙清)。CheckoutSuccess 保持純展示。

### 5.4 測試

- `CheckoutSuccess.test`(新或擴):failed 變體渲染(eyebrow/title/CTA→/cart);paid/processing/unknown 回歸不變。
- `callback/page.test`(node env、mock `@/lib/supabase/server` + `@/lib/payment/composition.getSettleChargeDeps` + `@pcm/use-cases.settleCharge`,鏡像 checkout actions.test 慣例):
  - 未登入 → redirect('/login')。
  - order 非 UUID → processing 泛用態、不呼 settleCharge。
  - 歸屬讀無 row → processing 泛用態、不呼 settleCharge(IDOR 不洩 displayId)。
  - 歸屬通過 × settleCharge 各 outcome(paid/pending/failed/no_attempt)→ 對應變體 + displayId 來源正確。
  - settleCharge throw → processing(fail-closed)。
- `ClearCartOnSuccess.test`:mount 呼 clear() 一次。
- 動金額路徑 → 收工跑**完整 pnpm test**(非單檔;memory `run-full-vitest-after-shared-component-change`,CheckoutSuccess 被 CheckoutView 整合)。

### 5.5 收工

三綠(typecheck+lint+build storefront、動 .tsx)→ code-reviewer(必跑)→ **codex 關卡2**(鐵則 12 payment/order;quota 撞牆走 Claude fresh-context fallback 2 輪)→ 精準 add → STATUS 7 欄自更 + busboy-end → **不 push、不 db push**(本片零 migration、不碰 bundle)。

---

## ⑥ 驗收條件(yes/no)+ 影響面 + rollback

### 驗收(yes/no)

- [ ] callback = page route;`frontend_redirect_url` GET 導回可渲染完成頁(非 api route)。
- [ ] 零信任:URL status/rec 參數不採信;成交權威只在 settleCharge 內 Record API。
- [ ] 🔴 IDOR:`?order=<他人 orderId>` → RLS 歸屬閘擋 → 不洩 display_id/狀態、不打 Record。
- [ ] 三終態:paid→訂單已成立+清車品項 / pending|no_attempt→處理中(不清車)/ failed→付款未完成(不清車、CTA 返回購物車)。
- [ ] fail-closed:getUser/歸屬讀/settleCharge 任一 throw → 不 500、退「處理中」、不偽 paid、不清車。
- [ ] Sean D4:失敗分支也跑 settleCharge(釋鎖裁決由 settleCharge markFailed;UI 只渲染 failed)。
- [ ] 經銷價零外洩(static + rendered-HTML 雙 grep)、金額整數零浮點、卡資料零落地(本片不碰卡欄)。
- [ ] 三綠 + 完整 pnpm test + code-reviewer PASS + codex 關卡2 PASS;零 migration(不碰 db push bundle)。

### 影響面(鐵則 8)

- **新增**:`app/checkout/callback/page.tsx` + `ClearCartOnSuccess.tsx`(+ tests);改 `CheckoutSuccess.tsx`(加 failed)。
- **影響部署**:新 page route(Vercel function、`force-dynamic`);新 env `APP_BASE_URL`(3DS-5b 構造 result_url 用;本片 page 只讀 searchParams、**不需** APP_BASE_URL → 留 3DS-5b 引入)。本片**零新 env**。
- **不影響**:DB / migration / db push bundle(純 code);settleCharge / factories / RLS / create_order 不動;CheckoutView 既有同步路徑不動(僅 CheckoutSuccess 變體擴充、回歸測釘)。
- **誠實中間態**:本 page Phase I 建好但**無真 3DS 流量**(frontend_redirect 在 Phase II 3DS-5b 才構造);部署到 prod ≠ 開放結帳(master §2)。

### rollback

每子片獨立 commit、未 push 可 `git reset`;純 code 無 migration → 無 DB rollback;CheckoutSuccess 變體擴充 forward-only(回歸測保 paid/processing/unknown 不退化)。

---

## 禁止清單(基線 + 本片)

不改 scope 外檔 / 不變 env·deployment(本片零新 env)/ 不改 schema·infra·migration / 不採信 TapPay redirect 欄位(一律 settleCharge Record 反查)/ 不在 callback 洩他人 order(歸屬閘)/ 失敗不清車 / 不動 CheckoutView 同步路徑清車政策(避雙清)/ 金額零 client·整數零浮點 / 經銷價零外洩 / 卡資料零落地 / 不用 git add .·-A / 不自動 push / 不 db push / 不動 .env*
— 禁止清單結束 —

---

## codex 關卡1 收斂(r1 FAIL → 全採納)

- **must-fix**:ClearCartOnSuccess hydration race → §5.3 gate `isHydrated`(+ remount 測 localStorage 真清)。
- **consider**:① pending 清車政策不一致(誘導重結帳)→ 升 **Q4** 交 Sean(§5.1 step5 建議 A);② GET 渲染寫入「prefetch 安全」過滿 → §5.1 補 runtime/dynamic/不快取 + Record 重打交 3DS-4 skip;③ ClearCartOnSuccess 放置矛盾 → §5.3 只掛 callback page、CheckoutSuccess 純展示;④ 前置檢查 self-reference → §2 plan 檔列允許 untracked。
- blocking fork = Q4 pending 政策(交 Sean);其餘已收斂進 plan。本片 plan 不再跑 codex round2(剩餘為 Sean 決策;實作 diff 走關卡2)。

## 決策岔路(一次性批次問 Sean)

- **Q1 完成頁範圍**:A=復用最小 `CheckoutSuccess`(加 failed 變體、功能齊備)、完整 `OrderCompletePage` 視覺 polish 交 Sean / 後續片(memory `sean-owns-visual-design`) ‖ B=本片就照 design 做完整 OrderCompletePage。**建議 A**。
- **Q2 cart_session_id regenerate 時序**:A=3DS-3 只清「購物車品項」、`cart_session_id` 的 regenerate 留 3DS-7(那時 cart_session_id 才存在)、本片留 TODO ‖ B=本片先把 cart_session_id 拉進 CartContext(與 3DS-7 重疊)。**建議 A**(守 Phase I/II 邊界;Phase I 無真流量、不急 regenerate)。
- **Q3 未登入導回**:A=callback 無 session → redirect('/login')(對齊 /checkout;3DS 期間 session 過期則回登入、之後走 /account 讀路徑查單) ‖ B=渲染「請登入查看訂單」頁含登入連結。**建議 A**。
- **Q4 🔴 pending(處理中)清車政策**(codex 關卡1):A=`paid + pending/no_attempt` 都清品項(對齊既有 processing 清車、防可能已扣款的殘車誘導重複扣款)、**只 `failed` 不清車** ‖ B=只 `paid` 清車、pending 保留(但 processing UI 不得給「返回購物車/重刷」暗示、且 3DS-7 前不接真流量)。**建議 A**(雙扣安全 > 失敗即時重結帳的便利;與同步流程一致)。
