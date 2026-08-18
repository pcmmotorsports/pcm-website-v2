# Plan — 人工待確認佇列:**完整範圍**(重查 + 補入帳 + 出口 一次做完)

> 🔴 **Sean 2026-08-19 拍板(逐字,主視窗轉)**:
> **「你安排完整一次做好,不要做一半。這種東西不能做一半然後等到之後忘記再補,寧可花時間做好。
>  如果需要,完整的 DB 權限都可以給你操作。」**
> ⇒ **「先做 A、B 寫進 backlog 之後補」這條路在這件事上【關了】。**
> ⇒ 本檔取代 `docs/specs/2026-08-18-manual-review-queue-has-no-exit-plan.md` §4 的實作範圍
>   (那份的**病理分析仍然有效、留痕不刪**;換掉的是**做什麼**)。
> **狀態:未批。** 命中 **鐵則 8**(跨 3+ 檔、動 schema)+ **鐵則 12 ①錢 ②權限 ③schema** ⇒ 要 Sean 批 + 對抗審查。

> ## 🔴🔴 檔頭警語(2026-08-19 加,**接手的人先讀這段**)
>
> **「`20260819010000` 的斷言群是今晚最強的一套 ⇒ 新版直接繼承、免重驗」這句【作廢】。**
> 它出現在 `~/pcm-mailbox/G4-008-STOP-段落-20260819.md` §0 與 GR 的第二意見裡。
> **錯的不是「繼承」,是「免重驗」** —— 而它具體錯在 **5c 那一格**:
>
> ```
> 5c 斷言(:404-409)要求函式原始碼(去 -- 註解後)含 'AND a.manual_reviewed_at IS NULL'
> 而 96e13bbe 的 C-B 反轉【把那一行從主告警述詞拿掉了】(:144 的刪除註記)
> ⇒ 兩者互斥 ⇒ **這支 migration apply 一定會 RAISE '告警述詞異常 … 拒繼續'**
> ```
> **量到的(唯讀,可重跑)**:
> ```
> $ f=supabase/migrations/20260819010000_m4a_close_manual_review_attempt.sql
> $ sed -n '104,209p' $f | sed 's/--.*$//' | grep -c "manual_reviewed_at"
> 0     ← get_payment_anomaly_alert_summary 函式體去註解後零命中 ⇒ 5c 必紅
> $ sed -n '104,209p' $f | sed 's/--.*$//' | grep -c "reviewed_unknown_unresolved_count"
> 1     ← 負向對照:同一把尺對該命中的東西會動
> $ sed -n '232,340p' $f | sed 's/--.*$//' | grep -c "manual_reviewed_at"
> 5     ← 字串本身沒打錯,它在【另一支函式】(RPC)裡
> ```
> 🔴 **證據等級:讀檔 + grep 量到的,【沒有】在 PG 上跑過 apply。** 引用本段要帶這個限定。
> 範圍限定:104-209 = `get_payment_anomaly_alert_summary` 函式體(:104 CREATE / :110 LANGUAGE sql)。
>
> 📌 **教訓的形狀**:那句「免重驗」是**對【一群】斷言下的整體評價**,
> 而**壞掉的是其中【一格】** —— 整體評價天生蓋不住單格的反轉。
> ⇒ **繼承時要逐格核,不是逐群核。** 逐格清單見 §13。
>
> 🔴 **2026-08-19 追加(GR-043 S5):§13 已降成【條件節,預設不做】。**
> 因為照 §14 那支檔會被移出 `supabase/migrations/` ⇒ **它永遠不會 apply ⇒ 5c 不用修。**
> 本段留著是為了記錄「免重驗那句錯在哪」,**不是**一張待辦。
>
> ## 🔴 主視窗裁定(2026-08-19,已生效、已落主視窗桌面狀態檔)
> **`20260819010000_m4a_close_manual_review_attempt.sql` 不得被 apply,直到 5c 與 C-B 反轉對齊。**
> Sean 的 apply 清單由主視窗控 ⇒ **這支不會進去。**
> 並裁:**不要改那支 SQL**(在舊形狀上補丁 = Sean 明文關掉的「做一半」);gate 仍是「完整範圍一次做完」。

---

## 0. 🔴🔴 先講最重要的一件:**我原本的形狀是錯的,而正確的機器【已經存在】**

我 2026-08-18/19 寫的 `20260819010000` 是這個形狀:
```
close RPC 收一個 p_outcome enum（unknown / not_charged / charged）
⇒ 由【操作者宣告】那筆到底收到錢沒有
```
🔴 **而那是錯的,理由不是「不夠嚴謹」,是【我們不需要人去猜】**:
```
settleCharge（packages/use-cases/src/settle-charge.ts）逐字：
  「三路（callback / webhook / sweeper）+ retry 共呼同一條冪等結算、
    以 **Record API 為唯一權威**（notify 無簽章不可信）」
它的四種結果：paid / failed / pending(reason) / no_attempt
  paid   ⇒ 它自己就把錢收斂完（markCharged → confirm → recordPendingInvoice）= 【補入帳已經在裡面】
  failed ⇒ 它自己 markFailed = 【釋鎖那條也在裡面】
  pending⇒ Record 查不到 / 查不動 / 驗不過 ⇒ **那才是真正的「還不知道」**
```
⇒ **佇列裡的單,不是「沒人去查」,是【自動查了 8 次都沒查出結果】**
(`settle_attempt_count >= 8` ⇒ `needs_manual_review = true`,`20260615120001:100,210`)。

**⇒ 所以正確的形狀是:那個鈕【不是讓人宣告】,是【讓人再查一次,而且繞過 8 次上限】。**
```
❌ 舊形狀：人看 → 人判斷 → 人宣告 → 系統照著寫
✅ 新形狀：人按 → 系統去問 TapPay → 【TapPay 的答案】決定走哪條路
```
📌 **主視窗那句「問題可能出在【讓人選】這一步本身」是對的,而答案比他想的更好:
不只不該讓人選 —— 那台會查的機器早就在了,而且它已經是這條線的唯一權威。**

⚠️ **而這也解掉了那個「三個選項兩個噴錯、一個通過」的阻力最小路** ——
**因為沒有選項了。** 只有一個動作:**再查一次**。

---

