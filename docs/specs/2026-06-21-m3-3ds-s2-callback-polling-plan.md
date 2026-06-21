# 2026-06-21 M-3 3DS S2 — callback 自動輪詢 + 處理中文案安撫(slice plan）

> **slice plan**（執行 session、寫審分離 ROLE=A、worktree `m3-3ds-s2`，從 dev `a1db8dc` 起）。
> 依據 = 設計決策包 `docs/specs/2026-06-20-m3-3ds-auth-settlement-redesign.md` §5.1（callback 自動輪詢）+ §5.5（處理中文案）+ §7 表 S2。
> **鐵則 8（重大改動：新增 API 端點 + 跨 3+ 檔）+ 鐵則 12（payment 讀路徑 + IDOR own-only + order 狀態）→ codex 雙關卡必跑。**

---

## ① 任務目標（1-2 句）

3DS callback 完成頁停在「處理中」時，前端**背景輪詢本人訂單付款狀態**，背景（webhook/sweeper）把訂單推成立後**自動跳成功頁**（客人無感、不必手動刷新）；輪詢有界（次數+間隔+退避）、超時/查無 **fail-closed** 維持安撫文案（不偽 paid 不偽 failed）；並把「處理中」文案對齊設計包 §5.5（已收到付款、銀行授權成功為正常、勿重複付款）。

---

## ② 前置檢查（已綠）

- worktree `m3-3ds-s2` 從 dev `a1db8dc`（S1「授權即成立」已 merge）；獨立 index 防撞車。
- 起手 `git branch`（=m3-3ds-s2）/ `status`（起手乾淨；目前僅本 plan + 後續 S2 檔 untracked）/ `log`（HEAD=a1db8dc）全綠。

---

## ③ 執行模式

mode B / conductor: main session（執行 session 自驅）/ subagent_chain: code-reviewer（commit 前必跑）/ fix_attempt_max: 2 / `/slice-checkpoint`: 跑 / `/codex-review`: **觸發**（鐵則 8 + 12：payment 讀路徑 + IDOR own-only 新端點；codex 關卡1 審 plan、關卡2 審 diff，main session `codex exec -s read-only -c service_tier="fast"`、零留痕）。

> Sean 睡覺、自驅模式：技術正確性執行 session 自扛（codex 雙關卡）；業務/口味決策題用 default 先實作 + 批次留交接檔；merge/push 等 Sean 明早。

---

## ④ Manifest Impact + Review 觸發

- **動到的 storefront 元件 / 檔**：
  - 新 `apps/storefront/src/app/api/orders/[orderId]/payment-status/route.ts`（會員自查付款狀態 GET 端點、own-only）
  - 新 `apps/storefront/src/app/api/orders/[orderId]/payment-status/route.test.ts`
  - 新 `apps/storefront/src/components/PollOrderStatus.tsx`（client 輪詢元件）
  - 新 `apps/storefront/src/components/PollOrderStatus.test.tsx`
  - 改 `apps/storefront/src/app/checkout/callback/page.tsx`（owned pending 變體掛 `<PollOrderStatus>` + **新增 owned-pending 專屬文案** OWNED_PENDING_MSG 對齊 §5.5；PROCESSING_MSG 維持中性供泛用態/no_attempt，見 §⑥ 步驟3 文案拆分）
  - 改 `docs/design-storefront-manifest.yaml`（CheckoutPage 段：component 清單加 PollOrderStatus + route + 新 business_override `checkoutCallbackPolling`〔述 callback 背景輪詢 + 文案拆分、design 無此態〕+ last_modified_commit/date）
- **對應 design 源**：design **有**送出鈕瞬時 loading「處理中…」（`design-reference/components/CheckoutPage.jsx` L600/677 `processing ? '處理中…'` 三元），但**無 callback 輪詢/確認中「終態頁」**（submitOrder L121-141 為假 TapPay 同步成功直導 OrderCompletePage）→ S2 的背景輪詢 + 自動跳轉 + 異步結算態文案/互動為 **PCM 自撰**、權威 = 設計包 §5.5。
  - ⚠️ **rule 1 grep 校正（誠實標）**：本 plan 初稿的 grep 在 worktree **design-reference submodule 尚未 init 時跑（內容空＝假陰性零命中）**；submodule init 後重 grep 校正＝確認 design 僅有送出鈕 loading「處理中…」、無 callback 終態頁（code-reviewer 抓出、已修正本句）。
