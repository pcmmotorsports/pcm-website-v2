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

🔴🔴 **契約債①(2026-08-06 B2-S2b-3a 前段更新:上一版說「本步暫時完整」,那句<u>已經不成立</u>)**:
本步目前只 REVOKE 採購側(A5a)那一個寫入口。**出貨側的第二條寫入路徑已經存在** ——
B2-S2b-1(commit `4ef591b`)建的 `shipments_summary_recompute_ac` 重算 trigger,
只要有人 `UPDATE shipments SET shipped_at / deleted_at`,摘要表的 `shipped_quantity` 就會被改。
🔴 **本步還沒有對應的停寫動作**(`ALTER TABLE public.shipments DISABLE TRIGGER shipments_summary_recompute_ac`
+ 步驟⑦ 的對稱 `ENABLE`)—— 那是 plan 項26 / 26b,歸 **S2b-3b**,**尚未落地**。
⇒ **災難日現況**:②→⑤ 之間若有出貨側寫入,步驟⑤ 會 RAISE(fail-closed,方向對),
但那一紅的原因是「①的涵蓋面還沒補齊」,不是「④期間有人亂寫」。**兩者處置不同,見步驟⑤ 的指路。**
🔴 另有**債⑤**(plan §9 交棒 9):`admin_cancel_order` 對 `service_role` 有 EXECUTE,
它經 A4a trigger 也寫得到摘要表 ⇒ 「A5a 是唯一 service_role 寫入口」這句本來就不精確。

```sql
-- (1) 停掉 service_role 應用路徑的唯一寫入口(A5a)。**單獨執行、確認已提交後再做下一步。**
REVOKE EXECUTE ON FUNCTION public.admin_upsert_item_procurement(
  uuid, uuid, integer, text, text, timestamptz, text, text, date, text, text) FROM service_role;
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
-- 🔴 **尚未結清的那一半**:plan §4 項27 的**驗收 fixture**(造只有 shipped 漂移的資料 ⇒ 舊三軸版回 0 列、
--    四軸版回 1 列且指名該品項)歸 **S2b-3b**,還沒進任何 harness。
--    ⇒ **不要因為看到欄位已經在就跳過那一格**(這正是 9c 那筆債踩過的形狀)。
-- 🔴 **前置**:本步驟現在硬相依 **S2a**(`s.shipped_quantity` 欄)與 **B2-S1**(`shipments` / `shipment_items` 兩表)。
--    對還沒套 S2a 的站,這句 `CREATE TABLE` 會 `42703` ⇒ 照下方「abort 僅限…停下找人」處理,不要自行改寫本段。
-- 🔴 `-- SHIPPED-TRUTH-BEGIN/END` 之間是**真相式的受守護區塊**:全 repo 共 **6 塊**
--    (helper 1 / 本檔 3 —— 對帳段的欄位與 WHERE 各一、收尾段一 / `a4a-verify.sh` 的 ORACLE_SQL 1
--     / migration 的 backfill oracle 1)。
-- 🔴🔴 **現在還沒有守門在比對它們**(R2 must-fix:上一版寫成現在式 = 宣稱超出事實)——
--    同步守門是 **S2b-3a 後段**的交付物;**在它落地之前,改這幾行不會有任何東西轉紅**。
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
  -- 🔴 2026-08-06 B2-S2b-3a 前段:值分歧補**第四軸 shipped**、候選全集補 `shipment_items`,
  --    與步驟②的 divergence 表同一組判準(兩處不同步 = 收尾驗證會漏掉出貨側的分歧)。
  -- 🔴🔴 **災難日看到本步紅在 shipped 時,先看這裡**:步驟① 目前**還沒有**停掉出貨側的寫入路徑
  --    (`ALTER TABLE public.shipments DISABLE TRIGGER shipments_summary_recompute_ac`,plan 項26,歸 S2b-3b)。
  --    ⇒ ②→⑤ 之間任何一次 `UPDATE shipments SET shipped_at / deleted_at` 都會經那支 trigger 改摘要,
  --    本步就會 RAISE。**那一紅通常代表「①的涵蓋面還沒補齊」,不是「④期間有人亂寫」** —— 兩者處置不同。
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

**Forward 重建**(任一時點):依序重放 A1(`20260730150000`)、A4a(`20260803140000`)、**B2-S2a(`20260806100000`)**三支 migration 檔(**照時間戳序,S2a 排最後** —— 它同時負責把 A1 重放蓋掉的註解再覆寫回來) → A4a backfill 由真相重算 → 快照/divergence/received_drift 三表事後 `DROP TABLE` 歸檔或清除。
🔴 **S2a 不能漏(2026-08-06 補;漏了零告警)**:A1 只把摘要表重建成**五欄**,而 `db push` **不會重跑已登記在 ledger 的 S2a** ⇒ 摘要表永久少 `shipped_quantity` 一欄與三條 CHECK,沒有任何東西會紅。重建後必須實查 **6 欄 / 10 條 CHECK**。
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

前提逐條 yes 才跑:☐ A1+A4a+**S2a** 已重放(實查 6 欄 / 10 CHECK)☐ backfill 對帳綠 ☐ 三張證據表已處置。
(⚠️ v4 互指:若走的是 **a7 全回滾**(取消表已 DROP)⇒ A4a 永無法重放、本步前提**永不可滿足**
——回權改走 `2026-07-30-a7-rollback.md` 步 8 的 a7 專屬前提,勿在此卡死。)

```sql
GRANT EXECUTE ON FUNCTION public.admin_upsert_item_procurement(
  uuid, uuid, integer, text, text, timestamptz, text, text, date, text, text) TO service_role;
-- 驗:應回 t
SELECT has_function_privilege('service_role',
  'public.admin_upsert_item_procurement(uuid,uuid,integer,text,text,timestamptz,text,text,date,text,text)', 'EXECUTE');
```
