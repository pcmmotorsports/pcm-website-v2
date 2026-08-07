# A4a 回滾 runbook:`order_item_quantity_summary` 已有真實資料時的撤除程序

> 依據:master plan `:373-377`(A4a DoD 硬前置)+ A1 plan §9(:383-389,「A4a 之後不得照抄 §9」的接棒者)。
> 片級 plan = `docs/specs/2026-08-03-e10-a4a-summary-recompute-plan.md` §6;演練 = `scripts/a4a-rollback-rehearsal.sh`(健康 + drift 雙變體,A4a 收工前必綠)。
> 執行者 = owner(postgres;Sean 經 dashboard SQL editor)。每一步 = 可直接複製的 SQL。
> 🔴 原則:**依賴未清零前不得 DROP 表**;對帳分歧**不是 abort 是分流**(災難日的正典輸入就是「摘要壞了」);abort 只留給「真相表自身讀不到」。

## 步驟 ①:停寫停守門

🔀 **2026-08-03 已回寫**(A5a migration 已寫成;**2026-08-03 已 apply 正式站**——本行 2026-08-04 A8a1 片更新,來源=`docs/handoff/CURRENT.md:5-6`(ledger 尾=`20260803160000`)與 `:12-13`(「三片皆已 apply,read-back 全符」);⚠️ STATUS.md 08-03 晚段寫的 ledger 尾=`20260803150000` 是 A5a apply **前**的快照、不含 A5a,勿引;本節寫的是 A5a 落地之後的程序),
契約(A4a plan §11 債⑦)結案。A5a 上線後採購側就有一支 writer RPC;
到貨明細(`order_item_procurement_receipts`)與取消側(`order_cancellation_items`)仍為零寫 GRANT、無 writer。

🔴 **(1) / (1b) / (2) 必須是<u>三次</u>獨立執行、中間確定已提交**(2026-08-06 R2:(1b) 若與 (2) 併一次跑,`revoke_at` 會在 DISABLE 對他人生效前記下 ⇒ drain 濾不到窗內的出貨寫入) —— 若整段被包在同一個交易裡(Dashboard SQL editor
把多句當一個交易送出時就會這樣),REVOKE 在提交前對其他連線不生效:那段期間新的 RPC 呼叫照樣進得來,
而它們的 `xact_start` 會**晚於** `revoke_at` ⇒ 正好被 (3) 的條件漏掉。⇒ 先單獨跑 (1)、確認回到非交易狀態,
再跑 (2)。(Dashboard 是否把多句包成單一交易,repo 內未實測 ⇒ 一律當成會包。)

🔴🔴 **契約債①(2026-08-06 B2-S2b-3a 前段更新:上一版說「本步暫時完整」,那句<u>已經不成立</u>)**:
本步目前只 REVOKE 採購側(A5a)那一個寫入口。**出貨側的第二條寫入路徑已經存在** ——
B2-S2b-1(commit `4ef591b`)建的 `shipments_summary_recompute_ac` 重算 trigger,
只要有人 `UPDATE shipments SET shipped_at / deleted_at`,摘要表的 `shipped_quantity` 就會被改。
✅ **停寫動作已補**(2026-08-06 B2-S2b-3b:見下方 **(1b)**;對稱的 `ENABLE` 在**步驟⑦**)。
🔴 **仍未涵蓋的**:債⑤(下一段)。
🔴 另有**債⑤**(plan §9 交棒 9):`admin_cancel_order` 對 `service_role` 有 EXECUTE,
它經 A4a trigger 也寫得到摘要表 ⇒ 「A5a 是唯一 service_role 寫入口」這句本來就不精確。

```sql
-- (1) 停掉 service_role 應用路徑的唯一寫入口(A5a)。**單獨執行、確認已提交後再做下一步。**
-- 🔴 簽章 = 12 參(A9h-M 20260806200000 起;末參 p_preserve_optional_fields boolean)。
--    型別清單少一個 boolean ⇒ 本句當場 undefined function、回滾在唯一需要它的那天卡死。
REVOKE EXECUTE ON FUNCTION public.admin_upsert_item_procurement(
  uuid, uuid, integer, text, text, timestamptz, text, text, date, text, text, boolean) FROM service_role;
```

```sql
-- (1b) 🔴 **停掉出貨側那條寫入路徑**(2026-08-06 B2-S2b-3b:債① 結清)。
--     REVOKE 對它沒用 —— 它不是 RPC,是掛在 shipments 上的重算 trigger;
--     `service_role` 對 shipments 只有 SELECT,**沒有可以 REVOKE 的 actor**。
--     停寫的正確對象就是 trigger 本身。
-- 🔴 少了這一步:②→⑤ 之間任何一次 `UPDATE shipments SET shipped_at / deleted_at`
--     都會改到摘要表的 shipped_quantity ⇒ 快照與拆除期間數字仍會動,而步驟⑤ 會紅在
--     「分歧不在②留檔集合內」——看起來像④期間有人亂寫,實際上是本步沒停乾淨。
-- 🔴 **步驟⑦ 有對稱的 ENABLE,不做那步會讓出貨側永久停寫、而三軸對帳仍可能全綠。**
-- 🔴 `ALTER TABLE … DISABLE TRIGGER` 對 `public.shipments` 取 **AccessExclusive**(PG 語義;
--    **本 repo 未實測量過鎖等級**,口徑與步驟④ 那段一致)⇒ 會排在既有寫交易之後。
--    這一句是**獨立小交易**,逾時重跑無代價 ⇒ 設等鎖上限;
--    卡住(`55P03`)就是「還有出貨交易沒結束」的訊號,等它結束再跑,不要硬等也不要跳過。
SET lock_timeout = '5s';
ALTER TABLE public.shipments DISABLE TRIGGER shipments_summary_recompute_ac;
RESET lock_timeout;
-- 驗:應回 D(disabled);回 O 代表沒生效,停下不要往下走
SELECT tgenabled FROM pg_trigger
 WHERE tgrelid = 'public.shipments'::regclass
   AND tgname = 'shipments_summary_recompute_ac' AND NOT tgisinternal;
```

