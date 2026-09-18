-- 20260918060000-rollback.sql —— 退回 20260918060000_m4b_revoke_pcm_readonly_five_tables.sql
-- M-4b · 窗 B(後台, worktree pcm-ops)
--
-- ⛔ ~~本檔原本退的是【一張表】(`..._saved_order_views.sql`)~~
-- 🔴 **2026-09-18 夜, 正片範圍從一張擴成五張(Sean Q1 / Q2 拍甲)⇒ 本檔跟著擴。**
--    **舊字面留著不刪** —— 下一個人要看得出它被擴過。
--
-- ═══ 本檔做什麼 ═════════════════════════════════════════════════════════════
-- **把那【五條】GRANT 加回去。** 正片收掉了它們, 本檔還原它們。
--   `admin_saved_order_views` · `order_cancellation_items` · `order_cancellations`
--   `order_item_costs` · `payment_charge_attempts`
--
-- 🔵 **與前一片(`20260918050000-rollback.sql`)【剛好相反】, 不要照抄** ——
--    那一片的正片是 no-op ⇒ 它的還原檔**刻意什麼都不做**。
--    **本片的正片真的改了 ACL ⇒ 本檔真的要動手。**
--    📌 判別句:**還原檔該不該動手, 看的是【正片有沒有改變狀態】, 不是「它是不是 migration」。**
--
-- ═══ 🔴 還原【不是免費的】—— 它把那些洞打回來 ═══════════════════════════════
-- 🔴 **而五張的「洞」不是同一種, 分開講**:
--
--  ① `admin_saved_order_views`:正片收的是一條**沒人決定過、查不到誰加的**授權,
--     而 `20260828080000` 逐字寫著「本表**刻意零 GRANT**」(在 **`:189`** —— ⚠️ R1 N1 更正:
--     我原本把它歸給 `:194-197`, 那一段是另一句)與「**私有性是 trust boundary, 不簡化**」(`:197`)。
--     ⇒ 還原它 = **知情地把那條授權放回去**。
--
--  ② `payment_charge_attempts` / `order_cancellations` / `order_cancellation_items`:
--     🔴 這三張上面**還有一道會叫的守門**:`scripts/a9g2-charge-attempts-grant-guard.test.ts`
--     守「全庫 migration 裡提到這三張的 GRANT 只准那一句 `TO service_role`」。
--     ⇒ 🛑 **本檔的那三句 `GRANT … TO pcm_readonly` 落在 `supabase/rollbacks/`,**
--        **而那道守門只掃 `supabase/migrations/` ⇒ 它【掃不到本檔】。**
--        📌 **所以本檔跑下去, 不會有任何測試變紅。** 照實寫, 不要以為有人在守。
--     🔴 而那三張 RLS enable + 對 `pcm_readonly` **零 policy** ⇒ 還原之後, 哪天有人拿掉
--        `pcm_readonly` 的 `BYPASSRLS`, 它就**讀到空陣列且不報錯**(fail-open)。
--        ⇒ **還原 = 把那條「離洞只有一個角色屬性」的路重新接上。**
--
--  ③ `order_item_costs`:正片收它是**推翻** 2026-09-14 的一個決定(`20260914010000:109`)。
--     ⇒ 🔴 **還原它 = 再推翻一次**, 回到「查帳唯讀帳號讀得到進貨成本」的狀態,
--       而那與「成本只給老闆看」(`is_manager` 閘)是矛盾的。
--     ⇒ 🛑 跑本檔之前, 這一條要單獨想一次:**你要止的血, 真的包含這一張嗎?**
--       本檔**沒有**提供「只還原其中幾張」的開關 —— 要那樣做請手動只跑你要的那幾句 GRANT,
--       並且**把下面的斷言一起改掉**(它斷言五條全回來)。
--
-- ⇒ 🛑 **跑本檔 = 知情地把那五條授權放回去。** 只有在「真的有人在用、而現在壞了」時才跑。
-- ⇒ 📌 判別句:**還原是為了「止血」, 不是為了「回到熟悉的樣子」。**
--
-- ═══ 為什麼這些句子是安全的 ═════════════════════════════════════════════════
-- 🔬 2026-09-18 拋棄式 PG 17.10 實測:**把已經有的權限再 GRANT 一次, `relacl` 逐字相同**
--    ⇒ 本檔**重複跑是 no-op**, 不會越補越多。
--
-- 🔴🔴 **而「還原之後 = 原狀」這句話, 只對【權限集合】成立, 對【relacl 字串】不成立。**
--    🔬 2026-09-18 拋棄式 PG 實測, 同一張表跑「正片 ⇒ 本檔」之後:
--      貼之前 `{postgres=arwdDxtm/postgres,pcm_readonly=r/postgres,service_role=r/postgres}`
--      還原後 `{postgres=arwdDxtm/postgres,service_role=r/postgres,pcm_readonly=r/postgres}`
--      ⇒ **同樣三條權限, 而 `pcm_readonly` 被排到最後** —— PostgreSQL 的 `relacl` 是**陣列**,
--        收掉再給回來, 那一項會**接在尾端**, 不會回到原本的位置。
--    ⇒ 🛑 **任何拿 `relacl::text` 逐字比對的漂移偵測, 還原之後【會叫】, 而那個紅是【假的】。**
--      ✅ 要比就比 `aclexplode` 展開後的集合(本檔的斷言就是這樣寫的), 不要比字串。
--    ⇒ 📌 **判別句:「一模一樣」要先講清楚是【哪一個層次】的一模一樣。**
--      我原本在 plan 裡寫「還原之後的 acl 會與貼之前逐字相同」—— **那句話是我自己量出來假的。**
--    🔵 **而今夜實查給了這句話一個獨立佐證**:五張今天的 relacl 裡,
--      `admin_saved_order_views` 是 `…,pcm_readonly=r,service_role=r`,
--      另外四張是 `…,service_role=r,pcm_readonly=r` —— **同樣的權限, 兩種排序。**
--      ⇒ 📌 **順序本來就不是語意的一部分, 而字串比對會把它當成語意。**
-- 🔵 **會**回到原狀的:`is_grantable`(原本是 `r` 不是 `r*`)與 `grantor`
--    (superuser 執行 GRANT 視同 owner 執行 ⇒ 仍是 `/postgres`;⚠️ 前提是今天那五列確實是 `/postgres`
--     —— 2026-09-18 夜正式庫實查:五張的 `pcm_readonly` 與 `service_role` 兩列 grantor 皆 `postgres`)。
-- 🛑 **不會**回到原狀的另一樣:**欄級授權** —— 表級 REVOKE 會連帶收掉同一個 grantee 的欄級,
--    而本檔**只補表級**。正片前置閘④-d 把「本表有欄級授權」擋在門外(2026-09-18 夜實查五張皆 0 欄),
--    所以那個世界走不到這裡 ⇒ **它在射程外, 不是被處理了。**
-- 🔬 而 `GRANT` 對目標表**零筆鎖**(同一輪實測)⇒ 止血可以馬上跑, 不必等離峰。
--
-- ═══ 🛑 本檔【不】還原 `service_role` 的任何東西 ════════════════════════════
-- 正片沒碰它(正片前置閘④-c + 後置【沒連累·格1】兩邊都證過)⇒ 本檔也不碰。
-- ⛔ ~~📌 **還原檔的射程 = 正片的射程。**~~
-- 🔴 **那句話 2026-09-19 被 R3 量出來是【假的】(MF2), 舊字面留著。**
--   實查:`單獨貼 / 外層交易` 本檔 **0 次**(正片 5)· `並行 / 沒有別人正在` **0 次**(正片 4)
--   · 後置的 `v_reg IS NULL` **0 次**(正片 1)。⇒ **三格全缺, 而那句話寫得像已經對齊了。**
-- ✅ **這一輪把三格都補了。而正確的說法是**:
--   **「本檔【不擴張】正片的射程」** —— 而它**做得出正片拒絕動手的狀態**
--   (同一 grantee 兩列不同 grantor ⇒ 正片 ④-b 的 `n_ro <> 1` 會擋, 本檔補得出來)
--   ⇒ 📌 **兩支檔的射程【本來就不相等】, 硬寫成相等才是那句話真正的錯。**
-- 🛑 而原則不變:正片沒改的, 本檔不准「順便修一下」。
--
-- ═══ 🔵 跑完之後要做的 ══════════════════════════════════════════════════════
-- 正片的 ACL 變更會進 `pcm_acl_digest` ⇒ **還原也會**。跑完同樣要:
--   SELECT public.pcm_acl_digest_record();
--   SELECT public.pcm_acl_approve_latest('跑了 20260918060000-rollback:把 pcm_readonly 在那五張的表級 SELECT 加回去, 理由:<寫下來>');
--   SELECT * FROM public.pcm_acl_drift_status;
-- 🛑 **順序不能反**(理由與正片同)。

