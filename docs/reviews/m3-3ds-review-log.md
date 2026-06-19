# M-3 3DS 重設計 — 審查 session review-log(寫審分離 ROLE=A 審查側)

> **本檔為審查 session 的工作 log,刻意「不 commit」**(執行 session 同一工作樹直接 commit `dev`,審查側若也 stage/commit 會撞 git index — 見 memory `project_parallel-sessions-shared-git-index-collision` / `feedback_concurrent-session-git-index-contamination`)。findings 留本機 + 對 Sean 橋接;只 FAIL 才 `PushNotification`。
> **接棒給下一個審查 session 用**:讀本檔 §0 baseline + §1 進場點,然後重 arm 哨兵(§2 命令)。

---

## 0. Baseline(本審查 session 起手 2026-06-15)

```
branch          = dev
dev tip         = 1f1e187  (3DS-2b TapPay notify webhook route)
origin/dev      = 1f1e187  (dev 與 origin/dev 同步 — Sean 已推到含 3DS-2b)
worktree heads  = dev=1f1e187 / main=9f609b0 / od-redesign=266f5f2
                  + 數個 claude/* 殘留分支(多 =9f609b0=main、practical-shannon-525b68=bd8c4fa
                  為陳舊 M-1-05「刀 2」探索 off main、與 3DS 無關 → 忽略)
stash@{0}       = On main: M-3 ②-⑤ WIP(完成頁)← 3DS-3 要吸收的素材
```

哨兵 baseline 含 dev=1f1e187 → **3DS-2b(及之前)不會被重審**(對齊 Sean「接 3DS-3」= 從下一個 commit 起審)。

## 1. 進場點 = 3DS-3(callback route + 成交清車 + 吸收 ②-⑤ 完成頁)

- 上一棒審查 session 哨兵 = `bo93zbypl`(隨該 session 結束而停)。**本 session 哨兵歷程**:`bw75eq243`(初 arm、被 kill)→ 2026-06-15 重開 = Monitor **`b9oe3knig`**(persistent、全 heads 掃描、20s 輪詢、baseline dev=76cbf00)。
- **3DS-2 審查狀態(進場前已關)**:STATUS 載 2a PASS、2b code FAIL(安全紅線〔雙扣/偽 paid/PII/fail-closed/secret〕全 PASS 無破口,FAIL=defensive-parse 健壯性 + 文件化)→ 執行側 amend 修 M1 數值收界/M2 asStr trim/解耦 TapPay env/文件化 + code-reviewer 複審 PASS。2b(1f1e187)已在 origin/dev → **視為已關,本 session 不重審**。
- **下一個正式待審 = 3DS-3**。master plan v5 §2:callback route + 成交清車,吸收原 ②-⑤ 完成頁(stash WIP)。

## 1.1 3DS-3 審查重點(預先框定,落地時逐條核)