```sql
-- (2) 另一次執行:記下停寫時點(下一步 drain 的錨;此刻 (1) 已對所有連線生效)
SELECT now() AS revoke_at;   -- ← 把回傳值填進 (3)

-- (3) 🔴 drain:REVOKE 只擋「新的」呼叫,已經通過 EXECUTE 檢查、正在跑或還沒 COMMIT 的交易
--     照樣會寫進去。反覆跑到回 0 為止(或等到最長交易 timeout)。
--     ⚠️ 不可改用 `query ILIKE '%admin_upsert_item_procurement%'`:①會命中這句自己
--        ②呼叫完 RPC 後改跑別的 SQL、尚未 COMMIT 的交易查不到 —— 兩種都會給出「已淨空」的假象。
SELECT count(*) FROM pg_stat_activity
 WHERE pid <> pg_backend_pid()
   AND xact_start IS NOT NULL
   AND xact_start <= TIMESTAMPTZ '<填 (2) 的 revoke_at>';
-- v3(A8a1 關卡2 折入):<= 不是 <——xact_start 恰等於 revoke_at 的交易(同一時戳精度)
-- 是「REVOKE 生效前已通過檢查」的可能成員,安全邊界必須含等號。
```

⚠️ **停寫後的殘餘寫入面(誠實列全,口徑對齊 S2 `20260801160000:303-306`)**:owner 手動 SQL、pg_cron job、
任何持 owner 憑證的服務 —— 三者都不受 REVOKE 影響。本步驟保證的是「**service_role 應用路徑**已停」,
不是「沒有任何東西能寫」。災難日若對帳持續飄移,先查這三個面,不要假設停寫失敗。

## 步驟 ②:保存快照 + 對帳(分流,不 abort;🔀 codex K2-R2-2:三形狀 —— 值分歧/缺列/received drift)

> 🔴 **v3(A8a1 關卡2 折入):②→⑤ 的 BEGIN…COMMIT 跨四個步驟,必須同一連線同一 SQL editor
> 分頁依序貼入執行、中途不換頁不斷線**;換連線=快照靜默回滾、④⑤ 的「同一交易」宣稱失效。
> 中途斷線就從 ② 重來(CTAS 未 COMMIT 會自動消失、無殘留)。

