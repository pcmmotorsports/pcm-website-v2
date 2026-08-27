-- ============================================================
-- M-4b E10 第 1 批 · A7-t:取消帳本主從一致 CONSTRAINT TRIGGER
-- ============================================================
-- 規格:docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md §5.1 表**第 24 列(A7)**
--       —— 🔴 本片**不新增 DAG 列號**(`:398-404` 契約:69 片 = 對本表列 awk 計數)
-- 片級 plan:docs/specs/2026-07-30-e10-a7t-cancellation-consistency-trigger-plan.md(**v2 縮減版**)
-- 上游拍板:Sean 2026-07-30 §12 **Q1=A**「空明細 header 要在 DB 層擋死」⇒ 新增本片
-- 本輪拍板:Q1(退款同型洞)=C 已查證不成立 / **Q2=A TRUNCATE 不留逃生門** / Q3=A 現在做完 / 收法=A 縮減版
-- 審查:關卡1 兩輪雙模型 —— codex `gpt-5.6-sol` xhigh **NO-GO 19 must-fix + 2 nit** /
--       Fable(換模型換角度)**NO-GO 7 must-fix + 6 nit + 1 uncertain**
--       ⇒ plan **縮小範圍重寫**(v1→v2),非修補;逐條處置見 plan §2
-- 片型 T(trigger 片)= 高風險片(鐵則 12③ DB 結構)
--
-- ── 這片在擋什麼 ──────────────────────────────────────────
-- A7-1 建的兩張表目前允許「**一列 header、零列明細**」= 「這張單取消了,但沒取消任何東西」。
-- A7-1 是 M 型(純 schema)刻意不放 trigger,把這道防線整條留給本片;
-- master plan 全檔實查**無任何其他片承接**(`:349` 逐字)。
--
-- 🔴 **為什麼必須是兩支 presence trigger**(逐字沿用 `20260725130100:182-184`):
--    只掛子表的話,「插了 header 但一列明細都沒插」**永遠不會觸發任何事件** ⇒ 空 header 完全擋不住。
--    ⇒ header 表必須自己有一個 AFTER INSERT;子表那個必須含 DELETE(刪光明細後 header 會變零明細)。
--
-- 🔴 **為什麼是 DEFERRED**(逐字沿用 `:265`):RPC 會先插 header 再插明細,
--    IMMEDIATE 會在插完 header 的那一瞬間就誤擋合法流程。
--
-- 🔴 **UPDATE 必須同時驗 OLD 與 NEW**(逐字沿用 `:200-201`):
--    把某列明細從 A 改掛到 B 時,若只驗 NEW(B),A 可能因此變成零明細卻無人檢查
--    —— B 的合計仍正確、整筆交易照樣 COMMIT。
--
-- ── 不變式恰為一條(範圍界線,不得擴張)──────────────────────
-- `order_cancellations` **沒有任何金額或數量彙總欄**(`20260730130000:68-118` 逐欄核過)
-- ⇒ order_refunds 的「header 金額 = Σ 明細」在本表**無對應物**。
-- 「取消量不超原始數量」**不屬本片** —— `20260730130000:222-224` 逐字把上界責任指給
-- **A1 的 CHECK + A4a 重算 + A8a2 守門**(master plan `:352/:355/:362/:424-431` 實查確認有人接)。
-- ⇒ 本片恰驗一條:**每個存在的 order_cancellations 列,至少有一列 order_cancellation_items 指向它。**
-- ⚠️ 關聯條件 `WHERE cancellation_id = v_x` **不可省** —— 誤寫成算全表 items 時,
--    只要別的 header 有明細,空 header 就會過關(A7-t 驗收含此突變)。
--
-- ── 🔴 本片對併發的立場是「不防」而非「已防」(誠實邊界)──────
-- 關卡1 抓到並經實測確認:兩交易**各刪一列明細**時,`REPEATABLE READ` 下兩邊都放行、
-- **零明細 header 真的落地**;`FOR UPDATE` 鎖 parent **補不住**(快照過期,鎖修得了併發執行、
-- 修不了快照);`READ COMMITTED` 序列化 commit 擋得住;`SERIALIZABLE` 由 PG 自己擋。
-- **但那條路要求「有人 DELETE 或 UPDATE 取消明細」,而目前沒有任何 writer 會那樣做:**
--   · 兩表寫入授權 = 無(`20260730130000:202-203, 267-268` 只有 GRANT SELECT)
--   · **production writer 路徑**(`apps/` + `packages/`,排除測試與本片探針)對兩表的
--     `DELETE` / `UPDATE` = 零命中
--   · master plan 的寫入片:A8a1 寫 header(`:361`)、A8a2 寫 items(`:362`)、A9g 只讀(`:368`)
--   · 資料模型本身:取消是**留存的事實**;多次部分取消 = **累積新 header**,不回頭改舊列
-- 🔴🔴 **這裡的措辭必須精確(關卡2 codex 兩條 must-fix,兩條都成立)**:
--   ①「零寫入 GRANT」**不等於**「無人能刪改」—— table owner、superuser、以及
--     **A8a1/A8a2 那種 SECURITY DEFINER owner RPC** 都不受表級 GRANT 限制。
--     正確講法是「**目前沒有任何 application writer 實作**」,不是「物理上不可能」。
--   ②「全 repo 零命中」**是錯的** —— 本片自己的 `scripts/a7t-behavior-probe.sql` 就有
--     `DELETE FROM public.order_cancellation_items`(案例 3/4/5/8)。該宣稱只在
--     **production writer 路徑**這個範圍內成立,不能不加限定地講。
-- ⇒ 結論不變(現行規劃內無人刪改 ⇒ 不加鎖、不加隔離級閘),但它是**條件性**的,
--    而那個條件由下面的合約債承接 —— **A8a1/A8a2 日後若加入 UPDATE/DELETE,漏洞立即可達**。
--
-- 🔴🔴 **合約債(對未來片有約束力,不是「日後自動生效」)**
--    **日後任何片若要 DELETE 或 UPDATE `order_cancellation_items` 或 `order_refund_items`
--    的既有列,必須先補上「trigger 內鎖 parent」+「隔離級 fail-closed 閘」;
--    否則取消側與退款側的主從一致防護都會靜默失效。**
--    依據:REPEATABLE READ 下兩交易各刪一列 ⇒ 雙雙放行(本機 PG17.10 實測);鎖 parent 不足以補。
--    落點:master plan 的 **A8a2** 列與 **A7b** 列(本 commit 已落)。
--    🔴 **backlog #307 尚未寫入** —— 該檔在施工期間裝著並行 session 的未 commit 內容,
--       已刻意撤出本片 commit;承接動作見 docs/handoff/2026-07-30-a7t-consistency-trigger-handoff.md §2。
--    🔴 **A8a1/A8a2 的作者請注意**:你們是 owner RPC,表級 GRANT 擋不住你們 ——
--    只要你們對 `order_cancellation_items` 寫下第一個 `UPDATE` 或 `DELETE`,本條就從
--    「不可達」變成「當天可達」,必須同片補上鎖 parent + 隔離級閘。
--
-- ── 🔴 A7-1 的 §3.6 斷言**不改**(關卡1 兩個模型各自獨立確認)──
-- `20260730130000:526-537` 斷言「兩張新表 user trigger = 0」,而該檔 `:529` 的註解與
-- `docs/handoff/2026-07-30-a7-cancellations-handoff.md:22,35-37` 都指示「A7-t 落地後必須回頭改它」。
-- **那個指示是錯的**:
--   · 全新環境按版本序執行,A7-1 早於本片 ⇒ 它的 DO block 執行當下 trigger 確實是 0 ⇒ 斷言正確且應通過
--   · `scripts/a7-verify.sh:59` 逐字 `DROP TABLE IF EXISTS` 兩表 ⇒ trigger 隨表滅 ⇒ 重套後仍為 0
--   · A7-1 已在 production ledger ⇒ `db push` / `--include-all` 不會重跑它;
--     `.github/workflows/` 三檔無任何 migration 步驟(Fable 獵殺第三條路徑的結果)
-- ⇒ 那是**該時點**的斷言,不是**永遠**的斷言。改一支已 apply 的 migration 會讓檔案與正式站
--    跑過的東西不符,並弄壞它在全新重建路徑上本來正確的行為。
-- ⇒ 本片改為:A7-1 一行不動,**本檔自己斷言自己的終態**(每表恰 2 支、且是預期那兩支)。
--
-- ── 驗收證明什麼、不證明什麼(誠實邊界)──────────────────────
-- 本檔的 DO block 證明「四支 trigger 存在、綁對表與函式(`tgrelid`+`tgfoid`)、事件位元(`tgtype`)對、
-- **啟用中**(`tgenabled`)、**無 WHEN 條件**(`tgqual`)、DEFERRED 屬性對;兩支函式的**本體 md5 指紋**、
-- SECURITY DEFINER / search_path、以及**完整 ACL allowlist**(owner 以外零 grantee)」。
-- 🔴 **不證明行為對** —— 行為在 `scripts/a7t-behavior-probe.sql`(獨立檔、獨立交易)。
--    兩者缺一,本片不得宣稱「空明細 header 已擋住」。
-- 🔴 `pg_get_triggerdef` **完全不反映 tgenabled**(本機實測:`DISABLE TRIGGER` 後
--    數量、名稱、定義字面**三層全綠**而空 header 直接逃脫)⇒ 下方逐支斷言 `tgenabled = 'O'`。
-- ============================================================