- **業務 override**：processing 輪詢頁（design 無此態，承接 3DS-3 callback 的 processing 變體）。
- **未解決偏離**：見下「決策題（批次待 Sean）」。
- **review_triggers**：`slice_review` / `code_review` / **`security_review_required`**（IDOR own-only）/ **`codex_review_required`**（鐵則 8 + 12）。

---

## ⑤ 安全紅線分析（不可用 default 繞、必 codex + fail-closed default）

| 紅線 | 設計 |
|---|---|
| **IDOR 歸屬（只查本人訂單）** | 輪詢端點 = 全新「會員自查」入口（鐵則 12）。雙軸 own-only：① RLS `orders_select_own`（`auth.uid()=customer_user_id`）② 應用層縱深 `.eq('customer_user_id', user.id)`（與 callback page L99-100 同 pattern；RLS 萬一誤設亦不洩他人單）。`getUser()`（向 auth server 驗 JWT，非信任 client 送欄）throw/null → 401。客人偽造 `orderId` 只能查到自己的單（查無→404）。 |
| **經銷價零洩漏** | 端點回應**只含** `{ status: 'paid' \| 'pending' }`（零金額、零 displayId、零任何價格欄）。select 只取 `payment_status` 單欄。天然零經銷價路徑。 |
| **查不到/超時 fail-closed** | 端點：查無/非本人 → 404；非 paid（unpaid/partiallyPaid/refunded）→ `{status:'pending'}`（不細分、不偽 paid）；DB error → 500。client：**只有明確 `{status:'paid'}` 才 `router.refresh()` 跳成功頁**；401/404 → 停止輪詢（不 refresh）；500/network → 計入次數續試；次數用盡 → 停止、維持「處理中」安撫文案（不偽 paid 不偽 failed）。 |
| **不改 settleCharge 結算邏輯** | default A：輪詢端點**只讀 `orders.payment_status`、不呼叫 settleCharge**（不碰成立判定）。settleCharge use-case 一字不動。 |

---

## ⑥ 執行步驟

### 步驟 1 — 輪詢端點 `GET /api/orders/[orderId]/payment-status`

```
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req, { params }): Promise<Response>
  1. const { orderId } = await params
  2. UUID 形狀過濾（UUID_RE，對齊 callback page L47）→ 非 UUID → 400（不查、不洩）
  3. const supabase = await createServerSupabaseClient()
  4. getUser()（try/catch；throw → 401）；user 為 null → 401
  5. RLS own-only 讀：
       .from('orders').select('payment_status')
       .eq('id', orderId).eq('customer_user_id', user.id).maybeSingle()
     - error → 500（不洩內部訊息、固定 reason）
     - data === null（查無/非本人）→ 404
     - data.payment_status === 'paid' → 200 { status: 'paid' }
     - 其餘（unpaid/partiallyPaid/refunded）→ 200 { status: 'pending' }（fail-closed 不偽 paid）
  6. Cache-Control: no-store（動態狀態、不快取）
```

- 直接在 route 內查（對齊 callback page L96-101 先例、scope 最小、不動 packages/ports/adapters）；route 為 server-only。
- 回應最小化：`{ status }` 字串，零金額/零 PII/零經銷價。

### 步驟 2 — client 輪詢元件 `PollOrderStatus.tsx`

```
'use client'
props: { orderId: string }
- useRouter()
- POLL_DELAYS_MS = [1000, 1500, 2000, 3000, 4000, 5000, 5000, 5000, 5000, 5000, 5000, 5000]
  （13 次、前密後疏退避、總 ≈ 51.5s；抓快速同步又保留耐心）
- useEffect（[orderId, router]）：
  - 旗標 stopped + AbortController（unmount/成立即取消 in-flight fetch + clearTimeout）
  - 排程下一次：setTimeout(delay) → fetch(`/api/orders/${orderId}/payment-status`, {signal})
      · res.ok 且 json.status==='paid' → router.refresh()（重跑 callback server component；
        order 已 paid → settleCharge step2 短路 paid → 渲染 paid 變體 + ClearCartOnSuccess）→ stop
      · res.status===401||404 → stop（fail-closed、不 refresh）
      · 其他（500/網路/abort 以外）→ 不 stop、續排下一次
    用完 delays → stop（超時、維持處理中文案）
  - cleanup：stopped=true; controller.abort(); clearTimeout
- return null（不渲染視覺；文案由 CheckoutSuccess processing 變體顯）
```