```sql
BEGIN;
CREATE TABLE public.a4a_rollback_snapshot AS
  SELECT s.*, pg_catalog.now() AS snapshotted_at
    FROM public.order_item_quantity_summary s;

-- divergence 以「活動 ∪ 摘要」全集驅動:有活動但摘要列缺失(snap_* 為 NULL)也是災難形狀
-- ⚠️ 契約債②(2026-08-06 B2-S2b-3a 前段:**只落地一半**):本表原本只對帳 ordered / instock / cancelled
--    **三軸**,大線讓 shipped 成為被維護的第四軸之後,shipped 漂移會在這裡全綠而漏掉。
--    ⇒ 已補 `snap_shipped` / `truth_shipped` 兩欄 + WHERE 的第四軸判斷,候選全集也補了 `shipment_items`
--    (**shipment-only 品項**:有出貨但從沒進過採購/取消/摘要 —— 不補就永遠不會被對帳掃到)。
-- ✅ **驗收 fixture 已落地**(2026-08-06 B2-S2b-3b):`scripts/b2s2b-verify.sh` 的 `B27-divergence-4th` 格
--    **從本檔抽出下面這段 SQL 實跑**,造「只有 shipped 漂移、前三軸正確」的資料 ⇒
--    舊三軸述詞回 0 列、本段回 1 列且指名該品項。⇒ 契約債② 兩半都結清。
--    🔴 那一格是從**本檔**抽 SQL 去跑的 —— 改壞下面這段,它會紅。
-- 🔴 **前置**:本步驟現在硬相依 **S2a**(`s.shipped_quantity` 欄)與 **B2-S1**(`shipments` / `shipment_items` 兩表)。
--    對還沒套 S2a 的站,這句 `CREATE TABLE` 會 `42703` ⇒ 照下方「abort 僅限…停下找人」處理,不要自行改寫本段。
-- 🔴 `-- SHIPPED-TRUTH-BEGIN/END` 之間是**真相式的受守護區塊**:全 repo 共 **6 塊**
--    (helper 1 / 本檔 3 —— 對帳段的欄位與 WHERE 各一、收尾段一 / `a4a-verify.sh` 的 ORACLE_SQL 1
--     / migration 的 backfill oracle 1)。
-- ✅ **守門已落地**(2026-08-06 S2b-3a 後段,commit `b3340ac`):`scripts/b2s2b-truth-sync.py`
--    逐塊比對**整塊 6 行的序列**(含順序)⇒ **改這幾行會轉紅**,那是設計、不是故障;
--    合法變更時要同批改該檔的凍結表。
--    區塊內**刻意零縮排**:縮排差異會讓逐字比對永遠不等,**不要順手重排這幾行**。
CREATE TABLE public.a4a_rollback_divergence AS
  SELECT u.order_item_id,
         s.ordered_quantity AS snap_ordered, s.instock_quantity AS snap_instock, s.cancelled_quantity AS snap_cancelled,
         s.shipped_quantity AS snap_shipped,
         COALESCE((SELECT sum(p.allocated_quantity) FROM public.order_item_procurement p WHERE p.order_item_id=u.order_item_id),0) AS truth_ordered,
         COALESCE((SELECT sum(r.quantity) FROM public.order_item_procurement_receipts r
                    WHERE r.procurement_id IN (SELECT p2.id FROM public.order_item_procurement p2 WHERE p2.order_item_id=u.order_item_id)),0) AS truth_instock,
         COALESCE((SELECT sum(c.cancelled_quantity) FROM public.order_cancellation_items c WHERE c.order_item_id=u.order_item_id),0) AS truth_cancelled,
-- SHIPPED-TRUTH-BEGIN
COALESCE((SELECT sum(si.shipped_quantity)
FROM public.shipment_items si
JOIN public.shipments sh ON sh.id = si.shipment_id
WHERE si.order_item_id = u.order_item_id
AND sh.deleted_at IS NULL
AND sh.shipped_at IS NOT NULL), 0)
-- SHIPPED-TRUTH-END
           AS truth_shipped
    FROM (SELECT p.order_item_id FROM public.order_item_procurement p
          UNION SELECT c.order_item_id FROM public.order_cancellation_items c
          UNION SELECT s2.order_item_id FROM public.order_item_quantity_summary s2
          UNION SELECT si2.order_item_id FROM public.shipment_items si2) u
    LEFT JOIN public.order_item_quantity_summary s ON s.order_item_id = u.order_item_id
   WHERE s.order_item_id IS NULL
      OR s.ordered_quantity   IS DISTINCT FROM COALESCE((SELECT sum(p.allocated_quantity) FROM public.order_item_procurement p WHERE p.order_item_id=u.order_item_id),0)
      OR s.instock_quantity   IS DISTINCT FROM COALESCE((SELECT sum(r.quantity) FROM public.order_item_procurement_receipts r
                    WHERE r.procurement_id IN (SELECT p2.id FROM public.order_item_procurement p2 WHERE p2.order_item_id=u.order_item_id)),0)
      OR s.cancelled_quantity IS DISTINCT FROM COALESCE((SELECT sum(c.cancelled_quantity) FROM public.order_cancellation_items c WHERE c.order_item_id=u.order_item_id),0)
      OR s.shipped_quantity   IS DISTINCT FROM
-- SHIPPED-TRUTH-BEGIN
COALESCE((SELECT sum(si.shipped_quantity)
FROM public.shipment_items si
JOIN public.shipments sh ON sh.id = si.shipment_id
WHERE si.order_item_id = u.order_item_id
AND sh.deleted_at IS NULL
AND sh.shipped_at IS NOT NULL), 0)
-- SHIPPED-TRUTH-END
      ;

-- received_quantity drift 另立留檔表(第二形狀來源:累計欄 vs receipts 明細)
CREATE TABLE public.a4a_rollback_received_drift AS
  SELECT p.id AS procurement_id, p.order_item_id, p.received_quantity AS snap_received,
         COALESCE((SELECT sum(r.quantity) FROM public.order_item_procurement_receipts r WHERE r.procurement_id=p.id),0) AS truth_received
    FROM public.order_item_procurement p
   WHERE p.received_quantity IS DISTINCT FROM COALESCE((SELECT sum(r.quantity) FROM public.order_item_procurement_receipts r WHERE r.procurement_id=p.id),0);

-- v3(A8a1 關卡2 折入):三張證據表 escape 兩件套(ENABLE RLS+REVOKE;owner 直讀,故不 GRANT
-- ——與 a7-rollback 的「三件套」(含 GRANT SELECT 供 ACL 斷言形狀)刻意不同,勿照字面找第三件)
-- —— CTAS 預設繼承 default privileges,
-- 內部採購/取消數字不得進 PostgREST 曝露面;owner(postgres)直讀不受影響。
ALTER TABLE public.a4a_rollback_snapshot        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.a4a_rollback_divergence      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.a4a_rollback_received_drift  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.a4a_rollback_snapshot, public.a4a_rollback_divergence,
  public.a4a_rollback_received_drift FROM PUBLIC, anon, authenticated, service_role;

SELECT (SELECT count(*) FROM public.a4a_rollback_divergence) AS divergence_rows,
       (SELECT count(*) FROM public.a4a_rollback_received_drift) AS received_drift_rows;
```

- 兩數皆 0 → 健康,直行 ③。
- 任一 > 0 → **分流**:三形狀差異已留檔,**以真相重算為準**續行(這正是回滾的理由);列數與樣本記入當日 handoff。
- **abort 僅限**:查詢對真相表本身報錯(表不存在/讀取失敗)→ `ROLLBACK;` 停下找人(本步只讀不改,無 re-enable 需求)。

## 步驟 ③:依賴清零檢查(不可用 pg_depend —— plpgsql body 依賴不入 catalog)

```sql
-- (a) 依賴 trigger 枚舉(此刻應 = 5;步驟④後重跑應 = 0,歸零才准走⑥)
-- 🔴 2026-08-06 B2-S2b-3b(plan 項21b):**從四支改成五支** —— 第五支是出貨側的重算 trigger,
--    它經自己的函式 → helper → 摘要表,是**同一條依賴鏈**;漏掉它就等於宣告「依賴已清零」
--    卻還有一支活著指向 helper。
SELECT count(*) FROM pg_catalog.pg_trigger
 WHERE tgname IN ('order_item_procurement_received_quantity_guard_bt',
                  'order_item_procurement_summary_recompute_zc',
                  'order_item_procurement_receipts_received_sync_ac',
                  'order_cancellation_items_summary_recompute_ac',
                  'shipments_summary_recompute_ac')
   AND NOT tgisinternal;
```