BEGIN;

-- 建 trigger 要對兩張目標表取 SHARE ROW EXCLUSIVE。兩表現無流量(零寫入 GRANT),
-- 但沿用 A7-1 `:64-66` 的樣板、不賭。
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ══ 0. 既有資料閘:trigger **不回溯驗證**已存在的列 ══════════════════════════
-- 🔴 沒有這道閘,apply 前若已存在零明細 header,trigger 建成後所有結構斷言仍然全綠,
--    而那筆壞資料**永久留下且永遠不會被任何檢查發現**(新 trigger 只看新事件)。
--    現況兩表 0 列 ⇒ 預期空轉;但「預期空轉」和「證明過」是兩回事。
DO $$
DECLARE
  v_orphan integer;
BEGIN
  -- 🔴 **先鎖表再驗**(關卡2 codex:原版有 TOCTOU)——
  --    本 DO block 只做 SELECT,不會取得寫入互斥鎖;而 CREATE TRIGGER 的
  --    SHARE ROW EXCLUSIVE 要到 §3 才拿。中間這段窗口內,owner writer 仍可
  --    插入一筆零明細 header 並 commit ⇒ 閘通過、trigger 之後才建成
  --    ⇒ 那筆壞列**永久留存且永遠不會被任何檢查發現**(trigger 不回溯)。
  --    ⇒ 用固定順序(header → items,與後續 CREATE TRIGGER 同序,避免死鎖)先鎖死。
  LOCK TABLE public.order_cancellations, public.order_cancellation_items
    IN SHARE ROW EXCLUSIVE MODE;

  SELECT count(*) INTO v_orphan
    FROM public.order_cancellations c
   WHERE NOT EXISTS (
     SELECT 1 FROM public.order_cancellation_items i WHERE i.cancellation_id = c.id
   );

  IF v_orphan <> 0 THEN
    RAISE EXCEPTION
      'A7-t 前置失敗 — order_cancellations 已存在 % 筆零明細 header;'
      '建 trigger 只會擋住未來的事件、不會修好既有壞資料 ⇒ 先清理再套用本片',
      v_orphan;
  END IF;

  RAISE NOTICE 'A7-t 既有資料閘通過(零明細 header = 0 筆)';
