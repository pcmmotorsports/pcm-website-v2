# A4a 回滾 runbook:`order_item_quantity_summary` 已有真實資料時的撤除程序

> 依據:master plan `:373-377`(A4a DoD 硬前置)+ A1 plan §9(:383-389,「A4a 之後不得照抄 §9」的接棒者)。
> 片級 plan = `docs/specs/2026-08-03-e10-a4a-summary-recompute-plan.md` §6;演練 = `scripts/a4a-rollback-rehearsal.sh`(健康 + drift 雙變體,A4a 收工前必綠)。
> 執行者 = owner(postgres;Sean 經 dashboard SQL editor)。每一步 = 可直接複製的 SQL。
> 🔴 原則:**依賴未清零前不得 DROP 表**;對帳分歧**不是 abort 是分流**(災難日的正典輸入就是「摘要壞了」);abort 只留給「真相表自身讀不到」。

## 步驟 ①:停寫停守門

今日(A4a 收工時點)三張來源表對所有應用 role **零寫 GRANT**、無 writer RPC ⇒ 本步 = no-op。
🔴 **契約(plan §11 債⑦)**:A5a 上線片必須回寫本節為具體 SQL,形如:

```sql
-- A5a 上線後的停寫(佔位;A5a 片負責把函式簽章填對):
-- REVOKE EXECUTE ON FUNCTION public.admin_upsert_item_procurement(...) FROM service_role;
```

## 步驟 ②:保存快照 + 對帳(分流,不 abort;🔀 codex K2-R2-2:三形狀 —— 值分歧/缺列/received drift)

```sql
BEGIN;
CREATE TABLE public.a4a_rollback_snapshot AS
  SELECT s.*, pg_catalog.now() AS snapshotted_at
    FROM public.order_item_quantity_summary s;

-- divergence 以「活動 ∪ 摘要」全集驅動:有活動但摘要列缺失(snap_* 為 NULL)也是災難形狀
CREATE TABLE public.a4a_rollback_divergence AS
  SELECT u.order_item_id,
         s.ordered_quantity AS snap_ordered, s.instock_quantity AS snap_instock, s.cancelled_quantity AS snap_cancelled,
         COALESCE((SELECT sum(p.allocated_quantity) FROM public.order_item_procurement p WHERE p.order_item_id=u.order_item_id),0) AS truth_ordered,
         COALESCE((SELECT sum(r.quantity) FROM public.order_item_procurement_receipts r
                    WHERE r.procurement_id IN (SELECT p2.id FROM public.order_item_procurement p2 WHERE p2.order_item_id=u.order_item_id)),0) AS truth_instock,
         COALESCE((SELECT sum(c.cancelled_quantity) FROM public.order_cancellation_items c WHERE c.order_item_id=u.order_item_id),0) AS truth_cancelled
    FROM (SELECT p.order_item_id FROM public.order_item_procurement p
          UNION SELECT c.order_item_id FROM public.order_cancellation_items c
          UNION SELECT s2.order_item_id FROM public.order_item_quantity_summary s2) u
    LEFT JOIN public.order_item_quantity_summary s ON s.order_item_id = u.order_item_id
   WHERE s.order_item_id IS NULL
      OR s.ordered_quantity   IS DISTINCT FROM COALESCE((SELECT sum(p.allocated_quantity) FROM public.order_item_procurement p WHERE p.order_item_id=u.order_item_id),0)
      OR s.instock_quantity   IS DISTINCT FROM COALESCE((SELECT sum(r.quantity) FROM public.order_item_procurement_receipts r
                    WHERE r.procurement_id IN (SELECT p2.id FROM public.order_item_procurement p2 WHERE p2.order_item_id=u.order_item_id)),0)
      OR s.cancelled_quantity IS DISTINCT FROM COALESCE((SELECT sum(c.cancelled_quantity) FROM public.order_cancellation_items c WHERE c.order_item_id=u.order_item_id),0);

-- received_quantity drift 另立留檔表(第二形狀來源:累計欄 vs receipts 明細)
CREATE TABLE public.a4a_rollback_received_drift AS
  SELECT p.id AS procurement_id, p.order_item_id, p.received_quantity AS snap_received,
         COALESCE((SELECT sum(r.quantity) FROM public.order_item_procurement_receipts r WHERE r.procurement_id=p.id),0) AS truth_received
    FROM public.order_item_procurement p
   WHERE p.received_quantity IS DISTINCT FROM COALESCE((SELECT sum(r.quantity) FROM public.order_item_procurement_receipts r WHERE r.procurement_id=p.id),0);

SELECT (SELECT count(*) FROM public.a4a_rollback_divergence) AS divergence_rows,
       (SELECT count(*) FROM public.a4a_rollback_received_drift) AS received_drift_rows;
```

