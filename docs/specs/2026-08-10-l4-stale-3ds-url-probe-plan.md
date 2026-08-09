# L4 前提 probe plan:Record 已 `-1/5` 之後,舊 payment URL 還能不能完成?

> 2026-08-10,P 窗。**主視窗 P-269-A 裁 B** 之後、動手之**前**寫。
> 觸發來源:codex 關卡2 F1(對 `ed57f67a`)。`ed57f67a` **凍結不動**,本 probe 走新 commit。

---

## §1 要證的那一句(只有這一句)

> **settleCharge 裁出 `failed`(Record `record_status ∈ {-1, 5}`)之後,那張交易的舊 `payment_url` 送出 OTP 必定失敗。**

L4b 靠這句話放行重刷。它**現在沒有實測證據**:
- L1a probe 證的是「按取消 → Record ≤1 秒轉 `5`」—— 證的是**轉態速度**,不是**轉態之後舊 URL 死了**。
- L1b probe 反而測到相反方向的東西:不碰的 3DS,**20 分鐘後送 OTP 照樣成功**(那是 `4 PENDING`,
  不是 -1/5 之後;但它說明「舊 URL 的生命力比直覺長」,所以這格不能靠直覺補)。

🔴 **這個前提不是 L4b 引入的**:已上線的 cart dedup 路徑(`adjudicateSettlement`)
與 live `settle-charge.ts:170`(`pending` attempt 遇 -1/5 → `markFailed` 釋鎖)**一直建立在同一句話上**。
⇒ 本 probe 若成立,同時替**既有那條已上線的路徑**補背書;若不成立,打到的也不只是 L4b。

## §2 兩態**分開**測、**分開**下結論(主視窗條件①)

`-1 ERROR` 與 `5 CANCEL` 的**誘發方式不同**,合併宣稱等於拿一態的證據替另一態背書。

| 態 | 誘發手法(預定) | 已知風險 |
|---|---|---|
| `5 CANCEL` | 開 3DS 頁 → 按頁面上的「取消 / 返回商店」 | L1a 已證這條誘得出來 |
| `-1 ERROR` | 未知。候選:OTP 連續輸錯 / 3DS 頁逾時放置 / 銀行模擬頁的失敗選項 | **可能誘不出來** ⇒ 照條件②第三分支處理 |

## §3 三分支**先寫死**(主視窗條件②;寫在結果出來之前,防事後挑好講的講)

| 觀察 | 結論 | 動作 |
|---|---|---|
| **兩態都失敗**(OTP 送不出去 / 送出被拒 / Record 不變) | 前提成立 | 收割 L4b + 在 `settle-charge.ts` 與 L4b 檔頭補「已實測」背書(含日期與腳本路徑) |
| **任一態成功**(舊 URL 在 -1/5 之後仍能授權) | 前提**被證偽** | **L4b 不上線**;我只回報事實與逐秒時序,**決策題由主視窗整理**;同時明講這打到的是既有已上線路徑 |
| **構造不出**(誘不出該態 / sandbox 不給那條路) | **未確認** | 明寫「未確認」+ 已試方法清單;**不推測充答案**、不拿另一態的結果替它背書 |

🔴 第三分支的紀律:**「我試不出來」不等於「它不會發生」**。未確認就是未確認。

## §4 安全設計(逐條鏡像既有 refund probe 的家規)

- **只打 sandbox**:host 寫死 `sandbox.tappaysdk.com`,送出前再斷言一次。
- **身分閘**:`merchant_id` 必須 `pcmmoto_CTBC`,否則拒跑。
- **金鑰絕不輸出**:partner_key 只進 request body/header;env 由腳本內部讀、**不經 shell**
  (memory `reference_never-source-env-local-use-grep`:2026-08-02 真的外洩過一把 TapPay secret)。
- **金額閘**:1-6 元,超出拒跑。
- **每一發動作前後都 query**,不靠推測;逐欄比對。
- **交易全退**(主視窗條件③):收工附逐筆最終 `record_status`。
- 🔴 **不碰正式站、不碰正式 DB**:本 probe 完全在 TapPay sandbox + 腳本內,**不經過 PCM 的 app 路徑**。

## §5 可證偽預測(先寫,才知道有沒有被打臉)

如果前提成立,我預期看到:
1. 按取消後 Record `record_status` = `5`,且**立刻**(≤ 數秒)。
2. 回到**同一個** `payment_url`:頁面已失效 / 拒絕 / 導回錯誤頁 —— **拿不到可送出的 OTP 表單**。
3. 即使硬送 OTP,Record 仍停在 `5`、`amount` 不變、不出現 `0 AUTH` 或 `1 OK`。