END;
$$;

-- ══ 1. 主從一致性函式 ═══════════════════════════════════════════════════════
-- SECURITY DEFINER + 釘死 search_path:逐項對齊 `20260725130100:186-190`。
-- 本函式要 SELECT 兩張表,而它們對 service_role 只開 SELECT、對其他 role 全無權限;
-- definer 身分是既有決定,本片沿用而非重新論證。
-- 🔴 **刻意用 `CREATE` 而非 `CREATE OR REPLACE`**(關卡2 R2 must-fix):
--    `OR REPLACE` 會**保留既有函式的 owner 與 ACL** ⇒ 若庫裡先前存在同名函式、
--    且被授權給某個自訂 grantee,本片的 REVOKE 只收回我們列名的四個 role,
--    那個 grantee 仍能 EXECUTE 一支 SECURITY DEFINER 函式。
--    ⇒ 用 `CREATE` 讓「已存在」直接 fail-closed;驗收另加 owner 與**完整 ACL allowlist**。
CREATE FUNCTION public.pcm_assert_cancellation_has_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ids    uuid[];
  v_x      uuid;
  v_dummy  uuid;
  v_cnt    integer;
BEGIN
  -- 依觸發來源決定要驗哪些 cancellation。
  IF TG_TABLE_NAME = 'order_cancellations' THEN
    v_ids := ARRAY[NEW.id];
  ELSIF TG_OP = 'DELETE' THEN
    v_ids := ARRAY[OLD.cancellation_id];
  ELSIF TG_OP = 'UPDATE' THEN
    -- 🔴 兩個都要驗:明細從 A 改掛到 B 時,只驗 B 會讓 A 靜默變成零明細。
    v_ids := ARRAY[OLD.cancellation_id, NEW.cancellation_id];
  ELSE
    v_ids := ARRAY[NEW.cancellation_id];
  END IF;

  FOREACH v_x IN ARRAY v_ids LOOP
    -- header 已不存在(整筆取消於同交易內被刪)⇒ 該 id 無不變式可驗,跳過。
    SELECT id INTO v_dummy FROM public.order_cancellations WHERE id = v_x;
    CONTINUE WHEN NOT FOUND;

    -- 🔴 關聯條件不可省:誤寫成全表 count 時,只要別的 header 有明細,空 header 就會過關。
    SELECT count(*) INTO v_cnt
      FROM public.order_cancellation_items
     WHERE cancellation_id = v_x;

    IF v_cnt = 0 THEN
      RAISE EXCEPTION
        'order_cancellations 不變式違反 — 取消 % 沒有任何品項明細;拒繼續', v_x;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