- 🔴 **(a2) 出貨側那支的處置**(2026-08-06 B2-S2b-3b):`shipments_summary_recompute_ac`
  掛在 `shipments` 上、由 **B2-S2b** 建。步驟①(1b) 先 **DISABLE**(擋住②→⑤ 視窗的寫入),
  步驟④ 再連同它的函式一起 **DROP** ⇒ 上面 (a) 的枚舉**已含它**、歸零才是真的歸零。
  🔴 **兩者不可互相取代**:只 DISABLE 不 DROP ⇒ 依賴沒清零、⑥ 不該放行;
  只 DROP 不先 DISABLE ⇒ ②→⑤ 視窗仍會被寫。
- (b)**消費端清單(授權時 repo-grep,2026-08-03;2026-08-06 B2-S2b-3b 更新為 <u>五 trigger + 六函式</u>;🔴 2026-08-06 由 A9c 回寫 PostgREST 側)**
  🔴 **本條 2026-08-07 由 B2-S2b 與 A9c <u>兩線 union 合併</u>**(merge 衝突,主視窗 `B-167-A` 裁 Q1=A):
  兩側改的是同一份清單但**不同的東西**,少任何一半災難當天都會做錯事 —— DB 側少了會不停出貨側的寫入,
  PostgREST 側少了會在 DROP 表之後把 admin 兩頁弄壞,而且 **catalog 查不到、沒有任何守門會紅**。
  - **DB 側**:A4a 四 trigger + 五函式,加 **B2-S2b 的 `shipments_summary_recompute_ac` +
    `pcm_a4a_shipments_summary_recompute()`** ⇒ 合計 **五 trigger + 六函式**。
  - **PostgREST 讀模型**:~~A9c 未建~~ ⇒ **A9c 已建,現有兩個消費端,回滾前都要先拆**:
    - `ADMIN_ORDER_DETAIL_SELECT`(`packages/adapters/src/supabase/SupabaseOrderAdapter.ts`;A9g-1 起)
    - **`ADMIN_ORDER_LIST_SELECT`(同檔;A9c 2026-08-06 新增)** —— 內嵌 `order_item_quantity_summary(quantity, ordered_quantity, instock_quantity, cancelled_quantity)`
    - TS 側連帶:`mappers/order.ts` 的 `mapQuantitySummary`(明細,fail-closed 回 `null`)與 `mapListQuantitySummary`(列表,補 0)、`AdminOrderLine.quantitySummary`(**非 nullable**)。
  🔴 **步驟③「逆序撤消費端」要先把這兩條 select 字串的內嵌拿掉再 DROP 表** —— 漏掉會讓 admin 訂單**列表**與**明細**兩頁一起壞(PostgREST 對不存在的關聯是回錯誤、不是靜默略過)。
  🔴 **未來消費端上線片必須回寫本清單**(PostgREST select 字串對 DB 完全不可見,catalog 查不到)。
- (c)反例(僅演練環境;證明「DROP 不會被 DB 自己擋、順序是人的責任」):trigger 在位時 DROP 表 → 下一筆來源 DML 紅 `42P01`。演練腳本自動跑。

## 步驟 ④:撤 trigger + 函式、標記 stale(與 ②⑤ 同一交易)

🔴 **DROP 序(2026-08-06 B2-S2b-3b,plan 項21b)**:**先出貨側、再採購/取消側、最後 helper**。
- **catalog 真正強制的只有一條**:`DROP FUNCTION` 在它的 trigger 還在時會被 `2BP01` 擋
  ⇒ 每支 trigger 必須排在**它自己的函式**之前。下面的順序滿足它。
- **helper 排最後是防禦性的、不是硬依賴**(2026-08-06 R1 更正:上一版寫得像硬依賴):
  ②④⑤ 在同一交易裡,交易結束時狀態相同。它真正保護的是**有人半途停手**的情況 ——
  helper 先沒了、而出貨側 trigger 還在,那支會在下一筆 `UPDATE shipments` 才炸 `42883`。
🔴 `DROP TRIGGER` **不會**帶走函式,兩者都要各自列出來。
🔴🔴 **鎖的代價要先知道(2026-08-06 R1 抓)**:`DROP TRIGGER … ON public.shipments` 取
**AccessExclusive**(PG 語義;**本 repo 未實測量過**),而本步驟在 **②→⑤ 的同一個交易裡** ⇒ 這把鎖**一路持到 COMMIT**,
期間 `shipments` 全表不可讀寫(出貨作業會整個卡住)。
- 🔴 **開始②之前就該讓出貨作業停下**;步驟①(1b) 卡住(`55P03`)本身就是「還有出貨交易沒結束」的訊號,
  那時就不要往下走,不要等到④ 才發現。
- 🔴 **本步驟不另設 `lock_timeout`**:①(1b) 是獨立小交易、逾時重跑無代價;④ 在大交易中途逾時
  會讓②→⑤ 整段回滾重來 —— 而**設在 session 層也一樣會整段回滾**(2026-08-06 R2 更正:
  上一版建議「設在進入②之前」,那沒有達成它自己宣稱的目的)。
  ⇒ **真正的保護是上面那條**:進②之前先讓出貨作業停下,並拿①(1b) 有沒有卡在 `55P03` 當訊號。

```sql
-- 出貨側(B2-S2b)先撤:trigger → 它自己的函式
DROP TRIGGER shipments_summary_recompute_ac ON public.shipments;
DROP FUNCTION public.pcm_a4a_shipments_summary_recompute();
-- 採購 / 取消側(A4a)
DROP TRIGGER order_item_procurement_received_quantity_guard_bt ON public.order_item_procurement;
DROP TRIGGER order_item_procurement_summary_recompute_zc       ON public.order_item_procurement;
DROP TRIGGER order_item_procurement_receipts_received_sync_ac  ON public.order_item_procurement_receipts;
DROP TRIGGER order_cancellation_items_summary_recompute_ac     ON public.order_cancellation_items;
DROP FUNCTION public.pcm_a4a_received_quantity_guard();
DROP FUNCTION public.pcm_a4a_procurement_summary_recompute();
DROP FUNCTION public.pcm_a4a_receipts_received_sync();
DROP FUNCTION public.pcm_a4a_cancellation_summary_recompute();
DROP FUNCTION public.pcm_a4a_recompute_order_item_summary(uuid);
COMMENT ON TABLE public.order_item_quantity_summary IS
  '🛑 STALE:A4a 已回滾撤除,本表值凍結於撤除時點、不得信任(顯示層請視為不可用)。重建 = 重放 A4a migration(backfill 會由真相重算)。';
```