-- ═══ ⚠️ **本檔必須【整支在同一個 transaction 裡】、而且【單獨跑】(R3 MF2(ii))** ═══
-- ⛔ ~~本檔原本對這件事一個字都沒有~~ —— 而正片講了五處。
-- 🔴 **而本檔的形狀與正片一模一樣, 它還是【壓力下被貼的那一支】。**
--
-- · 後置用 `current_setting(..., true)` 讀前置用 `set_config(..., true)` 存的值,
--   而那個 `true` 是 **transaction-local** ⇒ 剝掉 `BEGIN`/`COMMIT` 逐句跑 ⇒ 後置⓪ 會叫,
--   而那時**五句 GRANT 已經各自 autocommit** ⇒ 是「做了才叫」, 不是「什麼都沒發生」。
-- · 🛑 **反方向更糟**:本檔被**包在外層交易裡**跑時, 開頭 `BEGIN;` 只印 WARNING,
--   而檔尾 `COMMIT;` 會提交**外層**那個交易 ⇒ 本檔想要的原子性在那個模式下是假的,
--   而且會**順手提交同批裡別人的東西**。
-- ⇒ ✅ **本檔要單獨貼進 SQL Editor, 不要包在別的東西裡, 也不要與別人同時跑。**

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $pre$
DECLARE
  v_tables text[] := ARRAY[
    'admin_saved_order_views',
    'order_cancellation_items',
    'order_cancellations',
    'order_item_costs',
    'payment_charge_attempts'
  ];
  v_t text; v_reg oid; n_checked int := 0; n_present int := 0; n_aclrows int; n_foreign int;
