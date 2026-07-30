# 交接:backlog #301 TapPay Record API 三欄位更正 + 結算識別閘補強

> **狀態:code 已 commit(`21cba57`)、未 push、零 DB / 零 migration / 零 env / 未動 flag。**
> 日期:2026-07-30 下午 · Milestone M-4b · branch `dev`
> 上一份交接 = `2026-07-30-n3-display-id-handoff.md`(訂單編號改 6 碼亂碼,已 push、已真刷)

---

## 1. 一句話

修「TapPay Record API 三個欄位名寫錯」,連帶修好一條**從未成立過的金流路徑**,並在四輪對抗審查後補上 5 道識別/金額閘。**退款線 RF2b-RF8 的硬前置已解除。**

---

## 2. 這片動了什麼(18 檔)

| 層 | 檔 | 改動 |
|---|---|---|
| wire | `packages/adapters/src/tappay/wire.ts` | Record 段欄名與宣稱重寫;新增 `originalAmount`;`transactionTimeMillis` → `timeMillis`(讀 `time`) |
| wire 測試 | `wire.test.ts` | 新增以**正式商戶實回 33 鍵**為形狀的 fixture(未退款 / 全額退款)+ 負向:餵 `transaction_time_millis` 必被忽略 |
| domain | `packages/domain/src/payment/types.ts` | `TapPayTradeRecord` 同步 |
| adapter | `TapPayChargeAdapter.ts` / `.test.ts` | wire→domain 映射 + fixture |
| **use-case** | `packages/use-cases/src/settle-charge.ts` | **5 道閘**(見 §4)+ `recordMatchesOrder` 回傳改成可分辨的失敗原因 + 非 PII triage log |
| use-case 測試 | `settle-charge.test.ts` / `sweep-settlements.test.ts` | +21 條;sweeper fixture 對齊「TapPay 依 rec filter 查、回的必是那把鍵」 |
| D1(已退場) | `scripts/d1-readback*.ts` / `d1-orchestrator.test.ts` / `d1-tappay-client.test.ts` / `d1t2-seed.ts` | 判定矩陣改對(Q2=A);fixture 改真實形狀 |
| docs | `docs/reference/tappay-reference.md` / `docs/phase-1-backlog.md` / `STATUS.md` | 更正兩處假保證、#301 收案 |

---

## 3. 🔴 欄位真相(官方逐字 + 實測**分層**)

來源:`https://docs.tappaysdk.com/tutorial/zh/reference.html`(自抓原始 HTML 解析、非小模型摘要)
+ 證據檔 `~/.pcm-d1/d1b1-evidence-20260730.json`

| 欄 | 官方逐字 | 證據等級 |
|---|---|---|
| `amount` | 「交易金額,**會因退款而減少**」 | 官方 + **實測值**(全退後 = 0) |
| `original_amount` | 「原始金額,**不會因款項被退款而受影響**」 | 官方 + **鍵存在**;🔴 值從未被觀察 |
| `refunded_amount` | 「**退款金額**」(已退多少) | 官方 + **實測值**(101 / 1180) |
| `time` | 「交易時間,**單位為毫秒**」 | 官方 + **鍵存在**;🔴 值從未被觀察 |
| `transaction_time_millis` | **不屬於本 API**(Related topics 只列 payByPrime / payByToken) | 官方 + 實測 33 鍵無此鍵 |

🔴 **backlog #301 原文第 ② 點是誤推、已更正**:「`refunded_amount` 放的是原本金額」錯 —— 手上只有**全額退款**樣本時,「已退金額」與「原始金額」**恆等、型式上分辨不出**;是官方文件才分得出來。
🔴 `amount + refunded_amount = original_amount` 是**推導式、官方沒明文** ⇒ 不得當退款態的擋門(多次部分退款若回單次金額,會把該響的告警靜音)。

---

## 4. 現在 `settle-charge` 有哪 5 道閘,分別擋什麼

| # | 閘 | 擋什麼 | 誰要求的 |
|---|---|---|---|
| ① | 身分比 `originalAmount ?? amount` | 已退款紀錄(amount=0)被當成「認不出」而默默丟掉 ⇒ 退款告警永遠不響 | **Sean 拍板 Q1=A** |
| ② | 非退款態 `amount` 必須完好 | `{original=total, amount=0, status=1}`「錢已退光卻宣稱交易完成」被判 **paid** | codex R1 F1 |
| ③ | 非退款態 `refundedAmount` 必為 0 | 同上的另一半(status 5 則 markFailed 釋鎖) | codex R2 |
| ④ | 走 hint 查詢時,回應 rec 必須等於該 hint | TapPay 沒照 filter 回(查 A 收到 B)也照收 | codex R2-1 |
| ⑤ | **弱識別不得 markFailed 釋鎖** | 同單前一次 attempt 的延遲失敗把**這一次**標 failed 並釋鎖 ⇒ 重刷 = 雙扣 | **Sean 追認=A** |

⑤ 的取捨(Sean 逐字):「寧可你多花時間處理幾張單,也不要客人被扣兩次錢」。
Fable 已獨立確認:該路在本片前恆 fail-closed ⇒ ⑤ **等於維持正式站現行行為**,不是新的收窄。

---

## 5. 🔴 這片留下的守門與它們擋不住什麼