## 1. 範圍 —— **三族單、三條出口**,而現況只有一條

> 🔴 **代號改掉了(2026-08-19,GR-043 S8)**:~~甲 / 乙 / 丙~~ 不再使用。
> 理由:同一組字在本線上有**三種互斥的意思**(本 plan 的三元件 / 舊 plan `:78` 的三互斥方案 /
> `triage-manual-review-alert.sh:70` 的兩資料族),而 **Sean 的逐字裡沒有這三個字**
> (他說的是「完整一次做好,不要做一半」)。⇒ 一律寫全名:**重查 / 補入帳 / 出口**。

### 1-1 🔴🔴 先看**清單裡到底有幾種單** —— 這是 GR-043 S1,gate 級
告警自己的述詞(`scripts/triage-manual-review-alert.sh:83-85`,逐字):
```sql
 WHERE a.needs_manual_review = true
   AND o.payment_status = 'unpaid'::public.payment_status
   AND ( a.status = 'pending'
         OR (a.superseded_at IS NOT NULL AND a.status IN ('charged','released')) )
```
**⇒ 三族,不是一族:**

| 族 | 是什麼 | 現有出口 | 狀態 |
|---|---|---|---|
| **P 族** `pending` | 查了 8 次還沒查出結果 | `settleCharge` → `markCharged` / `markFailed` | ✅ 出口存在 |
| **R 族** `superseded` + `released` | 舊 attempt 被新的取代,已釋鎖 | `close_released_attempt`(**owner-only**) | ⚠️ 後台按不到 |
| **C 族** `superseded` + `charged` | 舊 attempt 標記已扣款,而訂單仍未付 | **無** | 🔴🔴 **零出口** |

**為什麼 P 族的出口對另外兩族無效(開檔核過,不是轉述)**:
```
markCharged / markFailed 的 UPDATE 逐字都是
  WHERE id = p_attempt_id AND order_id = p_order_id AND status = 'pending'
  (20260612150000_m3_s2d_charge_attempts.sql:283 與 :334)
⇒ status 不是 pending ⇒ ROW_COUNT = 0 ⇒ **按了鈕那一列一個字都不會變。**
```
**R 族那支為什麼按不到**:`20260624120010:139` COMMENT 逐字
「REVOKE 5 角色含 payment_confirmer、**無 GRANT = owner/postgres only**(Phase 1 受控人工流程)」;
且 `:104` 逐字 `status=% 非 released、不可 close` ⇒ **它連 C 族都不收。**

### 1-1a 🔴 那「完整」到底長什麼樣(GR-048 N2)
```
完整 = **三族都有出口,而且都看得見**。
🔴 而「有出口」不等於「有按鈕」——
   R 族的出口是【人】(Sean 手動呼 close_released_attempt),不是後台的一顆鈕,
   而那是 20260624120010:139 逐字寫著的【刻意設計】(「Phase 1 受控人工流程"),不是疏漏。
⇒ 三天後拿「不准做一半」去對「R 族後台按不到」的人,不要得出錯結論:
   **做一半的定義是【那一族沒有出口】,不是【那一族沒有按鈕】。**
⇒ 前提:§10-A 拍 A。若拍 B,這一段跟著作廢。
```

🔴 **這一格是「做一半」的實質形狀**:前一版 plan 的 §10-② 認過這個缺口,
**而 §3 到 §7 一格都沒有它** ⇒ 認了缺口卻沒排進工作 = 之後再補。

### 1-2 三個元件與它們服務的族
| 元件 | 是什麼 | 服務哪一族 | 新東西還是重用 |
|---|---|---|---|
| **重查** | 按鈕觸發伺服器端 TapPay Record 查詢 | **P 族** | 重用 `settleCharge`,零新狀態機 |
| **補入帳** | 查到 `paid` ⇒ 收斂成已付款 | **P 族** | 已存在(`settleCharge` step 5) |
| **出口** | 三族各自怎麼離開清單 + 誰看得到 | **P / R / C 三族** | R 族要開權限;**C 族要新 RPC** |

---

## 2. 補入帳:**不做新的,而那一發驗證【要排進本片】**

`settleCharge` step 5 逐字:`markCharged(主軌) → confirm → recordPendingInvoice → paid`
(`packages/use-cases/src/settle-charge.ts:20-26`)⇒ **查到真的收了錢,系統本來就會登記它。**

🔴 **2026-08-19 更正(GR-043 S7)**:~~「我沒實跑過,審查時當成待證」~~ **不夠。**
```
那一發【現在做得出來】：Sean 已授權沙盒刷卡(MAIN-052 §4-b),
測試卡與流水帳骨架已在 docs/reference/tappay-sandbox-test-cards.md
⇒ 它【不是】構造不出來的誠實缺口(那類才免驗),是【還沒排】。
```
⇒ 在「不准做一半」的判準下,**這一發進 §5 順序與 §7 估時**,不留成一個問句。

---

## 3. P 族的出口:admin 按鈕 → `settleCharge` —— **而那支「繞過 8 次上限」的 RPC【不該存在】**

### 3-1 🔴🔴 前一版 §3 整段作廢(GR-043 S3),理由是**它兩頭都落空**
```
前一版寫：admin_request_manual_settle 把 settle_attempt_count 歸零 + next_settle_at = now()
         「這就是繞過 8 次上限的全部：讓既有 sweeper/settle 路徑重新看得到它」

對【sweeper 路】無效 —— sweeper 擋的不是次數,是【旗標】:
  claim_stuck_unsettled_attempts        AND a.needs_manual_review = false  (20260615120001:131)
  mark_attempt_settle_retry             AND a.needs_manual_review = false  (:217)
  會員輪詢那條                            AND a.needs_manual_review = false  (20260621120000:70)
  而 20260621120000:49 逐字「4a-2 把它當【停止自動 retry】durable 旗標」
  ⇒ 歸零之後 sweeper **仍然看不到它**,而我們又明說旗標要留著。

對【直呼路】多餘 —— settleCharge 根本不讀那個欄位:
  grep -c settle_attempt_count packages/use-cases/src/settle-charge.ts ⇒ **0**
```
⇒ **admin 直呼 `settleCharge` 這條路,天生就在 8 次上限之外** —— 不需要繞過任何東西。
📌 爬梯子第一階:**這支 RPC 不需要存在。** 前一版是為一個不存在的障礙設計了一道門。