- React 19 hooks：deps 正確列 `[orderId, router]`、無多餘 disable。
- 🔴 **每次 await 後 + 排下一次前都檢查 `stopped`**（fetch resolve 後若已 stopped 不動作）；**`AbortError` 不排下一次**（unmount/成立才會 abort，視為終止非錯誤）；StrictMode/double-mount 安全：cleanup 取消、旗標防 late callback 誤動作。

### 步驟 3 — callback page 接線（`checkout/callback/page.tsx`）

🔴 **文案拆分（codex 關卡1 must-fix 1：PROCESSING_MSG 原為單一共用常數，被 generic / 非UUID / IDOR fail-closed / no_attempt / owned-pending 共用；若整體改成「已收到付款」會讓「必然未扣款」的 no_attempt 與「未歸屬」的泛用態謊稱已收款＝UX 偽付款確認）**：
- 新增 **`OWNED_PENDING_MSG`**（§5.5 三要點、斷言性）：**只給 owned pending 變體**（已歸屬 + outcome=pending = 可能已扣款、鎖仍持）。
- **`PROCESSING_MSG` 維持中性條件句**（不斷言已收款）：給 **泛用態 + no_attempt**（未歸屬／必然未扣款）。

接線：
- **owned pending 變體**（L143-148、outcome.kind 落 pending）：文案改用 `OWNED_PENDING_MSG`；在 `<ClearCartOnSuccess />` 旁加 `<PollOrderStatus orderId={orderId} />`。
- **no_attempt 變體**（L138-140）：文案維持中性 `PROCESSING_MSG`；default **不掛**輪詢（no_attempt ⟺ failed/never，必然未扣款，payment_status 不會變 paid，輪詢零收益）。
- **泛用處理中**（`renderProcessingGeneric` L56-58、無歸屬 orderId）：文案維持中性 `PROCESSING_MSG`；default **不掛**輪詢（無 orderId、無歸屬，不查）。
- **paid / failed**：不掛（終態）。

### 步驟 4 — manifest + 測試

- `docs/design-storefront-manifest.yaml` CheckoutPage 段：component 加 `PollOrderStatus.tsx` + route + 新增 business_override `checkoutCallbackPolling`（callback 背景輪詢 + 文案拆分、design 無此態）+ last_modified_commit（可達祖先）/ last_modified_date。
- route.test.ts（node env）：401（無 user/getUser throw）/ 400（非 UUID）/ 200 paid / 200 pending（unpaid）/ 404（查無）/ 500（DB error）/ 回應零金額零 PII 斷言 / 🔴 **斷言 `.eq('customer_user_id', user.id)` 確被呼叫（own-only 縱深）** / 🔴 **斷言 500/404/401 response body 不含 raw `error.message`**（codex K1 consider）。
- PollOrderStatus.test.tsx（jsdom + fake timers）：paid→refresh 並停 / 超時→停不 refresh / 404→停不 refresh / 401→停不 refresh / 500→續試 / unmount→cleanup 不再 fetch / 🔴 **StrictMode double-mount 不重複輪詢** / 🔴 **AbortError 不排下一次** / 🔴 **late paid callback（stopped 後 resolve）不誤 refresh**（codex K1 consider）。
- 動 callback page → 更新/補 callback page smoke（既有 11 測，補 owned pending 掛 PollOrderStatus + 用 OWNED_PENDING_MSG、no_attempt 不掛 + 用中性 PROCESSING_MSG、泛用態中性文案不掛）。

---

## ⑦ 決策題（逐條 default + 備選；**批次待 Sean 明早一次微調**，default 已落地、不阻塞）

> 全用「對齊 design / 設計包的合理 default」先實作（default **擬落地**、Sean 明早一次微調再定）；非安全紅線（紅線見 §⑤、已 fail-closed 鎖死）。