**任何一條不成立 = 前提被證偽**,走第二分支。
特別是第 3 條:**光看「頁面看起來失效了」不算** —— 要看 Record,那才是權威(memory:
`feedback_falsifiable-prediction-beats-endorsement` / 「6002 ≠ 錢沒動」同族)。

## §6 我現在就知道的限制(誠實邊界,先寫)

- **sandbox ≠ 正式**:sandbox 的 3DS 頁是模擬頁,它的「取消後 URL 失效」行為**未必等於**真實發卡行。
  ⇒ 本 probe 最多能證「TapPay sandbox 的狀態機這樣走」,**不能證真實發卡行也這樣**。
  這一條要寫進結論,不得省略。
- 真實發卡行的驗證頁多久失效 = 未知(母 plan §6 已列)。本 probe 不改變那個未知。
- ⇒ 即使兩態都失敗,結論的強度是「**sandbox 狀態機支持這個前提**」,不是「這個前提被證明了」。

— plan 結束,動手前落檔。

---

# §7 執行結果(2026-08-10,P-274 窗;plan 以上不修改,結果只往下加)

## 7.0 🔴 開工第一件事:前代的診斷是錯的(欄名打錯,不是 prime 的問題)

前代交接寫「官方固定測試 prime 做不出 3DS ⇒ 必須用 TPDirect SDK 產 prime」。**不成立**。
真因:探針腳本送的欄名是 `three_domain_secret`,**正確欄名是 `three_domain_secure`**
(對齊正式路徑字面 `packages/adapters/src/tappay/TapPayChargeAdapter.ts:188`)。
TapPay **靜默忽略未知欄** ⇒ 直接授權、回 `auth_code`、無 `payment_url`。

欄名改對後,**固定測試 prime 一樣拿得到 `payment_url`**(`D20260809yRE3lo`),SDK prime 非必要。

> 教訓形狀:**錯字不報錯,只是安靜地不做那件事**;而「沒發生」被讀成了「做不到」。
> 前代寫欄名時憑記憶、沒對正式 adapter 的字面 —— 這是 grep 一次就能擋掉的。
> (本窗仍先照交接把 SDK prime 那條路跑完並成功產出 prime + 交易 `D20260809xCwNLf`,
> 才在查官方欄位定義時撞到欄名差異。腳本 `tappay-sandbox-3ds-prime-page.py` 留檔備用。)

## 7.1 態 `5 CANCEL`:**三條預測全中,前提成立**(交易 `D20260809yRE3lo`)

| 時間 | 動作 | 觀察(Record = 權威) |
|---|---|---|
| 22:04:24 | create 後 query | `record_status=4 PENDING`、`auth_code=""` |
| 22:05:04 | 開 `payment_url`,3DS 測試頁正常渲染 | 頁面自述特約商店 `pcmmoto_CTBC`、金額 TWD 1、卡號 `…4242`、**OTP `1234567`(頁面原文)** |
| 22:05:15 | 按「取消」→ confirm「是否取消訂單」→ 確定 | 導回 `frontend_redirect_url?...&status=925` |
| 22:05:44 | query | **`record_status=5 CANCEL`**(預測 1 ✅) |
| 22:05:56 | 重開**同一個** `payment_url` | 直接彈回 `frontend_redirect_url?status=924`,**拿不到 OTP 表單**(預測 2 ✅) |
| 22:06:11 | **繞過頁面**、直接 POST `/redirect/three-domain-secure/otp-validate`(`pin=1234567` + `urlId`=payment_url 尾碼) | HTTP 200 但落 `/redirect/redirect-error` |
| 22:06:20 | query | **仍 `5 CANCEL`**、`amount=1` 未動、`auth_code` 仍空、未出現 `0/1`(預測 3 ✅) |

## 7.2 🔴 正向對照(這一格才是本 probe 的判別力來源)

7.1 最後那一發「POST 了但沒事發生」**本身沒有判別力** —— 它同時相容於「取消殺死了 URL」
與「我的 headless POST 手法本來就不通」。所以另建一筆**不取消**的交易,用**逐字相同**的
POST 手法打:

| 交易 | 狀態 | 同一手法 POST OTP `1234567` | Record 結果 |
|---|---|---|---|
| `D20260809yRE3lo` | 已 `5 CANCEL` | 落 `redirect-error` | **不動**,停在 `5` |
| `D20260809AgULsD` | 仍 `4 PENDING` | 導回 `...&status=0&auth_code=500436` | **`4 → 0 AUTH`,錢真的授權了** |