### 3-2 那還需要 RPC 嗎:**需要,而理由是【留痕】不是【繞過】**
```
admin server action：settleCharge(getSettleChargeDeps(), { orderId })
                     與 reconcile-actions.ts:101 同一條路,逐字重用、零改語意
窄 RPC(SECURITY DEFINER)：只寫「誰按的 / 什麼時候 / 這一發的結果」+ admin_audit_log
  🔴 為什麼仍要走 RPC:service_role 對 payment_charge_attempts 只有 SELECT
     (20260612150000:118-121)⇒ 不開表權限,只多一支窄門。
```
🔴 **而那需要一個【表上還不存在】的欄位** —— 見 §4-2(GR-043 S2)。

---

## 4. 出口:三族各自怎麼離開,以及**看得見**

### 4-1 三條出口(P 族已有、R 族要開權限、C 族要新造)
```
P 族  settleCharge 回 paid   ⇒ 訂單變 paid ⇒ 不再 unpaid ⇒ 自然離開
      settleCharge 回 failed ⇒ attempt 變 failed ⇒ 離開述詞(鎖釋放,客人可重付)
      settleCharge 回 pending ⇒ 🔴 **它不會離開**。留著,直到查得出結果。
                                  出口不是「有人按過」,是「查出來了」。

R 族  close_released_attempt 已存在且形狀正確(不讓人宣告、三欄成組 + CHECK)
      🔴 而它 owner-only、一個角色都不 GRANT ⇒ **後台按不到**
      ⇒ 決策題(不是我能拍的,見 §10-A):維持 Sean 手動,還是 GRANT 給 admin 路徑?
        後者動權限 ⇒ 鐵則 12②。

C 族  🔴🔴 **零出口,要新造。** 形狀照 close_released_attempt(§10-① 已認定它是對的形狀):
      owner-only 或窄 GRANT / 不讓人宣告 / 依據寫成欄組 + CHECK
      ⚠️ 它是三族裡**風險最高**的一格:「標記已扣款、而訂單仍未付」
         ⇒ 錢可能真的收了 ⇒ 這一格的設計要單獨過對抗審查。
```

### 4-2 🔴 計數與清單頁需要一個**沒有人要建的欄位**(GR-043 S2)
```
前一版 §4-② 逐字「那正是 triage-manual-review-alert.sh 印的東西(既有,不用重新發明欄位)」
⇒ **不成立。** 該腳本 :70-78 印的九欄開檔核過:
   族別 / id / display_id / status / last_settle_error / rec_trade_id /
   bank_transaction_id / released_manual_review_at / 卡幾小時
   —— **沒有任何一欄是「誰按的 / 何時 / 結果是什麼」。**
表上也沒有。payment_charge_attempts 的 ADD COLUMN 全盤點(GR 給的座標)
   20260615120001:73-75 / 20260624120000:51-53 / 20260621120000:36 /
   20260809230000:109-111 / 20260613140000:65 / 20260627120000:66 ⇒ 零命中「重查請求」
```
⇒ **要新增欄位**,形狀爬既有先例:`20260621120000:36` `last_poll_settle_at`
(「會員輪詢觸發 settleCharge 的時點欄」)—— 同族,直接對照著寫。
⇒ 連帶:前一版 §6「清單頁 ⇒ 不用 migration(讀既有欄位)」**跟著錯**,已在 §6 改掉。

### 4-3 計數要分三族,不是一個數
```
告警函式加的不是「一個未解決數」,是【三族各自的存量】——
否則 C 族(零出口)會被 P 族的下降蓋掉,而那正是「安靜的黑洞」。
🔴 主告警不動、不移除任何列。
```

---

## 5. 相依順序(不可換;已含 GR-043 S6 指出的漏項)
```
0. 🔴 移檔:20260819010000 移出 supabase/migrations/     ← 前一版漏了這一步(S6)
     它是獨立一片、命中鐵則 12③、要走對抗審查。§14 是它的規格。
1. 新欄位 migration(重查留痕欄)+ 三族計數改告警函式
     ⚠️ 這一步扯出一整條 app 層鏈,見 §6-2(S4)
2. admin server action(直呼 settleCharge)+ 留痕 RPC
3. C 族出口 RPC(新造,最高風險,單獨對抗審查)
4. R 族決策落地(§10-A 拍板之後才動;A 案也有事要做,見 §7 第 4 行)
5. 清單頁(三族分開顯示)
6. 🔴 補入帳那一發驗證:沙盒刷一筆,走完 settleCharge 回 paid 的整條路(S7)
```

---

## 6. 要不要 migration(前一版錯了兩格,已改)

### 6-1 清單
```
留痕欄位            ⇒ 要   (新欄,~~前一版說不用~~ S2)
三族計數            ⇒ 要   (改 get_payment_anomaly_alert_summary)
留痕 RPC            ⇒ 要
C 族出口 RPC        ⇒ 要   (新造)
R 族 GRANT          ⇒ 看 §10-A 怎麼拍;要動就是鐵則 12②
清單頁              ⇒ 不用(讀上面建好的欄位)
補入帳              ⇒ 不用(已存在)
移檔                ⇒ 不是 migration,是 git mv(而它自己是一片)
```

### 6-2 🔴 改告警函式會扯出一整條鏈(GR-043 S4),前一版一個字都沒有
```
packages/adapters/src/payment/PgAnomalyAlertReaderAdapter.ts:113   逐欄 parseCount
packages/use-cases/src/check-anomaly-alerts.ts:94-99 與 :139       告警文案 + shouldAlert
packages/ports/src/IAnomalyAlertReader.ts
packages/domain/src/payment/anomaly-alert.ts
apps/storefront/src/app/api/cron/anomaly-alert/route.ts
packages/adapters/src/supabase/database.types.ts:3866              ← 產生檔,apply 後要 gen types
```
🔴 **另有一道指紋守門會過期**(開檔核過):
```
scripts/l5b0-verify.sh:51 逐字
  PROSRC_S_C3="12a1605c7c9705b1ab1a1c363febbd79"   # get_payment_anomaly_alert_summary
```
它是「該片已套用」的身分閘 ⇒ **函式一改就對不上** ⇒ 改的同時要更新那個 hash,
否則下一個跑 `l5b0-verify.sh` 的人會拿到一個**紅在錯地方**的結果。