-- ══ 2. TRUNCATE 攔截 ════════════════════════════════════════════════════════
-- 🔴 row-level trigger 對 TRUNCATE **完全不觸發**(逐字沿用 `20260725130100:255-257`):
--    owner 若 TRUNCATE 明細表,所有 header 會保留、明細歸零,上述不變式**靜默失效**。
--    service_role 已無 TRUNCATE 權(本表零寫入 GRANT),本段是對 owner 誤操作的縱深防護。
-- 🔴 **Sean 2026-07-30 拍 Q2=A:不留逃生門。** 真要清帳的那天是有人在現場的操作,
--    當下手動 DROP TRIGGER 即可;留一個旗標當逃生門 = 留一條繞過防護的常設路徑。
CREATE FUNCTION public.pcm_cancellation_ledger_block_truncate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    '取消帳本禁止 TRUNCATE(%)—— 會讓 header/明細不變式靜默失效。'
    '🔴 也不要改用逐列 DELETE:刪明細正是 backlog #307 那個併發漏洞的入口。'
    '如確需清理,走受控的 forward migration:固定順序鎖兩表 + 隔離級閘,見 #307', TG_TABLE_NAME;
END;
$$;

-- 🔴 函式 EXECUTE 收斂(逐字沿用 `20260725130100:327-334` 的理由):
--    PostgreSQL 新建 function **預設 GRANT EXECUTE TO PUBLIC**(本機實測 `proacl = NULL`
--    且 `has_function_privilege('public', ..., 'EXECUTE') = t`)。
--    `pcm_assert_cancellation_has_items` 是 SECURITY DEFINER ⇒ PUBLIC 可執行
--    = 多一個以 owner 權限起跑的入口(任何能在自有 table 上建 trigger 的 role 都能把它掛上去)。
--    ⇒ 全數 REVOKE;trigger 由表擁有者觸發、**不需要任何 role 的 EXECUTE 權限**。
REVOKE ALL ON FUNCTION public.pcm_assert_cancellation_has_items()     FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pcm_cancellation_ledger_block_truncate() FROM PUBLIC, anon, authenticated, service_role;