| 守門 | 擋得住 | **擋不住** |
|---|---|---|
| 5 道識別/金額閘 | 矛盾紀錄成交、錯掛他單、查 A 收到 B | **TapPay 真的回什麼** —— 全部是單元層 mock,未對真 TapPay 跑過 |
| 33 鍵真實形狀 fixture | 欄名漂移、解析錯欄 | `original_amount` / `time` 的**值**(從未被觀察,fixture 是合成的) |
| `reason:'window'` 的 triage log | 「這條路到底活了沒」查不出來 | 沒人去看 log 這件事 |
| 突變 16/16 全紅 | 我**想得到**的改動 | 我想不到的改法(R2 就抓到兩個我以為測到、其實互相遮蔽的閘) |
| 三綠 + 3369 passed | 文字層與型別層錯誤 | 接線錯但長得完全正確(#301 本身就是這款:欄名錯了兩個月、測試全綠) |

---

## 6. 🔴 上線後**必須**驗的一件事

`time` 的**毫秒單位只有官方文件背書、實際值從未被觀察**。
若它其實是秒 ⇒ 弱識別時間窗恆 false ⇒ **本片主要修復在正式站靜默無效**,與 #301 修的原病同型、同樣沒人會發現。

**偵測方式(已埋)**:`settleCharge` 在被 `window` / `amount_eroded` / `refunded_on_non_refund_status` 擋下時發非 PII `console.warn`。**上線後看到大量 `reason: 'window'` 就是中了**;或用 `scripts/d1-readback.ts`(它現在會解析 `time`)對已知紀錄驗一次量級。

---

## 7. 順帶查到的既有缺口(**非本片造成**,未處理)

1. **卡住的單沒有自動釋鎖** —— `expire_stuck_attempts_at_ceiling` 逐字只 `SET needs_manual_review = true`、attempt 仍 `active` ⇒ 配 `initiate-payment.ts` 的 `duplicate → settlement_required`,那張單**鎖到人工介入為止**;告警 cron 每日一次 ⇒ 最壞 ~24h 才有人知道。**後台目前也沒有清 `needs_manual_review` 的工具。**
2. **退款告警的母體很小** —— `settleCharge` 對已 `paid` 訂單**先短路不查 Record** ⇒ 真實世界最常見的退款(**已付款後才退款**,= 0102/0104 本尊)**永遠不會觸發**這條告警。本片只涵蓋「unpaid + 有 active attempt + Record 顯退款態」。

⇒ 兩條都建議開 backlog 編號(**這片沒開**;前科:#302 在 memory 躺了六天才被補上編號)。

---

## 8. 審查鏈(19 must-fix + 12 nit,全接受、駁回 0)

| 輪 | 審查者 | 結果 | 最重的一條 |
|---|---|---|---|
| R1 | codex `gpt-5.6-sol` xhigh | **NO-GO 6** | 改比 `original_amount` **新增**了兩條 terminal 路徑(矛盾紀錄可 paid / 可 markFailed) |
| R2 | codex 同上 | **NO-GO 11** | 我把推導式寫成「**官方守恆式**」,且它會讓合法的多次部分退款紀錄被擋在告警之前 |
| R3 | **Fable**(換模型 + 換角度) | 修兩行即 GO | 我註解裡的「`expireStuckAtCeiling` 天花板可回收」**是錯的**(它只標記、不釋鎖) |
| R4 | Fable(只看 R3 後的 delta) | **GO**(0 must-fix) | 逐分支確認回傳型別重構未改任何裁決 |

🔴 **每一輪抓到的都是「上一輪修法自己開的洞」**,不是原本要修的東西。R1 之後就收工的話,會把兩條錯誤的成交路徑推上正式站。
🔴 **鐵則 12 這次按字面滿足**:codex 兩輪都跑完(846s / 949s,有完成標記),未逾時 ⇒ 不需動用 Fable 替代條款(Fable 是額外加的三、四輪)。
🔴 **折入過程自己踩到的假綠**:第一次修完跑突變,新加的三道閘拿掉之後**測試全綠** —— ①兩道閘互相遮蔽 ②「被身分閘擋下」與「走到退款告警」**回傳值相同**,斷言分不出來。已改成每道閘各配一個**只有它擋得住**的情境 + 以告警有沒有發當觀察點。

---

## 9. 下一片

🔴 **回 E10 推進「員工能在後台取消訂單/退款」** —— 退款寫入線 RF2b-RF8 已由 07-28 Q3=A 併入 E10 第 3 批。
入口 = `docs/handoff/2026-07-27-e10-order-closure-handoff.md` + 規格 `docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md`。

**開工前務必先讀本檔 §3 與 §5** —— RF 線的判定就建立在這三個欄位上,而其中兩欄的**值**至今沒被觀察過。

---

## 10. 開放項

- 🟡 **#302 待拍板**:1 元補差額商品被收 NT$100 運費(不是 bug,是「該商品免運」從未實作;傾向 B 改走後台手動建單)。
- 🟡 **提案檔 Q2 未答**:舊 30 張測試單要不要在後台列表隱藏(不擋任何片)。
- 🟡 **§7 兩條既有缺口未開編號**。
- 🟡 **STATUS 主表已 84 行 vs 規則 ≤30**(接手前即漂移,本線再加 6 行);MEMORY.md 超觸發值但已量測「壓字無槓桿」⇒ 兩者都建議獨立成片、需 Sean 拍板。

---

## 11. 並行 session 注意

本 session 期間另有一個 session 在同 repo 工作(mobile-catalog-ux 預覽 / `CascadeFilterTop` / `docs/superpowers/` / `docs/decisions/0007-*`)。
**其檔案全程未觸碰、未納入本線任何 commit**(一律精準 `git add <路徑>`)。接手時工作樹若仍有那些檔案,**那不是本線的殘留**。
