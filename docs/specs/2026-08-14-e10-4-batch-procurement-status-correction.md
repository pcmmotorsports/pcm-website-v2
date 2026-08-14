# #4 批次標商品進度 — 現況更正 + 既有 plan 還缺什麼(A 窗夜跑,零行 code)

> **這份不是第二份 plan。** 權威 plan 仍是 `docs/specs/2026-08-06-e10-a9h-batch-procurement-plan.md`(329 行),
> 本檔只做兩件事:**①更正兩處已過期的字面 ②列出那份 plan 現在還缺什麼才能開工。**
> 事實親查於 worktree `pcm-void-readers` @ `0e8c086b`。

## §1 🔴 兩處字面已過期,先更正再談後續

`docs/specs/2026-07-25-admin-backend-rebuild-spec.md:115` 的 §1-A ❌ 清單寫
「`4` 批次標商品進度(**plan 卡關卡1、零行 code**)」—— **兩個半句都不再成立**:

| 宣稱 | 實查 | 證據 |
|---|---|---|
| 「卡關卡1」 | A9h-M **已寫、已 apply 正式庫** | `supabase/migrations/20260806200000_m4b_e10_a9h_m_a5a_preserve_optional_fields.sql` 存在;`supabase/APPLIED.tsv:130` 有該版本號 |
| 「零行 code」 | A9h-1 **已完工** | `apps/admin/src/lib/orders/procurement-result.ts`(61 行)存在;`procurement-actions.ts:61` 註解逐字「A9h-1(2026-08-06):`classifyResult` 已抽到 `./procurement-result`」 |

數法(本 worktree 實跑,分母一併給):
`for f in supabase/migrations/*.sql; do v=$(basename "$f" | cut -d_ -f1); grep -q "^$v" supabase/APPLIED.tsv || echo UNAPPLIED $v; done`
⇒ **零行輸出**;`wc -l supabase/APPLIED.tsv` = **191**。⇒ **repo 內沒有任何一支 migration 是未 apply 的。**

⇒ 既有 plan `§5` 的三片,**A9h-M ✅、A9h-1 ✅、A9h-2 ❌**。`#4` 不是「零進度」,是「差最後一片 + 差入口」。

## §2 還缺什麼(這是主視窗問的那題的答案)

**缺的不是關卡1 的一輪審查,是兩片實作:**

| 缺口 | 是什麼 | 卡在哪 |
|---|---|---|
| **A9h-2** | coordinator 本體:逐列送 A5a、三態結果、批次上限、`maxDuration` | **只卡「批次上限的數字」** —— 既有 plan §10 假設 `A2` 明寫「數字由逾時預算反推、不是拍腦袋」,而那個 P95 **沒有人量過** |
| **A12a** | 列表批次選取 UI(勾選多列)| `apps/admin/src/components/shared/admin-data-table.tsx` 內 `grep -n "select\|checkbox\|batch"` = **零命中** ⇒ 選取能力不存在。且既有 plan §7.2 已判它**命中鐵則 12⑥**、codex 關卡2 不降級 |

🔴 **A9h-2 沒有 A12a 也能先落地**(server 端函式先存在、暫無 UI 呼叫端),既有 plan §5 已這樣拆。

## §3 既有 plan 需要回訪的三處漂移(08-06 → 08-14,那份 plan 看不到)

1. 🔴 **`order_item_procurement` 長出了 `voided_at`**(`20260813120000`,已 apply),
   而 A5a 已在 `20260814100000` 加了分流,該檔 `:32-36` 逐字:「已作廢列**視同不存在**、走新建路徑」、
   「回傳碼零變動…走新建 = `CREATED`」。
   ⇒ **對批次的意義**:員工一次勾 N 列、其中有已作廢的採購,結果會是「悄悄新建 N 筆」而不是「更新」。
   單列 UI 下這是 Sean 的拍板語意(`Q-S1=A`),但**一次 N 筆時員工看不出差別**。
   ⇒ 既有 plan §4.1 的 row result **已經分得出 `CREATED` / `UPDATED`**,資訊在;
   **要補的是把「這幾列是新建、不是更新」寫進 A12b 的顯示義務**,與 §4.3 MF11 的 read-back 契約放在一起。
2. **假設 `A4`(DROP 舊簽章後無其他呼叫端)已無意義** —— A9h-M 已 apply,現行簽章 12 參,
   `20260814100000:168` 是完整簽章逐字。該格可標「已過」。