---

## 7. 估時(🔴 估的,不是量到的;而 Sean 說「寧可花時間做好」)
```
0. 移檔片(含 literal-sweep 改指標 + 對抗審查)          ~60 分
1. 留痕欄位 + 三族計數 migration + apply 期斷言          ~75 分
   + app 層鏈六處 + gen types + 更新 l5b0 指紋           ~60 分
2. admin server action + 留痕 RPC + 測試                 ~60 分
3. C 族出口 RPC(最高風險,含斷言與拋棄式 PG 驗)          ~90 分
4. R 族決策落地(§10-A 拍板後;🔴 **兩案成本差很多,不是同一行**)
     A ⇒ 清單頁標明「這族由 Sean 手動收」+ 寫出那支 RPC 怎麼呼    ~30 分
         (🔴 **不是 no-op** —— 不寫的話那一族在畫面上會像沒人管)
     B ⇒ GRANT + 權限模型改動,**另計對抗審查**(鐵則 12②)         ~90 分 + 審查
5. 清單頁(三族分開)+ 測試                               ~90 分
6. 沙盒刷一筆、走完補入帳那條 path                        ~45 分
對抗審查(動錢 ⇒ 不降級)+ 折,分兩次(1 與 3 各一)      ~150 分
⇒ 合計 ~11 小時(前一版寫 5.5 小時 —— 那是【只算一族】的數字)
```

## 8. 🔴 需要真 DB 的那一格(Sean 說「如果需要」,我只列真的需要的)
```
補入帳那條 path（settleCharge 回 paid ⇒ 真的收斂成已付款）
⇒ 它要一個【TapPay 真的回 paid 的 Record】才走得到
⇒ 拋棄式 PG 造不出來（那不是 DB 的問題，是 TapPay 那側的回應）
🔴 而【正式庫的 DB 權限也解不了它】—— 需要的是 TapPay sandbox 的一筆真交易，不是 DB 權限
⇒ **所以我【不要】DB 權限。** ~~我要的是「補入帳那條 path 由誰在什麼環境驗過」的答案。~~
🔴 **2026-08-19 已答(GR-048 N1):沒有人驗過,而它現在排得動** ⇒ 已進 §5 第 6 步。
   ⇒ 這裡不再是一個問句。**§8 / §9 / §12 三處講同一件事,要一起讀。**
```
📌 **我把這一格寫出來,是因為「他給了權限」很容易變成「那就用吧」** ——
而**我這一格真正缺的東西,權限給不了。**

## 9. 誠實揭示
```
· 補入帳「已經在了」是【讀 code 得到的】;🔴 而那一發驗證【已排進 §5 第 6 步】(GR-043 S7),不再是待證問句
· ~~清單頁的欄位沿用 triage 腳本~~ 🔴 **已證錯**(GR-043 S2):那九欄裡沒有「誰按的/何時/結果」⇒ 要新增欄位,見 §4-2
· settleCharge 重查會不會有副作用（它會 markCharged / confirm）—— 它本來就是這樣設計的，
  而【由後台按鈕觸發】是一個新的呼叫路徑 ⇒ 要對抗審查特別打這一格
· 本 plan 沒有處理「TapPay 永遠查不出來」的極端情況 —— 那種單會永遠留在清單上，
  🔴 而那是【正確的】：它確實還沒有答案。不要為了清單好看而給它一個假出口。
```

---

## 10. 🔴 GR 第二意見(`~/pcm-mailbox/GR-040-…`)折進來的五格 —— 其中一格**推翻了我的全稱句**

### ①🔴 既有出口我盤點漏了一支,**而它正是 R 族/C 族出口該長的形狀 —— 新設計從它開始,不要從零**
`supabase/migrations/20260624120010_m3_3ds_r1c3_close_released_attempt.sql`
```
COMMENT 逐字：「owner-only 人工結案(SECDEF、search_path='')。
  Sean 取得 TapPay 明確終局(未扣款)後收尾 released attempt：released→failed +
  寫 released_closed_at / released_closed_by / released_close_resolution(三欄成組、滿足 group_chk)」
權限逐字：「REVOKE 5 角色含 payment_confirmer、無 GRANT = owner/postgres only(Phase 1 受控人工流程)」
```
🔴 **我在前一份 plan 寫「全樹只有一處把 `needs_manual_review` 設回 false」= 全稱句,被這一支推翻。**
📌 **它的三個性質正是我們要的**:
```
· 【不讓人宣告】—— 它要求「已取得 TapPay 明確終局」當前提，然後只做狀態收尾
· 【owner-only、一個角色都不 GRANT】—— Phase 1 就是刻意讓它走人工受控流程
· 依據寫成【三欄成組 + CHECK】，不是自由文字備註
```
⚠️ 它**只收 `released`**(其餘狀態一律拒)⇒ **`pending` 那族仍無對應結案 RPC** = 缺口的真正邊界。

### ②🔴 released 族的**對稱缺口**
我的 ⑤-2 只擋 `charged` 宣告 `unknown` ⇒ **`released` 列宣告 `unknown` 照樣過 = 反向的說謊**。
⇒ `not_charged` 要**分 pending / released 兩支**(released 那支就是 ①)。

### ③🔴 指路訊息住在一條**被我自己禁掉的通道**
我在 COMMENT 寫「**API 不得把 DB 例外原文回給前端**」,
而我的指路訊息(「請回報,不要改選 unknown」)**只活在例外原文裡** ⇒ **自相矛盾,操作者永遠看不到。**
⇒ 改成**結構化回傳**(`{ok:false, reason, next}`);RAISE 只留給「不該發生」。

### ④🔴 我自標「未重跑」的 C-B,GR 指出**差值不變式會破**
```
我寫：未檢視數 = attempt_manual_review_count − reviewed_unknown_unresolved_count
而兩述詞【已解綁】⇒ 一列 unknown-closed 之後變 charged 且無 superseded_at
⇒ 它在 unknown 存量裡、不在主告警裡 ⇒ **差值可以變負**
⇒ 「新到一筆 ⇒ 差 0→1」在負數的世界裡不成立
```
⇒ **這是重跑的第一發。** 📌 而教訓是:**標了「未驗」不等於可以宣稱。**

