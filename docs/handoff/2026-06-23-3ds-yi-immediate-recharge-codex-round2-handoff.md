# M-3 3DS 立即重刷(乙路)handoff — codex round2 後停點(2026-06-23)

> **給下個 session / Sean 醒來:** 乙路「立即重刷」設計經 **codex 4 輪 + gemini 業界審、持續收斂、方向確認可行**;停在**一個 Auth&Capture 上游決策**(Sean 拍)+ **核心金流真錢未 codex round3 PASS、Claude 不碰 code**(守線)。

## 真權威
- **plan:** `docs/specs/2026-06-23-m3-3ds-abandoned-complete-plan.md`(v3、**§14 為 codex round2 後最新增量**、覆蓋前文衝突處)。
- **設計史:** `docs/specs/2026-06-22-m3-3ds-abandoned-reorder-refund-design.md`(parked、codex 兩輪 FAIL + §8.1 gating fact)。

## 現況一句話
立即重刷(乙路)= 放棄舊單 `markReleased` 退「鎖去重集」讓客人馬上重買、舊單留「對帳集」自動捕捉 late success → 雙扣收尾。codex 確認**方向對**(released≠failed、active 集四類分類正確、立即重刷可行);剩 1 個上游決策卡 MF5。

## 審查歷程(對抗、唯讀零留痕)
| 輪 | 結果 |
|---|---|
| parked codex ×2 | FAIL(盲放行/取消放行都撞 §8.1「4 能否晚扣」牆)|
| 甲路(保守 hold)codex round1 | FAIL 5 洞(重買多建孤兒等)|
| 乙路 codex round1 | FAIL 6 洞(CAS/preflight/sweeper/released→failed/偵測/own-only)|
| 乙路 codex round2 | **FAIL 3 洞**(MF6 own-only/MF3 sweeper policy/MF5 atomic anomaly)+ 確認方向可行 |
| gemini 業界 | 背書方向(Compensating State/Orphaned Intent 對齊 Stripe/Adyen)、三陷阱 PCM 已防、推 **Auth&Capture** 更優 |

## codex round2 三洞處置
- ✅ **MF6**(authenticated release=新洞、client 可繞 server Record 檢查自釋鎖)→ 折入:markReleased 改 **server-only payment_confirmer + p_user_id**、DB 驗歸屬;find_sibling 留 authenticated own-only 唯讀(§14.1)。
- ✅ **MF3**(released 被 ceiling/manual 擋停掃→幽靈)→ 折入:markReleased 同交易重置 retry 欄 + released 專用 sweeper predicate + 12h manual queue + dashboard runbook(§14.1)。
- 🔴 **MF5**(atomic anomaly + 雙扣收尾)→ atomic 部分已定(同交易冪等寫 anomaly);**收尾動作依 Auth&Capture 決策**(§14.2)。

## 🔴 待 Sean 決策(上游、影響 MF5/§5/§7 整個雙扣收尾)
**Auth & Capture 分離(Void 收尾)vs 維持現狀(退款收尾):**
- **Void 版**(gemini 推、業界最佳):TapPay 只授權不請款 → 雙扣時對 late success 那筆 Void(取消授權、客人帳上不見兩筆)。**但推翻 Sean S1「授權即成立+自動請款」**(S1 理由=不做 capture、對齊刷卡連結慣例);PCM 已預留 is_captured 兩段基礎。
- **退款版**(維持 S1):late success confirm paid + 同交易記 anomaly + Sean TapPay 後台手動退(客人帳上兩筆達一週)。工程少、體驗差。

## 拍後步驟(Claude 自驅)
1. 依 Auth&Capture 決策定 MF5 收尾(Void/退款)。
2. codex round3 複審 → PASS(真錢、必過才實作)。
3. MCP DB 交易模擬驗 markReleased/markCharged 競態序(BEGIN+ROLLBACK 零留痕、plan §9 attack #1 + MF1)。
4. 實作 R1-R3/W1(migration + use-case + action + 型別/parser/database.types)→ 三綠 → code-reviewer → **codex K2 PASS** → commit(**不 push**)+ Codex Packet。
5. 塊 A 新分頁(純前端、零雙扣、配核心一起;要 Sean 肉眼驗)。

## Claude 守線(為何停)
核心金流真錢(雙扣/幽靈扣款);codex 未 round3 PASS + MF5 待上游決策 → **不碰 code**。塊 A 純前端但要 Sean 肉眼驗、單獨上價值有限(需配核心金流解「卡處理中空單」)→ 一起做。db push / push / 肉眼驗收 = Sean only。

## Sean 醒來最少動作
① 拍 Auth&Capture(Void vs 退款)② [Claude 做完後] 終端 `supabase db push`(連帶 S2b live)③ `git push` ④ 肉眼驗收。