= **A4a 單獨回滾的終點**(摘要表凍結保留)。`received_quantity` 同步凍結、直寫守門已除。

🔴 **走到這裡就停的人請讀這段(2026-08-06 B2-S2b-3b)**:
出貨側那支 trigger 與它的函式**已經在上面被 DROP 了**(不是留在 disabled)——
所以**沒有「忘記回權」這回事**:它根本不存在,要它回來只能重放 S2b(步驟⑥ 的 Forward 清單)。
- 🔴 **不要**在這個狀態下手動 `CREATE` 回去:helper 也被 DROP 了,建回去下一筆出貨會紅 `42883`。
- 🔴 **這段期間出貨側對摘要表零寫入** —— 摘要表本來就已標 `🛑 STALE`、不得信任,兩者一致;
  但**別把「三軸對帳全綠」讀成「可以信任了」**,那正是本檔最陰的那個形狀。

🔴🔴 **中止 / 放棄回滾的人請讀這段(2026-08-06 R2 抓;上一版完全沒涵蓋這條路)**:
①(1b) 的 `DISABLE` 是**單獨提交**的,**不會隨②→⑤ 的回滾一起消失**。
所以只要你是在 **④ COMMIT 之前**中止(② abort、⑤ RAISE 整段回滾、或單純決定不做了):
- **trigger 與 helper 都還在**(④ 沒提交 ⇒ 沒被 DROP,trigger 只是 disabled)
  ⇒ **回權是安全的、而且是必要的**。
- 🔴 **立刻跑步驟⑦ 的那一句 `ENABLE TRIGGER`**(只跑那一句;⑦ 的其餘前提與 A5a 回權另計)。
- 不跑的話:出貨側**永久停寫**、三軸對帳仍全綠、零告警 —— 同一個最陰形狀,只是從另一條路進來。

## 步驟 ⑤:凍結值驗證(可直接複製;codex K2-9/K2-R2-2 —— 三形狀、災難日不得未驗證就 COMMIT)

```sql
DO $s5$
DECLARE v_bad integer;
BEGIN
  -- 三形狀分歧(值/缺列/received drift)必須 ⊆ ② 已留檔集合(= ①停寫成立、④期間零新寫入)
  -- 🔴 2026-08-06 B2-S2b-3a 前段:值分歧補**第四軸 shipped**、候選全集補 `shipment_items`,
  --    與步驟②的 divergence 表同一組判準(兩處不同步 = 收尾驗證會漏掉出貨側的分歧)。
  -- 🔴 **災難日看到本步紅在 shipped 時**:先確認步驟①(1b) 的停寫**真的跑過且回 `D`**
  --    (2026-08-06 起①(1b) 已補上 `DISABLE TRIGGER shipments_summary_recompute_ac`)。
  --    跑過還紅 ⇒ 才是「④期間真的有人寫」;沒跑過 ⇒ 回頭補①(1b) 再從②重來。
  --    🔴 仍未涵蓋的寫入面見步驟① 的**債⑤**(`admin_cancel_order` 對 service_role 有 EXECUTE)。
  SELECT count(*) INTO v_bad
    FROM (SELECT p.order_item_id FROM public.order_item_procurement p
          UNION SELECT c.order_item_id FROM public.order_cancellation_items c
          UNION SELECT s2.order_item_id FROM public.order_item_quantity_summary s2
          UNION SELECT si2.order_item_id FROM public.shipment_items si2) u
    LEFT JOIN public.order_item_quantity_summary s ON s.order_item_id = u.order_item_id
   WHERE (s.order_item_id IS NULL
       OR s.ordered_quantity   IS DISTINCT FROM COALESCE((SELECT sum(p.allocated_quantity) FROM public.order_item_procurement p WHERE p.order_item_id=u.order_item_id),0)
       OR s.instock_quantity   IS DISTINCT FROM COALESCE((SELECT sum(r.quantity) FROM public.order_item_procurement_receipts r
                    WHERE r.procurement_id IN (SELECT p2.id FROM public.order_item_procurement p2 WHERE p2.order_item_id=u.order_item_id)),0)
       OR s.cancelled_quantity IS DISTINCT FROM COALESCE((SELECT sum(c.cancelled_quantity) FROM public.order_cancellation_items c WHERE c.order_item_id=u.order_item_id),0)
       OR s.shipped_quantity   IS DISTINCT FROM
-- SHIPPED-TRUTH-BEGIN
COALESCE((SELECT sum(si.shipped_quantity)
FROM public.shipment_items si
JOIN public.shipments sh ON sh.id = si.shipment_id
WHERE si.order_item_id = u.order_item_id
AND sh.deleted_at IS NULL
AND sh.shipped_at IS NOT NULL), 0)
-- SHIPPED-TRUTH-END
       )
     AND NOT EXISTS (SELECT 1 FROM public.a4a_rollback_divergence d WHERE d.order_item_id = u.order_item_id);
  IF v_bad <> 0 THEN
    RAISE EXCEPTION '步驟⑤失敗:% 列摘要分歧不在②留檔集合內(④期間有新寫入?)—— 整段回滾、停下清查', v_bad;
  END IF;
  SELECT count(*) INTO v_bad
    FROM public.order_item_procurement p
   WHERE p.received_quantity IS DISTINCT FROM COALESCE((SELECT sum(r.quantity) FROM public.order_item_procurement_receipts r WHERE r.procurement_id=p.id),0)
     AND NOT EXISTS (SELECT 1 FROM public.a4a_rollback_received_drift d WHERE d.procurement_id = p.id);
  IF v_bad <> 0 THEN
    RAISE EXCEPTION '步驟⑤失敗:% 列 received drift 不在②留檔集合內 —— 整段回滾、停下清查', v_bad;
  END IF;
END $s5$;
COMMIT;  -- ②④⑤ 同一交易至此收尾;上面 DO 若 RAISE 則整段回滾、trigger 不會停在半路
```