- 兩數皆 0 → 健康,直行 ③。
- 任一 > 0 → **分流**:三形狀差異已留檔,**以真相重算為準**續行(這正是回滾的理由);列數與樣本記入當日 handoff。
- **abort 僅限**:查詢對真相表本身報錯(表不存在/讀取失敗)→ `ROLLBACK;` 停下找人(本步只讀不改,無 re-enable 需求)。

## 步驟 ③:依賴清零檢查(不可用 pg_depend —— plpgsql body 依賴不入 catalog)

```sql
-- (a) 本片四支 trigger 枚舉(此刻應 = 4;步驟④後重跑應 = 0,歸零才准走⑥)
SELECT count(*) FROM pg_catalog.pg_trigger
 WHERE tgname IN ('order_item_procurement_received_quantity_guard_bt',
                  'order_item_procurement_summary_recompute_zc',
                  'order_item_procurement_receipts_received_sync_ac',
                  'order_cancellation_items_summary_recompute_ac')
   AND NOT tgisinternal;
```

- (b)**消費端清單(授權時 repo-grep,2026-08-03)**:本片四 trigger + 五函式;A9c(PostgREST 讀模型)未建。🔴 **未來消費端上線片必須回寫本清單**(PostgREST select 字串對 DB 完全不可見,catalog 查不到)。
- (c)反例(僅演練環境;證明「DROP 不會被 DB 自己擋、順序是人的責任」):trigger 在位時 DROP 表 → 下一筆來源 DML 紅 `42P01`。演練腳本自動跑。

## 步驟 ④:撤 trigger + 函式、標記 stale(與 ②⑤ 同一交易)

```sql
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

## 步驟 ⑤:凍結值驗證(可直接複製;codex K2-9/K2-R2-2 —— 三形狀、災難日不得未驗證就 COMMIT)

```sql
DO $s5$
DECLARE v_bad integer;
BEGIN
  -- 三形狀分歧(值/缺列/received drift)必須 ⊆ ② 已留檔集合(= ①停寫成立、④期間零新寫入)
  SELECT count(*) INTO v_bad
    FROM (SELECT p.order_item_id FROM public.order_item_procurement p
          UNION SELECT c.order_item_id FROM public.order_cancellation_items c
          UNION SELECT s2.order_item_id FROM public.order_item_quantity_summary s2) u
    LEFT JOIN public.order_item_quantity_summary s ON s.order_item_id = u.order_item_id
   WHERE (s.order_item_id IS NULL
       OR s.ordered_quantity   IS DISTINCT FROM COALESCE((SELECT sum(p.allocated_quantity) FROM public.order_item_procurement p WHERE p.order_item_id=u.order_item_id),0)
       OR s.instock_quantity   IS DISTINCT FROM COALESCE((SELECT sum(r.quantity) FROM public.order_item_procurement_receipts r
                    WHERE r.procurement_id IN (SELECT p2.id FROM public.order_item_procurement p2 WHERE p2.order_item_id=u.order_item_id)),0)
       OR s.cancelled_quantity IS DISTINCT FROM COALESCE((SELECT sum(c.cancelled_quantity) FROM public.order_cancellation_items c WHERE c.order_item_id=u.order_item_id),0))
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

⚠️ 誠實界(R3 nit):⑤ 的子集檢查按品項/採購列**成員**判定、不比形狀 —— 已留檔品項若在 ④ 窗口內新增**另一形狀**分歧會滑過;承重在 ①停寫(現況三表零寫 GRANT 下不可達)。**A5a 回寫 ① 時必須重看本條**。

## 步驟 ⑥(選擇性):續走 A1 全回滾(依賴已清零才合法)

```sql
-- 前置:步驟③(a) 重跑 = 0;③(b) 清單無其他消費端。
BEGIN;
DROP TABLE public.order_item_quantity_summary;   -- 連帶七條 CHECK 與複合 FK(A1 §9 原文)
ALTER TABLE public.order_items DROP CONSTRAINT order_items_id_quantity_key;
COMMIT;
```

**Forward 重建**(任一時點):依序重放 A1(`20260730150000`)與 A4a(`20260803140000`)migration 檔 → A4a backfill 由真相重算 → 快照/divergence/received_drift 三表事後 `DROP TABLE` 歸檔或清除。
🔴 **A1 重放的已知蓋寫(2026-08-03 家族序跑實錘)**:A1 `:170` 會 `COMMENT ON TABLE order_item_procurement`,把 **S1b 之後修訂的表註解蓋回 A1 版** ⇒ forward 前先快照 `obj_description`、重放後還原(演練腳本已內建);未來任何晚於 A1 且動過相同物件註解/屬性的 migration 同受此約束。
