# A4a 回滾 runbook:`order_item_quantity_summary` 已有真實資料時的撤除程序

> 依據:master plan `:373-377`(A4a DoD 硬前置)+ A1 plan §9(:383-389,「A4a 之後不得照抄 §9」的接棒者)。
> 片級 plan = `docs/specs/2026-08-03-e10-a4a-summary-recompute-plan.md` §6;演練 = `scripts/a4a-rollback-rehearsal.sh`(健康 + drift 雙變體,A4a 收工前必綠)。
> 執行者 = owner(postgres;Sean 經 dashboard SQL editor)。每一步 = 可直接複製的 SQL。
> 🔴 原則:**依賴未清零前不得 DROP 表**;對帳分歧**不是 abort 是分流**(災難日的正典輸入就是「摘要壞了」);abort 只留給「真相表自身讀不到」。

## 步驟 ①:停寫停守門

🔀 **2026-08-03 已回寫**(A5a migration 已寫成;**2026-08-03 已 apply 正式站**——本行 2026-08-04 A8a1 片更新,來源=`docs/handoff/CURRENT.md:5-6`(ledger 尾=`20260803160000`)與 `:12-13`(「三片皆已 apply,read-back 全符」);⚠️ STATUS.md 08-03 晚段寫的 ledger 尾=`20260803150000` 是 A5a apply **前**的快照、不含 A5a,勿引;本節寫的是 A5a 落地之後的程序),
契約(A4a plan §11 債⑦)結案。A5a 上線後採購側就有一支 writer RPC;
到貨明細(`order_item_procurement_receipts`)與取消側(`order_cancellation_items`)仍為零寫 GRANT、無 writer。

🔴 **(1) 與 (2) 必須是兩次獨立執行、中間確定已提交** —— 若整段被包在同一個交易裡(Dashboard SQL editor
把多句當一個交易送出時就會這樣),REVOKE 在提交前對其他連線不生效:那段期間新的 RPC 呼叫照樣進得來,
而它們的 `xact_start` 會**晚於** `revoke_at` ⇒ 正好被 (3) 的條件漏掉。⇒ 先單獨跑 (1)、確認回到非交易狀態,
再跑 (2)。(Dashboard 是否把多句包成單一交易,repo 內未實測 ⇒ 一律當成會包。)

```sql
-- (1) 停掉 service_role 應用路徑的唯一寫入口(A5a)。**單獨執行、確認已提交後再做下一步。**
-- 🔴 簽章 = 12 參(A9h-M 20260806200000 起;末參 p_preserve_optional_fields boolean)。
--    型別清單少一個 boolean ⇒ 本句當場 undefined function、回滾在唯一需要它的那天卡死。
REVOKE EXECUTE ON FUNCTION public.admin_upsert_item_procurement(
  uuid, uuid, integer, text, text, timestamptz, text, text, date, text, text, boolean) FROM service_role;
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
-- (a) 本片四支 trigger 枚舉(此刻應 = 4;步驟④後重跑應 = 0,歸零才准走⑥)
SELECT count(*) FROM pg_catalog.pg_trigger
 WHERE tgname IN ('order_item_procurement_received_quantity_guard_bt',
                  'order_item_procurement_summary_recompute_zc',
                  'order_item_procurement_receipts_received_sync_ac',
                  'order_cancellation_items_summary_recompute_ac')
   AND NOT tgisinternal;
```

- (b)**消費端清單(授權時 repo-grep,2026-08-03;🔴 2026-08-06 由 A9c 回寫)**:本片四 trigger + 五函式;~~A9c(PostgREST 讀模型)未建~~ ⇒ **A9c 已建。PostgREST 讀模型現有兩個消費端,回滾前都要先拆**:
  - `ADMIN_ORDER_DETAIL_SELECT`(`packages/adapters/src/supabase/SupabaseOrderAdapter.ts`;A9g-1 起)
  - **`ADMIN_ORDER_LIST_SELECT`(同檔;A9c 2026-08-06 新增)** —— 內嵌 `order_item_quantity_summary(quantity, ordered_quantity, instock_quantity, cancelled_quantity)`
  - TS 側連帶:`mappers/order.ts` 的 `mapQuantitySummary`(明細,fail-closed 回 `null`)與 `mapListQuantitySummary`(列表,補 0)、`AdminOrderLine.quantitySummary`(**非 nullable**)。
  🔴 **步驟③「逆序撤消費端」要先把這兩條 select 字串的內嵌拿掉再 DROP 表** —— 漏掉會讓 admin 訂單**列表**與**明細**兩頁一起壞(PostgREST 對不存在的關聯是回錯誤、不是靜默略過)。
  🔴 **未來消費端上線片必須回寫本清單**(PostgREST select 字串對 DB 完全不可見,catalog 查不到)。
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
DROP TABLE public.order_item_quantity_summary;   -- 連帶七條 CHECK 與複合 FK(A1 §9 原文)
ALTER TABLE public.order_items DROP CONSTRAINT order_items_id_quantity_key;
COMMIT;
```

**Forward 重建**(任一時點):依序重放 A1(`20260730150000`)與 A4a(`20260803140000`)migration 檔 → A4a backfill 由真相重算 → 快照/divergence/received_drift 三表事後 `DROP TABLE` 歸檔或清除。
🔴 **A1 重放的已知蓋寫(2026-08-03 家族序跑實錘)**:A1 `:170` 會 `COMMENT ON TABLE order_item_procurement`,把 **S1b 之後修訂的表註解蓋回 A1 版** ⇒ forward 前先快照 `obj_description`、重放後還原(演練腳本已內建);未來任何晚於 A1 且動過相同物件註解/屬性的 migration 同受此約束。

## 步驟 ⑦(最後一步;前提=⑥ 的 forward 重建完成+對帳綠):A5a 回權

前提逐條 yes 才跑:☐ A1+A4a 已重放 ☐ backfill 對帳綠 ☐ 三張證據表已處置。
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