### ⑤ 三份述詞要互釘
`attempt_manual_review_count` / RPC 的 ⑤ / unknown 存量 —— **三處各寫一份**,必須一致。
⇒ 抽成單一 SQL 函式(只寫一次)或加斷言驗三者同源;並進 rule-ledger。

---

---

## 10-A. 🔴 要 Sean 拍的決策題(**只有一題,其餘我自己判**)

> 依 `~/.claude/rules/00-work-rules.md` R3:動權限 = 必停問。**這一題我不能自己拍。**

```
Q:R 族(superseded + released)的出口,現在是 owner-only 的 close_released_attempt
  ——【Sean 手動、後台按不到】。要維持,還是開給後台?

  A. 維持 owner-only,後台清單【只顯示、不給鈕】,那一族由 Sean 手動收
     · 不動任何權限 ⇒ 不命中鐵則 12②
     · 代價:那一族的單會一直躺在清單上,直到 Sean 有空
  B. GRANT 給 admin 的窄路徑,後台按得到
     · 動權限 ⇒ 鐵則 12② 對抗審查不降級
     · 而該檔 :139 COMMENT 逐字寫著「Phase 1 受控人工流程」
       ⇒ 選 B 等於推翻一個【當初刻意的設計】,不是補一個疏漏
```
🔴 **我的推薦:A。** 理由不是保守,是 **B 要推翻的那個決定,當初是寫在 COMMENT 裡的刻意選擇**
(`20260624120010:139`),而我沒有找到任何「情況已經改變」的證據。
⇒ 若 Sean 選 A,C 族那支新 RPC **也照 owner-only 做**,三族的權限模型才一致。

⚠️ **而這一題不擋開工**:§5 的第 0~3 步與它無關,可以先做。它只擋 §5 第 4 步。

## 11. `20260819010000` 的處置 —— **GR 裁「不能單獨上」,而【在哪個標準下】要寫清楚**
```
GR 逐字：「不能單獨上 —— 新標準下它照定義就是做一半」
        「dev commit 不必回退，gate = apply + UI 片等完整範圍」
        「斷言群是今晚最強的一套，新版直接繼承免重驗」
```
🔴 **那個「新標準」= Sean 2026-08-19 的「不准做一半」** ——
**不是**「那支自己有問題」。⇒ **三天後有人看到一顆綠的 commit 卡著,不要以為 gate 可以拆** ——
**gate 的解除條件是【重查+補入帳+出口 三族完整範圍就緒】,不是「那支修好了」。**
```
處置：commit 留著（不回退）／【不 apply】／新 migration 不建立在它之上
⚠️ 「不 apply」需要會被讀到的載體 ⇒ 已在該檔檔頭;~~另請主視窗在待推清單標記~~
✅ 已完成(2026-08-19):主視窗已列進不得-apply 清單並落檔 `memory/project_0818-main-apply-blocklist.md`(含解除條件)
🔴 而那**只擋得住「經過主視窗」的 apply** ⇒ 檔案層的撤除機制仍然要做,見 §14
```
🔴🔴 **2026-08-19 更新:上面引號裡第三句【已作廢】,而它留在這裡是刻意的(留痕不刪)。**
```
「斷言群是今晚最強的一套，新版直接繼承免重驗」
  ↑ 這句作廢。錯的不是「繼承」，是「免重驗」——
    具體錯在 5c 那一格（apply 期斷言 vs C-B 反轉互斥 ⇒ apply 必 RAISE）。
    逐格清單見 §13；量到的數字見檔頭警語。
```
✅ **§11 最後那句「另請主視窗在待推清單標記」= 已完成**(2026-08-19 主視窗三裁之②):
```
主視窗逐字：「20260819010000_m4a_close_manual_review_attempt.sql 不得被 apply,
             直到 5c 與 C-B 反轉對齊。Sean 的 apply 清單由我控 ⇒ 這支不會進去。
            （這句我落成檔,不只留在訊息裡。）」
並裁：**不要改那支 SQL** —— 在舊形狀上補丁 = Sean 明文關掉的「做一半」。
```
⚠️ **而「不要改那支 SQL」與 §6「整支撤掉重寫」不衝突**:
前者說**現在不要動它**,後者說**新 migration 不建立在它之上**。**兩句的動作都是「不碰」。**

## 12. 🔴 非真 DB 不可的那一格(Sean 說「如果需要」,下一班拿這段去要)
```
補入帳那條 path：settleCharge 回 paid ⇒ 真的收斂成已付款
🔴 而它缺的【不是 DB 權限】，是【TapPay sandbox 的一筆真交易】
⇒ 所以：**不要為了這一格去要 DB 權限** —— 權限給不了它
⇒ ~~真正要問的是:「由誰、在什麼環境驗過?」~~ 🔴 **已答(GR-043 S7):沒有人驗過,而它現在排得動** ⇒ §5 第 6 步
```

---

## 13.(條件節)**萬一決定復用 `20260819010000`** 才適用的三格 —— 逐格,不逐群

> 🔴🔴 **2026-08-19 降級(GR-043 S5 + G4 自核):本節【預設不做】。**
> `manual_reviewed_at` 與 `reviewed_unknown_unresolved_count` **全樹各只出現在一個檔**
> —— 就是那支已被本 plan 自己否決、且照 §14 會被移出 `supabase/migrations/` 的 `20260819010000`
> (負向對照:同一把尺對 `attempt_manual_review_count` 回 5 個檔)。
> **檔移出去 ⇒ 它永遠不會 apply ⇒ 5c 根本不用修。**
> ⇒ 本節只在**有人決定復用那支檔**時才成立;新範圍(§3/§4)沒有 enum、沒有 unknown 存量。
> ⚠️ 前一版 `G4-008 STOP §1` 把「打 §10-④ 不變式」排成動手第一發 —— **那句已作廢**
>   (照它做,第一個工作單元會花在不存在的東西上)。STOP 檔已就地標作廢。


> 由來:主視窗 2026-08-19 三裁之③ ——「斷言群最強 ⇒ 直接繼承免重驗」作廢,**逐字寫明錯在哪一格**。
> 全部由 G4 唯讀量到(讀檔 + grep),**沒有在 PG 上跑過**。引用要帶這個限定。

