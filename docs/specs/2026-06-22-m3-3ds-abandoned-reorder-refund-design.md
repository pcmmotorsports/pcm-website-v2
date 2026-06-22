# M-3 3DS 放棄交易:放行重買 + 後台退款 設計(2026-06-22)

> **一句話:** 客人關閉 3D 驗證頁放棄後,**讓他馬上重新下單、不卡住**;放行「前」先打 TapPay 查「舊的付了沒」(付了→擋並顯既有單;沒付→放行);極少數真撞到重複扣款 → **後台退款**那筆。取代現行保守「卡住顯處理中」。
>
> **狀態:** 方向 Sean 拍板「乙」(2026-06-22 sandbox E2E 探索後);本檔=**設計**(由審查 session 產出),**未 commit**。實作須走鐵則 8/12 流程:slice plan → codex K1 → Sean 批 → 施工 session(worktree)→ 審查。
>
> **鐵則:** 鐵則 8(跨 client + server action + use-case;後台另動)+ 鐵則 12(payment / 雙扣 / idempotency / 退款)。

---

## §0 地基事實(Sean 親自確認 + 三方模型對抗 + 親讀 code)

1. **沒完成 3D 驗證 = 銀行不授權 = 完全不扣款**(Sean 確認、標準 3DS)。放棄的 3DS 是空殼、不會憑空扣款 → 「放行重買」安全的根本前提。
2. **退款 = 當下可取消授權,但客人卡片約一週才看到退款**(Sean 業主經驗、看銀行)。→ 極少數雙扣時客人帳上可能看到兩筆達一週(罕見、最終只扣一次)。
3. **真正的危險不是「銀行憑空扣」**,是 server 端**分不出**「客人放棄(沒扣)」vs「客人剛付成功、通知還沒到(已扣)」—— 兩者都顯 `pending`。→ 故**放行前必查 TapPay Record**(settleCharge),把「其實已付」那種擋掉。
4. **TapPay 無 API 取消「未完成 OTP 的進行中 3DS」**(全 API 面已查);但**完成的交易可退款**(Refund API 取消授權+請款)。→ 殘餘的「放行後舊的才完成」用**退款**收尾,非事前取消。

**否決的方向(留檔備查):**
- ❌ **Gemini「dedup 加 15 分鐘 TTL 自動放行」**:15 分是猜的、TapPay 無文件背書、等同已暫停的 S4 縮窗 plan、開雙扣縫。
- ❌ **E1「付款成功才建單」**:三方一致 = 破壞 WAL(預寫單)/ per-order 鎖 / 對帳錨 / TapPay order_number,反引入更大雙扣 + 幽靈扣款。
- ✅ **保留現行「先建單 → begin 佔鎖 → settleCharge Record 權威」鐵壁**,只在其上改「pending 時的放行策略」+ 補退款收尾。

---

## §1 前端設計(storefront、**先做**)

> 目標:把現行「pending → 一律 hold 顯處理中」改成「pending → 查 Record;確定沒付 → 放行重買」。**確定已付仍擋(顯既有單)**,維持零雙扣主線。

### 現行行為(`adjudicateSettlement`,charge-actions.ts)
- begin 偵測同 cart_session_id sibling → `needs_settle` → `settleCharge(舊單)`:
  - `paid` → 顯既有單(paid-equivalent、clear+regenerate)。**維持。**
  - `failed`/`no_attempt` → 放行重刷。**維持。**
  - `pending` → **短 hold 顯「處理中」**。🔴 **本設計改這裡。**

