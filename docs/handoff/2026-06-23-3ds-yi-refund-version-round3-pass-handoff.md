# M-3 3DS 立即重刷(乙路·退款版)— codex round3 PASS 交接(2026-06-23 晚)

> **給下個 session:** 退款版「立即重刷」plan **已通過 codex round3(round2 PASS)、可進實作**。沙盒 3DS 端到端跑通、late-success 證實為真、Sean 前台 UX 已拍。**下一步 = MCP DB 交易模擬 → 實作 R1-R3/W1/塊A(milestone 級、建議開 fresh 執行 session 寫審分離)。** 本 session 零 code 變更、零 commit。

## 0. 一句話現況
卡了整天的「正式刷卡跳不出 3D」根因查清(TapPay 憑證沒成套、非我們 code)→ 沙盒 3D 跑通 → 實證放棄的 3D 可事後完成(late-success 真)→ Sean 拍 UX(每次新訂單立即重刷+新分頁 3D+取消/關閉回購物車)→ 放掉 A1-Void 改退款版 → **codex round3 PASS**。真錢 code 一行未動(守線:DB 模擬 PASS 才實作)。

## 1. 本 session 做了什麼(全研究/規劃/DB 清理,零 code)
1. **診斷 3DS 正式刷卡卡關** → 根因 = **TapPay 憑證沒成套**(charge `status 84`=Partner 未授權 / `status 121`=參數錯誤:prime,前端 app 憑證 vs 後端 merchant 不成套)+ **demo 商家 `GlobalTesting_CTBC` 無 3D**。**非我們 code**(逐字核 TapPay 官方範例 repo=happy-path、cap/void 整合本就商家責任)。
2. **沙盒 3DS 端到端跑通** ✅:merchant `pcmmoto_NCCC_AE_Only`(sandbox AMEX-only 有開 3D)+ AMEX 卡 `3454 5465 4604 563`/CCV`1234` → `status:0`+payment_url → 3D 頁 → OTP`1234567` → callback → 訂單 paid。
3. **實證 late-success 為真** 🔴:客人按上一頁離開 3D 後,複製 payment_url 貼新分頁**可重開、輸 OTP 完成、訂單變 paid**(實證 PCM-2026-0052)→ 立即重刷的「舊單晚成功」雙扣窗**真實存在**。
4. **Sean 前台 UX 拍板**:每次重結帳=新訂單(立即重刷)、3D 跳新分頁、原頁鎖定、取消/關閉→回購物車、馬上重結帳零「付款處理中」死路頁;手機 fallback=整頁跳轉+go_back_url(結果同 PayPal)。
5. **方向定稿**:放掉 A1-Void(critic 證明與立即重刷二選一+8 洞)→ 回**退款版**(維持 S1「授權即成立+自動請款」、罕見雙扣偵測+Sean 後台手動退)。
6. **codex round3**:round1 FAIL 6 findings → 全折入 plan §17 → **round2 PASS**(F1-F6 全關死、無新增阻擋級洞、零留痕)。
7. **清掉 24 張 debug 死單**(PCM-2026-0029~0051、unpaid 無扣款紀錄、Sean 授權,DB 已執行)。
8. **零 code 變更、零 commit、graphify 未刷**(無 code 變動)。

## 2. 真權威座標
- **plan(真權威):** `docs/specs/2026-06-23-m3-3ds-abandoned-complete-plan.md`(286 行)。
  - 基線 = **§0-§14**(退款版 released 立即重刷;§14.1 MF6/MF3 已折入)。
  - **§15 = A1-Void 作廢**(勿照做)。
  - **§16 = 退款版定稿**(§16.1 沙盒實證 / §16.2 三點 UX / §16.3 手機 fallback / §16.4 接地事實)。
  - **§17 = codex round3 findings 折入**(F1-F6,實作以此為準);**§17.1 = round2 PASS + 實作序**。