| # | 位置 | 現況(過期/矛盾) | 繼承時要怎麼改 |
|---|---|---|---|
| **13-1** | `:404-409` apply 期斷言 **5c** | 要求函式體含 `AND a.manual_reviewed_at IS NULL`,而 C-B 反轉已把它拿掉 ⇒ **apply 必 RAISE** | 斷言要**跟著反轉**:改成驗「主告警述詞**不含**該行」+ 驗「`reviewed_unknown_unresolved_count` 在」。🔴 **不要只把 5c 刪掉** —— 刪掉 = 那一格從此沒有守門(照 `docs/patterns/guard-and-instrument-traps.md`) |
| **13-2** | `:210` `COMMENT ON FUNCTION` | 逐字仍寫「`attempt_manual_review_count` 多一條 `manual_reviewed_at IS NULL`」 ⇒ **描述的是已被拿掉的那一行** | COMMENT 改成描述**反轉後**的真實述詞;🔴 並在同一句寫明「unknown **不退出**主告警,可見性靠 `reviewed_unknown_unresolved_count` 的**差值**」 |
| **13-3** | `:151` 註解裡的**不變式** | 宣稱「未檢視數 = 主告警 − unknown 存量,新到一筆 ⇒ 差 0→1」。GR 指出它**會破**;讀 SQL 對上了 | 不變式**不能原樣繼承**。要嘛把兩述詞**重新綁回同源**,要嘛**刪掉這個不變式**改用別的可見性訊號 ⇒ **這是動手寫 code 的第一發**(§10-④) |

### 13-3 的破法(讀 SQL 得到,未實跑)
```
主告警述詞  needs_manual_review AND ( status='pending'
                                     OR (superseded_at IS NOT NULL AND status IN ('charged','released')) )
            AND o.payment_status='unpaid'
unknown 存量 manual_review_outcome='unknown' AND o.payment_status='unpaid'     ← 【不綁 status】

⇒ 一列:outcome='unknown' → 之後被 mark_charge_attempt_charged() 改成 charged 且【無 superseded_at】
   · 在【存量】裡(它只看 outcome + unpaid)
   · 不在【主告警】裡(charged 而沒有 superseded_at ⇒ 兩個分支都不成立)
⇒ 主告警 − 存量 **可以是負的** ⇒ 「新到一筆 ⇒ 差 0→1」在負數的世界裡不成立
```
📌 **這三格共同的形狀**:C-B 反轉只改了**述詞那一行**,
而**指著那一行的三個東西(斷言 / COMMENT / 不變式)一個都沒跟著改**。
⇒ 與 memory `feedback_claimed-sync-but-only-patched-touched-lines` 同族:
**改了被指名那處,沒改指著它的那些紙。**

### 🔴 繼承的方法(不是結論,是動作)
```
新 migration 抄斷言群之前,對【每一格】問一次:
  「這格斷言在描述的那個字面,C-B 反轉之後還在不在?」
量法:sed -n '<函式體起,迄>p' <檔> | sed 's/--.*$//' | grep -c '<斷言要找的字面>'
      —— 每一發都要有【負向對照】(同一把尺對該命中的東西回非 0)
```

---

## 14. 🔴 `20260819010000` 的**撤除機制** —— §6:160「這一格要主視窗裁怎麼撤」的答案

> 由來:主視窗 2026-08-19 轉 G6 must-fix #2 + 就地裁定。
> 主視窗逐字裁**驗收條件**(不裁設計):
> **「假設所有人都忘了這件事,這支還 apply 得下去嗎?答得出『不行,因為 X』才算數,X 要是檔案裡的東西。」**

### 14-0(已失效的排序約束,**文字保留**)先講一件反直覺的:擋住它的是【那個 bug】

> 🔴 **2026-08-19:本節那個「先立機制才准動 5c」的排序約束【不再需要】。**
> 它的前提是「我們之後要修 5c」,而 §13 已降成條件節 ⇒ **預設根本不會去動 5c。**
> **留著文字**是因為下面那個洞察仍然有效:**沒有人是故意裝這道閘的,所以也沒有人會在拆它的時候察覺。**
> ⇒ 下一個人不要把它讀成「還有一個【動 5c】的待辦」。**沒有那個待辦。**

```
5c 斷言 vs C-B 反轉互斥 ⇒ 現在誰去 apply 都會 RAISE ⇒ 事實上 apply 不下去。
🔴 而【意外不是機制】—— 而且這個意外有一個很壞的性質:
   **§13 要我們修好 5c,而修好 5c 的那一刻,這道意外的閘【自己消失】。**
⇒ 排序約束(不可換):**撤除機制要先立,才准動 5c。**
   否則「修一個 bug」會靜靜地把一支不該上的 migration 變成可上。
```
📌 這正是 memory `feedback_a-guard-on-a-safe-path-is-net-negative` 的反面:
**現在守著的那道閘,沒有人是故意裝的,所以也沒有人會在拆它的時候察覺。**

### 14-1 機制(重用既有慣例,不發明新東西)
```
把那支檔【移出 supabase/migrations/】
  supabase/migrations/20260819010000_m4a_close_manual_review_attempt.sql
  → scripts/20260819010000-blocked-until-full-scope.sql   (路徑待定,見 14-3)
```
**為什麼是這個形狀(爬梯子,不是設計)**:
```
· 這條慣例【已經在本 repo 裡】,不是新規矩 ——
  scripts/ 底下現有 20+ 支 .sql(*-down.sql 回退腳本 / *-behavior-probe.sql / *-rollback.sql)
  它們全是【刻意不放進 migrations】的 SQL。量法:
    find . -name '*.sql' -not -path './supabase/migrations/*' -not -path './node_modules/*' | wc -l
· MAIN-052:93 逐字已經寫著同一句:「草稿不進 supabase/migrations/(目錄本身是一道閘)」
⇒ 零新機制、零新腳本、零新 hook。**一次 git mv。**
```

