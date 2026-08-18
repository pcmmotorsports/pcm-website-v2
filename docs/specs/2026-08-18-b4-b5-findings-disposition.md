# B-4 / B-5 通知信 plan · **R1 findings 逐條折抵表**(2026-08-18 G4)

> 來源兩份:`~/pcm-mailbox/附件-W5-B4B5plan-adversarial-findings-20260818.md`(adversarial-reviewer:must-fix 12 / consider 4 / nit 4)
> 與 `~/pcm-mailbox/附件-W9-審查六格補查與框架題-20260818.md`(V1/V2/V3 + FRAME-1~4)。
> 🔴 **「14 條」是【只數 must-fix】的講法。本表 24 條全列**(20 findings + 4 frames)——
> consider 與 nit 裡也有必改的(`F13` 已被 `V2` 升級成 must)。
> **折抵去處**:B-4 = `2026-08-18-m4a-b4-persist-notification-email-plan.md`;B-5 = `2026-08-18-m4a-b5-enqueue-scan-plan.md`。

| # | 等級 | 折抵去處 | 怎麼折的 |
|---|---|---|---|
| F1 | must | **B-4 §2 / §4** | 收件人**不從已廢的表單欄來**,從建單當下已在手上的 `[session.email, address.email]` 來;**呼叫點寫死在 `charge-actions.ts:267`,一個。** |
| F2 | must | **B-5 §2** | 甲案(掃描)**不碰 `settleCharge`** ⇒ `payment_confirmer` 零表權那條死路不再擋路。乙案下此條仍全額成立。 |
| F3 | must | **B-5 §2 表格第 4 列** | 掃描式**天然可重入**,`settle-charge.ts:71-72` 那個短路的第二個 `paid` 回傳不再是致命路徑。 |
| F4 | must | **B-4/B-5 拆片本身 + B-5 §2** | 拆片理由就是它;甲案下 `service_role` 只出現在 email cron composition(`composition.ts:47`,**本來就有**),結帳路徑零改動。 |
| F5 | must→**重框** | **B-5 §1 / §7-1** | FRAME-2:契約是「可部署但不得宣稱功能上線」⇒ 沒排程是**設計好的落點**。本版把它**明列**(附當場量法:`grep -c crons vercel.json` ⇒ 0、pg_cron 三個 job 無 email)。 |
| F6 | must | **B-4 §4 範圍表** | 兩個型別檔列入;🔴 行號**重量過**:`packages/domain/src/order/types.ts:**1429**`(F 報的 `:1389` 量在 `notify-email` 樹上、已漂)、`mappers/order.ts:79,145-147`。 |
| F7 | must | **B-5 §2/§3** | 甲案下「`settleCharge` 有幾個呼叫點」**不再是驗收矩陣的基礎**(enqueue 不掛在那條線上)。乙案下此條成立且是主要成本。 |
| F8 | must | **B-4 §3.2** | **申報**:通知=註冊信箱優先(Sean 拍板),cardholder=地址優先(08-09 3DS 修復)⇒ **刻意不同**,配一格測試專門斷言兩者可以不同。 |
| F9 | must | **B-4 §3.3** | 改引真正的保證(`charge-actions.ts:190` 無條件 `buildCardholder` + `cardholder.ts:113-115` fail-closed),並配**一格釘住這個前提**的測試(§6 #6)。 |
| F10 | must | **B-4 §3.1** | 直接**不用 `customers.email`** 當第一候選,改用 session 現值 ⇒ 凍結快照的縫在 B-4 消失。**B-5 的 PRD fallback 仍用它** ⇒ 缺口移交 B-5 §7-6。 |
| F11 | consider | **B-4 §3.4** | 更正分類:**一套底 + 兩個衍生 + 一個窄化 + 一個註冊用鬆版**,不是「四套標準」。 |
| F12 | must | **B-5 §4.2** | 不修 adapter;論證「甲案下 enqueue 只有一個生產呼叫點 ⇒ 今天沒有可達路徑」,並標明這是**今天沒有、不是不會有** ⇒ 進 backlog。 |
| F13 | consider→**must**(V2) | **B-5 §4.1** | 改成**照 PRD §3.2**:照樣呼 enqueue,由 adapter 落 `skipped_no_real_email` 一列(有痕跡),不再是「一行沒人看的 log」。 |
| F14 | consider | **B-5 §4** | 採納(換一種方式):掃描直接 `select paid_at` ⇒ **不需要補讀、不需要新 port 去拿 paid_at**。 |
| F15 | must | **B-4 §7 · 不採納並說明** | 🔴 **反過來升級**:B-4 §4.1 讓**每一筆**結帳都走 9 參 ⇒ 猜錯代價從「功能沒接上」變「結帳整條斷」⇒ **preflight 從建議升為硬閘**。代價不對稱。 |
| F16 | must | **B-4 §7 指令段** | 貼給人跑的那一行改成 `read -rs PGURL && export PGURL` 形式(FRAME-4 收窄:腳本檔頭本來就教 env,錯的是 plan 貼的那行)。 |
| F17 | nit | **B-4 §9 待辦** | `verify-create-order-9param.sh:62` 的 `grep -q` 改「**恰一支且含第 9 參**」。🔴 **我沒有改**:那支腳本只在 `notify-email` 分支、不在我的樹上。 |
| F18 | nit | **兩份 plan 全檔** | 行號全部在 `dev @ 34d1754e` 當場重量,不沿用。 |
| F19 | consider | **拆片已執行** | 採納、**理由換成 `F4`**(不是估時)。 |
| F20 | nit | **B-5 §2** | 甲案不再抄 `bestEffortRecordInvoice` 的形狀 ⇒ 「範本自己就示範了要掛兩處」這個坑消失。 |
| F21 | nit | **保留為事實** | `.enqueue(` 生產零呼叫點,複量成立(該條的量具沒有比宣稱窄)。 |
| V1 | must | **B-5 §2 表格第 4 列 + §7-4** | `C-1` 沒有實作 ⇒ 內嵌式首次失敗**零救濟**;甲案的掃描**本身就是 C-1 的形狀** ⇒ 吸收。但**告警那半仍未做**,明列。 |
| V2 | must | **B-5 §4.1** | 照 PRD §3.2 的 NULL fallback 形狀實作,偏離撤回。 |
| V3 | nit | **兩份 plan 的引用** | PRD 節號改對:失敗語意=§3.2、cutoff=§5 R3、PII=§7。 |
| FRAME-1 | must | **B-4 §9 / B-5 §9** | 下一輪送審**把 PRD 內文貼進 prompt**,不只檔頭。 |
| FRAME-2 | — | **B-5 §1 / §7-1** | 已吸收(見 F5)。 |
| FRAME-3 | — | **B-4 §7** | 「量測讓推論」:preflight 留著且升級,不讓一條自標未驗的推論鏈拆掉唯一一道直接量測的閘。 |
| FRAME-4 | nit | **B-4 §7 / F16 列** | 已收窄。 |

## 🔴 本表沒有涵蓋的(誠實邊界)

- **我沒有跑任何測試、沒有連任何資料庫**(prod 或本機)。本表全部是唯讀讀檔 + `grep` 量測。
- **兩份新 plan 都還沒有通過任何外部對抗審查** —— R1 是審**舊**那份。**「折完了」不等於「它過了」。**
- `F2` / `F7` 在**乙案**下仍然全額成立;本表的「已折」是**建立在 Sean 選甲**的前提上。**Sean 選乙 ⇒ B-5 plan 作廢重寫。**