**Q1 — 輪詢「只讀 payment_status」 vs「呼叫 settleCharge」？（最重要、影響功能達標）**
- **A（default、任務字面 + 最保守）**：輪詢端點**只讀 `orders.payment_status`**，不呼叫 settleCharge。靠背景（webhook `after(settleCharge)` 首見 / sweeper cron）把 payment_status 推 paid，輪詢再反映。
  - 🔴 **誠實缺口**：設計包 §5.1 實測「callback 當下 Record `queryStatus=2` 查無」→ callback 首次 settleCharge 通常 pending；webhook `after` 也僅首見一次；現行 sweeper = **每日** cron（S6 才升頻）。故「Record 延遲幾秒後同步」時，輪詢窗（≈51s）內**可能無人重跑 settleCharge** → 輪詢超時 fail-closed（顯安撫文案、留 email）。即 default A 下「幾秒無感自動成立」**不保證**、要等生產 sweeper 升頻或 webhook 即時收斂（S6/§5.4）。本機（無 sweeper）肉眼驗多半看到「處理中直到超時」=測試假象。 〔🔴 **supersede（2026-06-21 querystatus-fix）**：此處「`queryStatus=2` 查無 → callback 首次 settleCharge 通常 pending」之真因經 PCM-2026-0018 真刷實證 = settle-charge.ts L85 把查詢成功態 status=2 誤殺、**非同步延遲**;修法見 `docs/specs/2026-06-21-m3-3ds-settle-querystatus-fix-plan.md`。本 Q1 決策（B=輪詢呼 settleCharge + throttle、已於 S2b 落地）不受影響、輪詢仍作 webhook/sweeper/實際延遲後備〕
- **B（備選、達成 §5.1「幾秒無感」目標）**：輪詢端點在 own-only 歸屬閘後**呼叫 settleCharge**（= callback/webhook/sweeper「三路共呼」模型的第四路 caller，**不改 settleCharge 內部**，只多一個 caller）。Record 同步後輪詢的下一次即成立 → 真「幾秒無感」。代價：① 輪詢期間重打 Record API（§7 rate-limit 需評估；settleCharge step2 paid 後短路、pending 才打）② 端點責任變重（會員可觸發 settleCharge 的入口、需 codex 重點審）。
  - 🔴 **B 必加放大防護（codex K1 consider）**：own-only 歸屬閘必要但不足 —— 會員可對自己 pending 單重複觸發（多頁籤/重整打爆 TapPay Record 查詢預算）。B 採用時須加 **per-order server-side throttle / 短 TTL / lease**（如「同單 N 秒內已 settle 過則 skip、直接讀 payment_status 回」），或把即時觸發交回 sweeper（升頻）。此防護為 B 的前置、非 A 範圍。
- **🔧 切換成本預留**：default A 的端點已內建 own-only 歸屬閘形狀；切 B 僅需在端點查到 pending 時多呼一次 `settleCharge(getSettleChargeDeps(), { orderId })`（cookieless、與 callback page L113 同呼法）。Sean 選 B，切換 ≈ 加數行 + 補測 + codex 複審。
- 與任務指令一致採 **A**；B 強烈標註待 Sean，因為它才真正達成設計包 §5.1 的「幾秒無感成立」。

**Q2 — 輪詢間隔/退避序列？**
- **A（default）**：`[1000,1500,2000,3000,4000,5000×8]` ms，12 次，總 ≈ 51.5s（前密抓快同步、後疏省資源保耐心）。
- 備選：固定 2s×15（30s、簡單可預期）/ 更長窗（配 B 給 Record 充裕同步時間）。

**Q3 — 輪詢次數上限 / 總時長？**
- **A（default）**：13 次 / ≈ 51.5s（對齊 §6 未實測的「Record 同步幾秒」+ 安全餘裕）。
- 備選：縮短（8 次 ≈ 25s、客人不久等）/ 拉長（配 B + 生產收斂時效實測後定）。