### 14-2 對驗收條件的回答(照主視窗要求的句型)
```
Q:假設所有人都忘了這件事,這支還 apply 得下去嗎?
A:不行 —— 因為 **`supabase db push` 掃的是 `supabase/migrations/`,而這個檔不在那裡。**
  X = 檔案的【位置】,不是任何人的記性、不是註解、不是清單。
```
🔴🔴 ~~**而 X 的前提我【沒有驗過】**~~ ⇒ **2026-08-19 已量到,見 §14-2a。下面這段留痕不刪:**
```
「db push 只讀 supabase/migrations/」= 我從 repo 慣例推出來的,不是量到的。
本 repo 沒有 supabase/config.toml(量法:ls supabase/ ⇒ APPLIED.tsv / migrations / tests)
⇒ 沒有檔案能證明那個路徑是不是可設定的。
🔴 缺的那一道檢查:**在拋棄式環境跑一次 `supabase migration list`(或 db push --dry-run),
   確認移走之後那支【真的從清單裡消失】。** ⇒ 移檔的那一片要附這一發,否則機制只是宣稱。
```

### 14-2a ✅ **那個前提【已經量到了】**(2026-08-19,拋棄式環境,雙向表演)
> 取代 14-2 裡「我從慣例推的、沒量到」那段。**下面每一行都是實跑輸出。**

**環境(拋棄式,零 repo 留痕、不碰 `.env*`、不碰正式庫)**
```
PostgreSQL 17.10 (Homebrew) @ 127.0.0.1:55501   ← /tmp/pgprobe,ssl=on(CLI 拒非 TLS 連線)
supabase CLI 2.98.1
拋棄式專案 /tmp/g4probe,repo 一個檔都沒動(移檔是在【副本】上做的)
```
**世界 A —— 目標檔在 `supabase/migrations/` 裡**
```
$ ls /tmp/g4probe/supabase/migrations/
20260101000000_control.sql
20260819010000_m4a_close_manual_review_attempt.sql        ← 檔名與正本逐字相同
$ supabase db push --dry-run --db-url <拋棄式> --workdir /tmp/g4probe
Would push these migrations:
 • 20260101000000_control.sql
 • 20260819010000_m4a_close_manual_review_attempt.sql     ← **在清單裡**
```
**世界 B —— 同一支檔【移到 `scripts/`】(檔案還在,只有位置變了)**
```
$ mv …/supabase/migrations/20260819010000_….sql  …/scripts/20260819010000-blocked-until-full-scope.sql
$ supabase db push --dry-run --db-url <拋棄式> --workdir /tmp/g4probe
Would push these migrations:
 • 20260101000000_control.sql                              ← 對照檔【還在】⇒ 管線是活的
                                                            ← 目標檔【不見了】
$ supabase db push --dry-run --include-all …                (有人可能加這個旗標)
Would push these migrations:
 • 20260101000000_control.sql                              ← --include-all 也叫不回它
```
🔴 **對照檔在兩個世界都被列出來** ⇒ 世界 B 的「不見了」**不是整條管線壞掉**,
是**移檔造成的**。(只做後半 ⇒ 量到的是「它不在」,而不是「移走讓它不在」。)

**⇒ §14-2 那句 X 現在是量到的**(🔴 **射程限定與這個數字同段,不要分開引用**:
這道閘只答「**忘記**」那一題;`psql -f <明確路徑>` 與 MCP `apply_migration` **不經過目錄掃描**,詳 §14-2b):
```
Q:假設所有人都忘了,這支還 apply 得下去嗎?
A:不行 —— `supabase db push` 的待推清單裡【沒有它】,因為它不在 supabase/migrations/。
  X = 檔案的位置。已實測,含負向對照。
```

### 14-2b 🔴 而射程有邊界 —— **這道閘擋的是「忘記」,不擋「刻意」**
`db push` 是本 repo 的正典 apply 路徑,**有檔為證**:
```
scripts/a7c-preflight.sh:98 逐字:「任何**未 apply** 的 migration 都會在下一次
                                  `supabase db push` 被套上正式站。」
```
**而另外兩條路【不經過那個目錄掃描】**:
```
· psql -f <明確路徑>            (scripts/w5-line-verify.sh:489、scripts/347-3a-verify.sh:25 都這樣用)
· MCP apply_migration           (docs/runbooks/supplier-storefront-onboarding.md:34 提到)
                                 它吃的是 SQL 內容,不是路徑
```
🔴 **這兩條擋不住 —— 而它們也不是「忘記」**:
兩者都要**當事人重新打出新路徑或貼上內容** ⇒ 那是**選擇**,不是遺忘。
📌 主視窗的驗收條件問的是「假設所有人都忘了」⇒ **這道閘答得出那一題,而且只答那一題。**
⇒ 要連「刻意」一起擋,得在檔案本體加 fail-closed 閘(而那要動 .sql,不在本輪邊界內)。

### 14-2c 本次量測的效度限定(不要擴大解讀)
```
· 用的是【同檔名、內容為 CREATE TABLE 一行】的替身,不是正本那 488 行
  ⇒ 證的是【CLI 依路徑挑檔】這件事,與檔案內容無關 —— 而我沒有用正本跑過
· 拋棄式 PG 無 supabase_migrations schema 歷史 ⇒ 兩個世界都是「全部待推」的起點
· CLI 版本 2.98.1(本機現值;官方已有 2.115.0)⇒ 換版本要重量
· 本 repo 無 supabase/config.toml ⇒ 沒有測到「migrations 路徑被改設定」的情況
  (拋棄式那份 config.toml 只寫了 project_id,沒動路徑)
```

### 14-3 兩個要一起做、否則機制會製造新的洞
```
① 移走之後,舊路徑在 repo 裡有【指著它的紙】(plan 本身 / §11 / §13 / STOP / commit body)
   ⇒ 移的那一發要同時跑:
     bash scripts/literal-sweep.sh '20260819010000_m4a_close_manual_review_attempt.sql'
   逐處改成新路徑。**不改 = 下一個人 test -e 得到「查無」,會讀成「這支被刪了」。**
   (照 `~/.claude/rules/00-work-rules.md` §6-b 第 4 條:寫下「已移走」的同一句必須答出 canonical 在哪。)
② 🔴 **`supabase/APPLIED.tsv` 那本帳會不會有殘留列 —— 【沒有人查過】**(GR-043 附註 + G4 複核,兩邊都沒查)
   ⇒ 這不是「應該沒事」,是**零觀測**。移檔那一片要當場查,否則交出來時它會蒸發。
③ 新檔頭第一段要寫【它為什麼在這裡】+【怎麼放回去】——
   放回去的條件 = 三族完整範圍就緒(§11 的 gate),**不是「5c 修好了」**。
```