-- ══ 3. 四支 trigger ═════════════════════════════════════════════════════════
CREATE CONSTRAINT TRIGGER order_cancellations_items_presence_ac
  AFTER INSERT OR UPDATE ON public.order_cancellations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.pcm_assert_cancellation_has_items();

CREATE CONSTRAINT TRIGGER order_cancellation_items_presence_ac
  AFTER INSERT OR UPDATE OR DELETE ON public.order_cancellation_items
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.pcm_assert_cancellation_has_items();

CREATE TRIGGER order_cancellations_block_truncate_bt
  BEFORE TRUNCATE ON public.order_cancellations
  FOR EACH STATEMENT EXECUTE FUNCTION public.pcm_cancellation_ledger_block_truncate();

CREATE TRIGGER order_cancellation_items_block_truncate_bt
  BEFORE TRUNCATE ON public.order_cancellation_items
  FOR EACH STATEMENT EXECUTE FUNCTION public.pcm_cancellation_ledger_block_truncate();

-- ══ 4. COMMENT ══════════════════════════════════════════════════════════════
COMMENT ON FUNCTION public.pcm_assert_cancellation_has_items() IS
  'M-4b E10 A7-t:取消帳本主從一致(DEFERRED 至 COMMIT 才驗)。恰一條不變式:每個 order_cancellations 列至少有一列 order_cancellation_items。🔴 兩支 trigger 都必要 —— 只掛子表則「零明細 header」永不觸發。🔴 不含「取消量不超原始數量」—— 那條由 A1 CHECK + A4a 重算 + A8a2 守門承接(20260730130000:222-224)。🔴 對併發的立場是「不防」不是「已防」:REPEATABLE READ 下兩交易各刪一列會雙雙放行(實測),鎖 parent 補不住;現行規劃無任何片 DELETE/UPDATE 取消明細 ⇒ 觸發前提不存在。**日後任何片若要刪改 order_cancellation_items 或 order_refund_items 的既有列,必須先補鎖 parent + 隔離級 fail-closed 閘。**';

COMMENT ON FUNCTION public.pcm_cancellation_ledger_block_truncate() IS
  'M-4b E10 A7-t:取消帳本禁止 TRUNCATE。理由:row-level trigger 對 TRUNCATE 完全不觸發 ⇒ 明細歸零而 header 保留 = 不變式靜默失效。Sean 2026-07-30 拍 Q2=A:不留逃生門,真要清帳當下手動 DROP TRIGGER。';

-- ══ 5. fail-closed 結構驗收(任一條不成立 = 整片回滾)═══════════════════════
-- 🔴 本段只證明「四支存在、事件位元對、**啟用中**、函式屬性與 ACL 對」,**不證明行為對**。
--    行為在 scripts/a7t-behavior-probe.sql;可重現驗證在 scripts/a7t-verify.sh。
DO $$
DECLARE
  v_cnt        integer;
  v_rel        text;
  v_name       text;
  v_exp_type   smallint;
  v_exp_fn     text;
  v_exp_defer  boolean;
  v_type       smallint;
  v_enabled    "char";
  v_defer      boolean;
  v_initdef    boolean;
  v_qual_null  boolean;
  v_fnoid      oid;
  v_def        text;
  v_secdef     boolean;
  v_config     text[];
  v_role       text;
  v_fname      text;
  v_md5        text;