⚠️ 誠實界(R3 nit;🔀 2026-08-03 A5a 回寫時重看):⑤ 的子集檢查按品項/採購列**成員**判定、不比形狀
—— 已留檔品項若在 ④ 窗口內新增**另一形狀**分歧會滑過。承重原本是「三表零寫 GRANT ⇒ 窗口內不可能有新寫入」;
A5a 上線後那句**不再成立**,承重改為 ①的 **REVOKE + drain 已跑完**:drain 回 0 之後 service_role 路徑
確實沒有新交易能寫,但 owner / pg_cron / 持 owner 憑證的服務仍在能力範圍內(見 ① 的殘餘寫入面)。
⇒ 災難日若 ④ 窗口內對帳結果與 ② 留檔對不上,先查那三個面,不要當成 ⑤ 的邏輯錯。

## 步驟 ⑥(選擇性):續走 A1 全回滾(依賴已清零才合法)

🔴 **重建之後必須把 A5a 的寫入權還回去**(關卡2 MF2):步驟① 的 REVOKE 不會被 forward 重放
A1/A4a 的動作抵銷 —— 重建完成、對帳綠之後若忘了這一句,採購寫入會**永久停擺**而系統看起來一切正常
(員工按儲存只會收到權限錯誤,沒有任何告警)。
⚠️ **v3 時點釘死;v3b(codex R2)連版面也釘:GRANT 的 SQL 不放本步、實體移到最後的步驟 ⑦**
——照文件順序操作的人不會在防線已拆/摘要表已 DROP 時提早恢復 writer。

```sql
-- 前置:步驟③(a) 重跑 = 0;③(b) 清單無其他消費端。
BEGIN;
DROP TABLE public.order_item_quantity_summary;   -- 連帶**十條** CHECK 與複合 FK(A1 七 + B2-S2a 三;A1 §9 原文寫「七條」已過期)
ALTER TABLE public.order_items DROP CONSTRAINT order_items_id_quantity_key;
COMMIT;
```

### 🔴 B2-S2a apply 前置步驟(**必跑,不是建議**;2026-08-06 補)

重放或首次 apply `20260806100000`(B2-S2a)**之前**,先對目標站跑唯讀前置閘:

```bash
PGHOST=<host> PGPORT=<port> PGDATABASE=<db> PGUSER=<user> scripts/b2s2a-verify.sh gate
```

🔴 **密碼放 `~/.pgpass`(權限 600),連線字串一個字都不要出現在命令列上**(codex 關卡2 R1+R2)。
理由:含密碼的 URI 若寫成參數,①會留在 shell history ②執行期間同機的 `ps` 看得到 argv。
`export B2S2A_GATE_URL=…` **不是解法** —— 那行本身仍進 history,而且值最後還是被展開成 psql 的參數。
本模式零參數時完全靠 libpq 原生的 `PGHOST`/`PGPORT`/`PGDATABASE`/`PGUSER`/`~/.pgpass` 取得連線,
psql 命令列上不帶任何憑證。
(仍支援 `scripts/b2s2a-verify.sh gate "<連線字串>"`,但**只用於本機無密碼的拋棄庫**。)

🔴 **migration 檔內的 `S2A-APPLY-NOTE` 那段已過期,以本節為準**(Fable R3 nit):
它寫於 harness 尚未交付時,字面說「該檔目前尚未存在 ⇒ 執行者是 apply 當下的人」。
harness 已交付(`scripts/b2s2a-verify.sh gate`),但那段話在 sha 凍結的檔案裡、**不能改**
(改了會讓整支 harness 的凍結值全部失效)。**首次 apply 的人請以本節的指令為準。**

🔴 **先讀懂「紅」在哪個情境代表什麼(2026-08-06 Fable R3 補;沒有這段會卡死在半夜)**:

| 情境 | gate 預期結果 | 紅了怎麼辦 |
| --- | --- | --- |
| **①首次 apply / 出貨線尚未上線** | 綠(exit 0) | **紅 = 真的有事**。停,問 Sean。不得硬繞。 |
| **②災難重建、出貨線已上線**(本節下方 Forward 重建的**主情境**) | **紅(exit 3)= 預期,不是故障** | **接下方替代路徑 A**,不要試圖讓 gate 變綠。 |

情境②為什麼必紅:出貨線上線後 `shipments`/`shipment_items` 一定非 0,而 gate 用的是裸列數。
這時 gate 的作用不是放行,是**逼你停下來走對的那條路**——它擋掉的正是「整檔重放 → `DEFAULT 0`
把已出貨品項寫成 0」那個真正會毀資料的動作。

