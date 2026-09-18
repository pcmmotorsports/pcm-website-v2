-- 20260917010000-rollback.sql —— 退回 20260917010000_m4b_pcm_readonly_grant_four_tables.sql
-- M-4b · 窗 B(後台, worktree pcm-ops)· 2026-09-18 補寫
--
-- ══ 為什麼今天才有這支檔 ═══════════════════════════════════════════════════
-- a1 2026-09-18 抽查:`supabase/rollbacks/20260917010000-rollback.sql` **不存在**(全樹 find 也找不到)。
-- 帳本敘述逐字:「還原檔 207r 是**主視窗從本檔檔尾 rollback 區塊逐字抽出來的**, 不是原作者寫的可執行檔」
-- ⇒ 📌 **那份東西從來沒有進 repo** —— 而「檔尾有一段註解」與「有一支退得動的檔」是兩件事。
-- Sean 2026-09-18 拍甲「補一支」。
--
-- 🔵 **本檔的 SQL 是從那支 migration 的檔尾區塊【逐字抽出來】的**(程式抽, 剝掉 `-- ` 前導),
--    不是我重寫的 —— 那段本身過了 R1 審查, 兩道閘的設計我一個字沒動。
--
-- ══ 🔴🔴 那句【未核】我核掉了, 而答案讓那道閘從「保險」變成「承重」═══════
-- 原檔尾逐字:「一行表級 `REVOKE SELECT` 會不會連帶把該表的欄級也收掉?
--   ⚠️ **審查者說會(PG 的 REVOKE 語意), 而我查不到權威出處也沒有實測 ⇒ 逐字標【未核】。**」
--
-- 🔬 **2026-09-18 拋棄式 PG 17.10 實測(帶正負對照), 答案是【會】**:
--    ```
--    只 GRANT SELECT (a) ON t TO r   —— 【不給表級】
--      欄 a attacl ⇒ {r=r/postgres}        ⚪ 負對照 欄 b attacl ⇒ (NULL)(沒給過)
--      表級 has_table_privilege ⇒ f        ← 確認它真的沒有表級
--    下一句 REVOKE SELECT ON t FROM r —— 【表級】
--      欄 a attacl ⇒ (NULL)                has_column_privilege(a) ⇒ f
--    ```
--    ⇒ 🎯 **表級 REVOKE 會連帶收掉欄級, 連那個角色【從來沒有表級權限】時也照收。**
--    ⚠️ 而我第一發的負對照是假的:用「另一欄 has_column_privilege」當對照 ⇒ 收之前回 `t`,
--       因為**表級權限本來就涵蓋所有欄**。⇒ 改用 `attacl` 才分得出「有沒有給過欄級」。
--       📌 **一個在兩個世界都回 t 的對照組, 不是對照組。**
--
-- ⇒ 🔴 **所以下面那道「零欄級」前置閘是【承重的】, 不是保險**:
--    若哪天有人給了這四張任何一欄的欄級 SELECT, 這支檔的四行表級 REVOKE **會把它一起收掉**,
--    而那不是本片給的東西。⇒ 前置閘不是就停。**不要為了讓它跑得動而放寬那一條。**
--
-- 🔬 **而今天不會踩到**(2026-09-18 唯讀正式庫實查):
--    · 那四張上 `attacl IS NOT NULL` 的欄 ⇒ **0 個**
--    · 🟢 正對照:全庫看得到欄級授權(`customers` 12 欄, 例如 `email {service_role=w,authenticated=r}`)
--      ⇒ **這把尺看得見欄級, 0 是真的 0**
--    · 🟢 正對照二:那四張的 relacl 都含 `pcm_readonly=r/postgres` ⇒ 板 207 確實貼過
--    · ⚪ 負對照:編造的表名 ⇒ 0 列
--
-- ══ 🛑 這支檔擋不住什麼 ═══════════════════════════════════════════════════
-- · 事後閘用 `has_table_privilege` ⇒ 它答的是「**還讀不讀得到**」, 不是「acl 那一列沒了」。
--   若 pcm_readonly 從別條路(角色繼承 / PUBLIC)也拿得到 SELECT, 這道會紅而 REVOKE 其實成功了。
--   🔵 那是**fail-closed 的方向**(紅了不會誤以為成功), 而訊息會指錯原因 ⇒ 寫在這裡。
-- · 它不動任何一列資料:GRANT / REVOKE 只改 catalog。
-- · 退完之後 `readonly-prod-sql.sh` 對這四張會回到 permission denied
--   —— 本片之前沒有任何程式用 pcm_readonly 讀它們, 所以不會壞掉在跑的東西。
--
-- 🛑 **本次沒有真的退任何東西。** 這支檔是把退路補起來, 不是用它。

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $rb$
DECLARE v_bad text;
BEGIN
  -- 還原前置閘 🔴 四張上 pcm_readonly 的直接授權必須【剛好】是那四列表級 SELECT、零欄級
  IF (SELECT count(*) FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace,
             LATERAL aclexplode(coalesce(c.relacl, acldefault('r'::"char", c.relowner))) a
       WHERE n.nspname = 'public'
         AND c.relname IN ('home_banners','supplier_inbound_emails',
                           'pcm_net_exposure_snapshot','shipment_order_ship_clearances')
         AND a.grantee = 'pcm_readonly'::regrole
         AND a.privilege_type = 'SELECT' AND NOT a.is_grantable) <> 4
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute at
                  JOIN pg_catalog.pg_class c ON c.oid = at.attrelid
                  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace,
                       LATERAL aclexplode(at.attacl) a
                 WHERE n.nspname = 'public'
                   AND c.relname IN ('home_banners','supplier_inbound_emails',
                                     'pcm_net_exposure_snapshot','shipment_order_ship_clearances')
                   AND at.attnum > 0 AND NOT at.attisdropped
                   AND a.grantee = 'pcm_readonly'::regrole)
  THEN
    RAISE EXCEPTION '還原前置閘:四張上的授權不是【剛好本片那四列】⇒ 停 —— 中間有人動過, 還原會刪到不是我們給的東西';
  END IF;
END
$rb$;

REVOKE SELECT ON TABLE public.home_banners                   FROM pcm_readonly;
REVOKE SELECT ON TABLE public.supplier_inbound_emails        FROM pcm_readonly;
REVOKE SELECT ON TABLE public.pcm_net_exposure_snapshot      FROM pcm_readonly;
REVOKE SELECT ON TABLE public.shipment_order_ship_clearances FROM pcm_readonly;

DO $rbp$
DECLARE v_bad text;
BEGIN
  -- 還原事後閘 🔴 四張都要變回讀不到 —— 這一道抓的是上面②那個【靜默無效】
  SELECT string_agg(v.t, ', ') INTO v_bad FROM (VALUES
    ('public.home_banners'), ('public.supplier_inbound_emails'),
    ('public.pcm_net_exposure_snapshot'), ('public.shipment_order_ship_clearances')
  ) v(t) WHERE has_table_privilege('pcm_readonly', v.t, 'SELECT');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '還原事後閘:這幾張還是讀得到 ⇒ REVOKE 沒有生效(多半是 grantor 不吻合)⇒ 回滾:%', v_bad;
  END IF;
  -- 🟢 正對照:orders 不該被這一發影響
  IF NOT has_table_privilege('pcm_readonly', 'public.orders', 'SELECT') THEN
    RAISE EXCEPTION '還原事後閘:正對照 public.orders 也被收掉了 ⇒ 還原動到了不該動的東西 ⇒ 回滾';
  END IF;
END
$rbp$;

COMMIT;