### 改動(僅 `pending` 分支)
- `settleCharge(舊單) = pending`(record_unreachable / auth_or_pending / record_unverified)→ **不再一律 hold**,改為**放行重買**(視同「舊的尚未扣款、允許新單」)。
- **安全前提**:放行 = 只放行「建新單 + 重新 3DS initiate」;舊單的 pending attempt **不主動標 failed**(它仍可能完成,留給 settleCharge/sweeper Record-driven 收斂)。
- **殘餘風險明列(鐵則 10 攻擊時序自審,須 codex K1 覆蓋):**
  - 客人在「放行後幾秒內」於舊分頁完成舊 OTP → 舊單也扣 → 雙扣 → **收尾 = 退款(§2)**。
  - TOCTOU:查 Record「沒付」與「放行」之間有時間差 → 同上,退款收尾。
  - **此放行為 Sean 拍板接受的權衡**(罕見、可退款),非無條件;plan 須寫明 Sean 已 informed-accept §0.2 的「卡片約一週才退」。

### 動到的檔(預估)
- `apps/storefront/src/app/checkout/charge-actions.ts`(`adjudicateSettlement` 的 `pending` 分支:hold → 放行;放行 = 回可重新結帳的態,client 不持鎖)。
- 對應 use-case / domain 若需新「放行重買」終態。
- tests:`pending → 放行`、`paid → 仍擋`、`failed → 放行`(回歸)、攻擊時序(舊完成 → 標記待退)。

### 不變(守住的線)
- `paid`/`failed` 分支不動;begin 佔鎖 + settleCharge Record 權威不動;放行**只在 pending**。
- 經銷價/tier/金額正交不碰。

---

## §2 後台設計(admin、**未來 backlog**、後台開做時一起)

> Sean 指定:退款/取消訂單功能放後台人工處理(不全自動)。後台目前**尚未開始做** → 本節為未來規格,記入 backlog。

- **退款功能**:接 TapPay Refund API(`/tpc/transaction/refund`、`rec_trade_id`)—— 目前 adapter 是 stub(`TapPayChargeAdapter.refund` throw '未實作 Phase 2')→ 須實作。
- **疑似重複偵測**:對帳機制標出「同 user 同 cart 短時間內 2 筆都成立」→ 後台列表呈現 → 客服**人工確認後按退款**。
- **一般訂單取消**:後台手動取消/退款入口。
- **過渡(後台做好前)**:極少數重複 → Sean 用 **TapPay 後台手動退**(當下取消授權、客人約一週收到)。

---

## §3 順帶(降孤兒單,可併前端或獨立)

- **E2 顯示層過濾**:會員訂單列表隱藏 unpaid 孤兒/卡住單(`SupabaseOrderAdapter` 列表查詢加過濾)。
- **reuse**:`create_order` 對同 `(user, cart_session_id)` + 同購物車內容 → 回既有 unpaid 單、不每次建新孤兒(舊 pending 仍活 → 仍照 §1 放行邏輯)。

---

## §4 多模型對抗審查紀錄(2026-06-22、唯讀零留痕)

- **Codex(gpt-5.5、額度恢復後)**:E2 最安全 / E3 須 Record-driven / E1 不該先做(Phase 2 payment_intent);**dedup TTL 不可用計時器自動放行 active sibling**(只 Record-driven 釋放,除非 TapPay 有文件 hard expiry + buffer + 再查);建議 same-cart preflight/reuse 止孤兒。
- **Gemini(CLI)**:力推 15 分 TTL + 30 分 age-markFailed → **審查方擋下**(押在未驗證的 15 分、開雙扣縫、age-markFailed 反致幽靈扣款、與其自身對 E1 的批評矛盾)。
- **本設計取捨**:採 Sean「乙」(放行 + 查 Record + 退款收尾),因 §0.1 地基(沒完成不扣款)使「放行」對放棄客人安全,§0.2(完成可退款)使殘餘race可收尾;**不採時間計時器放行**(codex + repo S4 前例)。

---

## §5 流程 + rollback

- **流程**:本設計 → slice plan(六件套)→ **codex K1**(鐵則 12、攻擊時序自審必查)→ Sean 批 → 施工 session(worktree、寫審分離)→ 三綠 + code-reviewer + **codex K2** → 審查 sign-off。
- **rollback**:§1 純 charge-actions 分支改、零 migration → revert 即回保守 hold;§2/§3 各自獨立。
- **待補**:① 後台 repo/位置(尚未開做)② TapPay 客服白紙黑字確認 §0.1/§0.2(雖 Sean 已口頭確認、金流設計留書面為佳)。