⇒ **POST 機制本身完全有效**(它甚至不需要瀏覽器、不需要 cookie/CSRF/referer)。
因此 7.1 的失敗**可歸因於取消本身**,不是手法問題。這一格若不做,7.1 全部是恆真觀察。

## 7.3 態 `-1 ERROR`:**未確認**(走第三分支)

已試的誘發手法(交易 `D20260809BNVVIc`):

| 手法 | 結果 |
|---|---|
| OTP 連續輸錯 5 次(`0000000`) | 每發都落 `redirect-error`;**Record 仍 `4 PENDING`**、未鎖死、未轉 `-1` |
| 放置逾時(頁面倒數 5 分鐘) | 見 §7.4 —— **不轉態,且 URL 還活著** |
| 銀行模擬頁的失敗選項 | sandbox 3DS 測試頁**只有「送出」與「取消」兩顆鈕**,無失敗選項 ⇒ 此路不存在 |

🔴 **「我試不出來」不等於「它不會發生」**(§3 第三分支紀律)。`-1` 這一半**沒有實測證據**,
**不得**拿 `5` 的結果替它背書(主視窗條件①)。而 `classifyRecordStatus`
(`packages/use-cases/src/settle-charge.ts:385-387`)把 `-1` 與 `5` 判成**同一個** `explicit_failed`
⇒ 該分支有一半仍靠假設撐著。

## 7.4 🔴 逾時測試的意外收穫:頁面倒數是**純 client 端**,舊 URL 在 `4 PENDING` 下活得很久

同一筆 `D20260809BNVVIc`,在 **① 已連錯 5 次 OTP** 且 **② 已超過頁面倒數的 5 分鐘**之後:

| 時間 | 動作 | 結果 |
|---|---|---|
| 22:06:45 | create | `4 PENDING`(從未開過瀏覽器) |
| 22:07:0x | 錯 OTP `0000000` × 5 | 全落 `redirect-error`;query 仍 `4 PENDING` |
| 22:11:57 | query(距 create 5 分 12 秒,已過倒數) | 仍 `4 PENDING` |
| 22:12:16 | 送**正確** OTP `1234567` | **成功**:`status=0`、`auth_code=416512`、Record `4 → 0 AUTH` |

⇒ 三件事同時成立:**倒數是 client 端裝飾**(不經瀏覽器就完全不存在)、**連續錯 OTP 不鎖死**、
**逾時不轉 `-1`**。與 L1b「20 分鐘後送 OTP 照樣成功」同向,並補上「錯 5 次也還是能成功」。
🔴 這也反過來加強 §7.2:同一支 POST 在**被虐待過又過期**的 `4 PENDING` 上照樣成交,
在 `5 CANCEL` 上卻打不動 —— 差別**只**在那個取消。

## 7.5 結論(照 §3 分支表對號,不臨場發明)

- 態 `5 CANCEL` → **第一分支**:前提成立。且 §7.2 證明這不是恆真觀察。
- 態 `-1 ERROR` → **第三分支**:未確認、已附試過的手法清單。
- ⇒ 合起來**不是**乾淨的第一分支(第一分支要求「兩態都失敗」)。**是否收割 L4b 由主視窗裁**。

🔴 **強度上限(§6 已先寫死,不得省略)**:本 probe 證的是「**TapPay sandbox 的狀態機**支持這個前提」,
**不等於**真實發卡行的驗證頁也這樣。sandbox 3DS 頁是 TapPay 自己的模擬頁。

## 7.6 交易收尾(主視窗條件③;逐筆最終 `record_status`)

| 交易 | 用途 | 最終狀態 |
|---|---|---|
| `D20260809xCwNLf` | SDK prime 那條路(欄名還沒改對,無 3DS) | `3 REFUNDED`、`amount=0`、`refunded=1` |
| `D20260809yRE3lo` | 態 5 主體 | `5 CANCEL`、`auth_code` 空、`amount=1` **從未授權 ⇒ 無款可退** |
| `D20260809AgULsD` | 正向對照(唯一真的授權過的) | `3 REFUNDED`、`amount=0`、`refunded=1` |
| `D20260809BNVVIc` | 態 -1 誘發嘗試(最後被 §7.4 的正確 OTP 授權) | `3 REFUNDED`、`amount=0`、`refunded=1` |

四筆全部**實查過**(逐筆 query,非轉述):沙盒無殘留款項。`D20260809yRE3lo` 是唯一非 REFUNDED 的,
因為它 `5 CANCEL`、`auth_code` 空、**從未授權過任何金額** ⇒ 沒有可退的錢
(不對它送 refund:那只會白白消耗一個 `bank_refund_id`、換回一個必然的錯誤碼)。