- 通過(exit 0)= 兩張出貨表皆 0 列 → 可以往下走。
- **不通過(exit 3)= 停。** 情境①→**問 Sean**(有真實資料時 S2a 的 `DEFAULT 0` 語意要重新確認,
  這不是技術問題、是決定);情境②→照下面的路徑 A 做。連不上目標時也算不通過(fail-closed)。
  🔴 **等待期間的系統狀態**:若已執行本文件上方的 rollback 區塊,`order_item_quantity_summary`
  **已被 DROP**,後台所有依賴它的畫面與統計都是斷的 —— 這段時間不是「安全等待」,要當成停機處理。
  ✅ **Sean 2026-08-06 拍板 A(`B-139-A`):不設時限** —— 情境①紅了就**停到 Sean 回覆為止**,
  沒有「等多久就可以自己決定」這回事,期間當停機處理,**不得自行往下走**(fail-closed)。
  決策題原文與來由見 `docs/reviews/2026-08-06-b2-s2a2-reviews.md` §8.6。
  🔴 **給未來**:本板成立的前提是「現實 operator = Sean 本人或其授權 session」。
  出現**第三方操作員**(外包/新同事/值班輪班)時,**本板必須重拍** ——
  對非 Sean 的人而言「無限期等一個人」不是可執行的指示。
- 🔴 **執行前必看那行 `🎯 連線目標:`**:gate 零參數時吃的是當下 shell 的 `PG*` 變數,
  殘留設定會讓你對**錯的庫**拿到綠燈。目標不是你要 apply 的那個庫就立刻停。
- 該模式**唯讀**:只跑兩個 `count(*)`,零 DDL、零寫入,對正式站安全。
- 🔴 **S2b 契約債**:gate 把「無出貨真值」定義成**恰好這兩張表**的列數。S2b 或後續片若新增任何
  出貨資料面(歸檔表、其他來源表),**必須同批把 gate 的查詢一起擴** —— 否則它會綠著放行。
- DB 層另有一道更精確的 fail-closed 閘寫在 migration §1(有效已寄出的**品項列數**必須為 0);
  兩者刻意不同:草稿箱有品項但未寄出時真值仍為 0,不該被裸列數擋下來,但那種狀態值得一個人看一眼。

🔴 動手前先跑上一節的 **B2-S2a apply 前置閘**,並先讀懂該節的情境表 ——
**出貨線已上線時 gate 必紅,那是預期,直接接下方路徑 A**。

**Forward 重建**(任一時點):依序重放 A1(`20260730150000`)、A4a(`20260803140000`)、**B2-S2a(`20260806100000`)**、**B2-S2b(`20260806180000`)**四支 migration 檔(**照時間戳序;S2a 負責把 A1 重放蓋掉的註解再覆寫回來,S2b 排最後**) → A4a backfill 由真相重算 → 快照/divergence/received_drift 三表事後 `DROP TABLE` 歸檔或清除。
🔴 **S2a 不能漏(2026-08-06 補;漏了零告警)**:A1 只把摘要表重建成**五欄**,而 `db push` **不會重跑已登記在 ledger 的 S2a** ⇒ 摘要表永久少 `shipped_quantity` 一欄與三條 CHECK,沒有任何東西會紅。重建後必須實查 **6 欄 / 10 條 CHECK**。
🔴🔴 **S2b 也不能漏(2026-08-06 B2-S2b-3b 補;plan 項31 = 契約債④)**:漏了它,
helper 會停在**三軸**(A4a 版)、出貨側 trigger 不存在 ⇒ **`shipped` 軸永遠不再更新,而三軸對帳全綠、零告警**。
重建後必須實查:**helper 是四軸**(`pg_get_functiondef` 內含 `shipped_quantity`)且
**`shipments_summary_recompute_ac` 存在**。
🔴 **S2b 的重放方式(它不是「整檔貼上去」就好)**:
①它的 §1 前置閘會 pin **A4a helper 的三軸指紋** ⇒ 必須在 A4a 重放**之後**跑,順序不可倒。
②**沒做過步驟④ 就整檔重放它 = 一定失敗,而且第一個紅不是你以為的那個**
(2026-08-06 R1 更正:上一版說會撞 `42710`,實際順序不是那樣):
helper 此刻是**四軸** ⇒ **最先紅的是它自己的 §1 前置閘(`P2B10`,三軸指紋不符)**;
就算閘過了,`CREATE FUNCTION pcm_a4a_shipments_summary_recompute()`(**無** `OR REPLACE`)
排在 trigger 之前 ⇒ 下一個紅是 `42723`,`42710` 根本輪不到。
⇒ **正確做法**:先照步驟④ 拆除(五 trigger / 六函式)再重放整檔;或照 §6 替代路徑手動挑段跑。
🔴 **本行是契約:未來任何動到 `order_item_quantity_summary` 的 migration,同一片必須把自己加進本行。**
🔴 **S2a 重放會被自己的閘擋下(必讀)**:S2a 檔內 §1 是 fail-closed 閘 ——
「有效已寄出量 <> 0 就 RAISE」。災難重建通常發生在出貨線已上線之後 ⇒ **直接重放該檔必然 abort**。
那不是故障,是它在說「DEFAULT 0 會寫下錯的真值」。替代路徑(擇一,不得硬繞閘):
  · **A**(預設):跳過整檔重放,手動在**一個交易內**依序跑該檔的 §2 → §3 → §4:
    🔴 **必須自己補 `BEGIN;` … `COMMIT;`**(codex 關卡2 R2)—— psql 逐句 autocommit,
    少了交易邊界時 §4 驗收紅掉,前面的 `ALTER` 與 COMMENT **已經分段提交下去了**,
    會留下一個「加了欄但沒驗過」的半套狀態。內容 = §2 那**一個 `ALTER TABLE`(四個 ADD:加欄 + C8 + C9 + C6′)**、§3 的七句 COMMENT,
    🔴 **並且必須把該檔 §4 的結構驗收 DO block 一起跑**(少了它,這條手動路徑**一條驗證都沒有**
    —— 打錯一個約束名或漏一句 COMMENT 都零告警)。跑完應看到
    `S2A 結構驗收全數通過(6 欄 / 10 CHECK / 7 註解物件)`;沒看到就是沒過,不得往下走。
    (§1 的閘刻意**不**跑 —— 走這條路徑的前提就是它會紅。)

    再由大線 B2-S2b 的真值 backfill 從 `shipment_items JOIN shipments` 重算填值。
  · **B**:先確認出貨表確實無有效已寄出量(例如尚未上線),再整檔重放。