---

## §6 codex 關卡1 對抗審結論(2026-06-22、唯讀零留痕)= **FAIL**(施工前不可照 §1 直接做)

> codex 驗證「§1 純前端放行」不可行;5 個 must-fix。**正確順序須反轉:鎖語意 + 重複偵測 + 退款 先做,UI pending 分支最後。**

**must-fix(施工前必修):**
1. **§1 不是純前端改**:begin 對同 cart pending sibling 回 needs_settle(不取鎖)→ 同 key 一直撞同一筆、B 無法 charge;換 key 又被 user_in_flight 擋 10 分。「放行」**必須同時定義 cart dedup + user_in_flight 兩道閘怎麼放寬**,跨 DB/use-case,非前端分支。
2. **放寬 user_in_flight = 重開已暫停 S4 的雙扣縫**:本案多了 Record 查詢但 **TOCTOU 仍在**(查到 pending 後舊 OTP 仍可能完成)→ 本質是「Record-driven 放寬鎖 + 接受殘餘雙扣 + 退款收尾」,**非「完全安全放行」**。
3. **`pending` 不能整包放行**:pending 含 record_unreachable(可能 Record 掛、**也可能已 paid 但 confirm 失敗**)/ record_unverified(識別/金額/筆數異常)/ auth_or_pending。**只能對「Record 明確查到同單同金額 record_status=4 且 attempt 仍 pending」放行;其餘 pending 必須 hold**(否則放行到「其實已付」= 雙扣)。
4. **退款是 §1 的安全邊界、非未來 nice-to-have**:refund adapter 是 stub。**放行上線前至少要有:重複付款偵測 + 人工退款 runbook + 責任人 + SLA;更穩=先做後台退款**。只靠「Sean 事後手動退」可接受於 sandbox/低量內測,**不該當 production 安全前提**。
5. **舊 pending 不標 failed → 仍佔 active 語意**(per-order 鎖/cart dedup/user_in_flight/settle/sweeper 共用 pending|charged active 集)。「不擋新 charge 但仍可被 settle」→ **須新增 release 狀態/flag + 同步改 begin/get_active/sweeper/adapter/type/test**。

**should:** §3 訂單列表 unpaid 過濾**提前做**(放行後孤兒更常見);補「B 真 acquired」DB 交易模擬;TapPay 書面確認 record_status=4/Record 延遲/OTP 頁有效期(「查 Record 確定沒付」措辭過強 → 只能說「查詢當下未觀測到授權成功」)。

**已確認可行:** paid 仍擋顯既有單 ✓ / failed/no_attempt 放行 ✓ / 經銷價·tier·金額正交 ✓。

**修正後正確順序(取代 §1「前端先做」):**
1. 先做 **§3 安全部分**(列表藏 unpaid 孤兒 + create_order reuse)—— codex 確認安全、獨立、解 Sean 視覺痛點。
2. 設計 **release 鎖語意**(新狀態/flag + 窄化 release-able pending 條件 §6.3)+ DB/use-case 變更。
3. **重複偵測 + 退款操作路徑**(後台退款 or 至少 runbook+SLA)。
4. **最後**才改 UI pending 分支放行。
> Sean 若要先走人工退款過渡,須明確拍板「production 前最小可接受 = 偵測 + runbook + SLA」,否則 §1 應等退款功能先做。

---

## §7 修正版設計(2026-06-22 後續;Sean popup/取消訊號洞見)= **取代 §1 的「盲目放行 pending」**