### 14-4 這一片何時做(它不在本輪邊界內)
```
本輪主視窗的邊界:只動 plan 一個 .md,不動任何 .sql。**⇒ 移檔【沒有做】,本節只是設計。**
排序:見 §5(移檔已是第 0 步)。🔴 ~~→ §13 修 5c~~ **§13 已降成條件節,預設不做**
      ↑ 不可換(理由見 14-0)
⚠️ 而移檔動到 supabase/migrations/ ⇒ 命中鐵則 12③ ⇒ 它自己也要走對抗審查,不是「順手 git mv」。
```

---

## 15. GR-043 折了哪些 / **沒折哪些**(GR 要求理由寫在檔裡,不要只在訊息裡)

### 15-1 我開檔核過的座標(**在別的檔案裡,不會隨本檔位移**)
> GR 給的是 `f7c2f133` 那一版的座標。下面是我**自己開檔印出原文**核過的七處。

| # | 座標 | 我核到什麼 |
|---|---|---|
| 1 | `scripts/triage-manual-review-alert.sh:83-85` | 三族述詞逐字,與 GR 引的相同 |
| 2 | `supabase/migrations/20260612150000_m3_s2d_charge_attempts.sql:283` | `AND status = 'pending'` |
| 3 | 同上 `:334` | `AND status = 'pending'` |
| 4 | `supabase/migrations/20260624120010_…close_released_attempt.sql:104` | 「非 released、不可 close」 |
| 5 | 同上 `:139` | 「REVOKE 5 角色…無 GRANT = owner/postgres only」 |
| 6 | `supabase/migrations/20260615120001_…attempt_sweeper_rpc.sql:131,:217` | 皆 `AND a.needs_manual_review = false` |
| 7 | `supabase/migrations/20260621120000_…poll_settle_throttle.sql:36,:49,:70` | `last_poll_settle_at` 欄 / 「durable 旗標」/ 同款旗標判 |

另外兩發是**我自己下的數**(非 GR 給的):
```
grep -c settle_attempt_count packages/use-cases/src/settle-charge.ts        ⇒ 0
sed -n '70,78p' scripts/triage-manual-review-alert.sh                       ⇒ 九欄,無「誰按的/何時/結果」
```
🔴 **S5 / S6 / S7 / S8 我沒有逐條複驗座標**,是照 GR 的敘述折的 ⇒ 標【未複驗】。
🔴🔴 **而 GR 在 R2(GR-048)明說它這輪【也沒複驗】那四條** —— 理由是那是它 R1 自己給的敘述,
   **由它複驗等於自驗**。⇒ 這四條的座標到現在是 **零獨立查核**。
   **不是「應該對」,是沒有人查過。** ⇒ 實作者動手前第一件事就是開檔核這四條,或交第三方。

### 15-2 折了(S1–S8 逐條落點)
```
S1 三族 vs 一族   ⇒ §1-1 表 + §4-1 三條出口(改寫,非附註)
S2 缺欄位         ⇒ §4-2 + §6-1(把「不用 migration」改掉)
S3 RPC 兩頭落空   ⇒ §3-1 整段作廢 + §3-2 改成「留痕」理由
S4 app 層鏈       ⇒ §6-2(含 l5b0-verify.sh:51 指紋會過期)
S5 §13 是遺物     ⇒ §13 降條件節 + §14-0 降級(文字保留)+ 檔頭警語追加
S6 順序與估時     ⇒ §5 補第 0 步移檔;§7 5.5h → 11h(🔴 兩者皆【估】)
S7 補入帳待驗     ⇒ §2 改寫 + §5 第 6 步;§9/§12 的舊問句就地標已答
S8 甲乙丙代號     ⇒ §1 檔頭停用宣告 + 全檔改寫 + 我自己 STOP 兩處
GR 追加三條      ⇒ §14-2a 射程同段 / §14-3 第 ② 項 APPLIED.tsv / §14-0 與 §13 同時改
```

### 15-3 🔴 **沒折的,以及為什麼**
```
① S8 的 MAIN-052:70 那一行
   不折的理由:**那是主視窗的檔,不是我的射程。** 主視窗 2026-08-19 已自行改完並回報。
   ⇒ 這一格【已關,而不是我關的】。

② GR-042 §④ 的 B-7 / D-11 / D-12 / D-13 / C-8 / C-9 / C-10
   不折的理由:**那是 GR 對自己前一封 findings 的複核附錄,不是對本 plan 的 finding。**
   其中 D-12 明說要在報價單 repo(`/Users/sean_1/API大量上架/PCM報價單-V2`)裡查 ——
   **不在本 repo,也不在我的線上。** ⇒ 不屬本 plan,不折。

③ A-6「告警述詞三份載體互釘」—— **這條我折了一半,另一半明寫在這裡**
   已折:§4-3 要求計數分三族、§6-2 列出下游鏈 ⇒ 述詞改動的**影響面**寫進工作清單了。
   🔴 未折:**「三處必須一致」這件事沒有做成機制**(rule-ledger 沒有那一列)。
   不做的理由:那要動 `docs/ops/rule-ledger.tsv`,而本輪主視窗的邊界是【只動這份 plan】。
   ⇒ 它是 §5 第 1 步的**驗收條件之一**,寫在這裡:
     `get_payment_anomaly_alert_summary` 的述詞 / triage 腳本的述詞 / RPC 的守門述詞
     三處改動要同 commit,且加一道斷言或 ledger 列。**現在【沒有】那道守門。**

④ §14-1 移檔本身
   不折的理由:主視窗邊界「repo 裡任何 .sql 一行都不動」,且它自己命中鐵則 12③
   ⇒ 它是獨立一片(§5 第 0 步),規格已在 §14,**本輪只寫規格不動手**。
```

### 15-4 這一版的證據等級(整份)
```
· 本 plan 全部由【讀檔 + grep】得到,**沒有在 PG 上跑過任何 SQL**
  唯一的例外是 §14-2a(拋棄式環境實跑,含負向對照)
· §7 的估時是【估】,不是量到的
· §2 補入帳那條 path **沒有人跑過** —— 它排進 §5 第 6 步,不是已完成
```