- **前序 handoff:** `docs/handoff/2026-06-23-3ds-yi-immediate-recharge-codex-round2-handoff.md`、`docs/handoff/2026-06-23-tappay-3ds-live-debug-research-handoff.md`。
- **沙盒測試組合(可重現 3D):** merchant `pcmmoto_NCCC_AE_Only` + AMEX 卡 `3454 5465 4604 563` / CCV `1234` / 到期任意未來 / OTP `1234567`;ngrok https tunnel 當 `NEXT_PUBLIC_SITE_URL`;`TAPPAY_3DS_ENABLED=true`。
- **codex 輸出(/tmp、重開機消失):** `/tmp/codex-r3-out.txt`(round1 FAIL 6 洞)、`/tmp/codex-r3b-out.txt`(round2 PASS)。

## 3. 下一步(編號、優先序)
1. **MCP DB 交易模擬**:驗 `markReleased`/`markCharged` CAS 競態序(BEGIN+ROLLBACK 零留痕、plan §9 attack#1 + §17 F1/F4 的 predicate 斷言)→ **PASS 才實作**(守線)。
2. **實作序**(每段:三綠 + code-reviewer + codex K2 → commit **不 push**):
   - **R1** migration(released 狀態 + CHECK + per-order index 含 released + `find_active_sibling_own` authenticated 唯讀 + **`mark_charge_attempt_released_for_user` server-only payment_confirmer**〔§17 F1〕 + sweeper released policy〔§17 F4〕 + 轉移時 anomaly 表〔§17 F3〕)
   - **R2** use-case `preflightReleaseSibling`
   - **R3** charge-actions 接線(placeOrder 前)
   - **W1** 雙扣偵測(released→charged transition anomaly + 退款候選報表〔§17 F3/F6〕)
   - **塊A1** 純前端(新分頁 3D + 原頁等待,先做)
   - **塊A2** 取消/關閉→回購物車→馬上重結帳(**綁 R 段 server release + go_back_url wiring**〔§17 F2/F5〕,依賴 Sean 待辦①)
3. **建議開 fresh 執行 session**(寫審分離 ROLE=A、獨立 worktree;milestone 級量大、fresh context 較穩)。

## 4. Sean 待辦
1. **(解塊A2 邊界)** ① ✅ **已驗(2026-06-23,記 plan §16.4)**:「取消」鈕→record 終態 CANCEL→現有 markFailed→attempt `failed`→死、零雙扣、**現在就能重刷**(實證 PCM-2026-0053/0054);「上一頁/關閉視窗」→record **4 PENDING**→卡「付款處理中」(實證 PCM-2026-0055)+ URL 可重開=late-success → **released 立即重刷只需對付這條、取消免**。② **待做**:`go_back_url` 接線後桌機 popup + 手機 redirect 真機驗。
2. **(上線前硬前置)** 修正式環境四憑證成套:`tppf_pcmmoto_5803001` 帳戶的 `NEXT_PUBLIC_TAPPAY_APP_ID`/`APP_KEY`/`TAPPAY_PARTNER_KEY`/`TAPPAY_MERCHANT_ID` 一起對齊同帳戶 + 確認該商家開通 3D(正式真卡現仍 `status 121`)。
3. **(環境)** `~/.codex/config.toml` 的 `service_tier = "priority"` → 改 `"fast"` 或刪(codex 0.128.0 不收、現靠 `-c service_tier="fast"` 繞)。
4. **(可選)** commit 這批 untracked 設計檔(plan + 3 handoffs)、push dev(dev 領先 origin/dev 數 commit、皆 Sean 手動)。

## 5. Blocker
無硬 blocker。塊A2 依賴 Sean 待辦①(沙盒驗);正式上線依賴 Sean 待辦②(正式憑證)。R1-R3/W1/塊A1 可逕行(codex round3 已 PASS)。

## 6. 守線(不變)
- 核心金流真錢 code **未實作**(round3 PASS 但 **DB 交易模擬未跑**)→ 實作前先跑 DB 模擬。
- **不 push / 不 db push**(Sean 終端);**不碰 .env**(Sean 自己改)。
- 本 session **零 code 變更、零 commit**;plan/handoff 皆 untracked 設計檔。

— END —