- **鐵則 12 紅線**:order/payment/pricing — 金額整數或 Decimal 禁 number 浮點;經銷價絕不入一般會員 client bundle(static + live rendered-HTML 雙 grep);server 端重驗 tier 不信 client。
- **雙扣防線(3DS callback 特有)**:callback 與 webhook/sweeper 三路共呼 `settleCharge`(冪等、Record API 唯一權威);callback「成交清車」必在 settle 裁決為 paid 後才清車,且不得因 callback 早於 webhook 而誤判/誤釋鎖(對齊 1b forFinalFail 硬化、recordMatchesOrder 識別+金額+單向窗閘)。
- **fail-closed**:callback 任一不確定態 → 保留鎖、不清車、不偽 paid;回應遺失層走 unknown 終態。
- **吸收 ②-⑤ stash**:完成頁素材搬入時對 design 保真(鐵則 1 grep design 字面、不憑記憶);processing/paid/failed 變體齊全。
- **codex 關卡2 觸發**:命中鐵則 12(payment/order)→ 跑 codex-adversary K2(OpenAI quota 已走 IDE 登入,memory `reference_codex-ide-login-no-api-key`);quota 撞牆則 Claude fresh-context fallback 對抗審 2 輪。codex 每 slice 硬上限 2 輪,round2 仍 FAIL 停下 raise Sean。
- **db push bundle 不退化**:3DS-3 若是純 code 不應動 migration;若新增 migration,確認併入既有 bundle(0b/0c/1b RPC/#214a)且 cart_session_id 整合前不可單獨 db push(memory `project_3ds-db-push-bundle-blocked-until-cart-session-integration`)。

## 1.2 審查姿態(每 commit)

fresh-context 對不可變 `git show <sha>` 快照重審 → 不信 commit message / STATUS 字面 → 親跑三綠(動金額路徑跑完整 vitest)→ 逐條核字面 vs 事實 → manifest 同步 → 鐵則 12 經銷價雙 grep。findings 寫本檔 §3,只 FAIL 才推播 Sean。

## 2. 哨兵 arm 命令(下一棒重 arm 用,沿用全 heads 掃描版)

```
R=/Users/sean_1/pcm-website-v2
snap() { git -C "$R" for-each-ref --format='%(refname:short)=%(objectname:short)' refs/heads/ | sort; }
prev=$(snap)
while true; do sleep 20; cur=$(snap) || continue
  if [ "$cur" != "$prev" ]; then printf '%s\n' "$cur" | grep -vxF "$prev" | while IFS= read -r l; do
    [ -n "$l" ] && echo "NEW_COMMIT ${l%%=*}=${l#*=} :: $(git -C "$R" log -1 --format='%s' "${l#*=}" 2>/dev/null)"; done
    prev="$cur"; fi; done
```
分支刪除不發事件(只發新增/移動);claude/* 殘留若被 harness 移動會發 NEW_COMMIT、識別非 3DS 即忽略。

## 3. Findings(逐 commit 追加)

### 2026-06-15 — 3DS-3 plan 關卡1 review-side 第二意見(code 前、非 binding;binding = commit 落地後關卡2 diff 審)

審 `docs/specs/2026-06-15-m3-3ds-3-callback-route-plan.md`(fresh-context、不信摘要)。**verdict = PASS-with-2-notes**(可 greenlight 執行側)。

驗證(非僅信 plan 字面):
- **IDOR 閘真存在** ✓:`orders_select_own` `FOR SELECT TO authenticated USING (customer_user_id = (select auth.uid()))`(`20260604120000_m3_s2a` L193-195)+ `GRANT SELECT ON orders TO authenticated`(L190)→ cookie client RLS own-only,plan 描述屬實、且該 migration 已上 prod(②-①)。
- codex must-fix(清車 hydration race)→ §5.3 `if (isHydrated) clear()` + 預塞 localStorage remount 真清測 = 正解 ✓。
- 架構修正(page Server Component vs api route)、零信任(只認 order UUID、settleCharge Record 權威)、fail-closed(getUser/歸屬/settle throw→processing 不 500 不偽 paid 不清車)= 皆成立 ✓。
- Sean A1-A4 全 A、安全面無雷:Q4(pending 清車)= lock 持有=可能已扣→清(防雙扣)、failed=markFailed 釋鎖→留車,與既有 useChargePayment processing 政策一致 ✓。

🟡 2 notes 交執行側折入(非 blocker、不改 Sean 決策):
- **N1**:settleCharge cookieless 無 ownership 檢查 → §5.1 step3 IDOR 歸屬閘是**唯一**歸屬防線 → code 必把「歸屬失敗」做成**硬 early-return**(非僅順序語句),確保任何 edge/throw 路徑都無法 fall-through 到 step4 的 settleCharge 寫入。
- **N2**:`no_attempt` 併入 pending→清車。真 3DS 導回應有 attempt,no_attempt 屬異常態;清車安全面 OK(order 已建、安全優先),但加 code 註解避免未來讀者誤判為 bug。

關卡2(binding)待 commit 落地:除上述,另查 ① CartContext `clear` 是否 stable ref(否則 isHydrated effect 每 render 重呼,無害但記)② CheckoutSuccess paid/processing/unknown 回歸不退化 ③ 經銷價雙 grep ④ 完整 pnpm test ⑤ codex K2(鐵則12)。哨兵 `bw75eq243` 待命。

---

### 2026-06-15 — 3DS-3 commit `ba56530` 關卡2(binding、fresh-context 對不可變快照)

`feat(payment): 建 3DS-3 callback 完成頁 + failed 變體 [m-3]`。review 全程 pin `ba56530`(我自跑三綠前後 `git rev-parse HEAD` 皆 ba56530、工作樹未移)。

**驗證矩陣(逐項實證、非信 commit 字面):**

| 項 | 結果 | 實證 |
|---|---|---|
| 三綠 | ✅ | 自跑:TYPECHECK_EXIT=0 / LINT_EXIT=0 / BUILD_EXIT=0(route `/checkout/callback` 註冊 ƒ Dynamic) |
| 完整 pnpm test | ✅ | 自跑:Test Files 116 passed、**Tests 1002 passed**(與 commit「1002」一致;0 fail) |
| N1 IDOR 硬擋(我關卡1 note) | ✅ | page.tsx L78-107:getUser throw / 非 UUID / 歸屬讀 error|!data / catch 各自 `return renderProcessingGeneric()` 硬 early-return,無 fall-through 到 L112 settleCharge;`.eq('customer_user_id', userId)` 應用層縱深(L99,codex K2 採納);test ④ 斷言非本人(PGRST116)→ settleCharge **未呼**+displayId **未洩**;test ⑤ 斷言 `.eq('id')`+`.eq('customer_user_id')` 雙 filter |
| 出口窮盡 | ✅ | SettleChargeOutcome 僅 4 kind(paid/failed/pending/no_attempt);page 顯式 failed+paid、else 收 pending+no_attempt = 窮盡;catch→`{kind:'pending',reason:'record_unreachable'}` 為合法 union member |
| fail-closed | ✅ | 三 throw 點皆退 processing、不 500、不偽 paid;`redirect('/login')` 在 try/catch **外**(L81、NEXT_REDIRECT 不被吞);test ②⑨ 釘 |
| 零信任 | ✅ | 只讀 `sp.order`+UUID_RE 形狀;status/rec 全程未讀;成交權威只在 settleCharge |
| hydrate-race must-fix | ✅ | ClearCartOnSuccess L29 `if (isHydrated) clear()` + deps `[isHydrated, clear]`;CartContext `clear=useCallback(()=>setItems([]),[])` **stable ref**(我關卡1 疑點解除);test 用**真 CartProvider**+預塞 localStorage+remount 斷言 qty:0 **且** localStorage===[](真抓 race,非只測 clear() 被呼) |
| runtime:CartProvider 包路由 | ✅ | app/layout.tsx L76-78 `<CartProvider>{children}</CartProvider>` 根層 → useCart 不 throw(測試綠≠真機過的常見雷,已查) |
| failed 變體 + 回歸 | ✅ | CheckoutSuccess:failed COPY/CTA→/cart;paid/processing/unknown COPY 與 /products CTA 不動;test 5 條釘回歸 |
| 鐵則 1 design 保真 | ✅ | grep design `OrderCompletePage.jsx` L33/34/41/110 = paid COPY「N°ORDER · CONFIRMED」「訂單已成立」「N°ORDER」「繼續購物」字面相符;failed/processing 為 PCM 自撰(design 無此態、同 ②-④ 既例)合法 |
| 鐵則 12 經銷價 | ✅ | 三重:新源 static grep ZERO;**client bundle(.next/static)ZERO** price_store/priceByTier/price_by_tier/cost/shopee;callback 渲染零 price/amount。server chunk 的 price_* 僅 lib/products+ProductPage(既有、正確位置、3DS-3 未碰) |
| 卡資料零落地 / 金額零浮點 | ✅ | 本片不碰卡欄、不渲染金額 |
| manifest 同步 | ✅ | CheckoutPage 條目加 callback/page+ClearCartOnSuccess、變體列加 failed、`last_modified_commit:1f1e187`(可達祖先、避 orphan) |
| 字面 vs 事實 | ✅(1 NIT) | headline「三綠/1002」精確;架構偏離(page vs api route)、displayId 縮單欄、3DS-2b 已推皆於 body 誠實標。**NIT(良性低估)**:body「callback page 10」實際 11 條 `it()`;為**低估**(做多於宣稱)非誇大 → 不違鐵則 11、不需 amend(memory `iron-rule-11-scope`) |

**codex 關卡2(審查側獨立、cross-model):** 進行中(task `b6381ovw1`、read-only、zero-trace 檢查中)。verdict 回來補於下方 + 最終 sign-off。

**手動關卡2(待 codex 收尾):PASS**。但 ↓ codex K2 逮到一條我手動審+執行側都低估的真破口。

**codex 關卡2 verdict = FAIL(1 must-fix)** — task `b6381ovw1`、exit 0、**zero-trace OK**(before==after porcelain、codex 零動檔)、HEAD 仍 ba56530。

> **finding(codex)**:`page.tsx:130` `no_attempt` 一律 processing + `<ClearCartOnSuccess/>`。但 `settleCharge` 在無 active attempt 時回 `no_attempt`,而 failed attempt 經 `markFailed` 轉 inactive → webhook/sweeper 先結算失敗、或使用者刷新 failed callback 後,callback 把「付款失敗」**誤顯示成處理中並清空購物車**,違反「只 failed 不清車」。修法:`no_attempt` 不可直接清車;需區分 latest-failed vs 真無 attempt。

**審查側仲裁(codex 第二意見 vs Sean A4 拍板 — 不無腦照收、不擅自推翻、raise Sean):**

- **finding 屬實、且比 N2 註解「benign」更嚴重**。關鍵實證(trace `settle-charge.ts`):L56-61 `findActiveByOrderId` 最先跑、無 active → **立刻** `no_attempt`;L64-70「order 已 paid → paid」短路在其後、且 findActive 含 `charged`(partial index `status IN('pending','charged')`)→ **paid 單回 paid 不會回 no_attempt**。故 `no_attempt` ⟺ attempt 為 `failed`(markFailed 只在 TapPay 確認 final-failed -1/5 才觸發=確定未扣款)**或** 從未建立 → **`no_attempt` 必然「未扣款」**。
- ⇒ Sean A4 把 `no_attempt` 併入 `pending` 的理由是「可能已扣款 → 清車防雙扣」,**該前提對 no_attempt 不成立**(它確定未扣款、零雙扣風險)→ 清它**無安全收益**、卻在失敗付款上**摧毀購物車 + 誤標處理中**。3DS 的 webhook vs frontend_redirect 競態常見 → 非罕見邊緣、會打到**首屏**(非只刷新)。
- **codex 的修法(failed-state reader 區分 failed/never)過大**;**最小正解**=`no_attempt` 移出清車桶(`pending` 仍清〔真可能已扣〕、`no_attempt` 與 `failed` 同列不清車)。此舉**對齊 A4 真意、改 A4 字面** → 必 raise Sean(不擅改拍板)。
- 「失敗刷新/競態仍顯『處理中』而非『失敗』」的純文案瑕疵 → 最小修後無安全/購物車影響、留讀路徑/3DS-4。

**審查側 3DS-3 判定 = FAIL(1 must-fix candidate、HOLD push)**。已 raise Sean 決策(最小修 now vs 完整修 vs 全延 3DS-5b)。其餘 12 項驗證全 PASS(矩陣不變);此單點為唯一阻擋。Sean 拍板後:最小修走執行側 amend → 審查側 codex round2 複審(每 slice 2 輪內)。

---

### 2026-06-15 — 3DS-4a-1 migration `f5b8015` 關卡2(審查側、鐵則 12 payment migration)

`feat(schemas): 建 3DS-4a-1 sweeper inbox claim/mark RPC + 3DS-4 plan`。f5b8015 **未 push**(remote=76cbf00)→ 可 amend。執行側已自跑 MCP 模擬 + code-reviewer + codex K2 PASS;審查側獨立複核。

**審查側獨立驗證(全 PASS):**
- **SQL 親讀全 trace**:原子 claim(CTE FOR UPDATE SKIP LOCKED + LIMIT clamp LEAST/GREATEST [1,1000]、attempt_count++ 唯一遞增=token)、token guard mark(WHERE attempt_count=p_claimed_count、stale=no-op)、ceiling-expirer **lease 條件**(next_retry_at<=now() 避誤標 lease 內事件)、退避 2^(count-1) 封頂 16(GREATEST 防負指數)、last_error allowlist→unknown(零 PII)、全 RPC SECURITY DEFINER + search_path='' + schema-qualified(LEAST/GREATEST SQL 構造安全)。
- **prod 狀態 read-only 實查**(零留痕):payment_confirmer 存在、**全域表/欄 grants=0**(→ role-hygiene assert 上 bundle 必過)、payment_webhook_events + 4 RPC 在 prod=null(0a/4a-1 未推、bundle 正確未解鎖)。
- **三綠**:4a-1 改 .sql/.md only(零 TS)→ 繼承 76cbf00 full-green 基線(typecheck/lint;build N/A)。
- has_function_privilege 矩陣 assert(4 RPC × 4 角色 fail-closed)+ 全域 role-hygiene assert 完整。

**🔴 審查側 codex K2(獨立、`biqmxttlb`、exit 0、zero-trace OK)= FAIL、2 must-fix(執行側 codex 漏)**:
- `mark_webhook_processed:111` + `mark_webhook_retry:143` 的 token guard **未排除 needs_manual_review=true 的 row** → 反例:claim 把 attempt_count 推到 8、worker 卡超 lease;expirer 轉 manual;late worker 用同 claimed_count=8 mark → 仍成功 → `processed=true + needs_manual_review=true` 矛盾態 / late retry 仍更新 manual row。修=兩處 WHERE 加 `AND needs_manual_review=false`(正常 count=8 markRetry 此時仍 false→正常轉 true、不受影響)。

**審查側仲裁(codex 第二意見 vs 設計、非盲收)**:
- **現行設計下此 race 被 maxDuration 防住**:plan §60 lease=5min **≫** maxDuration=60s;worker 60s 被 Vercel kill、expirer 5min 才標 manual → late mark 不可達(worker 已死 4min)→ **非 live bug**。
- **但仍建議補**:① migration 正確性不該silently依賴另一片(4c route)的 maxDuration=60s 設定(耦合);② 🔴 **Vercel 預設 maxDuration 現為 300s = lease 5min**(session-start 知識更新)→ 若 4c 漏設 60s 用預設,lease=maxDuration→race 邊界開啟;③ 修法 trivial(2 WHERE 各加一條)+ 無害(codex 證正常流不受影響)+ 把不變式收回 migration 本地。**安全面=nil**(無雙扣/無偽 paid、settleCharge 冪等+Record 權威;最壞=Phase II 假人工告警/cosmetic late retry)。
- **forward note 給 4a-2**:`mark_attempt_settle_retry` 須同樣加 `AND needs_manual_review=false`(對稱)。

**審查側 4a-1 判定 = FAIL(2 must-fix、防禦性、HOLD)**:其餘全 PASS。建議補 codex 修(decouple maxDuration 耦合)→ f5b8015 未推 → 執行側 amend → 審查側 codex round2 複審。已 raise Sean。

**2026-06-15 Sean 拍 A → 執行側 amend(f5b8015→4b474c3→9bfbde9〔再 amend 修 message/STATUS〕)→ 審查側 round2 複審 = ✅ PASS**:
- 淨 migration 修(f5b8015→9bfbde9)= **僅** mark_webhook_processed L114 + mark_webhook_retry L147 各加 `AND needs_manual_review = false` + 2 COMMENT 更新;**migration 其餘零變動**(4b474c3→9bfbde9 migration diff 空、再 amend 只動 message/STATUS)→ 外科手術式、無新破口。
- 正常流非退化:正常 count=8 markRetry 此時 needs_manual_review 仍 false（同 run 內、本 run expirer 在 claim 前跑時 count 還 7）→ 過 WHERE → SET 轉 true,正常轉人工不受影響(codex r1 + 審查側雙證)。
- 4a-2 forward note 已折入 plan §5.1b L79（`mark_attempt_settle_retry` token guard 含 `AND needs_manual_review=false`、codex K2 r1 對齊）+ 子片表 L34 + 收斂段 L193 + MCP「manual row late mark→no-op」補測。
- 三綠繼承(.sql/.md only)。

## ✅ 3DS-4a-1 審查側最終 sign-off = PASS（HEAD 9bfbde9、未 push）
SQL 全 trace PASS（原子 claim/token guard/ceiling-expirer lease 條件/退避/allowlist/窄權雙 assert）+ prod role-hygiene 前提 grants=0 實查 + codex K2 r1 防禦修 round2 PASS + 三綠。**未 push、未 db push**（入 bundle、cart_session_id 整合前不單推）。**下一步 = 3DS-4a-2**（attempt schema + claim_stuck + flag_non_unpaid + mark_attempt_settle_retry〔含 manual guard〕、plan §5.1b 就緒）。

**2026-06-15 Sean 拍 A(最小修)**:`no_attempt` 改不清車(`pending` 仍清不變);改 A4 字面、對齊 A4 真意(防雙扣;no_attempt 必然未扣款)。失敗顯「處理中」文案瑕疵留讀路徑/3DS-4。fix 範圍:page.tsx 拆 no_attempt 分支〔processing 不掛 ClearCartOnSuccess〕+ 改 §5/N2 註解 + test ⑦ `hasClear` true→false + 連帶 docs(plan §5.1/Q4、manifest、STATUS)+ ClearCartOnSuccess.tsx A4 註解 字面修正。

**🔴 交付方式更正(Sean 拍 A_交付=A)**:我 fix 指令誤寫「amend ba56530(未 push)」,但**審查側獨立驗證 `git ls-remote origin refs/heads/dev` = ba56530**(已 push、為 remote dev tip)→ amend 需 force-push、dev ruleset 擋(memory `github-branch-rulesets`)。改 **A=follow-up commit 疊 ba56530 上**(fast-forward、不改寫已推歷史、ruleset 安全)。教訓:交付方式(amend vs follow-up)必對**當下驗證的 remote 狀態**判定、非記憶中的 push 狀態。3DS-3 → 2 commit(ba56530 初版含 must-fix + follow-up 修),dev 線性誠實可審。

---

### 2026-06-15 — fix commit `76cbf00` 關卡2 round2(修後複審、binding)

`fix(payment): 3DS-3 no_attempt 改不清車(codex K2 r1)`。fresh-context pin `76cbf00`(三綠自跑前後 HEAD 皆 76cbf00);`git ls-remote` 確認 76cbf00 = origin/dev tip(Sean 已 push)。

- **手動複審 delta PASS**:page.tsx 新增 `if (outcome.kind==='no_attempt') return <CheckoutSuccess processing/>`(**無 ClearCartOnSuccess**);fall-through 僅剩 pending(仍清);四 kind 窮盡(paid 清/pending 清/no_attempt 不清/failed 不清=清車⟺可能已扣款)。test ⑦ `hasClear` true→false、⑤⑥⑧ 不動。docs 字面(plan §5.1/Q4/驗收、manifest、STATUS、ClearCartOnSuccess 頭註)全同步。
- **三綠自跑**:typecheck/lint/build exit 0、**Tests 1002 passed**、0 fail。
- **codex round2 = PASS**(task `bke6w8tab`、exit 0、**zero-trace OK**)。逐項:① round1 清車破口已收(no_attempt 不掛 ClearCartOnSuccess)② regression 無(failed/paid/pending 不變、4 kind 窮盡)③ correctness/security 無新破口(displayId 來源不變、settleCharge 仍在 IDOR 閘後、early-return 不破 pending fall-through)④ 字面vs事實 PASS-with-nit。
- 🟡 **唯一殘留 NIT(codex round2 抓、我 grep 漏〔用英文元件名非「清車」〕)**:`page.test.tsx:11` 檔頭測試清單仍寫「⑦ no_attempt → 同 processing + ClearCartOnSuccess(N2)」舊政策(實際 test ⑦ 已正確翻 false)。純註解、零功能/correctness 影響。**76cbf00 已 push → 不可 amend、不值另開噪音 commit** → **track:下次觸碰 callback 檔的 commit(3DS-4 或批次清理)順手掃掉**(memory `clean-nits-no-dangling-optional` 精神=清但不開噪音 commit)。系統性 sweep 確認此為唯一殘留(page.tsx:135 命中為正確解釋性註解、非 stale)。

## ✅ 3DS-3 審查側最終 sign-off = PASS

`ba56530`(原 callback 完成頁)+ `76cbf00`(no_attempt 不清車修)共構 3DS-3、皆已 push origin/dev。codex K2 round1 FAIL→修→round2 PASS;13 項驗證矩陣全 PASS;安全紅線(IDOR/雙扣/fail-closed/零信任/經銷價/卡資料)零破口;三綠+1002 自驗;design 保真;manifest/STATUS 同步。**唯一 follow-up = page.test.tsx:11 stale 註解(下個 callback-touching commit 掃)**。

**下一步**:回到押後的 **3DS-4 規劃**(A=執行側起草 plan+codex K1→我審〔建議〕 / B=我起草 / C=其他)。Sean 拍板後啟動。哨兵 `bw75eq243` 持續待命。

---

### 2026-06-15 — 3DS-4 sweeper cron plan 三模型審查(Sean 親口要、規劃階段、唯讀審 plan)

`docs/specs/2026-06-15-m3-3ds-4-sweeper-cron-plan.md`(尚無 code、未 commit)。三模型各依優點獨立審,審查側 triage 合併。**verdict = plan 未就緒、4a 前須實質改版**(全部非 Phase I live 危害〔零真流量〕,但多項改 4a migration schema/RPC 設計 → 必先改 plan 才寫 4a)。

- **Codex GPT-5.5**(跨模型、`b36svixo6`、zero-trace OK):FAIL、5 must-fix + 1 consider。
- **Opus 4.8**(8 維度 Workflow `w4aiqvdtl`、54 agents、逐 finding 對抗驗證):16 gap + 2 risk(18 nit 經驗證剔除)。
- **Gemini 3 Pro**(廣度、`bai9xx427`、zero-trace OK;⚠️ Sean 要的 3.5-pro 在 CLI 回 404、用最新可用 3-pro-preview):5 廣度洞見。

**合併後 8 群(去重 + 共識權重):**
1. 🔴 **stuck-attempt 路徑無退避/上限/升級 → 每輪無界重打 Record**(3 模型共識:Codex#4 + Opus O1/O3/O4/O6/O14/O16 + Gemini G4)。`payment_charge_attempts` 無 attempt_count/next_retry_at(inbox 有)→ confirm 永遠失敗的 charged-unpaid 每輪被掃、重打 Record、無告警上界。**改 4a schema**:加 settle_attempt_count/next_settle_at 欄 + mark RPC + claim ceiling,鏡像 inbox 退避。
2. 🔴 **`payment_status<>'paid'` 太寬**(Codex#2 + Opus O2 + Gemini G3):掃到 refunded/partiallyPaid(confirm 拒非 unpaid、markFailed 拒 charged)→ 永不收斂。charged 分支改 `='unpaid'`、非 unpaid 非 paid → 告警不迴圈。
3. 🔴 **漏傳 recTradeIdHint**(Codex#1):sweeper 呼 settleCharge 沒帶 inbox 的 rec → 退弱識別、違 master §1 優先序。inbox 路徑帶 recTradeIdHint + 補測。
4. 🔴 **claim lease 無 token guard + lease_interval 未定義**(Codex#3 + Opus O3/O4/O6/O16):markRetry/markProcessed 會覆寫被重領事件;lease_interval 須 ≥ maxDuration;attempt_count 語意(claim 次數 vs 失敗次數)混用。claim 回 token/count、mark 加 guard、釘 lease_interval、清 attempt_count 語意。
5. 🟠 **部署/migration sequencing**(Codex#5 + Opus O5/O7/O9/O10):vercel.json 啟用拆獨立片;CRON_SECRET 已存在(plan 誤當新設);須明寫 GET handler(Vercel cron GET、寫錯動詞→永不觸發);4a 時戳須最末;4a 末補 role-hygiene 回歸 assert(誤 grant 會炸整 bundle)。
6. 🟠 **prod hard-gate 未硬列 + master「轉人工」durable 被降為 ephemeral log**(Codex#6 + Opus O11/O12/O13/O18 + Gemini G1/G5):Q4-B/告警接入/heartbeat/轉人工 沒進 master §9 prod checklist + backlog 掛號;master 要求的「轉人工」被靜默降為 console.error(無 durable needs_manual_review 旗標)。amend master §9 + backlog + durable 旗標(或誠實標 Phase I 降級)。
7. 🟠 **連線池/批次預算**(Opus O15):maxDuration 60s + per-req new Client + 100 筆順序 settleCharge → pool 耗盡風險未評估。順序/有界並發 + 預算算式 vs pooler ceiling。
8. 🟡 **UX 防雙下單**(Gemini G2):台灣買家付款卡住會重新下單→重複扣款。Phase I 加前端 3DS 等待防呆文案(廉價、防雙下單);Phase II 撈救成功主動通知。
+ O8(安全但需文件化):charged-unpaid 遇 explicit_failed→markFailed RAISE→settleCharge 吞 pending=刻意安全,補測 + 註解避免被誤改釋鎖。

**建議**:plan 退執行側改版(群 1-7 折入、群 8 Phase I 加前端文案 + Phase II)→ 改版後我輕量複審(只驗修正)→ 才寫 4a。**Phase I 零真流量、無 live 危害**,但群 1-5 改 4a migration schema/RPC,必先定 plan。原始輸出:/tmp/codex-k1r-3ds4-out.txt、workflow result `tasks/w4aiqvdtl.output`、/tmp/gemini-3ds4-out.txt。

**執行側已開始改版(2026-06-15、並行)**:master plan §9 已 amend 群6 四項(Q4-B/告警channel/heartbeat/轉人工 durable)、backlog **#231** 已開(3DS-4 prod 前置)— 審查側讀過、與群6 一致。(此為執行側 uncommitted 工作樹改動,審查側不碰、避 git index 撞車。)

---

### 2026-06-15 — Gemini 3 Pro 整個結帳流程廣度檢視(Sean 親口要、優化非阻擋、triaged)

Gemini 3 Pro(`b7pxsd7fd`、read-only;porcelain TRACE_DIFF=執行側並行改 master§9+backlog 非 Gemini、已驗)。⚠️ Gemini 3.5-pro 在 GCA auth 仍 404、CLI 0.46 已最新 → 用 3-pro-preview(最新可用)。6 面 triaged + Sean 處置:

- 🟢 **#1 TapPay 卡欄字級 ≥16px(審查側驗證屬實)**:`useTapPayCard.tsx` L141-150 `card.setup` **無 `styles` 區塊** → iframe 內 input 走 TapPay 預設(常 <16px)→ iOS Safari 點卡欄自動放大、年長者迷失。修=card.setup 加 `styles:{input:{'font-size':'16px'}}`。**Sean:進行**(獨立小 slice / 併下個 checkout 前端 slice)。
- 🟡 **#2 LINE in-app browser × 3DS 銜接**(掉單)/ **#3 客服 Email+時間撈 orphan/unknown 單** / **#4 前端錯誤遙測(ready=error/unknown→上報 user+碼、零PII)** / **#5 Step3 退換貨連結+客服 LINE**:**Sean:進行**(backlog、Phase II prod 前)。
- ⚪ **#7 合作店家取貨 Store Picker(O2O)** / **#8 TapPay SDK 預載(Step1/2 idle 下載)**:**Sean:進行**(backlog、nice-to-have/商業)。
- **#6 付款方式廣度**:Sean=**只 LINE Pay + Apple Pay 類錢包**(分期不做、memory `installment-not-doing`;ATM/超商不在此次)→ **已存在 backlog #226(LINE Pay)+ #228(Apple/Google Pay),無需新增**、後續施工。

**待辦(審查側、等執行側 #231 backlog 編輯 commit 後做,避 git index 撞車)**:#1-5/#7-8 落 backlog 條目 + 寫 #1 iOS 16px 小 slice 指令(交執行側)。原始輸出:/tmp/gemini-checkout-out.txt。

---

### 2026-06-15 — 3DS-4 plan 改版輕量複審(審查側、規劃階段唯讀、只驗折入)= **PASS**

執行側依三模型 8 群 + 自跑 codex r2(FAIL→3 新 must-fix)逐項折入改版,並達 codex 2 輪上限。審查側 fresh 讀改版 plan 全文 + trace 新機制 vs schema/settleCharge 契約。**只驗折入正確性 + 新破口,非重新發散。**

**9 項驗證矩陣(全 ✓):**
1. 群1 stuck 退避/上限/轉人工 → §5.1b ALTER attempt 加 settle_attempt_count/next_settle_at/needs_manual_review(鏡像 inbox)+ claim ceiling 濾 + ceiling-expirer ✓
2. 群2 charged 分支 `payment_status='unpaid'` + flag_non_unpaid_active_attempts(非 unpaid 非 paid→manual)✓
3. 群3 §5.2① settleCharge 帶 recTradeIdHint(inbox claim 回 rec)+ 補測 ✓
4. 群4 §5.1 lease=5min 釘死+不變式、attempt_count 語意=claim 次數、退避 (count-1)、mark token guard `WHERE attempt_count=p_claimed_count`+回 affected+stale no-op ✓
5. 群5 4c/4d 拆分、§5.3 GET handler+requireCronSecret(env 未設 fail-closed)、§5.4 4d 前置(Vercel Production env 驗 CRON_SECRET)、§5.1b 時戳最末+role-hygiene assert ✓
6. 群6 durable needs_manual_review、master §9 amend(已驗)、backlog #231(已驗)、Q4-B 綁 flag-on 前置鏈 ✓
7. 群7 §5.2 順序/有界並發 p-limit 2-3 + 預算算式(100×500ms=50s<60s)✓
8. 群8 §5.5 Phase I 防呆文案(動 3DS-3 附帶)+ Phase II 通知;O8 §5.2 測+註解勿改釋鎖+distinct reason #231 follow-up ✓
9. codex r2 三 must-fix:①ceiling-expirer(§5.1+§5.1b 前置)②claim_stuck 原子(對稱 inbox FOR UPDATE SKIP LOCKED+lease+token、§5.1b)③flag_non_unpaid RPC(§5.1b)✓

**對抗檢查(新機制健全性、trace 過):**
- ceiling-expirer 真解孤兒:claim 把 count 加到 ceiling 後 crash → 該 row `count>=ceiling` 被 claim 濾掉、又無 mark → 原永久孤兒;expirer 前置 `SET needs_manual_review WHERE count>=ceiling` 轉 durable manual(1 cycle 延遲、可接受)✓
- ceiling+needs_manual_review **統一界定**群1 無界迴圈 + Opus risk O17(charged-unpaid rec 撞他單→confirm 永 RAISE)+ O8(charged 遇 explicit_failed→markFailed RAISE 吞 pending):皆 settleCharge 回 pending→markSettleRetry++→達 ceiling→manual+停打 Record,**全部有界** ✓
- claim lease(+5min)vs markRetry 退避覆寫:claim 設 lease 撐處理窗(≤60s<5min)、處理完 markRetry 覆寫真退避,對稱 inbox 既有模式、無丟失 ✓
- token guard:5min lease 內無法被另 run 重領 → guard 為處理超 lease 的防禦縱深(stale no-op);claim/flag/expirer 三者 payment_status 分軌(unpaid claim / 非 unpaid 非 paid flag)無交疊 ✓

🟡 **2 非阻擋 impl-stage watch(不擋批准、寫 4a 時留意)**:① 退避是否封頂 16min(plan「1/2/4/8/16」暗示封頂)→ ceiling=8 → 達 manual 約 1.3hr,對 3DS(分鐘級解)充裕、合理;② settleCharge 對已 claim stuck attempt 理論不回 no_attempt(剛 findActive 到),若極端 race 回 no_attempt 亦被 ceiling 界定、無無界迴圈。兩者皆 ceiling 兜底、非新洞。

**審查側判定 = PASS**:8 群 + codex r2 三 must-fix 全折入、設計健全(inbox/attempt 對稱、ceiling 統一兜底)、無新破口 → **plan 就緒**。Q1-Q5 待 Sean 拍(審查側concur 全 A;Q2 ceiling 5→8 + reason 連續性告警=正確收緊、贊同)。Sean 拍 Q1-Q5 後執行側才寫 4a-1。

---

### 2026-06-15 — 3DS-4a-2 migration `1d82623` 關卡2(審查側、鐵則 12 payment migration、binding)

`feat(schemas): 建 3DS-4a-2 attempt sweeper 退避/上限/轉人工 RPC`。fresh-context pin `1d82623`(工作樹 .sql 未漂移、diff <(git show 1d82623:…) 對比驗證);commit diff = 僅 STATUS.md + `20260615120001_m3_3ds_4a2_attempt_sweeper_rpc.sql`(294 行)。**remote=76cbf00 → 1d82623 未 push(amend 可行)**。執行側已自跑 MCP 模擬 + code-reviewer + codex K2 PASS;審查側獨立複核。

**三路獨立審查收斂(我人工 trace + codex K2 cross-model + 8 維度對抗 workflow)= 全 PASS、0 must-fix:**

| 項 | 結果 | 實證 |
|---|---|---|
| SQL 親讀全 trace | ✅ | claim 原子(CTE FOR UPDATE OF a SKIP LOCKED + LIMIT clamp LEAST/GREATEST[1,1000] + settle_attempt_count++ token、RETURNING ++後值無 off-by-one)/ mark token guard **含 needs_manual_review=false**(對齊 4a-1 codex K2 r1、late mark 已轉人工 row no-op)+ unpaid 閘 + 退避 2^(count-1) GREATEST(c-1,0) 封頂 16 + ceiling=8→manual + 不++ / expirer lease 條件(count>=8 AND next_settle_at<=now())+ [B] unpaid 閘 / flag_non_unpaid(NOT IN unpaid,paid)/ 四 RPC payment_status 分軌互斥完整 |
| 4a-1 對稱 | ✅ | 結構鏡像;attempt 特有差異([A]last_settle_error 鏡像 inbox last_error/[B]unpaid 閘 join-orders 必要/[C]FOR UPDATE OF a 只鎖 a/[D]age-gate)皆有理 |
| 窄權雙 assert | ✅ | 4 RPC REVOKE **含 service_role**(memory `supabase-service-role-execute-default-grant`)+ GRANT 唯 payment_confirmer + has_function_privilege 矩陣 4×4(正向+負向全覆蓋)+ 全域 role-hygiene assert;全 SECDEF + search_path='' + 全識別子 schema-qualified(零注入) |
| MCP 唯讀 prod 前提 | ✅ | **payment_confirmer 全域 role_table_grants=0 / role_column_grants=0**(→ 4a-2 §8 role-hygiene assert 落 prod 必過)、4a-2 四 RPC+四欄 prod 皆 absent(bundle 未提前 push)、payment_charge_attempts 表存在(ALTER 標的在)、0a inbox absent(bundle 一致)。純 metadata SELECT、零寫入、零留痕 |
| 三綠 + full vitest | ✅ | 自跑 @ b9f04e2(含 4a-2 .sql 合併樹):typecheck/lint/build/test 全 exit 0、**Tests 1002 passed (116 files)**;4a-2 純 .sql/.md 對 TS 工具零影響(結構繼承)+ 合併樹實證綠 |
| codex K2 cross-model | ✅ | `b0c0gu0oz`、exit 0、**zero-trace OK**(4a-2/4a-1 .sql 未被動、唯一 tracked 變動=執行側 backlog WIP)。VERDICT=PASS、A–H 全 PASS、0 must-fix;C) **獨立判定殘餘 TOCTOU=cosmetic**(只設 needs_manual_review、不改 payment_status、不釋 charged 鎖、不碰金額/PII) |
| 8 維度對抗 workflow | ✅ | `w8vumz80u`、17 agents、23 raw findings → 對抗驗證後 **confirmed=1(nit)**、0 must-fix、0 money/security。8 維(claim 原子/mark guard/expirer-TOCTOU/flag/權限注入/字面vs事實/有界性/bundle)逐 finding REFUTE |
| 時戳 bundle 最末 | ✅ | 20260615120001 = migrations 目錄最末(0a→0b→0c→1b→#214a→4a-1→4a-2);forward-only + rollback 註解完整逆序(DROP 4 func + DROP 4 col) |
| 鐵則 12 / 零 PII | ✅ | last_settle_error allowlist 三碼+unknown(RPC 唯一寫者、p_reason_code 任意輸入不原文落 DB);本片零金額/零經銷價/零卡資料 |
| 字面 vs 事實 | ✅ | commit body [A][B][C][D]+4 欄+4 RPC+退避封頂 16+ceiling=8 逐條與 SQL 相符;[A] 第 4 欄 last_settle_error 為 plan §5.1b L79「+ last reason_code」+鏡像 inbox 所需(良性「做足於宣稱」、非 scope creep、檔頭誠實揭示)|

**🟡 殘留(全非 blocker、forward note):**
- **[B] 殘餘 TOCTOU(三方一致判 cosmetic)**:expirer/mark 語句快照讀 unpaid 後並發 callback commit order→paid → 可留 `paid + needs_manual_review=true`。**零 money/security**(只設旗標、不改 payment_status、不釋鎖、不碰金額/PII;人工複查即清)。Phase I 零真流量不可達。執行側已誠實揭示 + 路由 #231 候選 → 審查側**獨立驗證 cosmetic 成立**,**raise Sean FYI**(disposition:接受為 cosmetic forward note vs Phase II 後台清 needs_manual_review on settled order;非阻擋、不 push)。memory `adversarial-timeline-self-review-before-codex` 精神=揭示+Sean 知悉,已滿足。
- **4b/4c forward(codex consider 1)**:`sweepSettlements` use-case 須每輪在 claim 前呼 `expire_stuck_attempts_at_ceiling()`,否則 count=8+route crash 的孤兒停在 manual=false(SQL 已備防孤兒 RPC、靠 caller 呼)。寫 4b-2 時釘 + 補測。
- **Phase II perf 索引(workflow nit + codex consider 2)**:量起後加 partial index `ON payment_charge_attempts(created_at) WHERE status IN(pending,charged)`(對稱可考慮 DB CHECK `settle_attempt_count>=0` + last_settle_error allowlist)。backlog 級、Phase I 不需。

## ✅ 3DS-4a-2 審查側最終 sign-off = PASS(HEAD 當時 1d82623、未 push)
SQL 全 trace + 4a-1 對稱 + 窄權雙 assert + MCP prod 前提(grants=0/0)+ 三綠 1002 + codex K2 cross-model PASS + 8 維對抗 workflow(0 must-fix)三路收斂。**未 push、未 db push**(入 bundle、cart_session_id 整合前不單推)。**下一步 = 3DS-4b-1/4b-2/4c/4d**(port/adapter→use-case→cron route→vercel.json gated)。

---

### 2026-06-15 — 副 commit `2d29294`(iOS 16px)+ `b9f04e2`(backlog docs)關卡2 light review = PASS

**`2d29294` `fix(storefront): TapPay 卡欄釘 16px 防 iOS 自動放大`** — 例行前台 slice(SOP step7 不跑 codex)、fresh 對 git show 快照:
- diff 乾淨:useTapPayCard.tsx 僅加 `styles:{input:{'font-size':'16px'}}` + 2 行註解,**不碰 prime/token/卡資料/金額/settleCharge**(commit 字面屬實);型別 tappay.d.ts:44 `styles?: Record<string,Record<string,string>>` 早宣告(無需改型別);test 加 `setupArg.styles!.input!['font-size']).toBe('16px')` regression 斷言、字面相符。
- 鐵則 1 design 保真:grep design-reference 確認**無 card input font-size 字面**(HANDOFF.md 僅述正式串接改 TapPay iframe)→ override `checkoutCardFieldFontSize16` 正當、非偏離。
- 16px = iOS Safari 不自動放大精確門檻(Gemini #1 屬實)。三綠 1002 自跑綠(含此 slice)。manifest 同步(last_modified_commit=1d82623 可達父)。**PASS**。

**`b9f04e2` `docs(backlog): Gemini 結帳廣度 #2-5/#7-8 落 Phase II backlog`** — docs-only(STATUS.md + phase-1-backlog.md +96、零 code/config/migration)→ **PASS**(routine docs、對齊 review-log §3 carry)。

**三 commit(1d82623/2d29294/b9f04e2)+ 前序 9bfbde9 皆未 push**;9bfbde9(4a-1)+ 1d82623(4a-2)入 db push bundle、cart_session_id 整合前不可 db push(持守阻擋)。哨兵 `bsibz5meb` 持續待命接 4b。

---

### 2026-06-15 — `a2dc05e`(4a-2 對抗複驗收尾 + Sean A 拍板)docs-only review = PASS

`docs(specs): 3DS-4a-2 對抗複驗收尾 + Sean 拍 A 殘餘處置`。fresh 對 git show:**docs-only**(STATUS + phase-1-backlog +2 + plan ±1);**4a-2 migration 1d82623==a2dc05e 未漂移、未 amend**(字面「migration 0 改」屬實、diff 實證)。記錄忠實:
- 執行側自跑 Ultracode 6-lens 對抗 workflow `wbpvvr5b7` = PASS-WITH-NITS、**0 confirmed must-fix**(2 nit:refunded/partiallyPaid+ceiling 唯一靠 flag〔4b 每輪呼〕/ paid+pending 盲區,皆 benign 且與 4a-1 對稱)。→ 與審查側 codex K2 + 8-dim workflow **同源收斂**(4a-2 共四路對抗審查全 PASS)。
- **Sean 拍 A**=殘餘窄 TOCTOU 留現狀(Phase II 後台清、非 4b),記 **backlog #231 ⑤**(歸入後台轉人工流程一併清,對齊審查側論證的 #233/#231④ 人工 triage 吸收路徑)。
- plan §5.2③ 強化「flag/expirer 必呼」不變式(收進 codex consider 1 + 審查側/workflow 同源 forward note)+ #231 ⑥ ACL-assert benign nit forward-note。

**TOCTOU FYI 項已由 Sean 拍 A 關閉**(留現狀)。

## ✅ 3DS-4a-2 區段審查側總結(HEAD a2dc05e、領先 origin/dev 5、全未 push)
4a-2(1d82623)四路對抗審查 + 人工 trace + MCP 前提全 PASS、sign-off;副 commit iOS(2d29294)/ backlog(b9f04e2、#232-237 已驗)/ 收尾 docs(a2dc05e)皆 PASS;TOCTOU 殘餘 Sean 拍 A 留現狀關閉。**未 push、未 db push**(bundle 阻擋持守)。**下一步 = 3DS-4b-1**。哨兵 `bsibz5meb` 待命。

---

### 2026-06-16 — 3DS-4b-1 commit `56be19c` 關卡2(審查側、純 code port/adapter、binding、fresh-context)

`feat(payment): 實作 3DS-4b-1 sweeper port + Pg adapter [m-3]`。**接手新審查 session**(前一棒 handoff 預期 HEAD=a2dc05e、實際 4b-1 已落地 `56be19c` 且 **Sean 已推**〔`git ls-remote origin dev`=56be19c〕→ 已推故任何修走 follow-up 非 amend)。fresh-context pin 56be19c(三綠自跑前後 HEAD 皆 56be19c、tracked 工作樹零漂移〔`git status --porcelain` 僅審查側 untracked〕)。diff = 13 檔 525+/8−:port×2 + domain types + adapter×3 + 5 test 檔 + STATUS + plan;**零 .sql / 零 migration / 零 vercel.json**(pure code、db push bundle 未碰)。

**驗證矩陣(逐項實證、非信 commit 字面):**

| 項 | 結果 | 實證 |
|---|---|---|
| 8 RPC 簽名 vs 4a-1/4a-2 migration(exact-match) | ✅ | 親讀兩 migration `CREATE FUNCTION` 簽名逐一對 adapter SQL:`expire_webhook_events_at_ceiling()→int` / `claim_due_webhook_events(p_limit int)→TABLE(rec_trade_id,order_number,attempt_count)` / `mark_webhook_processed(text,int)→int` / `mark_webhook_retry(text,int,text)→int` / `expire_stuck_attempts_at_ceiling()→int` / `claim_stuck_unsettled_attempts(p_age_seconds int,p_limit int)→TABLE(attempt_id,order_id,settle_attempt_count)` / `mark_attempt_settle_retry(uuid,int,text)→int` / `flag_non_unpaid_active_attempts(p_limit int)→int`。**positional 順序全對**(尤其 `claimStuckUnsettled` 傳 `[ageSeconds, limit]` ⟺ `(p_age_seconds, p_limit)`〔最易靜默錯位處〕);型別 cast 全對;SETOF 欄名 adapter `SELECT` 逐字相符 |
| adapter 健壯性 | ✅ | server-only(三 runtime adapter 皆 `import 'server-only'`、結構性零 client bundle)+ `run<T>` per-request connect/finally end(end throw 吞不蓋主錯)+ branded `*ParseError`(sanitizeError 憑類別放行、非「無 code」啟發式)+ SETOF/affected parser fail-closed:claim token `Number.isInteger`(1.5/NaN/字串→throw)、affected 非整數→throw、形狀不符→通用訊息 throw(非靜默 0/undefined) |
| sanitizeError 零 PII | ✅ | 通用訊息 + 安全 SQLSTATE `code`、零 pg 原文/token;test 證 `connect ECONNREFUSED secret-host-details` 不外洩(`not.toContain('secret-host-details')`)、P0001 RAISE `internal-detail` 不外洩 |
| WithFallback 4 新方法主軌-only 委派 | ✅ | expireStuckAtCeiling/claimStuckUnsettled/markSettleRetry/flagNonUnpaidActive 皆 `return this.primary.*`(原參數原回傳直通、零 retry/sleep);論證成立(sweeper 無 user JWT、fallback 需 auth.uid()、失敗→下輪 lease/退避重來無漏寫);test 4 條釘 `toHaveBeenCalledWith` 原參數 + 零 sleep + 回傳 passthrough |
| use-case fake 漣漪不弱化 | ✅ | confirm-payment/settle-charge.test 各 +4 stub(no-op 滿足介面、二 use-case 不呼 sweeper 方法、sweepSettlements〔4b-2〕才呼);無 `as IWebhookInbox` 鬆 cast、無 IWebhookInbox 測試 fake(僅 route real adapter 消費)→ typecheck-complete、零隱藏 stale fake |
| 三綠(forced fresh、繞 turbo cache)| ✅ | `turbo run typecheck lint build --force` = **18 tasks successful、exit 0**(不信 cache、強制重算) |
| 完整 vitest(fresh)| ✅ | 自跑 `pnpm test`:Test Files **116 passed**、Tests **1036 passed**、0 fail(與 commit「1036」精確一致) |
| 鐵則12 經銷價/卡資料/金額 | ✅ | 變更 source 經銷價 grep = **唯一命中是註解「零 token/卡資料/經銷價」**(宣告 absence、非洩漏);.next/static sweeper RPC 字串 = ZERO;本片不碰金額/卡欄/prime/token |
| manifest / STATUS 同步 | ✅ | manifest「零 storefront 元件」屬實(只動 packages/* + docs);STATUS 最近 3 commit〔a2dc05e/b9f04e2/2d29294〕全可達祖先;`f5b8015`(STATUS:11 narrative)= 4a-1 amend-chain 歷史敘述、pre-existing〔+/− 同行〕、非 push-readiness hash(且已推) |
| codex K2 cross-model | ✅ PASS | `codex exec -s read-only`、exit 0、**zero-trace OK**(porcelain before==after、HEAD 仍 56be19c)。VERDICT=**PASS、0 must-fix、3 nit**(獨立 cross-model 確認我手動逮的「3 vs 4」字面) |

**🟡 殘留 3 nit(全 doc-staleness、零 functional/security、非 blocker):**
- **N1 「3 新方法」應為「4」**(commit body〔不可變、已推〕+ STATUS:11):WithFallback 實際委派 4 個 sweeper 方法、4 test 覆蓋。**良性低估**(做多於宣稱、非誇大)→ 不違鐵則 11(memory `iron-rule-11-scope`);我手動 + codex 雙逮。
- **N2 plan §③ 子片表 L35 stale**:4b-1 row 仍寫 `listStuckUnsettled`(改名前舊字)且漏 `expireStuckAtCeiling`/`flagNonUnpaidActive`;同檔 §5.2(L87)已更新為 8-RPC port → plan 內部不一致。
- **N3 STATUS 最後更新日期** `2026-06-15`、但 commit CommitDate `2026-06-16 08:17`(跨夜)。
- **處置**:三者皆 doc-staleness、commit body 已推不可 amend、審查側不 commit(避 git index 撞執行側)→ **forward 執行側下個 commit 順手掃**(4b-2 自然動 STATUS 7 欄 + plan §5.2,同 `page.test.tsx:11` stale 註解 NIT pattern、memory `clean-nits-no-dangling-optional`=清但不開噪音 commit)。非 push-hold(已推)。

**審查側註(為何本片無多維 workflow)**:4b-1 = 純 code port/adapter 委派 + parser,零 SQL/零 money 算術/零新安全邊界/server-only+type-only;風險面遠小於 migration(4a-2 用 8-dim workflow 是因 SQL 並發/權限風險高)。本片以「人工逐檔 trace + 簽名對 migration exact-match + forced-fresh 三綠 + 完整 vitest + cross-model codex K2」覆蓋,三 nit 已 cross-model 確認、無爭議待對抗驗,proportionate。

## ✅ 3DS-4b-1 審查側最終 sign-off = PASS(HEAD 56be19c、已推 origin/dev)
8 RPC 簽名 exact-match〔positional 全對〕+ adapter fail-closed parser〔claim token Number.isInteger〕+ sanitizeError 零 PII + WithFallback 4 方法主軌-only 委派 + use-case fake 不弱化 + 三綠 forced-fresh 1036 + 鐵則12 零經銷價/server-only 結構零 client 洩 + codex K2 cross-model PASS。**0 must-fix、3 doc nit(forward 4b-2 掃)**。已推故無 push-hold;db push bundle 阻擋持守(本片零 migration、不影響 bundle)。**下一步 = 3DS-4b-2**(sweeper use-case `sweepSettlements`)。

**4b-2 forward note(審查時逐條核)**:① 每輪 claim 前必呼 `expireEventsAtCeiling()`+`expireStuckAtCeiling()`+`flagNonUnpaidActive()`(plan §5.2③ 不變式、否則孤兒/refunded 殘留不轉 manual)② inbox settleCharge 帶 `recTradeIdHint`(群3)③ 順序/有界並發 p-limit 2-3(群7)④ O8 charged-unpaid 遇 explicit_failed→settleCharge 吞 pending(刻意安全、測+註解勿改釋鎖)⑤ per-order 去重 in-memory Set(Q4-A Phase I 降級)⑥ pending→markRetry/markSettleRetry 帶 claimedCount token、達 ceiling→needs_manual_review。**哨兵重 arm = Monitor `bakj81vbl`(persistent、全 heads、baseline 56be19c、接 4b-2 起新 commit;隨本 session 結束而停,下一棒重 arm 用 §2 命令)。**

---

### 2026-06-16 — 3DS-4b-2 commit `3fa4aad` 關卡2(審查側、純 code sweeper use-case、鐵則12 金流鏈、binding)

`feat(payment): 建 3DS-4b-2 sweeper 對帳兜底 use-case [m-3]`。哨兵 `bakj81vbl` 抓到 → fresh-context pin `3fa4aad`(三綠自跑前後 HEAD 皆 3fa4aad、tracked 零漂移)。**未 push**(origin/dev=56be19c、`ls-remote` 確認 → 可 amend)。diff = 4 檔 615+/5−:`sweep-settlements.ts`(240 行)+ `.test.ts`(361 行、17 測)+ index.ts export +9 + STATUS;**零 migration / 零 vercel.json / 零 .sql**(pure code、bundle 未碰)。執行側 codex K2 round1 PASS、依成本紀律未跑 round2、**明文交審查側哨兵獨立 K2**(commit body)。

**驗證矩陣(逐項 trace、非信字面):**

| 項 | 結果 | 實證 |
|---|---|---|
| 每輪不變式(plan §5.2③)| ✅ | `expireEventsAtCeiling`+`expireStuckAtCeiling`+`flagNonUnpaidActive(stuckLimit)` 在 claim **前無條件**呼(三 `try{}catch{errors++}`、各自 fail-closed、一守衛掛不阻其他守衛/後續 claim);test「即使無 due/stuck 各被呼一次」+「一守衛 throw→errors++ 續跑+claim 仍進行」釘 |
| inbox 路徑 | ✅ | claim→`settleCharge({orderId:e.orderNumber, recTradeIdHint:e.recTradeId})`(🔴 群3 rec 優先序)→ pending→`markRetry(rec, attemptCount, normalizeReason)`/ terminal·no_attempt→`markProcessed(rec, attemptCount)`;**不對同 order 多 rec 去重**(各 rec 為獨立 work item、去重會孤兒化未標事件、註解+我 trace 確認正解);test recTradeIdHint 入 `recordQuery({recTradeId})` 釘 |
| stuck 路徑 | ✅ | claim→`settleCharge({orderId})`→ pending→`markSettleRetry(attemptId, settleCount, reason)`/ terminal→`stuckSettled++`(attempt 路徑無 processed 旗、settleCharge 改 status 收斂);群1 charged-unpaid 收斂測釘 |
| 🔴 O8 不釋鎖 | ✅ | test:charged-unpaid + Record record_status=5(CANCEL)→ settleCharge markFailed RAISE→吞 pending→`markSettleRetry(...,'record_unreachable')`、**不誤判 terminal、不釋鎖**、errors=0;與 plan §5.2 O8「勿改釋鎖」+ reason=record_unreachable(distinct reason 留 #231 follow-up)一致 |
| per-order 去重(Q4-A)| ✅ | inbox 階段先 `settledOrderIds.add(orderNumber)`(同步、無 await 間隔=原子);stuck 階段 `has()?deduped++:add()`(check+add 同步契約原子、await 在後)→ 並發>1 無 race(worker 在 add 後才 yield);inbox runBounded 全 await 完才跑 stuck claim → 跨來源去重穩;test「inbox settle X→stuck X 跳過 findActive 只 1 次」+「並發下 stuck 同 order 多筆 check+add 原子→settle 1 次」雙釘 |
| runBounded exactly-once + 有界 | ✅ | cursor++ 同步(JS 單線程原子、無 await 間隔)→ 不漏不重;`limit=max(1,min(concurrency,len))`;test「6 事件 concurrency=2:maxActive≤2 + seen 恰一次不漏不重」釘 |
| fail-closed | ✅ | 單筆 `try/catch+errors++`(不中斷整批、test 第二筆仍處理);claim throw→該來源空、另一來源續(各 claim try/catch) |
| token guard / staleMarks | ✅ | mark* 回 affected=0→`staleMarks++`(非錯誤、disposition 計數仍記;result 註解誠實「裁決計數非保證 DB 都寫」);test markProcessed=0→staleMarks=1 errors=0 |
| 鐵則12 | ✅ | 經銷價 grep source ZERO;sweepSettlements 不在 .next/static(server 編排);orderId 全 from DB claim RPC(零 client 輸入)、無 client 參數;settleCharge 冪等+Record 權威+金額整數(本片不碰金額);log `console.error({...result})` = counts only 零 PII;reason 固定碼集 `normalizeReason`(非碼集→'unknown'、RPC allowlist 縱深) |
| 三綠(forced fresh)+ full vitest | ✅ | `turbo … --force` 18 tasks exit 0;`pnpm test` **117 files / 1053 passed / 0 fail**(與 commit「1053(+17)」精確一致) |
| 字面vs事實 | ✅ | sweepSettlements 240 行 / test 361 行 / 17 `it()`(逐數)/ 1053 / 未 push 皆屬實;commit「執行側 codex r1 PASS、未跑 r2、交審查側哨兵 K2」誠實(我已獨立跑) |
| codex K2 cross-model | ✅ PASS | `codex exec -s read-only`、exit 0、**zero-trace OK**、HEAD 仍 3fa4aad;VERDICT=**PASS、0 must-fix、2 nit**;獨立判定「無繞過 Record 權威 / 無 client orderId 路徑」 |

**🟡 殘留 nit(全非 blocker、4b-2 未 push 可 fold;否則 forward 4c):**
- **N4(codex、我實證確認)`sweep-settlements.ts:95` concurrency=NaN → 0 workers**:`Math.max(1, opts.concurrency ?? 1)` 的 `??` 不擋 NaN(NaN 是 number)→ runBounded `Array.from({length:NaN})`=0 worker→本輪 claim 的 row 不處理。**但**:僅當 caller(4c route、未建)顯式傳 NaN 才可達(default undefined→1、任何 literal 1/2/3 安全);最壞=leased row 下輪重來、持續 NaN 則 count++ 達 ceiling→expirer 轉 manual(durable 告警、**fail-safe 非靜默丟失**)。→ nit。修法:4b-2 加 `Number.isFinite` guard(trivial)**或** 4c 注入時驗證 concurrency 為有限正整數。
- **N5(codex + 我同源)`:181` deduped stuck = lease-only skip**:inbox 已 settle 同 order → stuck 直接 return、不寫 markSettleRetry/last_settle_error、只留 5min lease。安全可恢復(order 被 inbox settle 成 paid→下輪 claim 濾 unpaid 不再領;仍 unpaid→5min 後重領真 settle);telemetry/backoff 語意略弱。已有註解。→ nit。修法:明確註解/補測「lease-only skip」或 deduped 用同 reason 標 retry。
- **N1–N3(4b-1 carry,4b-2 未掃)**:N1 STATUS「ChargeAttemptStoreWithFallback 3 新方法」應 4(現於 4b-1 歷史敘述行、commit body 已推不可改)/ N2 plan §③ 子片表 L35 仍 `listStuckUnsettled`、漏 `expireStuckAtCeiling`/`flagNonUnpaidActive`(4b-2 未動 plan)/ N3 4b-1 STATUS 條目日期 2026-06-15(4b-2 新條目日期 2026-06-16 已正確、舊條目歷史)。執行側 commit body 寫的「掃 3 nit」是 codex 自薦 nit、非我的 N1-N3。→ forward 4c(動 plan §5.3+STATUS)順手掃。

## ✅ 3DS-4b-2 審查側最終 sign-off = PASS(HEAD 3fa4aad、未 push)
每輪守衛不變式 + inbox/stuck 雙路徑 + recTradeIdHint + O8 不釋鎖 + per-order 去重原子(並發安全)+ runBounded exactly-once + fail-closed + token guard staleMarks + 鐵則12 零經銷價/零 PII/orderId-from-DB + 三綠 forced-fresh 1053 + codex K2 cross-model PASS。**0 must-fix、5 nit(N4/N5 本片 + N1-N3 carry,皆非 blocker)**。4b-2 未 push → 執行側可選 fold N4 trivial guard;否則全 forward 4c。**下一步 = 3DS-4c**(cron route `app/api/cron/settle-sweep`:GET handler + requireCronSecret + CRON_SWEEPER_ENABLED gate、plan §5.3)。哨兵 `bakj81vbl` 持續待命接 4c。

**4c forward note(審查時逐條核、plan §5.3)**:① `export async function GET`(Vercel cron 走 GET、寫 POST=永不觸發)② `requireCronSecret()` Bearer 硬驗 + timingSafeEqual + env 未設→fail-closed throw(沿 3DS-2 requireNotifySecret)③ 🔴 `CRON_SWEEPER_ENABLED` gate:default false→200 no-op、enabled+RPC missing/DB error→5xx(不可吞 200 偽裝成功)④ concurrency 注入須驗有限正整數(N4 use-case 端已加 Number.isFinite guard、route 端再驗=縱深)⑤ 批次 limit/maxDuration 上限 + 結構化 counts log 零 PII ⑥ 不採信外部輸入(無 client 參數)。4c 純 code、不含 vercel.json(=4d)。

---

### 2026-06-16 — 3DS-4b-2 **amend** `3fa4aad → f200c1a`(執行側 fold 審查側 nit、delta-only 複審 = PASS)

執行側採納審查側 5 nit、amend 4b-2(未 push → amend 合法、`3fa4aad` orphaned、`f200c1a` parent 仍 56be19c)。**delta-only 複審**(已對 3fa4aad 全 PASS、只驗 amend 變動無回歸):

- **delta = 4 檔 24+/4−**:`sweep-settlements.ts`(N4 guard + N5 註解)/ `.test.ts`(+N4 NaN 測=18 測)/ STATUS(N1)/ plan(N2)。
- **N4 修正驗證(我親讀 + 實證)**:`Number.isFinite(req) && req>=1 ? Math.floor(req) : 1` —— NaN/undefined/0/負/Infinity/小數全降為 1(嚴格較原 `Math.max(1, x??1)` 安全;valid 1/2/3 原樣)。test `concurrency:NaN → inboxProcessed=2`(不再 runBounded 0 worker 靜默漏掃)。✅ 正解、零回歸(防禦性收緊)。
- **N5**:lease-only skip 註解強化(明述不寫 markSettleRetry、靠 5min lease 回收、僅計 deduped 不誤示已對帳)。✅
- **N1**:STATUS「ChargeAttemptStoreWithFallback **4** 新方法」(原誤 3)。✅ grep 確認。
- **N2**:plan §③ 子片表 4b-1 row = `claimStuckUnsettled`+`expireEventsAtCeiling`+`expireStuckAtCeiling`+`flagNonUnpaidActive`(原 `listStuckUnsettled`、漏 expirer/flag)。✅ grep 確認無 listStuckUnsettled。
- **N3**:歷史日期 no-op(執行側判定正確 —— 4b-2 新條目已 2026-06-16、舊 4b-1 條目為歷史敘述)。
- **三綠 forced-fresh** 18 tasks exit 0 + **full vitest 117 files / 1054 passed / 0 fail**(與 commit「1054」一致、+1=N4 測)。
- **codex 不再跑**:delta = Number.isFinite guard(strictly-safer)+ 註解 + docs + 1 測,無新實質邏輯/無新安全面;substantive 邏輯與已 cross-model-PASS 的 3fa4aad 同 → 機械性 nit-fold 靠 delta 親讀 + 三綠 + full test 複驗 proportionate(cost 紀律、codex 2 輪上限為 FAIL→修→複審用)。

## ✅ 3DS-4b-2 審查側最終 sign-off = PASS(HEAD **f200c1a**、未 push;`3fa4aad` 已被 amend orphaned)
**5 nit 全收**(N4 concurrency fail-safe guard + 測 / N5 lease-only 註解 / N1 STATUS 4 新方法 / N2 plan 子片表 4+4 / N3 歷史日期 no-op);substantive 邏輯 sign-off 不變(每輪守衛不變式 / inbox·stuck 雙路徑 / recTradeIdHint / O8 不釋鎖 / per-order 去重原子 / runBounded exactly-once / fail-closed / token guard / 鐵則12 零經銷價零 PII / 三綠 1054 / codex K2 cross-model PASS)。**0 殘留 nit、0 must-fix**。未 push、未 db push(本片零 migration)。**下一步 = 3DS-4c**(cron route)。哨兵 `bakj81vbl` 待命。

---

### 2026-06-16 — 3DS-4c cron route `b53fea5`(amend of `734036a`)關卡2(審查側、鐵則12 payment 未驗證端點、binding、fresh-context)

`feat(payment): 建 3DS-4c sweeper cron route [m-3]`。**接手新審查 session**(baseline=f200c1a、哨兵重 arm = Monitor `bou9qpqu1`〔persistent、全 heads、20s〕;舊 session 哨兵 `bakj81vbl` 仍存活雙發 → 已 TaskStop 收掉避平行噪音)。哨兵抓到 `734036a` → 旋即又抓 `b53fea5`(執行側 amend、subject 同 → `734036a` orphaned)。fresh-context pin `b53fea5`(三綠自跑前後 HEAD 皆 b53fea5、tracked 零漂移〔`git status --porcelain` 僅審查側 untracked〕)。**未 push**(`ls-remote origin dev`=f200c1a → amend 合法)。

**amend `734036a→b53fea5` = STATUS.md-only(2±2 行)**:修「最近 3 commit」表頂為可達父 `f200c1a`(原 56be19c)+ 移 `b9f04e2`、敘述同步 → off-by-one orphan hygiene 正確(`git merge-base --is-ancestor f200c1a b53fea5`=YES)。**route.ts/route.test.ts 兩檔 byte-identical 734036a→b53fea5**(`git diff` 空)→ 734036a 的 code trace 全 carry。commit = 3 檔 361+/3−:`route.ts`(129 行新)+ `route.test.ts`(229 行/17 測新)+ STATUS。零 migration / 零 vercel.json(=4d)/ 不碰 db push bundle。

**驗證矩陣(逐項實證、非信 commit 字面):**

| 項 | 結果 | 實證 |
|---|---|---|
| ① GET handler(非 POST) | ✅ | 僅 `export async function GET`(L72);grep 無 POST/PUT/PATCH/DELETE/HEAD/OPTIONS export;test L75-78 鎖 `typeof GET==='function'`+`POST` undefined。build 註冊 `/api/cron/settle-sweep` = ƒ Dynamic |
| ② requireCronSecret Bearer + timingSafeEqual + env 未設 fail-closed | ✅ | `requireCronSecret`(L64-70)`!s\|\|<32`→throw;GET try→catch→500(L75-79、設定錯拒不執行)。Bearer 解析(L80-81)+ `safeEqual`(L56-61、長度不等先 false→timingSafeEqual 永不以不等長 buffer 呼〔否則 throw〕)→ 缺/錯→401(L82-83)。**對齊 3DS-2 requireNotifySecret**;差異=去掉 URL_SAFE_RE(secret 為 Bearer header 值非 URL 段、正當適配非盲抄) |
| ③ 🔴 CRON_SWEEPER_ENABLED gate(default false=200 no-op;enabled+RPC/DB error=5xx 不吞 200) | ✅ | `!== 'true'`(L89)嚴格 opt-in:未設/'false'/'TRUE'/' true'/'1'/任何 truthy→200 no-op(`{ok:true,enabled:false,skipped}`);**gate 在「建 deps 前」return**(L89 先於 L98)→ disabled 路徑零 DB env 依賴(route 已 deploy 但 4a 未推仍安全)。auth(L82)**先於** gate(L89)→ 未認證打不到 no-op。errors>0→503(L112-115)不吞 200;deps/factory throw + 非預期 throw→catch→503(L119-128) |
| 🔴 ③ crux:errors>0→503 完整性(無 broken-sweeper 偽 200、無 benign-pending 偽 503) | ✅ | **親 trace settle-charge.ts**:settleCharge **永不 throw**(Record/DB 失敗皆 catch→`{kind:'pending',reason:'record_unreachable'}`〔L57/80/108/246/264〕)→ use-case 內 pending→markRetry 計 inboxRetried**非 errors**→ 不誤 503;`errors++` 僅 guard/claim/mark RPC throw(真 DB/RPC 失敗)→ 精確對應「RPC missing/DB error→5xx」。systemic outage 必先撞 claim/guard throw→errors>0→503(claimDue/claimStuck/3 守衛為首觸 DB);mark 在 per-item try 內→寫失敗亦 errors++ 非丟失。6 出口逐一列舉、唯一 post-enable 200 = errors===0 |
| ④ concurrency 有限正整數 | ✅ | route 端 `SWEEP_CONCURRENCY=1` 常數(L53)= 最強驗證形式(不接受外部輸入);use-case 端另有 4b-2 N4 `Number.isFinite` guard 縱深(route 從不傳外部值故不可達、合理冗餘);test L207-215 斷言注入 `concurrency:1` |
| ⑤ 批次/maxDuration 上限 + counts log 零 PII | ✅ | `INBOX_LIMIT/STUCK_LIMIT/STUCK_AGE_SECONDS=50/50/600`+`maxDuration=60`(L36/50-53);log = `console.error(...,{...result})`(L113)+ catch `{reason:'deps_or_unexpected_throw'}`(L124-126),`SweepSettlementsResult` 12 欄全 number count(零 orderId/rec/amount);response body 亦 counts-only。**catch `catch {` 省略 err 綁定 → err.message 結構性不可達**(codex consider fold) |
| ⑥ 不採信外部輸入 | ✅ | 無 query/body/searchParams/request.url 讀取(僅讀 authorization header 認證);批次/節流/並發皆 route 常數;orderId 全 from DB(use-case claim RPC) |
| 三綠(forced fresh)+ full vitest | ✅ | 自跑 `turbo run typecheck lint build --force` = **18 tasks successful exit 0**(0 cached);`pnpm test` **118 files / 1071 passed / 0 fail**(與 commit「1071」精確一致);PINNED_HEAD before==after=b53fea5(HEAD 未移) |
| 鐵則12 經銷價/secret/RPC 雙 grep | ✅ | source(route+test)ZERO 經銷價/卡/金額;**.next/static client bundle** ZERO price_store/priceByTier/price_by_tier **且** ZERO CRON_SECRET/CRON_SWEEPER_ENABLED/claim_*RPC/sweepSettlements/PAYMENT_CONFIRMER_DB_URL/settle-sweep(server-only 結構性零洩) |
| composition 前提(server-only/純 ctor/requireEnv-only throw) | ✅ | 親讀 composition.ts:`import 'server-only'`(L15);getSettleChargeDeps(L109)/getWebhookInbox(L123)同步純存連線字串、ctor 零連線、唯一 throw=requireEnv(env-name 固定訊息無密鑰)+TAPPAY_ENV 驗(值非密)→ catch 固定碼後該訊息亦不入 log |
| 字面 vs 事實 | ✅ | route.ts 129 行 / route.test.ts 17 `it()` / 1071 / 未 push / amend STATUS-only 皆實量相符;header 註解數值/行為全對 code;commit body「執行側 codex K2 PASS+2 findings fold(固定 reason code + errors 註解)」誠實(審查側已獨立重驗) |

**🔴 codex K2 cross-model = quota-blocked → Claude fresh-context fallback(documented SOP、review-log §1.1):**
- 審查側獨立 codex K2(`codex exec -s read-only`、porcelain before==after **zero-trace OK**、HEAD 仍 b53fea5)**撞 OpenAI 用量上限**(「try again Jun 18th 2026 6:06 PM」、CODEX_EXIT=1、**零 verdict 產出**)→ 不可 cross-model 背書。Gemini 非 correctness/security 背書(memory `gemini-breadth-third-eye`)故非替代。
- 依 SOP fallback = **Claude fresh-context 對抗審**:5-lens 對抗 workflow `wvb5dr5xw`(5 agents、各攻一獨立面、node repro 實證、對不可變快照)= **5/5 PASS、0 must-fix**:① auth-bypass(Bearer 變體全→401、auth 先於 gate 先於 deps、無繞過)② gate-sequencing(只 'true' 跑、gate 前於 deps、vercel.json 無 settle-sweep cron、zero-deploy-risk)③ error-swallow(6 出口列舉、「broken-sweeper 偽 200」不成立、「benign-pending 偽 503」亦不成立)④ pii-leak(6 出口 sink inventory、catch 省 err 綁定、2 console.error counts-only)⑤ http-contract/crash(GET-only、唯一 await 在 try 內、auth window 純同步非 throw、無 uncaught throw 出 GET、字面vs事實全對)。

**🟡 殘留 nit(全非 blocker、b53fea5 未 push 可選 fold;否則 forward 4d-adjacent commit):**
- **N1(workflow gate L29)gate test 漏 whitespace/alias 值**:test 蓋 unset/'false'/'TRUE'、未蓋 ' true'/'true '/'1'/'yes'(code `!== 'true'` 對全部正確、屬 test-completeness 鎖嚴格契約防未來 .trim/.toLowerCase refactor)。建議補參數化案。
- **N2(workflow gate L33 + http L81)disabled 零-DB-env 仰賴 lazy adapter ctor 的隱式跨包不變式**:成立於今(ctor 純存字串、連線 lazy);建議 import 點加一行不變式註解防未來 adapter 把 env 讀/pool 移 module-top 致 disabled 路徑靜默回歸要 DB env。
- **N3(審查側、字面精化)route L45 maxDuration 預算註解** 寫 `50×500ms=25s`(per-source、鏡像 plan §5.1b L60 framing);total 順序最壞(concurrency=1、inbox 50+stuck 50)≈ `100×500ms=50s`(plan §5.2 L93 framing)。**結論 <60s 兩者皆成立**(真餘量 10s 非 35s);與 plan 自身雙 framing 一致、非自創錯數 → benign 精化。
- **其餘 workflow nit 全 by-design/已接受**:length-equality side-channel(=3DS-2 既例、不可利用)/ auth block 在 try 外(safeEqual 不 throw、即使 throw 亦 500 fail-closed)/ record_unreachable 單筆→200(durable re-queue、systemic 必 503;reason 連續性告警已 master §9/#231 Phase II)/ staleMarks 不觸 503(visibility-only 正確)/ 503 body spread result(counts-only、認證後才可讀)/ requireEnv 嵌 env name(catch 不綁 err 故不外surface)/ NaN-concurrency guard 不可達(route 傳常數)。

## ✅ 3DS-4c 審查側最終 sign-off = PASS(HEAD `b53fea5`、未 push;`734036a` amend orphaned)
GET-only + requireCronSecret fail-closed〔env 未設→500 / Bearer 缺錯→401 / timingSafeEqual 等長前置〕+ CRON_SWEEPER_ENABLED 嚴格 'true' gate〔default 200 no-op、gate 前於 deps=zero-deploy-risk〕+ 🔴 errors>0→503 完整〔settleCharge 永不 throw 故 errors⟺真 DB/RPC 失敗、無偽 200 無偽 503〕+ 不採信外部輸入 + maxDuration 60s<5min lease + 鐵則12 雙 grep 零洩〔含 client bundle〕+ composition server-only/純 ctor + 三綠 forced-fresh 1071 + 字面vs事實全對。**0 must-fix、3 forward nit(N1 gate test / N2 lazy-ctor 註解 / N3 budget 數字精化,皆非 blocker)**。
🔴 **codex K2 cross-model 未跑(OpenAI quota 至 Jun 18 重置)→ 以 Claude fresh-context 5-lens 對抗 fallback 覆蓋(documented SOP、全 PASS、node repro 實證)**。**建議**:4d prod-activation 前可選 codex K2 重跑取 cross-model belt-and-suspenders(code 不變、cheap);非阻擋 4c dev commit(Phase I 零真流量、route default disabled、無 vercel.json cron、4a 未進 prod)。**🔴 2026-06-16 Sean 拍 A = 接受 Claude 5-lens 備援、現在繼續;cross-model codex K2 延到 4d prod-activation 前補跑(quota 6/18 重置後)。** → 🔴 **4d 審查 forward hard-gate**:放行 prod 部署 config 前務必先確認 codex K2 補跑 PASS(對 4c route 不可變快照 b53fea5〔或 nit-fold 後 hash〕),與既有 4d 三前置(CRON_SECRET prod 高熵 / CRON_SWEEPER_ENABLED 決策 / 4a 進 prod)並列。

**未 push、未 db push**(本片零 migration、不影響 bundle 阻擋)。**下一步 = 3DS-4d**(vercel.json crons 啟用、deploy config 鐵則8、gated;前置硬列:① Sean 於 Vercel Production env 驗 `CRON_SECRET` 已設且高熵 ② 設 `CRON_SWEEPER_ENABLED`〔4a 進 prod 後才 'true'〕③ 4a 兩 migration 進 prod〔db push bundle 解鎖後〕;plan §5.4)。哨兵 `bou9qpqu1` 持續待命接 4d(或 4c nit fold amend)。

---

### 2026-06-16 — 接手新審查 session(fresh-context、ROLE=A 審查側)

接前一棒 3DS-4c sign-off(PASS、b53fea5 已推 origin/dev)。**起手驗證**:`git fetch` → branch=`dev` / HEAD=`b53fea5` = origin/dev(`git rev-parse` 雙證)/ 工作樹 clean(僅審查側 untracked:`.playwright-mcp/` + 4 份 handoff/review-log md)。讀畢 review-log §3 全段 + plan §5.4(4d scope/前置)+ master §2/§9 + §0/§1 baseline(舊 1f1e187 → 已按 §3 末 + 本提示詞改 baseline=b53fea5,4c 及之前不重審)。

- **哨兵重 arm**:先 TaskStop 前棒兩殘留(`bou9qpqu1`/`bakj81vbl`)= 皆 "No task found"(session 死哨兵已死、無雙發風險)→ 重 arm Monitor **`bt010dz8d`**(persistent、全 heads 掃描、20s 輪詢、baseline=當前 origin/dev `b53fea5`)。下一棒重 arm 用 §2 命令。
- **進場待審狀態 = 待 b53fea5 之後新 commit**:① 3DS-4d(vercel.json crons、鐵則8 deploy config、gated/短期不動,三前置未滿足〔CRON_SECRET prod 驗 / CRON_SWEEPER_ENABLED 決策 / 4a 進 prod〕)② 4c-nit follow-up(N1 gate test whitespace/alias、N2 lazy-ctor 不變式註解、N3 route L45 budget 數字,皆 doc/test-completeness、非 blocker、下個 callback/route-touching commit 順手掃)③ Sean 指派。**現無 actionable 待審 commit**(b53fea5 已 sign-off)→ 哨兵待命、event-driven。
- **🔴 4d forward hard-gate 持守**:放行 prod 部署 config 前必先 codex K2 cross-model 補跑 PASS(對 b53fea5〔或 nit-fold 後 hash〕)。**codex K2 OpenAI quota 撞牆至 2026-06-18 18:06 重置** → 6/18 前若有鐵則12 commit 落地、codex 不可用 → 走 documented fallback = Claude fresh-context multi-lens 對抗 workflow(各攻一獨立面 + node repro 實證)+ 標明 cross-model 延後;Gemini 非 correctness 背書替代。
- **db push bundle 阻擋持守**:0a/0b/0c/1b/#214a + 4a-1(9bfbde9)/4a-2(1d82623)全在 bundle、cart_session_id 整合(Phase II 3DS-5b/7)前不可 `supabase db push`。

---

### 2026-06-16 — 3DS-4c forward nit 收尾 `d2381f7` 關卡2(審查側、test+comment-only nit-fold、fresh-context)

`test(payment): 收 3DS-4c sweeper 三 forward nit(gate 測試+註解)`。哨兵 `bt010dz8d` 抓到 → fresh-context pin `d2381f7`(三綠/vitest 自跑前後 HEAD 皆 d2381f7、tracked 零漂移〔`git status --porcelain` 僅審查側 untracked〕)。**未 push**(`ls-remote origin dev`=b53fea5、parent 確認=b53fea5 → follow-up 疊 b53fea5〔4c 已推不可 amend〕,線性誠實)。diff = 3 檔 +27/−6:`route.ts`(2 hunk、**皆 comment-only**)+ `route.test.ts`(header ③ doc-sync + it.each 8 案)+ STATUS.md。**零 migration / 零 vercel.json / 零 .sql**(不碰 db push bundle)。

**驗證矩陣(逐項實證、非信 commit 字面):**

| 項 | 結果 | 實證 |
|---|---|---|
| 🔴 零生產邏輯(crux) | ✅ | **親讀 route.ts 兩 hunk 全在註解區**:hunk1=import 上方 5 行 `//` lazy-ctor 不變式塊(N2)、import 語句本身 byte-unchanged;hunk2=JSDoc `/** */` 內 budget 註解精化(N3)。`export const runtime/maxDuration/dynamic`、gate `!== 'true'`、`requireCronSecret`/`safeEqual`、errors>0→503、常數 50/50/600/1、deps 組裝 **皆無 +/− 出現於 diff**。**route.ts 可執行碼對 b53fea5 byte-identical** |
| N1 gate 契約測完整(it.each 8 案) | ✅ | 新增 `it.each([' true','true ',' true ','1','yes','True','enabled','on'])` 各斷言 `status===200` + `res.json()` matchObject `{enabled:false}` + `sweepSpy.not.toHaveBeenCalled()`;精確鎖 `!== 'true'` 嚴格契約(whitespace/alias/截斷/case 變體全 disabled)→ 防未來 .trim()/.toLowerCase()/寬鬆 parse 靜默開 sweeper 回歸。**正解、無回歸**(對齊前棒 N1 forward note〔未蓋 ' true'/'1'/'yes'〕、新增涵蓋且超之) |
| N2 lazy-ctor 不變式註解 | ✅ | 註解述「getSettleChargeDeps/getWebhookInbox factory 必維持 lazy=ctor 只存連線字串/零 module-top env 讀/零 pool,否則 disabled 路徑〔gate 在建 deps 前 return〕零-DB-env 保證靜默回歸」—— 與 4c sign-off N2 一致、述前提屬實(composition.ts ctor 純存字串已於 4c 親讀);防衛性文件、零功能影響 |
| N3 budget 數字精化(math 親驗) | ✅ | concurrency=1 順序 → 單輪最壞 (inbox 50+stuck 50)×~500ms = 100×500ms = **50s < 60s maxDuration**(真餘量 ~10s);per-source 50×500ms=25s 標為「半段」對齊 plan §5.1b L60、total 100 筆≈50s 對齊 §5.2 L93。**算式正確**(較原僅寫 per-source 25s 更誠實完整)= 前棒 N3 forward note 精確收斂 |
| 三綠(forced fresh、繞 turbo cache)| ✅ | `pnpm turbo run typecheck lint build --force` = **18 tasks successful、0 cached、exit 0**;route `/api/cron/settle-sweep` 註冊 ƒ Dynamic |
| 完整 vitest(fresh)| ✅ | `pnpm test` = **118 files / 1079 passed / 0 fail**(與 commit「1079」精確一致;= 4c 1071 **+8**=it.each 8 案,+8 證新 gate-alias 測真跑非 skip);PINNED before==after=d2381f7 |
| 鐵則12 經銷價/secret/RPC 雙 grep | ✅ | source(route+test)ZERO 經銷價;**.next/static client bundle** ZERO price_store/priceByTier/price_by_tier/CRON_SECRET/CRON_SWEEPER_ENABLED/claim_*/sweepSettlements/settle-sweep/PAYMENT_CONFIRMER(server-only 結構零洩) |
| 字面 vs 事實 | ✅ | commit body「零邏輯變更(route handler/gate/認證/errors→503/常數/deps 皆未動)」逐項屬實;N1 八案值 + 斷言、N2/N3 描述、1079(+8)、未 push、follow-up 疊 b53fea5 全實量相符;**無 scope creep**(僅 3 檔=3 nit + STATUS,無其他改動) |
| manifest / 範圍 | ✅ | 後端 cron route 非 design-mirror 範圍(plan §4「零 storefront 元件」)→ manifest 不需動;STATUS 表頂 `b53fea5`=可達父(off-by-one orphan hygiene 正確、`merge-base --is-ancestor` 成立)、新敘述條目誠實 |

**codex K2 = 刻意跳(審查側 concur)**:本片 comment + additive-test、**零生產邏輯/零新安全邊界/零 money 算術/零 SQL** → 與 4b-2 amend nit-fold 成本紀律先例同類(delta strictly-safer/機械性 → 不燒 codex 輪次);且 codex quota 卡至 6/18。fresh-context diff-trace + forced 三綠 + full vitest + 雙 grep 已 proportionate 覆蓋。**4d prod-activation 的 codex K2 cross-model hard-gate 仍獨立存在**(見下)、不受本跳影響。

**🟢 carry nit 全清**:前棒 4b-1 三 doc nit(STATUS「3 vs 4」/ plan §③ listStuckUnsettled / 歷史日期)已於 4b-2 amend(f200c1a)folded;本片再清 4c 三 nit(N1/N2/N3)→ **現 0 殘留 forward nit**。

## ✅ 3DS-4c forward-nit 審查側最終 sign-off = PASS(HEAD `d2381f7`、未 push)
route.ts 可執行碼對 b53fea5 byte-identical(兩 hunk 純註解)+ N1 gate 契約 it.each 8 案鎖嚴格 'true'〔正解無回歸〕+ N2 lazy-ctor 不變式註解 + N3 budget 算式 50s<60s 精化〔math 親驗〕+ 三綠 forced-fresh 18/18 + full vitest 1079(+8 證真跑)+ 鐵則12 雙 grep 零洩 + 字面vs事實全對 + 0 scope creep。**0 must-fix、0 殘留 nit**。**未 push、未 db push**(本片零 migration、不影響 bundle 阻擋)。

**🔴 4d codex-K2 hard-gate 快照更新**:前棒 4c sign-off 列「放行 prod 部署 config 前必先 codex K2 PASS 對 b53fea5〔或 nit-fold 後 hash〕」→ 現 nit-fold 已落地 = **快照目標 `b53fea5 → d2381f7`**;因 route.ts 可執行碼 byte-identical,d2381f7 codex K2 與 b53fea5 行為等價(僅多註解)。quota 6/18 18:06 重置後對 **d2381f7** 補跑。

**下一步 = 3DS-4d**(vercel.json crons、鐵則8 deploy config、gated;三前置〔CRON_SECRET prod 高熵 / CRON_SWEEPER_ENABLED 決策 / 4a 進 prod〕+ codex K2 對 d2381f7 補跑 PASS 並列硬前置)或 Sean 指派。哨兵 `bt010dz8d` 持續待命。

---

# 3DS-5a charge adapter 3DS 啟動 — 審查側 sign-off(寫審分離、哨兵 bjae1c42y)

**commit:** `969eb0c`(初)→ **FAIL** → amend `96a2e79`(修)→ **PASS**。base dev `26a9da7`、branch `m3-3ds-5` worktree `/Users/sean_1/pcm-3ds-5`(線性 ancestor 驗過)。
**範圍:** TapPay adapter 加 `initiateThreeDSCharge`(回 payment_url+rec、不請款)+ domain `TapPayInitiationPayload/Result`(只 pending_3ds、非成功一律 throw、無 failed)+ `generateBankTransactionId()` + wire 加 payment_url/bank_transaction_id 白名單 + ITapPayAdapter 方法 + 測。零 migration、零 .env、不動同步 charge/confirm-payment/charge-actions/useChargePayment 實作。

## round1(`969eb0c`)= FAIL(1 must-fix + 1 consider;codex K2 獨立 + fresh Claude 雙審)
- ① 解析不過寬釋鎖:**PASS** — 唯 status=0+payment_url+rec→pending_3ds、其餘(含 421/timeout/HTTP/格式)一律 throw、無 failed 態、回 caller payload bankTransactionId(非 wire)。
- ② PII:**PASS** — logInitiation 只記 orderId/status/recTradeId/bankTransactionId;payment_url(token)/cardholder/rawResponse 零入 log(測實證)。
- ③ body:**PASS** — three_domain_secure:true/result_url/bank_transaction_id、不送 delay_capture_in_days。
- ④ 產生器數學:**PASS** — 19字 ^[A-Z0-9]{19}$、`byte&31` 零 modulo bias(256%32=0)、Crockford 無 ILOU、~2^90 熵。
- ⑤ **client-bundle 邊界:FAIL(must-fix)** — generateBankTransactionId import node:crypto 經 @pcm/domain root barrel 匯出,而 useResolvedCart/CartView/CheckoutView('use client')**value-import** 該 barrel(實證:FREE_SHIPPING_THRESHOLD/calculateShippingFee/toMoneyAmount)+ package.json **無 sideEffects:false**(tree-shake 不可靠)+ base domain src **零 node: import**(本片首引入=回歸點)→ build 綠靠 tree-shake 僥倖、payment 邊界不該賭。執行側兩審查器原評 consider/follow-up watch、**審查側獨立 codex K2 + 三事實實證升 must-fix**。
- consider:測試 wire bank_transaction_id 與 payload 同值,無法防未來誤改取 wire 值。
- 重驗:turbo typecheck 7/7 + scripts typecheck **主repo 補驗綠**(5a 零動 scripts/、worktree .bin tsc symlink gap=環境非型別、memory od-worktree-typecheck-gotcha)+ lint + next build + full vitest **1205** 全綠;codex K2 零留痕。

## round2(`96a2e79` amend)= PASS
- **must-fix 解**:bank-transaction-id.ts 移除 node:crypto import、改 `globalThis.crypto.getRandomValues(new Uint8Array(18))` = Web Crypto 通用 CSPRNG、**零 node: import** → barrel isomorphic 安全、不依賴 tree-shake;保留 byte&31/P前綴/19字格式。
- **consider 解**:加測試 wire 異值('WIRE_DIFFERENT_VAL')/缺欄 → 仍回 payload bankTransactionId(鎖死「回 caller 自產鍵非 wire」)。
- **重驗(fresh 重跑)**:node:crypto 從 5a 全消(`git show 96a2e79:...bank-transaction-id.ts` 親驗、僅註解提及 + getRandomValues 碼)+ turbo typecheck 7/7 + lint 10/10 + next build storefront 編譯成功(node:crypto 移除無破壞)+ full vitest 125檔/**1206**測(+1 consider 測);scope 未擴(同 12 檔)。
- **codex K2 round2 = 刻意跳(審查側 concur)**:must-fix 修法正是 codex round1 自薦的 globalThis.crypto、delta = 1 行 crypto API swap + 1 測 = 機械性 strictly-safer、零新邏輯/邊界/money/SQL → 不燒 codex 輪次(對齊 4c nit-fold 成本紀律先例);Claude fresh diff-trace + 全綠重驗 + node:crypto 全消已 proportionate。

## ✅ 3DS-5a 審查側最終 sign-off = PASS(HEAD `96a2e79`、未 push)
0 must-fix、0 殘留 nit。執行 session 可開 **5b**。整合(STATUS 7欄/busboy-end/pcm-roadmap/graphify/merge dev)deferred 至 m3-3ds-5 線收尾。哨兵 `bjae1c42y` 續盯 5b。

---

# 3DS-5b initiate use-case + migration — 審查側 sign-off(寫審分離、哨兵 bjae1c42y)

**commits:** `f476b1d`(migration)+ `af391e4`(port/adapter)+ `ed08945`(use-case/flag)= 5b 全套(tip `ed08945`、base 5a `96a2e79`、線性)。執行側拆 3 子 commit、各自三綠。
**範圍:** 寫 bank_txn/rec 進「仍 pending」attempt 的 2 窄權 RPC + IChargeAttemptStore 2 主軌-only 方法 + PgChargeAttemptAdapter/複合委派 + initiatePayment use-case + InitiatePaymentInput/Outcome + TAPPAY_3DS_ENABLED flag helper。**帶 migration → 待 Sean db push**(本片不 db push)。

## migration(`f476b1d`)= PASS
- **plan §3.1 全保真**:2 SECDEF RPC(payment_confirmer only、search_path=''、schema-qualified、RETURNS boolean persisted)、FOR UPDATE + 雙鍵 + status='pending' guard + 冪等(NULL/同值→true、異值→false 防竄改、非 pending/查無→false)+ 輸入 guard(btrim / bank_txn `^[A-Z0-9]{1,19}$` / rec ≤64〔鏡像 s2d mark_charged L256/L369〕)+ unique_violation→通用 RAISE;UNIQUE 部分索引;REVOKE service_role + GRANT payment_confirmer + has_function_privilege 矩陣 + role-hygiene assert。
- **format CHECK 偏離裁決 = 接受**:plan §3.1 字面只列 UNIQUE 索引、CHECK 為加法 → 執行側誠實揭示 + flag 審查核;**實證履行 0c migration(20260613140000)L15/L67 前向承諾「生成方式 3DS-5b 定義時再加 length CHECK」**(親讀 0c 確認)+ 對齊 fallback_token_hash CHECK 慣例 + additive/易回退 → 比 plan 字面更正確(plan 漏列);codex 關卡2 獨立同此裁決。
- 🔴 **審查側獨立 MCP 交易模擬全 PASS 零留痕**(project bmpnplmnldofgaohnaok、BEGIN+真套 migration+synthetic+SET session_replication_role=replica〔關 FK、CHECK 仍生效〕+DO 斷言+ROLLBACK;不 SET ROLE 避 pooled-MCP 斷線、ACL 走 has_function_privilege 等價):
  - **B(bank_txn)B1-B8**:pending+NULL→true+寫入 / 同值→true 冪等 / 異值→false 不覆寫 / 格式錯(小寫·底線·>19·空)→通用 RAISE / charged→false / failed→false / 雙鍵不配對→false / 跨單同 bank_txn 撞 UNIQUE 部分索引→通用 RAISE。
  - **C(rec)C1-C7**:pending+NULL→true **+ status 仍 pending(關鍵:≠ markCharged)** / 同值→true / 異值→false / 空·>64→通用 RAISE / charged·failed→false / 雙鍵不配對→false / 跨單同 rec 撞 rec_unique_idx→通用 RAISE。
  - migration 自帶 ACL 矩陣 + role-hygiene assert 套真版通過;ROLLBACK 後唯讀複查:函式/索引/CHECK/synthetic 全 0、prod 回 8 列原樣。
  - ⚠️ pooled-MCP SET ROLE payment_confirmer 斷線限制(memory)→ 真連線 round-trip 交 3DS-6 charge action 對 session pooler 補。

## port/adapter(`af391e4`)= PASS
- IChargeAttemptStore +recordInitiationBankTxn/+recordInitiationRec **主軌-only**(對齊 findActiveByOrderId;對帳路徑無 user JWT);PgChargeAttemptAdapter 實作(三 cast SQL、parseBooleanResult 非 boolean→throw、**RPC false→branded ChargeAttemptNotDurableError throw**〔codex #3:bank_txn 未落地不送 TapPay〕、sanitizeError 憑類別放行零 pg 原文);複合直通委派不走 fallback。測:happy/false→throw/形狀/P0001 + 直通 + 主軌 throw 不切備軌。

## use-case + flag(`ed08945`)= PASS
- initiate-payment.ts 全保真 plan §3.3:begin→!acquired(duplicate/needs_settle→settlement_required / else locked)→bankTxn=generateBankTransactionId()→**recordInitiationBankTxn catch→init_failed 零 TapPay**(硬失敗)→initiateThreeDSCharge **catch→charge_unknown 不 markFailed**(bank_txn 已 durable)→**recordInitiationRec catch→console.error 仍 redirect**(軟失敗)→redirect。**無 markFailed/markCharged/confirmer**(deps 只 {tappay,attempts});命名 override 註明(=master confirmPayment.initiate、6 只 consume)。
- InitiatePaymentOutcome 無 paid/orphan/charge_failed;flag isThreeDSEnabled 嚴格只認 'true'、server-only、靜態 process.env(不觸 #182)、**僅引入不被 live 消費(中間態誠實)**。
- PII:rec 失敗 log 只 orderId/attemptId/code、initiation log 只 orderId/status/recTradeId/bankTransactionId;**payment_url(token)/prime/cardholder/raw 零入 log**(測實證)。

## 重驗 + codex 關卡2
- 三綠 fresh(worktree):turbo typecheck 7/7 + lint 10/10 + next build 1/1;**full vitest 127 檔/1243 測**(與執行側宣稱完全一致、字面vs事實成立)。
- 🔴 **審查側獨立 codex 關卡2 = PASS、0 must-fix/consider/nit**(8 點全 PASS:RPC/ACL/CHECK/port/use-case/PII/flag/字面vs事實;codex 確認「bank_txn TapPay 前 durable、RPC false 不誤判成功、charge unknown 不釋鎖、不 markCharged/confirm、PII 零 log」);porcelain 零留痕。執行側自跑 codex 關卡2 round1 PASS,跨模型雙路徑收斂。

## ✅ 3DS-5b 審查側最終 sign-off = PASS(HEAD `ed08945`、未 push、未 db push)
0 must-fix、0 殘留。🔴 **migration 待 Sean db push**(本片不 db push;審查側 MCP 模擬於 rolled-back 交易、真連線 round-trip 交 6;db push 時機 = m3-3ds-5 整線收尾 / Sean 拍)。**下一步 = 3DS-6**(delivery:charge-actions flag 分岔回 redirect + useChargePayment redirect 態 + CheckoutView 跳轉 → 接 live action;鐵則 8、需先寫 6 plan + codex 關卡1 + Sean 批准才實作)。哨兵 `bjae1c42y` 續盯。

---

# 3DS-6 charge-actions flag 分岔 + client redirect — 審查側(寫審分離 ROLE=A、新審查 session)

> **接手新審查 session**(2026-06-19、前棒哨兵已死)。重 arm 哨兵 = Monitor **`b845nq6ad`**(persistent、poll `refs/heads/m3-3ds-5`、base=`ed08945`〔5b tip〕、每新 commit 出 `NEW-COMMIT`)。base 確認:m3-3ds-5 tip=ed08945、worktree 僅 untracked plan。

## 2026-06-19 — 3DS-6 plan 關卡1 review-side 第二意見(code 前、非 binding;binding = commit 落地關卡2)

審 `docs/specs/2026-06-19-m3-3ds-6-charge-actions-redirect-plan.md`(worktree m3-3ds-5、uncommitted;fresh-context、不信 plan 字面、grep 真權威核「5a/5b 已交付介面」)。**verdict = PASS-with-notes(可 greenlight 執行側開 6a)**。

**🔴 接線命脈 8 錨點全 grep 實證(plan 對交付介面非憑記憶、鐵則 1):**
| 錨點 | 結果 | 實證 |
|---|---|---|
| `InitiatePaymentInput` 含 `frontendRedirectUrl`/`backendNotifyUrl` | ✅ | `packages/domain/.../types.ts`:兩欄存在 + docstring 明載「delivery 層(3DS-6)組 URL、use-case 收參數不自組、5b 簽章預留入參」→ 6a 傳這兩值有合法落點 |
| `InitiatePaymentOutcome` 五態 | ✅ | `redirect{redirectUrl}` / `charge_unknown{orderId}` / `settlement_required` / `locked{reason}` / `init_failed`,逐字對 plan §0 line7 |
| `ChargeLockReason` 三子態 | ✅ | `'user_in_flight'\|'order_locked'\|'not_unpaid'` → §2.3 的 `locked{user_in_flight}` vs `locked{order_locked\|not_unpaid}` 雙列**有真 discriminant**(非杜撰) |
| `initiate-payment.ts` 實產 outcome | ✅ | L109 `return {kind:'redirect', redirectUrl: initiation.paymentUrl}`(redirectUrl 即 payment_url)+ settlement_required/locked(reason)/init_failed/charge_unknown 全產;**無 paid 分支**(啟動半段不回扣款) |
| `isThreeDSEnabled` | ✅ | server-only、嚴格 `=== 'true'`、靜態 process.env(不觸 #182) |
| charge-actions 現行結構 | ✅ | 208 行;`getTapPayAdapter`(L36)/`getChargeAttemptStore`(L38)已 import(復用、無新 factory);`randomUUID` cartSessionId L136;`buildCardholder`(L118)**先於** placeOrder(L139)→ preflight 插兩者間零垃圾單成立;MSG.{generic,chargeFailedWait,processing,settlementRequired,inFlight} 皆存;ChargePaymentActionResult union 已含 `payment:'processing'`/`'charge_failed_wait'`/`'in_flight'`(redirect variant 為新增) |
| CheckoutView 行數 + 早返群 | ✅ | 388 行(+3 早返=391 **<400** 鐵則 6 OK);早返群 paid L143/processing L146/unknown L157 → cart loading L161,redirect 早返插 L159↔L161 正確 |
| 3DS-2 `requireNotifySecret` + 3DS-3 callback | ✅ | route `MIN_SECRET_LEN=32` + `URL_SAFE_RE` + timingSafeEqual(plan Q1「≥32 URL-safe」逐字相符);callback 讀 `sp.order`+UUID_RE → frontendRedirectUrl `?order=<UUID>` 對齊 |

**📌 db-push 狀態更新(更正本檔 §3 5b sign-off 的 stale 字面)**:`list_migrations`(project bmpnplmnldofgaohnaok)實證 **`20260619120000_m3_3ds_5b_record_charge_initiation` 已在 prod**(連同 0a→4a-2 全 bundle)。plan §0 line4「5b migration 已 db push 落 prod」**屬實**;§3 5b sign-off 寫的「未 db push」為**寫時狀態、now stale**(Sean 已於 sign-off 後 db push)→ db push bundle 阻擋已完全解除。

**設計健全性(對抗審視、非橡皮圖章):**
- §2.3 outcome→result 映射逐態**對齊既有同步 mapOutcome 政策 + master plan §1**:redirect(合法 https)=不清車/UI 鎖/非終態(導向 OTP、abandon 可回頭)、charge_unknown/settlement_required=processing 清車(bank_txn durable、settleCharge 收斂)、locked{user_in_flight}=in_flight 留車無單號、locked{order_locked\|not_unpaid}=processing 清車(同同步)、init_failed=charge_failed_wait 留車(零 TapPay 零扣款、可重試)。內部一致、安全面無雷。
- codex k1 #2「壞 payment_url → processing 非 generic」防誤導重刷雙扣 = 正解;k1 #3 preflight 移建單前零垃圾單 = 正解(buildCardholder 先於 placeOrder 已實證、插點成立)。

**🟡 notes 交執行側(非 blocker、不改 Sean 決策):**
- **🔴 N1(實作風險、6a 關卡2 緊盯)**:§2.3 mapInitiateOutcome 對 redirect 的 payment_url 驗證**必須是與 base-URL 不同的較鬆 predicate**。`resolvePaymentBaseUrl()` 驗 base = **origin-only**(拒 query/hash/path);但 **payment_url 是 `https://...?token=...`、本質帶 query**(TapPay token query)→ 若誤把 origin-only 檢查套到 payment_url,**會拒掉所有合法 redirectUrl → 每筆 3DS 都掉到 processing**(happy-path 全壞、code-review 表面看不出)。plan §2.3 line106 文字有意識到(「isHttpsUrl 驗 protocol/hostname、不限定 TapPay 網域」),但 §2.2 code sketch **未顯式定義/export `isHttpsUrl()`**。→ 執行側須在 three-ds-urls.ts **明確 export 一個 protocol+hostname+no-credential(允許 query)的 `isHttpsUrl()`**,與 origin-only 的 base 驗 **分開**;6a 測必含「payment_url 帶 token query → 仍判合法 → redirect」案,釘死此區分。
- **N2(6b nit、非 blocker)**:CheckoutRedirecting 的 `window.location.assign` 在 useEffect 無 fallback link/timeout;若導向被瀏覽器擋(罕見),使用者卡在 interstitial。Phase II 可加「N 秒後顯示手動『點此繼續』」;Phase I 可接受。
- **Q1 審查側 concur = A**(抽 `notify-secret.ts` 單一真相):secret 規則是安全邊界、應單一真相防漂移、route 行為零變且 route.test.ts 守回歸;規則已驗 byte 一致(≥32 + URL_SAFE_RE + MIN_SECRET_LEN=32)。**caveat**:抽出後動到的是**已上 prod 的 webhook route** → 執行側須跑**完整 route.test.ts**(非子集)+ 確認抽出函式行為 byte 等價(memory `run-full-vitest-after-shared-component-change`)。

**關卡2(binding)待 commit 落地逐條核**:① flag off 走 confirmPayment 零行為差(initiatePayment/resolveThreeDSConfig 零呼叫回歸)② flag on charge-actions 分岔正確(initiatePayment 收 server 值、client 竄改不採信)③ **N1 isHttpsUrl 區分**(payment_url 帶 query 仍合法、base origin-only)④ payment_url/prime/卡資料零入 log(server+client、.next/static grep)⑤ result_url 組裝對齊 3DS-2 secret 段 / 3DS-3 `?order=` callback ⑥ 中間態誠實(prod checkout 不可開、flag 僅 sandbox)⑦ 三綠 forced-fresh + full vitest + 經銷價雙 grep ⑧ codex 關卡2 cross-model(鐵則 12、main session、read-only、porcelain 零留痕;quota 6/18 已過、應可跑)。哨兵 `b845nq6ad` 待命接 6a。

## 2026-06-19 — plan commit `5cc5baa` light review(docs-only、N1/Q1=A/N2 折入驗收)= PASS-with-1-nit

`docs(payment): M-3 3DS-6 charge-actions redirect plan(codex 關卡1 PASS + 審查側 sign-off、N1/Q1=A 折入)`。哨兵 `b845nq6ad` 抓到 → fresh pin `5cc5baa`(parent=ed08945 線性)。**docs-only**(單檔 plan +294、零 code/STATUS/migration → 整合留整線、正確)。

**折入驗收(字面 vs 事實逐條 grep):**
- ✅ **N1 折入**:§2.2 L90-92 顯式區分 `resolvePaymentBaseUrl`(origin-only、**不 export**、拒 query/hash/path)vs `isHttpsUrl`(**顯式 export**、允許 query/path、只驗 protocol/hostname/無 credential);L97 明述「絕不可誤用 origin-only 驗 payment_url」;L98 要求 `mapInitiateOutcome` import `isHttpsUrl`(不另寫一份)。
- ✅ **Q1=A 折入**:L76/L80 `import { requireNotifySecret } from './notify-secret'`(用真實 route 函式名);L99 byte 等價抽出(同 MIN_SECRET_LEN=32/URL_SAFE_RE/throw)+ route 改 import 行為零變 + **改完跑完整 route.test.ts + 完整 vitest**(我的 caveat 逐字);§5 L202-203 影響面列 notify-secret.ts 新檔 + route import 改。
- ✅ **N2 折入**:§3.3 L174 nit、本片不做、記 backlog、Phase II 補手動繼續連結。
- ✅ §11 L284-287 補「審查側關卡1 PASS-with-notes、Sean 批 Q0=A/Q1=A、5b migration 已在 prod」。

**🟡 NIT(forward 到 6a、非 blocker)— fold 自身字面 vs 事實 gap**:§11 L285 宣稱「6a 測釘『帶 token query→redirect / 壞值→processing』兩案(§2.2/**§2.4**)」,但 **§2.4 測試列舉未實際更新**:① charge-actions.test 仍泛寫「`redirect`(合法 https payment_url)」、**未明確釘「payment_url 帶 `?token=` query → 仍 redirect」**;② three-ds-urls.test 只測 base/secret/buildResultUrls、**未為新 export 的 `isHttpsUrl` 加專屬測案**(尤缺「`isHttpsUrl('https://host?token=x')`→true、允許 query」)。需求已捕捉於 §2.2 + §11 文字,但未落進 §2.4 列舉 → 照 §2.4 寫無 query 的「合法 https」測,即使誤用 origin-only 驗證測也會綠、N1 bug 漏網。**disposition**:5cc5baa 未 push、可選 fold 進 6a(6a 本就動 §2.4 測);無論 plan §2.4 字面如何,**6a 關卡2 我親驗測試碼真含 token-query 案 + isHttpsUrl 允許-query 案**(binding hard-check、列入上方關卡2 ③)。

**判定 = PASS**(docs-only、N1/Q1/N2 實質折入、N1 需求已捕捉於 §2.2/§11)。1 forward nit(§2.4 測案列舉)交 6a。哨兵續盯。

## 2026-06-19 — 3DS-6a commit `6d076a5` 關卡2(審查側、鐵則 12 金流 delivery、binding、fresh-context)

`feat(payment): 3DS-6a charge-actions flag 分岔回 redirect + 抽 notify-secret`。哨兵 `b845nq6ad` 抓到 → fresh pin `6d076a5`(parent=5cc5baa 線性、三綠跑前後 HEAD 皆 6d076a5)。diff = 7 code/test + plan ±4;**零 migration/env/sql/vercel/STATUS**(整合留整線、不碰 db push bundle)。

**⚠️ 工作樹汙染揭示(誠實記帳)**:審查時 worktree 有**未 commit 的 6b WIP**(CheckoutView.tsx/.test + useChargePayment.tsx/.test 4 檔 M)—— 執行側未待 6a sign-off 即起 6b。故 full-vitest 跑在 `6d076a5 + 6b WIP` 上(非純快照)。緩解:① 6a 4 測試檔與 6b WIP **disjoint**(6a 動 charge-actions/three-ds-urls/notify-secret/route、6b 動 CheckoutView/useChargePayment)→ **單獨 filter 跑 6a-related 8 檔/146 pass/0 fail 乾淨**;② 全域 typecheck 綠**且 6b 已消費 6a 的 redirect variant** = 對 6a 型別反更強證據。code 審全程對不可變 `git show 6d076a5` 快照(非工作樹)。

**驗證矩陣(逐項實證、非信 commit 字面):**

| 項 | 結果 | 實證 |
|---|---|---|
| 🔴 N1 命門(isHttpsUrl vs base 兩 predicate) | ✅ | `three-ds-urls.ts`:`isHttpsUrl`(L64 **exported**、僅驗 protocol/hostname/無 credential、**不碰 search/hash/path**)vs `resolvePaymentBaseUrl`(L35 **不 export**、額外驗 search/hash/pathOk = origin-only);`isHttpsUrl` test 釘 `https://...tappaysdk.com/...?token=abc123→true`(帶 query)+ `https://host:8443/p?a=1#frag→true`,base test 釘 `https://host?x=1→throw`(query 對比);charge-actions 整合測 redirect payment_url 帶 `?token=abc`→`{redirect:true}` 非 processing。**誤用 origin-only 驗 payment_url 必被 test 紅** |
| flag 分岔正確 | ✅ | flag off→threeDSConfig=null→`confirmPayment`(else 逐字不動);flag on→`initiatePayment`→`mapInitiateOutcome`;test:flag off→initiatePayment/resolveThreeDSConfig 零呼叫(回歸)、flag on→confirmPayment 零呼叫 |
| 🔴 preflight 零垃圾單(codex k1 #3) | ✅ | `const threeDSConfig = isThreeDSEnabled() ? resolveThreeDSConfig() : null` 在 buildCardholder 後、**placeOrder 前**;resolveThreeDSConfig throw→既有 catch→MSG.generic;test 釘 throw→generic + **placeOrder 零呼叫** + initiatePayment 零呼叫(零扣款零垃圾單) |
| 🔴 鐵則 12 server 權威 | ✅ | initiatePayment 收 `orderId=placed.orderId`(placeOrder 回)/`amount=total`(findTotal read-back、Money 整數)/`prime=parsedPrime.data`(L176,與同步 confirmPayment L195 **同源**)/cardholder=built;deps={tappay,attempts} **無 confirmer**(不 markCharged/confirm);test 斷言 client 塞值不採信 |
| mapInitiateOutcome 映射 + 窮盡 | ✅ | redirect(isHttpsUrl 合法→redirect、壞值→processing settlementRequired **非 generic**、防誤導重刷雙扣)/charge_unknown·settlement_required→processing/locked{user_in_flight}→in_flight 無 displayId/{order_locked·not_unpaid}→processing/init_failed→charge_failed_wait;5 kind 窮盡(typecheck 強制 return 覆蓋、無 ok:true 分支);test 全列 |
| 🔴 無 fake-paid | ✅ | mapInitiateOutcome 永不回 `ok:true`(啟動半段不回扣款結果);paid 只在同步 mapOutcome;codex 獨立確認 |
| Q1=A byte 等價抽出 | ✅ | `notify-secret.ts`:MIN_SECRET_LEN=32 + URL_SAFE_RE `/^[A-Za-z0-9_-]+$/` + 同 throw 訊息,與 route 原版字字相同;route.ts diff = +import、移除本地 MIN_SECRET_LEN/URL_SAFE_RE/requireNotifySecret 副本(typecheck 綠證無 dangling ref);route.test 在 8/146 綠(完整跑、行為零變 caveat 滿足) |
| 🔴 零洩(log + client bundle) | ✅ | charge-actions/three-ds-urls/notify-secret **完全無 console.***(redirectUrl/payment_url/prime/cardholder/secret 零入 log);**.next/static ZERO** TAPPAY_NOTIFY_PATH_SECRET/requireNotifySecret/resolveThreeDSConfig/isThreeDSEnabled/TAPPAY_3DS_ENABLED + ZERO price_store/priceByTier/price_by_tier(server-only 結構零洩) |
| 三綠 | ✅ | turbo typecheck/lint/build exit 0;**6a-related 8 檔/146 pass/0 fail(乾淨 filter)**;full vitest 129 檔/1295/0 fail(含 6b WIP,1295 與 commit 字面一致) |
| 對齊 3DS-2/3DS-3 | ✅ | buildResultUrls frontend `<base>/checkout/callback?order=<orderId>`(對齊 3DS-3 callback 讀 sp.order UUID)、backend `<base>/api/checkout/tappay-notify/<secret>`(對齊 3DS-2 webhook secret 段);test 釘 shape |
| 中間態誠實 | ✅ | flag off=現況同步、flag on=sandbox-only;本片不開 prod 結帳、不設 env;6a 未消費 redirect(client 跳轉=6b)→ flag 必續關到 6b 落地(codex 同認) |
| manifest | ✅ N/A | 6a 動 server action/lib/API route、**無 design-mirror storefront UI 元件**(那是 6b)→ manifest 不需動;commit 無 STATUS(整合留整線、正確) |
| 字面 vs 事實 | ✅ | commit body「1295/typecheck 7/7/lint 10/10/Q1=A byte 等價/N1 折入/payment_url 零 log/中間態誠實」逐條實證相符;plan ±4 = code-reviewer 3 nit 修(§2.1 import 名 + §2.4 framing) |
| 🔴 codex 關卡2 cross-model | ✅ PASS | `codex exec -s read-only -c service_tier=fast`(config `default` 無效、override 繞;此版只收 fast/flex)、exit 0、**zero-trace OK**(PORCELAIN_UNCHANGED + HEAD_UNCHANGED)。VERDICT=**PASS、0 must-fix**;codex 獨立查證「無 fake-paid / preflight 先於 placeOrder / server orderId·amount·cardholder / 壞 payment_url→processing / notify-secret 抽出行為保留」→ 與審查側手動審收斂 |

**🟡 殘留 nit(全非 blocker、forward):**
- **N-a(codex nit + 審查側同源)**:`isHttpsUrl` 未鎖 TapPay 網域 allowlist。**現無 open-redirect**(redirectUrl 來自 TapPay adapter server-to-server 回應、非 client 輸入;isHttpsUrl 擋非 https/credential)→ codex 與審查側皆判非洞;Phase II 加固可考慮 TapPay host allowlist 縮 blast radius(backlog 級)。
- **N-b(doc-staleness)**:plan §2.4 spec 文字仍未列舉 `isHttpsUrl` token-query 測案(§11 fold-note 宣稱有)→ 但**測試碼已完整有**(three-ds-urls.test L82-103);純 spec 落後 test、零功能影響。
- **N-c(整合 forward)**:commit body「N2 記 backlog」實為 plan §3.3 標註、**backlog 檔條目未加**(STATUS/backlog 留整線收尾)→ 整線收尾時確認 N2 落 backlog。
- **過程觀察**:執行側未待 6a sign-off 即起 6b WIP(寫審分離節奏重疊)。非 6a 缺陷;提醒理想節奏=每片 commit 後暫停待 sign-off,或至少保持工作樹乾淨利審查方跑純快照三綠。

## ✅ 3DS-6a 審查側最終 sign-off = PASS(HEAD `6d076a5`、未 push)
N1 命門兩 predicate 分開〔isHttpsUrl 允許 query、test 釘死對比〕+ flag 分岔正確〔off 同步不動/on initiatePayment〕+ preflight 零垃圾單 + 鐵則 12 server 權威〔orderId/amount/prime 同步同源〕+ 無 fake-paid + 壞 payment_url→processing 防雙扣 + Q1=A byte 等價抽出〔route 行為零變〕+ 零 log/零 client bundle 洩 + 三綠〔6a 乾淨 146 + full 1295〕+ codex K2 cross-model PASS zero-trace + 字面vs事實全對。**0 must-fix、3 forward nit(N-a host allowlist Phase II / N-b plan §2.4 spec / N-c N2 backlog,皆非 blocker)**。**未 push、未 db push**(零 migration)。**下一步 = 3DS-6b**(useChargePayment redirect 態 + CheckoutView early-return + CheckoutRedirecting;已見工作樹 WIP、落 commit 後單獨審)。哨兵 `b845nq6ad` 續盯。

## 2026-06-19 — 3DS-6b commit `db3afbb` 關卡2(審查側、鐵則 12 client redirect、binding、fresh-context)

`feat(payment): 3DS-6b client redirect 跳轉 TapPay + CheckoutRedirecting`。哨兵 `b845nq6ad` 抓到 → fresh pin `db3afbb`(parent=6d076a5 線性、**工作樹現乾淨**〔6a 審時的 6b WIP 已 commit、汙染解除〕、三綠前後 HEAD 皆 db3afbb)。diff = 6 client/test + manifest + backlog;**零 server/charge-actions/three-ds-urls/notify-secret/migration/env**(純 client 接線)。

**驗證矩陣(逐項實證):**

| 項 | 結果 | 實證 |
|---|---|---|
| redirect 態接線 | ✅ | useChargePayment 在 `'ok' in res` **前**攔截 `'redirect' in res && res.redirect`(redirect shape 無 ok/payment 鍵、避 fall-through 驗證層);其餘 6 態逐字不動 |
| 🔴 redirect 不清車 | ✅ | redirect 分支**不呼 clear()**(留車、callback 成功頁才清、abandon 可回頭);test 雙釘 `cart.clear).not.toHaveBeenCalled()`(hook + View) |
| 🔴 非終態 + UI 鎖 | ✅ | submit 回 `true`(primeBusyRef 不釋放、防導向前重送);state=redirect 非 paid;codex 確認「不顯示為 paid」 |
| 🔴 payment_url 零 log + 零 DOM | ✅ | CheckoutRedirecting JSX **只渲染靜態文案、零顯示 redirectUrl**;redirectUrl 只進 `useEffect → window.location.assign`(零 console);test 斷言 `container.textContent.not.toContain(PAY_URL)` + `.not.toContain('token=...')` |
| render 期零副作用 | ✅ | window.location.assign 封裝於 CheckoutRedirecting 的 `useEffect`(deps [redirectUrl]、無 disable);CheckoutView 只 early-return 渲染、零副作用 |
| 鐵則 6(400 行) | ✅ | CheckoutView 394<400(抽 CheckoutRedirecting 子元件避超限);diff +6 行(388→394) |
| 🔴 無 client 可控 redirect 源 | ✅ | redirectUrl 唯一來源 = chargePaymentAction 回傳(6a 已 isHttpsUrl 驗);codex 獨立確認無替代未信任源 |
| 鐵則 1 design 保真 + 零新 CSS | ✅ | 沿用 CheckoutSuccess co-page/co-main/co-success-card/co-success-eyebrow/co-success-title/co-success-note(checkout.css L16/17/368/377/381/385 全存在);interstitial 文案 PCM 自撰(design 無 3DS redirect 態、同 failed/processing PCM 變體既例);scope 零 .css 檔變動 |
| 三綠(乾淨 db3afbb) | ✅ | turbo typecheck/lint/build exit 0;full vitest **130 檔/1299/0 fail**(與 commit「1299(+4)」精確一致;工作樹乾淨=純快照、無 6a 審時的汙染) |
| manifest 同步 | ✅ | CheckoutPage 加 CheckoutRedirecting.tsx + last_modified_commit=`6d076a5`(db3afbb 父、可達祖先、避 amend orphan #180 案 A)+ 完整 3DS-6 描述 |
| backlog #239 | ✅ | N2(redirect 無 fallback 連結)完整條目〔問題/觸發/解法/不修會痛三視角/估時/依賴〕、🟡 低優先 sandbox-only、flag 對外開前補 → 解審查側 N-c forward nit |
| 經銷價 client bundle | ✅ | .next/static ZERO price_store/priceByTier/price_by_tier |
| 中間態誠實 | ✅ | flag off=同步現況、prod 結帳仍不可開;真實刷卡待 sandbox 3DS E2E + Sean 驗收 |
| 字面 vs 事實 | ✅ | 1299/394 行/typecheck 7/7/不清車/payment_url 零顯示 逐條相符;manifest 可達性 gate「path-token ❌=worktree submodule 未 populated 環境 artifact〔#238 主樹已修〕」屬實揭示、非真斷鏈 |
| 🔴 codex 關卡2 cross-model | ✅ PASS | `codex exec -s read-only -c service_tier=fast`、exit 0、**zero-trace OK**(PORCELAIN/HEAD UNCHANGED)。VERDICT=**PASS、0 must-fix**;4 點獨立確認(攔截順序/不清車/非終態/不顯 paid / useEffect 導向零 log / 無替代 redirect 源) |

**🟡 殘留 nit(全非 blocker、forward):**
- **🔴 N-d(codex 關卡2 抓、好觀察、forward 給 #239 實作)**:backlog #239 提的未來解法寫 `<a href={redirectUrl}>` → 會把 token URL 落進 **DOM href 屬性**(雖非 textContent、但頁面源碼/DevTools/analytics 可見)→ **違反 payment_url 零入 DOM 鐵則**。現行 CheckoutRedirecting 碼**無**此問題(純 assign);此為 #239 條目「解法」文字的潛在地雷。**修法**:#239 實作時改 **button + onClick→`window.location.assign(redirectUrl)`**(token 完全不落 DOM),非 `<a href>`。建議整線收尾時順手修 #239 解法文字。
- **N-a/N-b carry(6a)**:N-a isHttpsUrl host allowlist(Phase II 加固);N-b plan §2.4 spec 文字未列 isHttpsUrl 測案(test 碼已有、純 doc-staleness)。

## ✅ 3DS-6b 審查側最終 sign-off = PASS(HEAD `db3afbb`、未 push)
redirect 攔截順序正確〔ok 前、避 fall-through〕+ 不清車〔留車 abandon 可回頭〕+ 非終態 UI 鎖〔submit 回 true〕+ payment_url 零 log 零 DOM〔test 斷言〕+ render 期零副作用〔useEffect 封裝〕+ 鐵則 6 394<400 + 無 client 可控 redirect 源 + 鐵則 1 零新 CSS 沿用 co-success + 三綠乾淨 1299 + manifest/backlog 同步 + codex K2 cross-model PASS zero-trace。**0 must-fix、3 forward nit(N-d #239 button-not-href〔codex〕/ N-a host allowlist / N-b plan §2.4 spec,皆非 blocker)**。**未 push、未 db push**(零 migration)。

## ✅✅ 3DS-5a+5b+6 整線審查完成 — 全部 PASS,整合收尾待啟
- **5a**(`96a2e79`)/ **5b**(`f476b1d`/`af391e4`/`ed08945`)/ **6a**(`6d076a5`)/ **6b**(`db3afbb`)= 全 PASS、0 殘留 must-fix。
- **5b migration `20260619120000` 已在 prod**(list_migrations 實證、Sean 已 db push);6a/6b 零 migration → **db push 已了結、無待推 migration**。
- **整合收尾(整線、待執行側 + Sean)**:① m3-3ds-5 worktree(5a→6b、tip db3afbb)merge → dev ② STATUS 7 欄 ③ busboy-end ④ /pcm-roadmap ⑤ /graphify --update ⑥ 可選順手修 backlog #239 解法文字(N-d button-not-href)。
- **🔴 prod checkout 仍一律不可開**(中間態誠實):真實刷卡 = Phase I + 5a/5b + 6 全到位〔已〕+ `TAPPAY_3DS_ENABLED='true'`〔Sean sandbox 設〕+ `NEXT_PUBLIC_SITE_URL` 公開 https + `TAPPAY_NOTIFY_PATH_SECRET` ≥32 + sandbox 3DS E2E 過 + Sean 肉眼驗(同一決策點、Sean 拍)。
- **未 push**(全線等 Sean 手動推);哨兵 `b845nq6ad` 可收(6 已完;若執行側續動再 arm)。