3. **`maxDuration` 的前例數字要更新**:既有 plan §4.3 引訂單明細頁「斷言 ≥45」,
   而現況三處全是 `= 60`(`app/orders/page.tsx:43`、`app/@panel/orders/page.tsx:35`、`app/orders/[id]/page.tsx:43`),
   守門在 `app/@panel/order-panel-wiring.test.ts:174-181`(regex 抓 `^export const maxDuration = (\d+)`,
   **且該檔 `:176` 自己記著「整行註解掉照樣綠」這個坑已修**)。⇒ A9h-2 照 60 對齊、抄那條守門形狀。

## §4 檔數與鐵則判定(只算 A9h-2;A12a 是另一片、不合併)

我自己數 = **4 檔**:①新增 `apps/admin/src/lib/orders/procurement-batch.ts` ②新增 `procurement-batch.test.ts`
③改 `apps/admin/src/app/orders/page.tsx`(批次 action 入口;`maxDuration = 60` **該檔已有**、不需新增)
④改 `apps/admin/src/lib/orders/procurement-actions.ts`(匯出批次 action 或拆入口)。

- **鐵則 8:命中**(4 檔)⇒ 等 Sean 批。
- **鐵則 12**:既有 plan §8 判「命中 ②③④」。**其中 ② 已隨 A9h-M apply 消失**(那是 DROP 簽章要重 GRANT 的事);
  A9h-2 剩 **③ 大量寫入(一次 N 列)** 與 **④ 顯式 `maxDuration`(弱)** ⇒ **仍命中、codex 關卡2 不降級**。
- 片型:**高風險片**。估時 40-50 分(沿用既有 plan §5;我沒有重估)。

## §5 驗收條件

**逐條沿用既有 plan §11 的 1-10**(不重寫、不改寫;那 10 條是關卡1 R1 十一條 must-fix 折出來的)。

🔴 **沿用 §11 的前提是「R1 的折法真的成立」,而那個前提未驗** —— 我沒有讀
`docs/reviews/2026-08-06-e10-a9h-k1-codex.md` 的 findings 全文,「11 條全折」是既有 plan §6 的**自陳**,
我只是沒有反證。**Sean 批這片時請把這句一起看**:沿用一份未被複驗的折法,等於拿它當地基。
要拆掉這個前提,只需要有人讀一次那份 findings 並逐條對回 §6 的對照表。

本檔**只加兩條**:

11. 批次上限的數字**必須附實測 P95 與量法**(單列 RPC 往返時間、樣本數、怎麼跑的),
    不得只寫一個常數。負向對照 = 把上限調到 `N+1` 應觸發守門測試紅。
12. 批次輸入含**已作廢採購列**時,結果碼是 `CREATED`(不是 `UPDATED`),且測試明寫這條預期
    ——釘住 `20260814100000:32-36` 的分流語意,避免將來有人「修」成 `UPDATED`。

## §6 誠實缺口

1. **我沒有對正式庫查 `admin_upsert_item_procurement` 的實際簽章。** §1、§3 引的 12 參與分流字面
   **全部來自 repo 內的 migration 檔與型別檔**,不是 DB 查詢。照今天第 4 條教訓,這**不算 DB 事實**
   —— 只算「repo 說它 apply 了」。**正式庫實際簽章 = 未確認**;開工前要對 DB 查一次 `pg_proc`。
2. **我沒有跑既有 plan 的關卡1 R2。** 我判斷「R2 已無標的」是因為它審的 A9h-M 已經上線,
   但**我沒有讀關卡1 R1 的 findings 全文**(`docs/reviews/2026-08-06-e10-a9h-k1-codex.md`),
   所以無法宣稱「11 條都真的折進去了」—— 那是既有 plan §6 的自陳,我只是沒有反證。
3. **`#4` 就算 A9h-2 做完也不會變綠。** 沒有 A12a(選取 UI),員工在畫面上仍然沒有批次入口
   ⇒ §1-A 的 ❌ 要變 🟡 或 ✅ 得等 A12a。本檔不假裝這片能單獨翻牌。
4. 未量:批次一次 N 列對 A2b1 parent order 鎖的排隊行為(既有 plan §4.2 提到「同單片段會排隊」,同樣沒有數字)。