**Q4 — 處理中文案措辭（對齊 §5.5 三要點：已收到付款 / 銀行授權成功為正常 / 勿重複付款）？**
- **A（default、拆兩文案；codex K1 must-fix 1）**：
  - `OWNED_PENDING_MSG`（owned pending、可能已扣款）＝`你的付款正在確認中。若銀行已授權扣款（你可能已收到銀行簡訊），系統會自動為你成立訂單，請勿重複付款；可稍候片刻，或留意 email 通知。`（§5.5 三要點 + fail-closed，不過度斷言「確定成立」）
  - `PROCESSING_MSG`（泛用態 / no_attempt、未歸屬或必然未扣款）＝**維持現行中性條件句**：`我們正在確認你的付款結果，若已扣款將自動為你成立訂單，請稍候片刻或留意 email 通知。`（不斷言已收款、不謊稱付款確認）
- 備選：OWNED_PENDING_MSG 用更強/更弱語氣 / Sean 自訂措辭。

**Q5 — no_attempt 變體是否也掛輪詢？**
- **A（default）**：**不掛**（no_attempt ⟺ failed/never、必然未扣款、payment_status 不會變 paid、輪詢零收益）。
- 備選：掛（防 webhook-vs-redirect race 下 attempt 稍後才現；但與 settleCharge 契約矛盾、default 不採）。

---

## ⑧ 驗收條件（yes/no）

- [ ] 輪詢端點 own-only（RLS + 應用層 `.eq customer_user_id`）；偽造他人 orderId → 404；未登入 → 401；非 UUID → 400。
- [ ] 端點回應只含 `{ status }`，零金額/零 PII/零經銷價（測試斷言）。
- [ ] client 只在 `{status:'paid'}` 才 `router.refresh()`；401/404 停且不 refresh；500/網路續試；用盡停且維持處理中文案。
- [ ] callback owned pending 變體掛 PollOrderStatus；no_attempt/failed/paid/泛用態不掛。
- [ ] owned pending 文案 `OWNED_PENDING_MSG` 對齊 §5.5 三要點；泛用態/no_attempt 維持中性 `PROCESSING_MSG`、**不謊稱已收款**。
- [ ] settleCharge use-case 一字不動（git diff 零變更）。
- [ ] 🔴 **default A 驗收範圍 = 驗「輪詢機制 + fail-closed」本身**（端點 own-only/最小回應、client 退避輪詢、paid→refresh、超時/查無 fail-closed）；**不承諾「Record 延遲同步情境下即時自動成立」**（那依賴 B 或生產 sweeper 升頻＝S6/§5.4、超出 S2 default A 範圍；codex K1 consider）。
- [ ] 三綠（typecheck+lint+build）+ 完整 pnpm test 綠（含新 route + PollOrderStatus + callback smoke）。
- [ ] manifest CheckoutPage 同步（design-mirror --validate PASS）。
- [ ] code-reviewer PASS + codex 雙關卡 PASS。

---

## ⑨ Rollback（鐵則 8 要求）

- forward-only 改、無 migration/env/schema/vercel.json 變更 → **無資料/部署回滾**。
- 程式回滾（若需）：刪 `api/orders/[orderId]/payment-status/route.ts(.test.ts)` + `components/PollOrderStatus.tsx(.test.tsx)`；還原 `checkout/callback/page.tsx`（移除 `<PollOrderStatus>` 掛載 + 還原單一 `PROCESSING_MSG`、移除 `OWNED_PENDING_MSG`）；還原 `docs/design-storefront-manifest.yaml` CheckoutPage 段。`git revert <commit>` 即可（純前端 + docs、無外部副作用）。
- flag：S2 無新 flag；prod checkout 仍受既有 `TAPPAY_3DS_ENABLED` 等 gate 鎖（本 slice 不開）。
- 🔴 **Sean 批准後才實作**（鐵則 8；本 plan 經 codex 關卡1 審）。

---

## 禁止清單（基線）

不改 scope 外檔 / **不改 settleCharge 成立邏輯**（settle-charge.ts 零變更）/ 不動 env·deployment·schema·migration·vercel.json / 不用 `git add .` · `-A`（精準 add）/ 不自動 push / 不 merge dev / 不動 .env* / 不開 prod checkout flag / 不繞 design-mirror / **端點回應不含任何金額/價格/經銷欄**。
— 禁止清單結束 —