BEGIN
  -- ── 5.1 已撤(2026-08-11 #399:精確集合相等 → 包含式)──────────────────
  -- ~~原本這裡對每張表斷言「user trigger 數恰 2 且名稱集合完全相等」~~
  -- 🔴 **這是刻意反轉本片作者當初的設計決策**(原註解逐字:「用集合相等而非 count:
  --    只數數量的話,『刪掉一支、另外加一支無害的』數量仍對」),不是筆誤修正。理由:
  --    後來者往同一張表加 trigger 是**合法演進** —— A4a(`20260803140000`)就在
  --    `order_cancellation_items` 加了第三支 `..._summary_recompute_ac`(正式站實查:該表現有 3 支)。
  --    集合相等會擋掉別人的無辜片,也讓「在 HEAD 狀態重放本檔」必紅 ⇒ `scripts/a7t-verify.sh`
  --    整支跑不完 ⇒ A7-t 四支 trigger 的回歸覆蓋歸零(backlog #399)。
  -- ⇒ 改成**包含式**語意:「這四支具名 trigger 都在、且屬性正確」,不對總數與集合設上限。
  -- ⚠️ **誠實寫出放棄了什麼**(關卡2 codex must-fix,裁決型 —— 依 B-445-A 拍板保留本修法,理由記於此):
  --    本檔從此**不再管這兩張表上還有誰**。有人掛一支會讓正式站寫入中斷的 trigger,A7-t 不會擋。
  --    這不是「所有後加 trigger 都無害」的宣稱 —— 是**責任歸屬**:新 trigger 的正確性由**加它的那一片**
  --    自己的驗收負責(A4a 就是這樣做的);A7-t 只保證自己那四支還在、還是原本的樣子。
  --    集合相等本來也擋不住這件事:它在 A4a 落地那天就已經是紅的,只是紅在**重放**、不在正式站。
  --    包含式**不需要新程式**:下面 5.2 已經逐支綁 `(tgrelid, tgname)` 查、`IF NOT FOUND THEN RAISE`,
  --    再寫一段 `@>` 只是與 5.2 重複的第二把 ⇒ 這裡只留說明,判定全交給 5.2。
  --    (惡意面仍有守:5.2 逐支驗啟用態/事件位元/函式 OID/DEFERRED/無 WHEN,5.3 驗本體指紋與 ACL。)
  -- 三條件(主視窗 2026-08-11 裁定,B-445-A):①本檔已 apply 到正式站、DO block 早已執行完
  --    ⇒ 改檔不會回頭動正式站 ②ledger 漂移比對的是 `schema_migrations` **版本號**不是內容雜湊
  --    ⇒ 改內容不造成帳本不一致 ③本次改動過審查(codex 關卡1 + code-reviewer)。

  -- ── 5.2 逐支斷言(🔴 **每一條都綁 tgrelid + tgname**)──────────
  -- 🔴 關卡2 codex 抓到三個逃脫路徑,以下逐一封死:
  --    ①原版只比 `proname` ⇒ trigger 可以綁 `evil.pcm_assert_cancellation_has_items()`
  --      這支同名 no-op,而 public 底下正確那支原封不動 ⇒ 函式屬性與 ACL 斷言全綠。
  --      ⇒ 改比 **`tgfoid` 對 `regprocedure`**(schema + 名稱 + 參數型別一次到位)。
  --    ②原版 DEFERRED 屬性用「全資料庫查這兩個 tgname」計數、**沒綁目標表**
  --      ⇒ 把目標那支改 INITIALLY IMMEDIATE、在別的表放一支同名 deferred 誘餌,計數仍是 2。
  --      ⇒ 改成逐支(tgrelid + tgname)各自斷言。
  --    ③原版**完全沒看 `tgqual`** ⇒ 四支各加一個 `WHEN (false)`,
  --      名稱、tgtype、tgenabled、綁定函式、deferred 屬性**全部正確**,而它們永遠不會排隊執行。
  --      ⇒ 斷言 `tgqual IS NULL`。
  -- tgtype 位元(src/include/catalog/pg_trigger.h):ROW=1 BEFORE=2 INSERT=4 DELETE=8 UPDATE=16 TRUNCATE=32
  --   presence(header)  = ROW + AFTER + INSERT + UPDATE          = 21
  --   presence(items)   = ROW + AFTER + INSERT + DELETE + UPDATE = 29
  --   truncate 攔截      = STATEMENT + BEFORE + TRUNCATE          = 34
  --   (三個常數為**本機 PG17.10 實測值**,非憑記憶推算。)
  FOR v_rel, v_name, v_exp_type, v_exp_fn, v_exp_defer IN
    SELECT * FROM (VALUES
      ('order_cancellations',      'order_cancellations_items_presence_ac',
       21::smallint, 'public.pcm_assert_cancellation_has_items()',      true),
      ('order_cancellation_items', 'order_cancellation_items_presence_ac',
       29::smallint, 'public.pcm_assert_cancellation_has_items()',      true),
      ('order_cancellations',      'order_cancellations_block_truncate_bt',
       34::smallint, 'public.pcm_cancellation_ledger_block_truncate()', false),
      ('order_cancellation_items', 'order_cancellation_items_block_truncate_bt',
       34::smallint, 'public.pcm_cancellation_ledger_block_truncate()', false)
    ) AS t(rel, nm, ty, fn, df)
  LOOP
    SELECT t.tgenabled, t.tgtype, t.tgfoid, t.tgdeferrable, t.tginitdeferred, (t.tgqual IS NULL)
      INTO v_enabled, v_type, v_fnoid, v_defer, v_initdef, v_qual_null
      FROM pg_trigger t
     WHERE t.tgrelid = ('public.' || v_rel)::regclass
       AND t.tgname = v_name
       AND NOT t.tgisinternal;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'A7-t 驗收失敗 — 表 % 上找不到 trigger %', v_rel, v_name;
    END IF;

    -- 🔴 本條的存在理由:DISABLE / ENABLE REPLICA 之後 tgenabled 變 'D'/'R',
    --    而數量、名稱、pg_get_triggerdef **三者完全不變**(本機實測)⇒ 防線死了而驗收全綠。
    --    'O'=origin(啟用) 'D'=disabled 'R'=replica only 'A'=always
    IF v_enabled <> 'O' THEN
      RAISE EXCEPTION 'A7-t 驗收失敗 — %.% 的 tgenabled = %(預期 O);定義字面不反映此欄,只有本條抓得到',
        v_rel, v_name, v_enabled;
    END IF;

    IF v_type <> v_exp_type THEN
      RAISE EXCEPTION 'A7-t 驗收失敗 — %.% 的 tgtype = %,預期 %(事件集合或 ROW/STATEMENT 被改)',
        v_rel, v_name, v_type, v_exp_type;
    END IF;

    IF v_fnoid <> v_exp_fn::regprocedure::oid THEN
      RAISE EXCEPTION 'A7-t 驗收失敗 — %.% 綁的是 %,預期 %(只比函式名會被同名異 schema 的 no-op 騙過)',
        v_rel, v_name, v_fnoid::regprocedure::text, v_exp_fn;
    END IF;

    IF v_defer <> v_exp_defer OR v_initdef <> v_exp_defer THEN
      RAISE EXCEPTION 'A7-t 驗收失敗 — %.% 的 deferrable/initdeferred = %/%,預期 %/%'
        '(presence 必須 DEFERRABLE INITIALLY DEFERRED;IMMEDIATE 會讓合法的「先 header 後明細」流程當場斷掉)',
        v_rel, v_name, v_defer, v_initdef, v_exp_defer, v_exp_defer;
    END IF;

    IF NOT v_qual_null THEN
      RAISE EXCEPTION 'A7-t 驗收失敗 — %.% 帶有 WHEN 條件(tgqual 非 NULL);'
        '一個 WHEN (false) 可以讓其餘所有斷言全綠而 trigger 永不執行', v_rel, v_name;
    END IF;
  END LOOP;

  -- ── 5.3 函式屬性 / 本體指紋 / 完整 ACL(🔴 全部綁 regprocedure)──────────
  -- 🔴 關卡2 R2:原版這幾段仍用 `proname` 查 ⇒ **同 schema 的 overload**
  --    (例如多一支帶參數的同名函式)可以當指紋誘餌,而零參數那支本體被改成 no-op
  --    仍可能通過。⇒ 改用 `'public.f()'::regprocedure::oid` 精確指名那一支。
  FOR v_fname, v_md5 IN
    SELECT * FROM (VALUES
      ('public.pcm_assert_cancellation_has_items()',      '9356c3ecc4484b2340b8ac5b9bf0d766'),
      ('public.pcm_cancellation_ledger_block_truncate()', 'b77248da6b576aa9c350280a19a936f5')
    ) AS t(fn, h)
  LOOP
    SELECT p.oid INTO v_fnoid FROM pg_proc p WHERE p.oid = v_fname::regprocedure;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A7-t 驗收失敗 — 找不到 %', v_fname;
    END IF;

    -- 本體指紋逐字元釘死(同 N3a 的自指指紋守門)。
    -- ⚠️ 代價寫明:日後任何合法修改都必須同批更新這個常數 —— 這是刻意的,
    --    帳本層的 SECURITY DEFINER 函式不該被無聲改掉。
    -- ⚠️ 它**不證明語意對**,只證明「與審查過的那一版逐字元相同」;語意由行為探針負責。
    IF md5((SELECT prosrc FROM pg_proc WHERE oid = v_fnoid)) <> v_md5 THEN
      RAISE EXCEPTION 'A7-t 驗收失敗 — % 的本體指紋 = %,預期 %'
        '(函式被改過;若是刻意修改,請同批更新本常數並重跑 scripts/a7t-verify.sh)',
        v_fname, md5((SELECT prosrc FROM pg_proc WHERE oid = v_fnoid)), v_md5;
    END IF;

    -- 🔴 **完整 ACL allowlist**(關卡2 R2):原版只逐一問四個具名 role,
    --    自訂 grantee(例如既有函式殘留的授權)整個漏掉。
    --    ⇒ 改成「除了 owner 以外,任何 grantee 都不允許」。
    SELECT count(*) INTO v_cnt
      FROM pg_proc p, aclexplode(p.proacl) a
     WHERE p.oid = v_fnoid AND a.grantee <> p.proowner;
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION 'A7-t 驗收失敗 — % 的 ACL 有 % 個 owner 以外的 grantee;'
        '新建 function 預設 GRANT EXECUTE TO PUBLIC,必須全數 REVOKE', v_fname, v_cnt;
    END IF;

    -- 保留四個具名 role 的顯式否定斷言(allowlist 之外的第二層,訊息比較好讀)
    FOREACH v_role IN ARRAY ARRAY['public','anon','authenticated','service_role'] LOOP
      IF has_function_privilege(v_role, v_fnoid, 'EXECUTE') THEN
        RAISE EXCEPTION 'A7-t 驗收失敗 — % 對 % 仍有 EXECUTE', v_role, v_fname;
      END IF;
    END LOOP;
  END LOOP;

  -- presence 函式的兩個安全屬性(truncate 攔截函式不需要 SECDEF)
  SELECT p.prosecdef, p.proconfig INTO v_secdef, v_config
    FROM pg_proc p WHERE p.oid = 'public.pcm_assert_cancellation_has_items()'::regprocedure;
  IF NOT v_secdef THEN
    RAISE EXCEPTION 'A7-t 驗收失敗 — pcm_assert_cancellation_has_items 不是 SECURITY DEFINER';
  END IF;
  IF v_config IS NULL OR NOT ('search_path=public, pg_temp' = ANY(v_config)) THEN
    RAISE EXCEPTION 'A7-t 驗收失敗 — pcm_assert_cancellation_has_items 的 search_path 未釘死(proconfig = %)', v_config;
  END IF;

  RAISE NOTICE 'A7-t 結構驗收全數通過(四支 trigger 綁表逐支比對:啟用態/事件位元/函式 OID/DEFERRED/無 WHEN 條件;函式屬性、本體指紋與 ACL 收斂)';
END;
$$;

COMMIT;