BEGIN
  IF pg_catalog.array_length(v_tables, 1) IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION '還原前置閘:名單不是 5 個 ⇒ 本檔與正片的範圍對不上 ⇒ 停下';
  END IF;
  IF pg_catalog.to_regrole('pcm_readonly') IS NULL THEN
    RAISE EXCEPTION '還原前置閘:角色 pcm_readonly 不存在 ⇒ 沒有東西可以還原給它 ⇒ 停下';
  END IF;

  FOREACH v_t IN ARRAY v_tables LOOP
    v_reg := pg_catalog.to_regclass('public.' || v_t);
    IF v_reg IS NULL THEN
      RAISE EXCEPTION '還原前置閘[%]:public.% 不存在 ⇒ 停下(要還原的不只是一條權限了)', v_t, v_t;
    END IF;

    -- 🔴🔴 **【你是誰】—— R3 MF1。與正片 ④-a2 同一道, 而在這裡【更貴】。**
    --   `GRANT` 只寫得進「執行者當得成的那個 grantor」的列。執行者若當不成 owner:
    --     · 五句 GRANT **各自多長一列**(grantor 記成執行者)
    --     · ⇒ 分母 `後 = 前 + (5 - n_present)` **對不上** ⇒ **整發 ROLLBACK, 一張都沒還原**
    --     · ⇒ 而訊息說「本檔動到的不是剛好那五張」—— **它動的就是那五張。**
    --   🛑 **而這是【止血路徑】** —— 正片擋下來只是「今晚不貼」;
    --     **本檔擋下來是「血還在流, 而工具指著錯的方向」。**
    --   ⚪ 今天恆綠(owner = `postgres`, 貼法是 SQL Editor)—— 它守的是「哪天換個身分跑」。
    IF NOT pg_catalog.pg_has_role(
             current_user,
             (SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = v_reg),
             'USAGE') THEN
      RAISE EXCEPTION '還原前置閘[%]:你現在是【%】, 而 % 的 owner 是【%】—— 你不是它、不是它的成員、也不是 superuser ⇒ 你下的 GRANT 會**另外長一列**(grantor 記成你), 而下面那道分母會因此對不上 ⇒ **整發回滾、一張都沒還原** ⇒ 停下, 換一個當得成 owner 的身分再跑。',
        v_t, current_user, v_t,
        (SELECT pg_catalog.pg_get_userbyid(c.relowner) FROM pg_catalog.pg_class c WHERE c.oid = v_reg);
    END IF;

    -- 🔵 已經在了 ⇒ 數起來、印出來, 而**不擋**。
    --    理由:重複 GRANT 是 no-op ⇒ 讓它跑完比擋下來安全,
    --    而「它本來就在」這件事讀的人要知道 —— 否則他會以為是本檔補回來的。
    --
    -- 🔴🔴 **R2 MF2:這把尺【不能只問「有沒有那一列」】—— 要問「是不是 owner 授的那一列」。**
    --   `relacl` 是按 **(grantor, grantee, privilege)** 存的 ⇒ **「有一列」≠「再 GRANT 一次是 no-op」**。
    --   既有那列若由**別人**授出, 我們(owner / superuser)下的 GRANT 會**再長一列** ⇒ 該表 aclexplode 1⇒2。
    --   ⛔ ~~舊版只問 EXISTS~~ ⇒ 那張表被算成 present ⇒ 期望式少算 1
    --     ⇒ 🔴 **後置分母不成立 ⇒ 整支 ROLLBACK ⇒ 一張都沒還原,而訊息說「動到的不是剛好那五張」。**
    --   🔬 實燒(PG 17.10, R2 提出、我複現):正片貼完後由 `second_granter` 補回 `order_item_costs`
    --     ⇒ 前置印「已經在的有 1 張 ⇒ 後置要看到 8」⇒ 後置實得 9 ⇒ 拒 COMMIT, **止血失敗**。
    -- 🛑 **而這一格在【止血路徑】上 —— 它出錯的代價比正片高:**
    --   正片擋下來只是「今晚不貼」;**本檔擋下來是「血還在流而工具說它動到了別的東西」。**
    -- ✅ **改法(R2 的甲案)**:只把「**由本表 owner 授出**」那一列算成 present,
    --   與正片 ④-b 用的是**同一把尺**(`a.grantor = c.relowner`)。
    --   ⇒ 只有別人授的那種 ⇒ 算「不在」⇒ 我們的 GRANT 確實會 +1 ⇒ 期望式自然成立。
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c, LATERAL pg_catalog.aclexplode(c.relacl) a
       WHERE c.oid = v_reg
         AND a.grantee = pg_catalog.to_regrole('pcm_readonly')
         AND a.privilege_type = 'SELECT'
         AND a.grantor = c.relowner) THEN
      n_present := n_present + 1;
      RAISE NOTICE '🔵 % 那條授權【本來就在】(owner 授的)—— 這一張本檔是 no-op(正片沒貼, 或已經被別人還原過)。', v_t;
    END IF;

    -- ⚠️ 🔴 **而「別人授的那一列」要【出一聲】—— 它不影響分母, 而它影響【你以為你還原了什麼】。**
    --   那一列本檔碰不到(正片也收不掉它, 見正片 ④-b)⇒ 它**在還原前後都在**。
    SELECT count(*) INTO n_foreign
      FROM pg_catalog.pg_class c, LATERAL pg_catalog.aclexplode(c.relacl) a
     WHERE c.oid = v_reg
       AND a.grantee = pg_catalog.to_regrole('pcm_readonly')
       AND a.privilege_type = 'SELECT'
       AND a.grantor <> c.relowner;
    IF n_foreign <> 0 THEN
      RAISE NOTICE '⚠️ % 上另有 % 列 pcm_readonly 的 SELECT 是【別人授的】(grantor ≠ owner)⇒ 本檔碰不到它, 正片也收不掉它 ⇒ 它在還原前後都在。🛑 這表示那張表的授權形狀已經不是本片假設的樣子 ⇒ 跑完請找人看。', v_t, n_foreign;
    END IF;
    n_checked := n_checked + 1;
  END LOOP;

  IF n_checked <> 5 THEN
    RAISE EXCEPTION '還原前置閘:逐表只跑了 % 圈(應該是 5)⇒ 停下', n_checked;
  END IF;

  -- 🔴🔴 **獨立分母(R1 MF4 補)** —— 正片有、本檔原本【沒有】。
  --   正片檔頭逐字說那道閘「**是這個設計成立的條件, 不是裝飾**」, 而本檔用同一個迴圈結構、
  --   同一組寫死的五句動作, 卻只留了 `n_checked`。
  --   🔬 **R1 實燒出來的失敗情境(鏡像自正片那一發)**:本檔多一句
  --     `GRANT SELECT ON public.<名單外的表> TO pcm_readonly`
  --     ⇒ 逐表 EXISTS 全過 · `n_checked = 5` 全過 · 印 ✅ ⇒ **沒有任何東西會叫。**
  --   🛑 **而本檔是【止血時在壓力下跑的那一支】** —— 少一道分母的代價在那個時刻最大。
  --   📌 期望:`後 = 前 + (5 - n_present)` —— 本來就在的那幾張是 no-op, 不該算進增量。
  --
  -- 🔴🔴 **R3 MF2(i):這道分母有一個【前提】, 而 R1 MF4 把分母抄過來、把前提留在正片。**
  --   正片在同一道分母旁邊逐字寫過:「它有一個前提:**貼的當下沒有別人在動 `pcm_readonly` 的授權**」
  --   以及「🛑 **一個依賴要寫在【被依賴的那一端】—— 寫在依賴方, 刪的人看不到。**」
  --   ⇒ 🔴 **而我把那句話抄漏了, 這正是它自己在講的那個病。**
  --   🔬 **具體情境(不是假想 —— 這一週正在做的事)**:止血當下另一個窗正在貼別的
  --     `pcm_readonly` 授權(姊妹片 `20260918050000` **一發就是 61 句 GRANT**)
  --     ⇒ 全域列數被別人推動 ⇒ 本檔分母對不上 ⇒ **整發 ROLLBACK ⇒ 血還在流。**
  --   🛑 **所以「本檔要單獨跑、跑之前確認沒有別人正在貼」不是客套話, 是【這道閘成立的條件】。**
  --
  -- ⚠️ **而下面那句失敗訊息, 今天至少有【三個】成因, 它只列一個(R3 MF2)**:
  --     ① **並行**:別人同時在動 `pcm_readonly` 的授權(上面這一格)
  --     ② **身分**:執行者當不成 owner ⇒ 五句 GRANT 各多長一列(前置那道 `pg_has_role` 閘擋的就是它)
  --     ③ **別人授的那一列**:`n_present` 那把尺已經處理, 而形狀變了本來就該找人看
  --   ⇒ ✅ 訊息裡把三個都列出來, 不要讓讀的人只往一個方向找。
  SELECT count(*) INTO n_aclrows
    FROM pg_catalog.pg_class c, LATERAL pg_catalog.aclexplode(c.relacl) a
   WHERE a.grantee = pg_catalog.to_regrole('pcm_readonly') AND a.privilege_type = 'SELECT';
  PERFORM pg_catalog.set_config('pcm.rb_aclrows_pre', n_aclrows::text, true);
  PERFORM pg_catalog.set_config('pcm.rb_present_pre', n_present::text, true);
  RAISE NOTICE '🔵 還原前置:貼前 pcm_readonly 表級 SELECT 共 % 列, 其中這五張已經在的有 % 張 ⇒ 後置要看到 % 列。', n_aclrows, n_present, n_aclrows + (5 - n_present);
  -- 🔴 **五張全都已經在 ⇒ 本檔整支是 no-op。照實印, 不要讓人以為他止到血了。**
  IF n_present = 5 THEN
    RAISE NOTICE '🔴 五張的授權【全部本來就在】⇒ 本檔整支是 no-op。你要止的血【不是這一片造成的】⇒ 停下來重新判斷。';
  END IF;