> **核心轉向:** 不再「settleCharge=pending 就放行」(codex §6 抓的危險),改成「**客人『明確取消』→ 查 TapPay 確認沒付 → markFailed → 放行**」。用**既有 `failed` 終態**(codex §6「failed/no_attempt 放行=已確認可行」),**繞開** §6 must-fix #1/#2/#5。
>
> **前提(Sean 拍板):** 網站未上線 → 退款(§2)延後、sandbox/內測手動退可接受(放寬 §6 #4)。

### §7.1 關鍵洞見(Sean)
- 現行 **整頁跳轉**(charge-actions 回 redirect + client window.location.assign)→ **系統收不到「客人取消」訊號**(跳走了)。
- **取得「明確取消訊號」**才是價值核心:
  - **桌機**:3DS 開**新視窗 popup** + 鎖原視窗(「刷卡中」)→ popup 關閉/取消 = 偵測得到的取消。
  - **手機**(popup 不可靠:被擋/無視窗可鎖/偵測不到關閉、PCM 客群多手機)→ 改用「**取消、重新刷卡**」按鈕(桌機手機通用),一樣產生明確取消訊號。
- **UI 鎖只是體驗層**(擋同瀏覽器同分頁);**真正防雙扣保證仍靠後台 dedup**(換手機/換瀏覽器 UI 鎖管不到)。popup/按鈕 = 體驗 + 取消訊號;dedup = 保證;並存。

### §7.2 安全流程(取消 → 查 Record → markFailed → 放行)
```
客人明確取消(popup 關閉 / 取消按鈕)
   -> settleCharge(該單) 查 TapPay Record
       ├ paid                -> 顯「已完成付款」(他其實付成功了、零雙扣)
       ├ failed              -> 既已釋鎖 -> 放行重刷(現況)
       ├ 確認 not-charged    -> markFailed -> dedup + user_in_flight 兩閘自然釋放 -> 乾淨重刷
       │   (Record 明確查到同單同金額 record_status=4 且 attempt 仍 pending)
       └ record_unreachable / record_unverified(查不到真狀態、可能已付)
                             -> 不 markFailed、維持 hold(fail-closed、防 §6 #3 的「其實已付」誤放)
```

### §7.3 為何這版安全(逐一對應 §6 codex must-fix)
- **#1/#2(放寬 gate=重開 S4 雙扣縫)-> 避開**:不放寬 cart dedup / user_in_flight;取消的 attempt 轉 failed 後**自然**退出 active 集(pending|charged),兩閘 join active 不再命中 -> 放行,**非鬆鎖**。
- **#3(pending 不可整包放行)-> 滿足**:只在「取消 + Record 確認 not-charged」才 markFailed;record_unreachable/record_unverified **維持 hold**(可能已付不誤放)。
- **#5(需新 release 狀態)-> 避開**:復用既有 failed,不新增狀態機。
- **#4(退款先行)-> Sean 放寬**:未上線、手動退;殘餘「OTP 在取消瞬間恰好完成」-> Record 查到 paid -> 顯成功(非雙扣);更深 race(查後才扣)-> 內測量極低 + 手動退,正式上線前再補後台退款。
- **#3 should(措辭)-> 修正**:「查 Record 確定沒付」改「Record 明確查到同單 record_status=4 且 attempt 仍 pending(查詢當下未觀測到授權成功)」。

### §7.4 動到的檔(預估、施工前 codex 複審)
- client(6b redirect 區):桌機 popup + 鎖原視窗 + postMessage/close 偵測;手機 fallback「取消重刷」按鈕(或整頁跳轉 + go_back_url)。
- 取消 -> 呼既有 settleCharge 路徑(callback page 同款 getSettleChargeDeps)-> 依 §7.2 映射。
- markFailed 既有(退雙閘已驗、3DS-7 7c §3 攻擊時序自審 #1 綁定 Record terminal)。
- §3(列表藏 unpaid 孤兒 + create_order reuse)**仍先做**(codex should 提前)。
- tests:取消×{paid/failed/not-charged/unreachable} 映射;markFailed 退雙閘 DB 交易模擬;桌機/手機路徑。

### §7.5 殘留 / 待 codex 複審
- 桌機 popup 跨瀏覽器相容 + 手機 fallback 是否漏「取消訊號」情境。
- 「明確取消」訊號可信度(popup close ≠ 一定取消?誤觸?)-> 一律走 Record 查證,不單憑前端訊號 markFailed。
- 仍須 TapPay 書面確認 §0.1(沒完成不扣款)/ record_status=4 語意 / Record 延遲。

---

## §8 codex K1 第 2 輪複審 = **FAIL**(§7 仍不成立)+ 唯一 gating fact

> §7「取消訊號 → markFailed → 放行」仍 FAIL。codex 釘出**所有放行設計都撞的同一面牆**。

**must-fix(codex):**
1. **`record_status=4`(PENDING)≠「確認 not-charged」**:repo 正確把 4 視為 `pending/auth_or_pending`(settle-charge.ts L241、test L226 釘死),**非終態**、仍可能 late success(稍後變 0 AUTH/1 OK)。**客人「取消」不足以推翻這個保守**。除非 TapPay 書面保證「取消後 4 已不可能 later AUTH/OK」,否則不可用 4 觸發 markFailed。
2. **markFailed 非終態 attempt 會切斷對帳**:`get_active_charge_attempt` 只回 pending|charged;webhook 用「active attempt 存在」當存在性閘(無 active → 200 drop)。若先把 4 標 failed、之後真授權 → webhook 不 durable 記錄 → **幽靈扣款更難自動對帳**(比現況更糟)。
3. **不可改通用 settleCharge**:現行只對 record_status -1/5 markFailed;「取消模式」須獨立路徑 + 測試證 callback/poll/sweeper 遇 4 仍 hold。
4. **取消入口需安全規格**:client 取消訊號不可信 → 必 own-only 查本人單再 settle、不信 client 傳 attemptId/amount、加節流。

**已確認可行:** markFailed 確實退兩閘(Record-driven 單筆、≠ S4 時間縮窗);但只要 record_status=4 仍可能 late success,§7 只是**縮小** S4 雙扣縫、非關掉。

### 🔴 §8.1 唯一 gating fact = TapPay 書面確認

**所有「放行重買」設計(盲目放行 / 取消訊號放行 / 計時放行)都撞同一面牆**:**「客人放棄/取消的 3DS,之後還能不能被授權/扣款?」** 這是 **TapPay 事實、非設計問題**。在拿到答案前,任何 markFailed/放行都是把雙扣/幽靈扣款風險押在未驗證假設上。

**問 TapPay 客服(4 題):**
1. Pay by Prime + `three_domain_secure=true` 取得 payment_url 後,客人**未完成 3D 驗證**(關閉頁面 / 取消 / 放著)→ 這筆**之後還有沒有可能被授權/扣款**(例如稍後回驗證頁完成 OTP)?還是一旦放棄就**永久作廢、不可能再扣**?
2. 若會作廢:**多久後**作廢(timeout)?期間 Record API 的 `record_status` 是什麼?作廢後變什麼(5 CANCEL?)?
3. 商家端有沒有辦法**主動讓這筆作廢**(確定不可能再扣)?
4. `record_status=4`(PENDING)的交易,**是否可能稍後變成 0(AUTH)/ 1(OK)**?什麼情況下?

**分流:**
- TapPay 答「放棄=永久作廢、不會 late success」→ §7 取消放行設計**成立**(取消 → 標 failed → 乾淨放行),safe。
- TapPay 答「仍可能 late success」或不確認 → **保守 hold 維持** + 後台退款收尾(正式上線前)。

**在此之前:** 保守 hold(現況)維持、安全;**§3(會員列表藏 unpaid 孤兒 + create_order reuse)可獨立先做**(codex 確認安全、解視覺痛點)。**停止再迭代放行設計**(每版都撞同一面牆)。

— END —