🔴 **契約債**:此清單是手寫的、沒有機制保證同步 —— **未來任何動到 `order_item_quantity_summary` 的 migration,同一片必須把自己加進本行**,並更新上面那個「幾欄幾條 CHECK」的數字。
🔴 **A1 重放的已知蓋寫(2026-08-03 家族序跑實錘)**:A1 `:170` 會 `COMMENT ON TABLE order_item_procurement`,把 **S1b 之後修訂的表註解蓋回 A1 版** ⇒ forward 前先快照 `obj_description`、重放後還原(演練腳本已內建);未來任何晚於 A1 且動過相同物件註解/屬性的 migration 同受此約束。

## 步驟 ⑦(最後一步;前提=⑥ 的 forward 重建完成+對帳綠):A5a 回權

前提逐條 yes 才跑:☐ A1+A4a+**S2a** 已重放(實查 6 欄 / 10 CHECK)☐ backfill 對帳綠 ☐ 三張證據表已處置
☐ 🔴 **S2b(`20260806180000`)已重放**(實查 helper 是**四軸**、`shipments_summary_recompute_ac` 在)。
🔴🔴 **最後那一格為什麼要獨立列**(2026-08-06 B2-S2b-3b;第二段依步驟④ 改動重寫):
步驟④ 現在會把出貨側 trigger **連同它的函式一起 DROP** ⇒ 這條路上 trigger 的存在與否,
完全取決於**你有沒有重放 S2b**:
- **只重放 A1+A4a+S2a**(漏了 S2b)⇒ trigger 不存在、helper 停在**三軸**。
  此時跑下面的 ENABLE 會**直接紅在 `42704`(trigger 不存在)** —— 那是**好事**,它擋住你。
  🔴 真正危險的是**不跑 ENABLE 就收工**:`shipped` 軸永遠不再更新,而三軸對帳全綠、零告警。
- **四支都重放**⇒ trigger 由 S2b **重新建出來、預設就是 enabled**,helper 是四軸。
  下面那句 ENABLE 在這條路上**是 no-op**(驗證查詢回 `O`),留著是保險與可讀性。
⇒ **這一格要實查的是「helper 是四軸 + trigger 在」,不是去猜 ENABLE 會不會報錯。**
🔴 **S2b 的重放方式見步驟⑥ 的 Forward 重建那一節**(2026-08-06 B2-S2b-3b 已補):
重點兩條 —— ①必須排在 A4a **之後**(它的前置閘 pin A4a helper 的三軸指紋)
②**沒做過步驟④ 就整檔重放它必失敗,而且第一個紅是前置閘 `P2B10`(三軸指紋不符),
不是 `42710`**(2026-08-06 R2 更正:我在⑥ 把這個碼改對了,卻在這裡又寫回舊的;
`CREATE FUNCTION` 無 `OR REPLACE`、排在 trigger 之前 ⇒ 就算閘過也是 `42723` 先撞,
`42710` **不可達**)。詳見⑥。
(⚠️ v4 互指:若走的是 **a7 全回滾**(取消表已 DROP)⇒ A4a 永無法重放、本步前提**永不可滿足**
——回權改走 `2026-07-30-a7-rollback.md` 步 8 的 a7 專屬前提,勿在此卡死。)

```sql
-- 🔴 簽章 = 12 參(A9h-M 20260806200000 起;末參 p_preserve_optional_fields boolean)。
GRANT EXECUTE ON FUNCTION public.admin_upsert_item_procurement(
  uuid, uuid, integer, text, text, timestamptz, text, text, date, text, text, boolean) TO service_role;
-- 驗:應回 t
SELECT has_function_privilege('service_role',
  'public.admin_upsert_item_procurement(uuid,uuid,integer,text,text,timestamptz,text,text,date,text,text,boolean)', 'EXECUTE');
```

```sql
-- 🔴 **出貨側回權**(2026-08-06 B2-S2b-3b:與步驟①(1b) 對稱;債① 的另一半)。
-- 🔴 **少了這一步的後果最陰**:出貨側**永久停寫** —— 之後每一次出貨/作廢都不再更新
--     `shipped_quantity`,而**三軸對帳仍然全綠**(前三軸都對),沒有任何東西會提醒你。
--     ⇒ 這一步不是收尾整潔,是不變式本身。
-- ⚠️ 前提:**A4a + S2b 都已重放**(見上方前提清單最後一格)。
-- 🔴 **本句在兩條路上的意義不同(2026-08-06 3b 第二段重寫;步驟④ 現在會 DROP 那支 trigger)**:
--   ①**走完⑥ 四支全重放**:trigger 由 S2b 重建、**預設已是 enabled** ⇒ 這句是 **no-op**,
--     驗證查詢回 `O`。留著是保險與可讀性,不是因為它有事要做。
--   ②**④ COMMIT 之前中止、後來決定不回滾了**:trigger 還在但被①(1b) DISABLE ⇒ **這句才是實質動作**,
--     而且**非做不可**(見步驟④ 終點下方那段)。
-- 🔴 **漏了 S2b 重放就跑這句** ⇒ 紅在 `42704`(trigger 不存在)。那是它在擋你,不要用 IF EXISTS 吞掉。
ALTER TABLE public.shipments ENABLE TRIGGER shipments_summary_recompute_ac;
-- 驗:應回 O(enabled);回 D 代表沒生效,停下 —— 出貨側還是停寫狀態
SELECT tgenabled FROM pg_trigger
 WHERE tgrelid = 'public.shipments'::regclass
   AND tgname = 'shipments_summary_recompute_ac' AND NOT tgisinternal;
```