END $pre$;

-- 🔴 五句, 寫死不用迴圈 EXECUTE —— 動作要一眼看得到。
GRANT SELECT ON TABLE public.admin_saved_order_views  TO pcm_readonly;
GRANT SELECT ON TABLE public.order_cancellation_items TO pcm_readonly;
GRANT SELECT ON TABLE public.order_cancellations      TO pcm_readonly;
GRANT SELECT ON TABLE public.order_item_costs         TO pcm_readonly;
GRANT SELECT ON TABLE public.payment_charge_attempts  TO pcm_readonly;

DO $post$
DECLARE
  v_tables text[] := ARRAY[
    'admin_saved_order_views',
    'order_cancellation_items',
    'order_cancellations',
    'order_item_costs',
    'payment_charge_attempts'
  ];
  v_t text; v_reg oid; v_acl text; n_checked int := 0;
  n_aclrows_pre int; n_present_pre int; n_aclrows_now int;
BEGIN
  -- 🔴 讀得到前置存的值 —— 讀不到 = 本檔沒跑在同一個 transaction 裡(與正片同一個道理)。
  n_aclrows_pre := NULLIF(pg_catalog.current_setting('pcm.rb_aclrows_pre', true), '')::int;
  n_present_pre := NULLIF(pg_catalog.current_setting('pcm.rb_present_pre', true), '')::int;
  IF n_aclrows_pre IS NULL OR n_present_pre IS NULL THEN
    RAISE EXCEPTION '還原後置閘⓪:讀不到前置存的基準 ⇒ 本檔沒有跑在同一個 transaction 裡 ⇒ 拒 COMMIT';
  END IF;
  FOREACH v_t IN ARRAY v_tables LOOP
    v_reg := pg_catalog.to_regclass('public.' || v_t);
    -- 🔴 R3 MF2(iii):正片後置有這道、本檔漏了 ⇒ 表在交易中途消失時,
    --    炸出來的訊息會變成「acl 裡還是沒有 pcm_readonly 那一列」—— **又是指錯原因。**
    IF v_reg IS NULL THEN
      RAISE EXCEPTION '還原後置閘[%]:public.% 在交易中途不見了 ⇒ 拒 COMMIT(這【不是】授權的問題)', v_t, v_t;
    END IF;
    -- 🎯 斷言:那一列【真的回來了】。
    -- 🛑 用 `aclexplode(relacl)`, **不要用 `has_table_privilege`** ——
    --    後者在 PUBLIC 授權或角色繼承下會回 true ⇒ 它會在「什麼都沒補回來」的世界裡照樣印綠。
    --    (板 050000 的 R2 MF1 就是栽在這把尺上。)
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c, LATERAL pg_catalog.aclexplode(c.relacl) a
       WHERE c.oid = v_reg
         AND a.grantee = pg_catalog.to_regrole('pcm_readonly')
         AND a.privilege_type = 'SELECT') THEN
      RAISE EXCEPTION '還原後置閘[%]:GRANT 跑完了, 而 % 的 acl 裡【還是沒有】pcm_readonly 的那一列 ⇒ 拒 COMMIT', v_t, v_t;
    END IF;

    n_checked := n_checked + 1;
  END LOOP;

  IF n_checked <> 5 THEN
    RAISE EXCEPTION '還原後置閘:逐表只跑了 % 圈(應該是 5)⇒ 有表被跳過 ⇒ 拒 COMMIT', n_checked;
  END IF;

  -- 🔴🔴 **獨立分母(R1 MF4)**:剛好多回來 `5 - n_present` 條, 不多不少。
  SELECT count(*) INTO n_aclrows_now
    FROM pg_catalog.pg_class c, LATERAL pg_catalog.aclexplode(c.relacl) a
   WHERE a.grantee = pg_catalog.to_regrole('pcm_readonly') AND a.privilege_type = 'SELECT';
  IF n_aclrows_now <> n_aclrows_pre + (5 - n_present_pre) THEN
    RAISE EXCEPTION '還原後置閘:pcm_readonly 的表級 SELECT 從 % 變成 %(應該是 %)⇒ 拒 COMMIT。🛑 這句話**今天至少有三個成因, 不要只往一個方向找**:① 貼的當下有別人在動 pcm_readonly 的授權(本檔要單獨跑)② 你當不成 owner ⇒ 五句 GRANT 各多長一列(前置那道 pg_has_role 閘本來該先擋)③ 某張表上另有別人授的那一列 ⇒ 形狀已經變了。', n_aclrows_pre, n_aclrows_now, n_aclrows_pre + (5 - n_present_pre);
  END IF;

  -- 🔴🔴 **收尾那句話要照實說(R1 MF3)** ——
  -- ⛔ ~~原本無條件印「✅ 已還原:pcm_readonly 的 SELECT 在五張表的 acl 裡都回來了。」~~
  -- 🔬 **R1 實燒:同一支跑第二次** ⇒ `n_present = 5`, 前置印了 🔴「整支是 no-op…停下來重新判斷」,
  --    **然後照樣印那句 ✅**, 而且 ✅ 在輸出**最後一行**、🔴 被中間五行 relacl dump 壓在上面。
  --    ⇒ 📌 **SQL Editor 裡人讀的就是最後那一行 ⇒ 他會以為自己止到血了。**
  -- 🛑 這與本檔 `n_present = 5` 那一格自己逐字的「**照實印, 不要讓人以為他止到血了**」直接矛盾,
  --    也與正片「不要靜靜跑完印【成功】」同一個病。**最後一行是最貴的一行。**
  -- 🔴🔴 **R2 MF2(b):`relacl` 逐字那五行【移到這裡】—— 它原本在斷言【之前】。**
  --   🔬 R2 實燒:分母不成立時整支 ROLLBACK, **而那五行 `🔬 … 還原之後的 relacl` 是 NOTICE,**
  --   **NOTICE 不跟著 ROLLBACK 收回去** ⇒ 🔴 **螢幕上留著五行「已經還原好了」的假證據, 而實際一列都沒進去。**
  --   🛑 **在止血的當下, 一個假的成功訊息比沒有訊息更糟。**
  --   ✅ 改法:**先把每一道斷言跑完, 全過了才印那五行。** 印出來 = 它真的成立。
  --   📌 同族(方向相反)—— 正片那句「不要把【跑完沒紅】讀成【收到了】」。
  FOREACH v_t IN ARRAY v_tables LOOP
    SELECT COALESCE(c.relacl::text, '<NULL>') INTO v_acl
      FROM pg_catalog.pg_class c WHERE c.oid = pg_catalog.to_regclass('public.' || v_t);
    RAISE NOTICE '🔬 % 還原之後的 relacl 逐字:%', v_t, v_acl;
  END LOOP;

  IF 5 - n_present_pre = 0 THEN
    RAISE NOTICE '🔴 本檔實際補回【0 張】—— 那五條授權在本檔跑之前就全都在了 ⇒ **本檔整支是 no-op**。🛑 你要止的血【不是這一片造成的】⇒ 停下來重新判斷, 不要把這一發讀成「已還原」。';
  ELSE
    RAISE NOTICE '✅ 本檔實際補回 % 張, 另 % 張本來就在(那幾張是 no-op)。五張的 acl 裡現在都有 pcm_readonly 的 SELECT。', 5 - n_present_pre, n_present_pre;
    RAISE NOTICE '🛑 而那些設計現在又破著 —— 請把「為什麼需要還原」寫下來, 不要讓它們變成下一批查不到出處的孤兒。';
    RAISE NOTICE '🛑 別忘了 pcm_acl_digest_record() → pcm_acl_approve_latest(…) → pcm_acl_drift_status, 順序不能反。';
  END IF;
END $post$;

COMMIT;
