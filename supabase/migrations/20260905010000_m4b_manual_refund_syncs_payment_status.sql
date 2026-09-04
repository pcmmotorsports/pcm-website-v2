-- M-4b · ⟦b4-MANREFUNDNOOWNER2⟧ 人工退款要能翻 payment_status —— 現在沒有人在管
-- ==========================================================================
-- ── 這一片在補什麼洞 ──────────────────────────────────────────────────────
--   員工在後台登記一筆人工退款(匯款/現金退回去給客人)
--   ⇒ `admin_record_manual_refund` 把它寫進 `order_manual_refunds`
--   ⇒ 然後呼叫 `pcm_sync_order_refund_payment_status` 去同步狀態
--   ⇒ 🔴 **而那支同步器只加總 `order_refunds`(卡片軌), 不讀 `order_manual_refunds`**
--   ⇒ ⇒ 它算到 0 ⇒ 提早 return ⇒ 🎯 **`payment_status` 從來沒有被改過, 而沒有東西會叫。**
--
-- ── 而「沒有人在管」是掃出來的, 不是推的 ──────────────────────────────────
--   🔬 2026-09-04 掃描, **分母當場量**(⛔ ~~`orders.payment_status` 的 catalog COMMENT 寫
--      「2026-09-01 實量 11 支檔」~~ —— 那是三天前的數字, 不轉述):
--        2,320 支檔(migrations + apps + packages + scripts;.sql/.ts/.tsx;排除 node_modules 等)
--        ⇒ 剝註解後提及 `payment_status` = 119 支(🟢 正對照 不剝註解 = 154 ⇒ 尺會動;
--           ⚪ 負對照 `payment_statusZZZ` = 0)
--        ⇒ 收窄成【寫】的形狀 = 17 支 ⇒ 逐支 `latest-definition-of.sh` 扣掉被後片蓋掉的
--        ⇒ **活的寫入端 = 6 支函式**, 逐支開【真函式體】量 ⇒ `order_manual_refunds` **全部 0**
--           (🟢 正對照 `admin_finalize_order_refund` 的 `order_refunds` = 10)
--        ⇒ 而 `admin_record_manual_refund` **只呼叫**本函式(命中 5, 另三支各 0)
--   🎯 **⇒ 人工退款那條路唯一到得了的寫入端, 就是那支不讀那張表的同步器。**
--
--   ⚠️ **而過程中兩把尺打過架, 寫在這裡讓下一個人不要重踩**:
--      尺A「函式名往後 6000 字元」⇒ 對同一支印 `order_manual_refunds` = **1**
--      尺B 抓真正的 `$fn$` 函式體(1,474 字元)⇒ **0**;開檔看 ⇒ 那 1 次**溢出到下一個函式去了**。
--      ⇒ 📌 **一把用字元數當邊界的尺, 在函式短的時候會把鄰居算進來** ——
--        🔴 而它印的是 **1**, 不是 0 也不是 999。**一個合理的小數字不會讓任何人起疑。**
--
-- ── 本片做什麼(一件)──────────────────────────────────────────────────────
--   `pcm_sync_order_refund_payment_status` 的加總改成 `order_refunds` + `order_manual_refunds`。
--   ⛔ ~~**其餘一字未改**~~ **作廢**(codex R1 must-fix, :30)—— **那句話在我寫下它的當下是真的**,
--   而我**後來為了過 `search_path` 那道閘又改了三處**(`search_path` 本身 / `current_setting` /
--   `SUM` 的限定名), 而那句宣稱**沒有跟著動**。
--   ✅ 正確字面:**函式體逐字取自 `20260823020000:239-286`(`sed` 抽出、未重打), 而本片動了四處**:
--     ① `SET search_path` ⇒ `''`  ② `current_setting` 加 `pg_catalog.`  ③ `SUM` 加 `pg_catalog.`
--     ④ 新增一句加總 `order_manual_refunds`。**其餘逐字未動。**
--   🔴🔴 **而這格的教訓比它本身重要**:
--     **「只改了 X / 其餘未改」是一句【會被後續動作變假】的話, 而它自己不會叫。**
--     ⇒ 📌 **判別句:任何這種宣稱, 在【下一次動同一支檔】時必須重讀。**
--     ⇒ 今晚同一種病第四次(前三次在 `20260904230000`), 而**四次都由對抗審查抓到**。
--
-- ── 🔴🔴 前置閘兩道(而第一道是【硬順序相依】, 不是保險)────────────────────
--   ① **`20260904230000` 必須先貼。** 本函式 :30 有一道閘:
--        `payment_status NOT IN ('paid','partiallyRefunded','refunded') ⇒ RAISE EXCEPTION`
--      而匯款單在 `230000` 貼進去之前是 `unpaid`
--      ⇒ 🎯 **本片一上, 一張「未付款 + 已有人工退款」的單, 下次登記退款會【當場失敗】** ——
--        而失敗的是**員工正在做的那件事**, 不是背景排程。
--      🔵 判法走 catalog(主視窗 2026-09-04 指定), 不看帳本 —— **帳本落後現實**。
--   ② **資料閘(雙保險)**:庫裡不得已經存在那種單。①擋順序, ②擋「順序對了而歷史資料已經踩到」。
--   ⇒ 📌 **兩道各擋一半, 不是重複** —— ①問「世界準備好了嗎」, ②問「有沒有人已經掉進去了」。
--
-- ── 🛑 這一版證不到什麼 ──────────────────────────────────────────────────
--   · 掃描只涵蓋 repo 的 `.sql`/`.ts`/`.tsx` —— **`.js`/`.py`/`.sh` 與 Edge Function 不在分母裡**
--   · 沒有查正式庫**實際裝著哪一代**(帳本不是正式庫)
--   · 沒有驗「有沒有人直接對 DB 下 SQL 改 `payment_status`」
-- ==========================================================================

BEGIN;

-- ══ 1. 前置閘 ═════════════════════════════════════════════════════════════
DO $pre$
DECLARE
  v_src       text;
  v_n         integer;
  v_live_md5  text;
  v_live_len  integer;
BEGIN
  -- 🔴🔴 **先拿一把交易級 advisory lock, 再開始檢查**(codex R3 must-fix ×2)。
  --    codex 抓到兩個 TOCTOU 窗口, 而它們是**同一個形狀**:
  --      ③ 讀完舊指紋 ⇒ `CREATE OR REPLACE` 之間沒有鎖
  --         ⇒ 另一交易先換掉函式並提交, 而本片仍會**無聲覆蓋**它。
  --      ④ 前置閘②查完 ⇒ `COMMIT` 之間
  --         ⇒ 另一交易新增一張「不允許狀態 + 人工退款」的單, **本片的快照看不到**,
  --           而它會在本片上線後留下日後必炸的資料。
  --    ⇒ 📌 **兩個都不是「檢查寫錯」, 是【檢查與動作之間有一段時間, 而那段時間沒有人守】。**
  -- ⛔ ~~一把鎖同時封住兩個窗口~~ **作廢**(codex R4 must-fix)—— 那句話比它的能力寬。
  -- ✅ **它實際做到的, 分兩半**:
  --    · **窗口③**:🔬 codex R4 查證 `DO` 結束不釋放交易級 advisory lock, 而本檔 `BEGIN`⇒`COMMIT`
  --      是同一交易 ⇒ `CREATE OR REPLACE` 那一刻仍持鎖。
  --      ⚠️ **而它只約束【也拿這把鎖的交易】** —— 一個直接執行的 `CREATE OR REPLACE` 不拿鎖, 照樣進得來。
  --      ⇒ 涵蓋範圍 = 另一支**走同一條 migration 紀律**的片, 不含手動操作。
  --      ⛔ ~~原本寫「真的封住了」~~ 作廢(codex R5:與同段「不是關掉窗口」自相矛盾)。 —— 🔬 codex R4 查證:`DO` 結束**不釋放**交易級 advisory lock,
  --      而本檔 `BEGIN`⇒`COMMIT` 是同一交易 ⇒ `CREATE OR REPLACE` 確實仍持鎖
  --      ⇒ **另一支【也拿這把鎖的 migration】進不來。**
  --    🔴 **窗口④【沒有封住】** —— 一般的收款/退款交易**不拿這把鎖**, 而 PostgreSQL
  --      **不會強制一般 DML 遵守 advisory lock**。⇒ 閘②查完之後、COMMIT 之前,
  --      仍然可能有人新增一張「不允許狀態 + 人工退款」的單, 而本片看不到它。
  --    ⇒ 📌 **⇒ 窗口④ 是【已知殘留風險】, 不是被這把鎖解決的。**
  --      · 那張單不會壞掉本片。它會在**日後有人再對它登記退款時**撞白名單閘而失敗。
  --      ⛔ ~~原本寫「有人會看到, 不是靜默的」~~ 作廢(codex R5 must-fix:低估潛伏)——
  --        🔬 事實是:**可能一直沒有人再對它登記退款**;而顧客站匯款入口的旗標**現在還關著**
  --        ⇒ **只有【日後入口解封、且員工再送出一次】那一刻**, 才會有人在表單上看到失敗訊息。
  --        ⇒ 在那之前它就躺在庫裡, 沒有任何東西會提到它。
  --      🛑 真正關掉它要鎖 `orders` 或加 constraint ⇒ 那是另一片的範圍。
  -- 🔵 用 advisory 而不是鎖表:鎖 `orders` 會擋住整站下單;這把鎖只擋「同時跑這支 migration 的人」。
  -- ⚠️ **誠實邊界**:advisory lock **只擋得住願意拿同一把鎖的人** —— 它擋不住
  --    一個直接 `CREATE OR REPLACE` 那支函式的人(那種人本來就繞過所有 migration 紀律)。
  --    ⇒ 🔴 **它把窗口從「任何並行交易」縮到「另一支也拿這把鎖的 migration」, 不是關掉窗口。**
  PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended('pcm_sync_order_refund_payment_status', 0));

  -- ① 20260904230000 已貼(走 catalog, 不看帳本)
  IF to_regprocedure('public.pcm_noncard_settle_recompute(uuid)') IS NULL THEN
    RAISE EXCEPTION '前置閘①失敗:public.pcm_noncard_settle_recompute 不存在 ⇒ 20260904230000 還沒貼。先貼它, 否則本片會讓「未付款的匯款單登記退款」當場失敗。';
  END IF;

  -- 🔴🔴 **函式存在 ≠ 那一片完整成功**(codex R3 must-fix):
  --    `20260904230000` 真正在做事的是**掛在 order_payments 上的那個 trigger** ——
  --    函式建好了而 trigger 沒掛, 上面那格照樣全綠, 而**收款進來一樣不會翻狀態**。
  --    ⇒ 📌 **我原本驗的是「零件在不在」, 而我要問的是「線接上了沒」。**
  SELECT count(*) INTO v_n
    FROM pg_catalog.pg_trigger t
   WHERE NOT t.tgisinternal
     AND t.tgname = 'pcm_noncard_settle_after_payment_ai'
     AND t.tgrelid = 'public.order_payments'::pg_catalog.regclass;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '前置閘①a失敗:order_payments 上的 pcm_noncard_settle_after_payment_ai 應為 1 個, 實得 % ⇒ 20260904230000 沒有完整生效(函式在而掛點不在)。', v_n;
  END IF;

  -- 🔴 **同名 trigger 存在 ≠ 它有效**(codex R4 must-fix):它可能**被停用**, 或**改掛到別的函式**
  --    ⇒ 上面那格照樣算 1。⇒ 📌 **我數的是名字, 而我要問的是「它現在會不會跑、跑的是不是那支」。**
  SELECT count(*) INTO v_n
    FROM pg_catalog.pg_trigger t
   WHERE NOT t.tgisinternal
     AND t.tgname = 'pcm_noncard_settle_after_payment_ai'
     AND t.tgrelid = 'public.order_payments'::pg_catalog.regclass
     -- 🔴 ⛔ ~~`tgenabled <> 'D'`~~ **不夠**(codex R5 must-fix):值域是 O/D/R/A,
     --    而 `'R'`(replica only)會通過 `<> 'D'` —— 🔬 而正式庫跑的是 origin 模式
     --    ⇒ **一個 `R` 的 trigger 通過這一格, 而它從來不會被觸發。**
     --    ✅ 只收 `O`(origin, 一般)與 `A`(always)。
     --    🔬 而 `O` 是本 repo 的既有慣例:全 repo `tgenabled = 'O'` 命中 **30 處**。
     -- 🔴 ⛔ ~~`tgenabled <> 'D'`~~ 不夠(codex R5):值域 O/D/R/A, 而 `'R'`(replica only)
     --    會通過 `<> 'D'` —— 而正式庫跑 origin 模式 ⇒ 一個 `R` 的 trigger 通過而從不觸發。
     -- 🔴 ⛔ ~~改成 `IN ('O','A')`~~ 也不夠(codex R6):`A`(ENABLE ALWAYS)在
     --    **Supabase 還原流程**(`session_replication_role = replica`)下**會額外執行** ——
     --    ⇒ 資料尚未完整載入就重算狀態, 與本 migration 建立時的預設 `O` 行為不同。
     -- ✅ 只收 `O`。🔬 依據是實測不是查表:對本支 trigger 跑 `SELECT tgenabled` ⇒ `O`;
     --    而全 repo `tgenabled = 'O'` 命中 30 處(既有慣例)。
     AND t.tgenabled = 'O'
     AND t.tgfoid = 'public.pcm_noncard_settle_after_payment()'::pg_catalog.regprocedure
     -- 🔴 **位元:釘死整個 `tgtype`, 不逐位元列舉**(codex R6 三條 must-fix 的共同解)。
     --    逐位元列舉會放行三種東西, 而它們每一種我都要擋:
     --      · `AFTER INSERT OR DELETE` ⇒ `& 4` 成立而 DELETE 時 `NEW` 不存在
     --      · `INSTEAD OF INSERT`(表被換成 view)⇒ BEFORE bit 同樣為 0
     --      · 多事件組合 ⇒ 「至少包含 INSERT」不等於「恰好只有 INSERT」
     --    🔬 `tgtype = 5` 是實測值:對本支 trigger 跑
     --      `SELECT tgtype,&1,&2,&4,&8,&16,&64` ⇒ `5 | 1 | 0 | 4 | 0 | 0 | 0`
     --      ⇒ ROW=1 · BEFORE=0 · INSERT=4 · DELETE=0 · UPDATE=0 · INSTEAD OF=0
     --    ⇒ 📌 **一個等號涵蓋所有位元, 包括我沒想到的那些。**
     AND t.tgtype = 5
     -- 🔴 **`WHEN` 條件**(codex R6 must-fix):同名同表同函式、位元全對, 而帶 `WHEN (false)`
     --    的 trigger 照樣被數成 1 —— 而它**永遠不會執行**。
     --    🔬 本支實測 `tgqual IS NOT NULL` ⇒ `f`(沒有 WHEN)。
     AND t.tgqual IS NULL
     -- 🔴 **可延遲的 CONSTRAINT TRIGGER**(codex R6 must-fix):
     --    `AFTER INSERT ... INITIALLY DEFERRED` 也會通過上面每一格, 而它到交易結束才跑
     --    ⇒ 同一交易內後續操作仍讀到尚未重算的狀態。
     --    🔬 本支實測 `tgconstraint` ⇒ `0`(不是 constraint trigger)。
     AND t.tgconstraint = 0;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '前置閘①a2失敗:那個掛點名字在, 而它【被停用或改掛到別的函式】(符合「啟用中且指向 pcm_noncard_settle_after_payment」的數量 = %)⇒ 20260904230000 沒有真的生效。', v_n;
  END IF;

  SELECT p.prosrc INTO v_src
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'pcm_cron' AND p.proname = 'expire_unpaid_orders';
  -- 🔴 先剝註解 —— 230000 的註解裡逐字寫著 order_payments, 不剝的話這道閘對「腿被刪掉」失明。
  -- 🔴🔴 **這一行原本寫 `pg_catalog.coalesce` —— 而本檔檔頭正在解釋這個坑。**
  --    fresh-context 驗證者判 **BLOCKER**:它在前置閘①通過之後**無條件執行**
  --    ⇒ 🎯 **每一次真實呼叫(成功或該失敗)都在這裡就炸, 從來到不了真正的邏輯。**
  --    🔬 我複驗:剝註解後全檔命中 1 處, 而**函式體裡三處都是對的**。
  --    🛑 **成因是我的尺**:我修完之後只掃了 `AS $fn$` 那一段函式體 ——
  --      而這一行在【前置閘】裡, **結構上不在我那個分母內。**
  --      ⇒ 📌 **一把只看函式體的尺, 對「同一支檔的別的區塊」是完全失明的**,
  --        而它印出的 0 讀起來像「全檔乾淨」。
  v_src := pg_catalog.regexp_replace(coalesce(v_src, ''), '--[^' || chr(10) || ']*', '', 'g');
  IF pg_catalog.strpos(v_src, 'order_payments') = 0 THEN
    RAISE EXCEPTION '前置閘①b失敗:pcm_cron.expire_unpaid_orders 裡找不到 20260904230000 的淨額腿(剝註解後)⇒ 那一片沒貼完整。';
  END IF;

  -- 🔴🔴 ①c **基線指紋**(codex R1 must-fix, :85):本片是 `CREATE OR REPLACE`
  --    ⇒ **正式庫若已經有比 `20260823020000` 更新的一版, 本片會【無聲覆蓋】它的修正。**
  --    ✅ 貼之前先問「我要蓋掉的那一份, 是不是我以為的那一份」。
  -- 🔵 用 `md5(prosrc)` **不是** `md5(pg_get_functiondef(...))`(主視窗 2026-09-05 拍甲):
  --    後者是 PG 自己重排過的樣子(`AS $fn$` 會被正規化成 `$function$`, 縮排也重排)
  --    ⇒ 🔴 **我無法從檔案字面算出它** ⇒ 只能先貼一次讀回來寫死
  --    ⇒ ⇒ **那個常數會綁本機 PG 版本, 而正式庫版本不同就【誤報】** —— 一道會誤報的閘會被人關掉。
  --    ✅ `prosrc` 是**我寫進 `$fn$` 之間的原文**(含換行、不含 `$fn$` 標記), 我算得出、跨版本穩定。
  --    ⚠️ 而它**不含** `search_path` 與 `SECURITY DEFINER` ⇒ 那兩樣由事後⑥守(兩把尺各一半)。
  -- 🔴🔴 **這道閘擋住之後【永遠貼不上去】, 而那是【要的行為】**(主視窗 2026-09-05 裁):
  --    `CREATE OR REPLACE` 靜靜蓋掉一個你不知道存在的版本, 比一個貼不上去的 migration 糟。
  -- ✅ **而 fail-closed 的代價是【拿到紅的那個人要知道下一步】** —— 一句乾的 ERROR 會讓他卡住。
  --    ⇒ 下面的訊息**印出 live 與預期兩個值**, 並直接說出下一個動作。
  SELECT md5(p.prosrc), pg_catalog.length(p.prosrc) INTO v_live_md5, v_live_len
    FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.pcm_sync_order_refund_payment_status(uuid)'::regprocedure;

  IF v_live_md5 IS DISTINCT FROM '0473092c723ae33d8538886c592a5b8a' THEN
    RAISE EXCEPTION E'前置閘①c失敗:目標函式的 body 指紋對不上。\n'
      '  live     md5=% len=%\n'
      '  預期(20260823020000 那一代)md5=0473092c723ae33d8538886c592a5b8a len=1474\n'
      '🔴 意思是:正式庫的 pcm_sync_order_refund_payment_status **不是本片預期要蓋掉的那一份** ——\n'
      '   有人在 20260823020000 之後改過它(哪怕只改了一個註解, 指紋也會變)。\n'
      '🛑 本片若繼續, CREATE OR REPLACE 會【無聲蓋掉】那個改動。\n'
      '✅ 下一步(不要自己猜):請 -db 那條唯讀路把 live 的 prosrc 撈出來, 與\n'
      '   supabase/migrations/20260823020000_...sql:239-286 逐字比對, 看差在哪 ——\n'
      '   ⛔ ~~①只差註解 ⇒ 把本檔這個常數更新成 live 的值再貼~~ **作廢**(codex R2 must-fix)——\n'
      '      🎯 那條指示會讓後面的 CREATE OR REPLACE【靜靜蓋掉】那個註解,\n'
      '      而那正是本閘要防的事 ⇒ **我的修復指示叫人繞過我自己的閘。**\n'
      '   ✅ **唯一的路(主視窗 2026-09-05 裁)**:停下, 由人判它是註解漂還是語意漂,\n'
      '      再決定要不要出【第二代 migration】—— **不是改常數重貼。**\n'
      '      📌 差別在:改常數重貼 = 那個未知改動消失且沒有紀錄;\n'
      '        出第二代 = 那個改動被讀過、被判斷過、留在版控裡。',
      v_live_md5, v_live_len;
  END IF;

  -- ② 資料閘:庫裡不得已經有「未付款 + 有未作廢人工退款」的單
  -- 🔴🔴 **述詞是白名單的【補集】, 不是我自己列舉**(codex R1 must-fix, :71-77)。
  --    ⛔ ~~原本寫 `payment_status = 'unpaid'`~~ **作廢** —— 而 :146 那道閘實測是
  --      `NOT IN ('paid','partiallyRefunded','refunded')`
  --      ⇒ 🔴 **`partiallyPaid` 與 `unpaid` 一樣會撞, 而我的閘看不到它。**
  --    🎯 **⇒ 我用【列舉】去對一個【排除】形狀的規則, 而我只列了一個。**
  --      ⇒ 📌 **兩邊要寫成同一個集合的兩面, 不是各列各的** —— 下面這行與 :146 逐字互補,
  --        ⚠️ **而它們仍是【各自寫一份】三個值**(codex R2 nit)—— 單改一邊會產生假擋或漏擋。
  --        🔵 沒有抽成共用來源的理由:前置閘在 `DO` 區塊、函式體在 `$fn$` 裡, 兩者無法共用變數;
  --          抽成一支 helper 函式 = 為了 DRY 多一個要維護的物件。**代價寫出來, 不假裝解決了。**
  SELECT count(DISTINCT o.id) INTO v_n
    FROM public.orders o
    JOIN public.order_manual_refunds m ON m.order_id = o.id AND m.voided_at IS NULL
   WHERE o.payment_status NOT IN ('paid'::public.payment_status,
                                  'partiallyRefunded'::public.payment_status,
                                  'refunded'::public.payment_status);
  IF v_n > 0 THEN
    RAISE EXCEPTION '前置閘②失敗:庫裡已有 % 張「payment_status 不在 (paid, partiallyRefunded, refunded) 之內、且有未作廢人工退款」的單。⛔ ~~舊訊息寫「payment_status=unpaid」~~ 作廢(codex R2)—— 述詞早就改成白名單的補集了, 而訊息沒跟著改 ⇒ 它會把來修資料的人導向錯的狀態。⇒ 本片一上, 那些單下次登記退款會撞函式裡那道白名單閘而失敗。先處理那些單, 或改用逐單修復。', v_n;
  END IF;
END
$pre$;

-- ══ 2. 同步器:加總改成兩張表 ══════════════════════════════════════════════
-- 🔴 整支逐字取自 `20260823020000:239-286`(`sed -n '239,286p'` 抽出, **未重打**),
--    ⛔ ~~只在 `v_moved` 那一段之後多一句加總~~ ⇒ ✅ **四處改動見檔頭那段訂正**;
--    而**卡片軌那三行(`FROM public.order_refunds … status = 'confirmed'`)確實原樣留著** ——
--    🔵 這半仍為真, 刻意不一起劃掉:**把對的那半也劃掉會製造另一個假。**
CREATE OR REPLACE FUNCTION public.pcm_sync_order_refund_payment_status(p_order_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
-- 🔴🔴 **[2026-09-05]`search_path` 從 `public, pg_temp` 改成 `''`**(線【資料】`-db` 的閘抓的)。
--    ⛔ ~~原版(`20260823020000:243`)是 `public, pg_temp`~~ —— 本片是 `CREATE OR REPLACE`,
--      而**那道閘只看檔面, 新檔一律要求 `''`**。
--    🔵 `''` = 不信任任何 schema ⇒ body 裡的物件必須帶全名, 攻擊者無法用同名物件劫持。
-- 🛑 **而「body 裡一律加 `pg_catalog.`」這句話是【錯的】, 我逐個實測過**:
--      🔬 `SELECT pg_catalog.sum(1)`                    ⇒ 1              ✅ 可以加
--      🔬 `SELECT pg_catalog.current_setting('transaction_isolation')` ⇒ read committed  ✅ 可以加
--      🔬 `SELECT pg_catalog.coalesce(1,2)` ⇒ **ERROR: function pg_catalog.coalesce(integer, integer) does not exist**
--      ⇒ 🔴 `COALESCE` / `NULLIF` / `GREATEST` / `LEAST` 是 **SQL 特殊語法, 不是可加 schema 的函式**。
--    🔵 樣板 `20260904200000` 自己 body 裡用的也是**裸 `coalesce`** ⇒ 這不是我的例外, 是慣例。
--    🎯 **⇒ 一句「一律加全名」照字面執行會讓整支貼不下去** —— 而它讀起來完全合理。
--      (今晚 `20260904230000` 已經被同一件事咬過一次, R2 抓到 3 處。)
SET search_path = ''
AS $fn$
DECLARE
  v_ps     text;
  v_total  integer;
  v_moved  bigint;
  v_target text;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'pcm_sync_order_refund_payment_status: 缺 order_id';
  END IF;
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'pcm_sync_order_refund_payment_status: 需在 READ COMMITTED 下執行(現為 %;RR 下鎖後 SUM 讀不到並行提交)', pg_catalog.current_setting('transaction_isolation');
  END IF;

  SELECT o.payment_status::text, o.total INTO v_ps, v_total
    FROM public.orders o WHERE o.id = p_order_id
    FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pcm_sync_order_refund_payment_status: 訂單 % 不存在(FK 應擋住;資料異常)。🔴 本函式由多個呼叫端共用 —— 看呼叫堆疊, 錯不一定在卡片那條路', p_order_id;
  END IF;

  -- 🔴🔴 **[2026-09-05 ⟦b4-MANREFUNDNOOWNER2⟧]本片唯一的行為改動:把人工退款也算進來。**
  --    ⛔ ~~原本只加總 `order_refunds`(卡片軌)~~ —— 而 `admin_record_manual_refund` 寫的是
  --      **另一張表** `order_manual_refunds`, 然後呼叫本函式 ⇒ 本函式算到 0 ⇒ 提早 return
  --      ⇒ 🎯 **客人的人工退款登記進去之後, `payment_status` 從來沒有被改過。**
  --    🔬 掃描實測(2026-09-04, 分母 2,320 支檔):全 repo 六支活的 payment_status 寫入端,
  --      `order_manual_refunds` **全部 0 次**;而 `admin_record_manual_refund` **只呼叫本函式**
  --      ⇒ **人工退款那條路唯一到得了的寫入端, 就是這一支。** ⇒ 沒有別人在管。
  --    🔵 述詞用 `voided_at IS NULL` 而**不是** `status = 'confirmed'` ——
  --      🔬 `order_manual_refunds` 建表(`20260820010000`)**沒有 status 欄**;
  --      作廢走 `voided_at`(`20260820090000` 後補)。
  --      ⇒ 📌 這與 `20260904230000:239` 用的述詞**逐字相同** ⇒ 兩邊對齊, 不是各寫各的。
  SELECT COALESCE(pg_catalog.sum(refund_amount), 0) INTO v_moved
    FROM public.order_refunds
   WHERE order_id = p_order_id AND status = 'confirmed';

  SELECT v_moved + COALESCE(pg_catalog.sum(refund_amount), 0) INTO v_moved
    FROM public.order_manual_refunds
   WHERE order_id = p_order_id AND voided_at IS NULL;

  IF v_moved <= 0 THEN
    RETURN v_ps;
  END IF;

  IF v_ps NOT IN ('paid', 'partiallyRefunded', 'refunded') THEN
    RAISE EXCEPTION 'pcm_sync_order_refund_payment_status: 訂單 % 的 payment_status=% 不允許進入退款轉移(domain 轉移表);拒繼續。🔴 本函式由多個呼叫端共用(卡片結案 / 非卡登記 / …)—— **錯不一定在卡片那條路**, 看呼叫堆疊', p_order_id, v_ps;
  END IF;

  v_target := CASE WHEN v_moved >= v_total THEN 'refunded' ELSE 'partiallyRefunded' END;
  IF v_ps <> 'refunded' AND v_ps <> v_target THEN
    UPDATE public.orders SET payment_status = v_target::public.payment_status
     WHERE id = p_order_id;
    v_ps := v_target;
  END IF;

  RETURN v_ps;
END;
$fn$;

-- ══ 3. COMMENT 也要跟著改 ═════════════════════════════════════════════════
-- 🔴🔴 **`CREATE OR REPLACE` 保留 oid ⇒ catalog COMMENT 原封不動** —— 不改它, `\df+` 上
--    永遠寫著本函式只管卡片軌那一半, 而**那是 repo 之外的人唯一讀得到的說明**。
-- 🎯 而我 2026-09-04 夜**就是在這一格上漏掉過一次**(`20260904230000` 只搬了函式本體、
--    漏掉 `20260903080000:243` 的 COMMENT, 由 codex 對抗審查抓到)⇒ 這次先找 COMMENT 再動手。
-- 🔵 **而它住在【另一支檔】**:函式體在 `20260823020000`, 而 COMMENT 在 `20260823010000:201`
--    ⇒ 📌 **同一個物件的「碼」與「說明」可以分居兩支 migration** —— 只讀一支會漏。
-- ✅ 下面整段原文是用程式從 `20260823010000` 抽的、一字未重打;舊字面全部留著加刪除線。
COMMENT ON FUNCTION public.pcm_sync_order_refund_payment_status(uuid) IS
  'M-4b 退款通知信 片1/4:退款方向 orders.payment_status 的【唯一寫入端】。'
  '🔴 **內部 helper,不是對外 RPC** —— 零 GRANT、只有 owner 執行得到。'
  '它沒有 actor、不寫 audit ⇒ 開給 service_role 等於多開一條【沒有留痕的動錢入口】,'
  '可繞過 admin_finalize / admin_record_manual_refund / admin_correct_order_refund_verdict 三條正式入口。'
  '(codex R1 2026-08-23 must-fix;前一版曾 GRANT service_role,已撤。)'
  '內容取自 admin_finalize_order_refund 步 7(G8,20260803150000:769-785);'
  '相對原文多了【五樣】:隔離斷言 / 鎖+重讀 / 訂單不存在守門 / 早退 / '
  '🔴 **來源態 allowlist 與 SUM 的先後順序交換**(原文 allowlist 先、本函式 SUM 先)——'
  '五樣在 A 路徑上皆不改變可觀察行為(A 只在剛 confirmed 時呼叫 ⇒ v_moved 恆 > 0 ⇒ 早退不可達 ⇒ allowlist 必達),'
  '逐樣證明寫在本檔檔頭 §2。'
  '⛔ ~~**RAISE 訊息字面逐字保留**(含 admin_finalize_order_refund 前綴)~~ **這句不成立**(codex 2026-09-05):'
  '🔬 實測本函式的 RAISE 前綴逐字是 **pcm_sync_order_refund_payment_status:**, 不是 admin_finalize_order_refund。'
  '🔵 而它【不是本片弄假的】—— 那句在片1 抽函式時就已經與碼不符, 本片只是把它讀出來。'
  '📌 一句寫在 COMMENT 裡的「逐字保留」, 沒有任何東西在檢查它 —— 而它活了兩週。'
  '⛔ ~~因為改掉訊息 = 可觀察行為改變 ⇒ 片2 讓 B/C 也呼叫時必須回訪那個前綴~~ **已作廢**:片2 早就把前綴改成中性名稱了, 這句是假的待辦(codex R2 nit)。'
  '⛔ ~~🔴 現行語意仍是**片1 的舊語意**:只計 confirmed~~ **2026-09-05 起不成立**(本片 20260905010000):'
  '🔴 現行語意 = **order_refunds(status=confirmed)+ order_manual_refunds(voided_at IS NULL)** 兩張表相加。'
  '🔵 而 order_manual_refunds **沒有 status 欄**(建表 20260820010000)⇒ 對它而言「只計 confirmed」這句話沒有意義;'
  '作廢走 voided_at(補欄 20260820090000)。「兩態、單調不降級」那半**仍然成立**, 本片一字未動。'
  '片3 會換成「已確認動錢」三段聚合 + 三態(含回 paid)+ 依 Sean 2026-08-22 Q-B=甲 開放降級。'
  '🔴🔴 **片3 必須【移除】上面那道早退,而不是留著它** —— Fable R2 2026-08-23 抓到:'
  '留著它 ⇒ 全部退款被作廢時 v_moved=0 ⇒ 早退 ⇒ 永遠走不到三態的 paid 分支 ⇒ '
  'payment_status 卡死在 refunded ⇒ **Sean 拍板「作廢後照事實降回」的行為靜靜地不存在**,'
  '而 typecheck / lint / build 與片1 片2 的全部驗收都是綠的。'
  '⚠️ 這一行在片1 是【讓宣稱成真的那一行】,在片3 變成【讓宣稱成假的那一行】——'
  '同一個改動在兩片之間換了正負號,而片界文件裡沒有任何地方會記錄這件事 ⇒ 所以記在這裡。'
  '片3 的驗收必須含一格必紅測試:全部退款作廢 ⇒ 斷言 payment_status 回到 paid。'
  '🔴 鎖序:呼叫端必須在自己的 DML【完成之後】以獨立語句呼叫本函式。'
  '(理由是可見性與鎖序, 不是 volatility —— 本函式**沒有 volatility 子句且會 UPDATE ⇒ 它是 VOLATILE**;'
  '前一版這裡寫「本函式 STABLE」是錯的, 那是把它與 pcm_order_refundable_remaining〔那支才是 STABLE〕搞混。)'
  'A 的鎖序 orders → order_refunds;**B/C 已持子列鎖,呼叫前必須先取 orders 的 FOR NO KEY UPDATE,'
  '否則形成 order_refunds → orders 的反向鎖序、可能 40P01**(codex R1 must-fix,片2 規格必寫)。'
  '⛔ ~~上面任何一句暗示本函式只管卡片軌 / 只加總 order_refunds 的字面~~ **2026-09-05 起不再成立**(⟦b4-MANREFUNDNOOWNER2⟧, migration 20260905010000)。'
  '🔴 現況:本函式加總 **order_refunds(status=confirmed)+ order_manual_refunds(voided_at IS NULL)** 兩張表。'
  '成因:admin_record_manual_refund 寫的是 order_manual_refunds 然後呼叫本函式, 而本函式當時不讀那張表 ⇒ 算到 0 ⇒ 提早 return ⇒ **人工退款從來沒有翻過 payment_status**。'
  '🔬 2026-09-04 掃描(分母 2,320 支檔):全 repo 六支活的 payment_status 寫入端對 order_manual_refunds **全部 0 次**;而 admin_record_manual_refund **只呼叫本函式** ⇒ 那條路唯一到得了的寫入端就是這一支。'
  '🔵 述詞用 voided_at IS NULL 不是 status=confirmed —— order_manual_refunds **沒有 status 欄**(建表 20260820010000);與 20260904230000:239 逐字對齊。'
  '🛑 :30 那道 payment_status 白名單閘**一字未改** ⇒ 未付款的單登記退款仍會 RAISE;本片的前置閘②就是在擋「庫裡已經有那種單」的世界。';
-- ══ 4. 事後斷言 ═══════════════════════════════════════════════════════════
-- 🔴 **突變要插在【這個區塊之前】才會被看到**(2026-09-04 夜實測:三發突變插在檔尾, 全部印綠)。
DO $post$
DECLARE
  v_src       text;
  v_n         integer;
  v_functions text[] := ARRAY['public.pcm_sync_order_refund_payment_status(uuid)']::text[];
  v_fn        text;
  v_fp        text;
BEGIN
  SELECT p.prosrc INTO v_src
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pcm_sync_order_refund_payment_status';
  IF v_src IS NULL THEN
    RAISE EXCEPTION '事後①失敗:函式不見了。';
  END IF;
  -- 🔴 先剝註解 —— 本片的註解裡逐字寫著 order_manual_refunds 好幾次,
  --    不剝的話「把新增那句 SELECT 刪掉、註解留著」照樣印綠(2026-09-04 夜同一個病抓到四次)。
  v_src := pg_catalog.regexp_replace(v_src, '--[^' || chr(10) || ']*', '', 'g');

  -- 🔴🔴 **②-⑤ 從「查 token」換成【指紋】**(codex R1 must-fix ×4, :210-235)。
  --    codex 對每一格都演出了一種「**保留字面而改語意**」的繞法:
  --      ② 加一段無效查詢 / 由 overload 提供字面 · ④ `voided_at IS NULL OR TRUE`
  --      ⑤ 白名單後補 `AND false`、或把左值換成別的變數
  --    ⇒ 🛑 **每一種的字面都還在, 而閘已失效** ⇒ `strpos` 那族結構上擋不住它們。
  --    🔴 **而這不是假設** —— 今晚 `20260904230000` 的事後⑤a 就是只查 token,
  --      而 codex 用「把 `<=` 改成 `>=`」一發繞過去。**同一個母題已經在我手上發生過一次。**
  -- ✅ 指紋 = `md5(prosrc)`:body 裡**任何一個字元**變了它就變 ⇒ 上面每一種繞法都紅。
  --    🔬 演算法(主視窗 2026-09-05 要求寫明):
  --      **從本檔 `AS $fn$` 之後、`$fn$;` 之前的原文算 md5, 含換行、不含 `$fn$` 標記。**
  --      期望值 md5 = 753f36b4dc0c86caf5ca72566e4767a6(body 長度 2417)。
  --    🟢 **而「我算的」與「PG 存的」是兩件事** ⇒ 拋棄式庫貼完會讀回來比對一次(那是正對照)。
  --    · 觸發條件:body 的**任何字元**差異 —— 含註解、空白、行尾。
  --      🔬 **而那不是理論** —— 我在寫這一段的同一小時就撞到:去 `20260904230000` 訂正兩句
  --        **純註解**, 而它的 body md5 當場從 `52d1ab7e…` 變成 `5259cdaf…`。
  --        (剝註解 + 去空行後差異 **0** 行, 🔵 正對照剝完仍有 72 行碼 ⇒ 行為零改動。)
  --      ⇒ 📌 **`prosrc` 把 `--` 註解一起存進去** ⇒ 「行為零改動」與「指紋不變」**是兩件事**。
  --      ⛔ ~~🔴 任何動這支函式註解的人, 都必須同步更新這個常數 … 本檔第 §5 節寫了重算那一行指令~~
  --        **兩句都作廢**(codex R4 must-fix:折 ① 沒折乾淨)——
  --        🔴 **那份重算指令【已經刪掉了】**(見 §5b), 而這句還在指它 ⇒ 指向一個不存在的東西;
  --        🔴 **而「同步更新常數」正是 §5b 拿掉重算指令要防的那個動作** ⇒ **同一支檔自己打自己。**
  --        ⇒ 📌 **我折了一條 finding, 而它的另一半留在別的地方繼續說相反的話。**
  --          🎯 **判別句:折完一條之後, 拿它的【結論】去 grep 全檔, 看有沒有句子在說反的。**
  --      ✅ 正確字面:**body 變了(含只改註解)= 它不是同一個東西了 = 出【第二代 migration】。**
  --        見 §5b。**不要自己重算常數重貼。**
  --      🛑 **它擋不住「有人重貼一支【指紋相同】的舊版」** —— 那由前置閘①c 擋。
  -- 🔴🔴 **順序:先跑三格「壞在哪」, 指紋擺【最後】**(codex R2 must-fix, :310-326)。
  --    ⛔ ~~原本指紋在最前面~~ —— 而它一 RAISE, 後面三格**永遠到不了**
  --    ⇒ 🎯 **我寫「保留它們當可讀的失敗訊息」, 而它們是【不可達的死碼】。**
  --      ⇒ 📌 **R1 的那一條我以為折完了, 而我只是把死碼搬了位置。**
  --    🔵 現在的順序讓兩種訊息各司其職:
  --      **三格 strpos 答「壞在哪」**(它們只認得幾種常見的壞法, 認不出就沉默)
  --      **指紋答「壞了沒」** —— ⛔ ~~它認得所有壞法~~ **高估了**(codex R4 must-fix):
  --        🔴 **它抓得到的是【意外漂移】與【沒有同步竄改】** ——
  --          有人**同時改 body 與這個常數**, 它一樣全綠。
  --        ⇒ 📌 **一個寫在被驗物旁邊的常數, 擋不住能改被驗物的人。**
  --          ⇒ 它的真正價值在:**那個人必須【知道有這道閘】而且【刻意去改它】** ——
  --            而那讓「不小心」與「刻意」分開了, 那是 diff 上看得見的差別。
  --    · 涵蓋範圍:三格 token 全過而 body 有任何字元差異時, 這一格仍會紅。
  --      而**同時改 body 與本檔這個常數**時, 這一格不會紅。
  IF pg_catalog.strpos(v_src, 'order_manual_refunds') = 0 THEN
    RAISE EXCEPTION '事後②失敗:函式體裡找不到 order_manual_refunds(剝註解後)⇒ 本片的加總沒進去。';
  END IF;
  IF pg_catalog.strpos(v_src, 'order_refunds') = 0 THEN
    RAISE EXCEPTION '事後③失敗:函式體裡找不到 order_refunds ⇒ 卡片軌那半被弄掉了。';
  END IF;
  IF pg_catalog.strpos(pg_catalog.regexp_replace(v_src, '\s+', '', 'g'), 'voided_atISNULL') = 0 THEN
    RAISE EXCEPTION '事後④失敗:人工退款那半沒有 voided_at IS NULL ⇒ 被作廢的退款會被算進來。';
  END IF;

  -- 🔴 ⑤ **指紋(硬閘)** —— 上面三格全過也擋不住「保留字面而改語意」。
  --    🔬 實錘(fresh agent 2026-09-05 E4 實測):把 `voided_at IS NULL` 改成
  --      `(voided_at IS NULL OR TRUE)` ⇒ 上面第三格的 `strpos` 回 **872(非 0 ⇒ 印綠)**,
  --      而指紋這一格**紅**。⇒ **那就是換成指紋的全部理由, 不是我推測的。**
  SELECT md5(p.prosrc) INTO v_fp
    FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.pcm_sync_order_refund_payment_status(uuid)'::regprocedure;
  IF v_fp IS DISTINCT FROM '753f36b4dc0c86caf5ca72566e4767a6' THEN
    RAISE EXCEPTION E'事後⑤失敗:貼完的 body 指紋對不上。\n'
      '  實得 md5=%\n  期望 md5=753f36b4dc0c86caf5ca72566e4767a6\n'
      '⚠️ 而觸發它的不只「改了語意」—— **註解 / 空白 / 行尾 / 編碼**任何差異都會讓它紅'
      '(§5b 已寫明:body 變了就是另一個東西)。上面三格若全過, 差異多半就在那一類。\n'
      '✅ 下一步(不要自己重算常數):停下, 由人比對 live body 與本檔 $fn$ 內的原文,\n'
      '   判它是註解漂還是語意漂 ⇒ 要改就出【第二代 migration】。見本檔 §5b。', v_fp;
  END IF;

  -- 🔴🔴 ⑥ **`search_path` 必須是空字串**(`-db` 的閘只看檔面, 它管不到 apply 之後)。
  --    🔬 兩種形狀都收 —— 樣板 `20260904200000:54` 逐字記著:「第一版寫死 `= 'search_path='`,
  --      而 PG 實際存 `search_path=""` ⇒ **乾淨貼當場紅**」。
  --    🛑 **而不得退回 `LIKE '%search_path=%'`** —— 該樣板 `:55` 逐字「那正是 codex 抓的那格」:
  --      那種寫法對 `search_path=public` 也會印綠。
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
     WHERE p.oid = 'public.pcm_sync_order_refund_payment_status(uuid)'::regprocedure
       AND p.prosecdef
       AND (p.proconfig @> ARRAY['search_path=""'] OR p.proconfig @> ARRAY['search_path='])
  ) THEN
    RAISE EXCEPTION '事後⑥失敗:函式不是 SECURITY DEFINER + search_path='''' ⇒ 本片的隔離沒生效。';
  END IF;

  -- ⑦ ACL:清單驅動, 不得有 owner 以外的 grantee。
  -- 🔴 ⑦ **owner 本人也要驗**(codex R2 must-fix, :343-352):
  --    只驗「ACL 僅 owner」在 **owner 漂移**時是全綠的 —— 而那時三條正式入口
  --    (admin_record_manual_refund / 卡片結案 / 非卡登記)可能全部 `permission denied`。
  --    ⇒ 📌 **「沒有別人拿到」與「該拿到的人還拿得到」是兩個宣稱, 而我只驗了前者。**
  --    🔵 基準取 `20260823020000` 那代同一支函式的 owner —— 本片是 CREATE OR REPLACE, owner 不該變。
  IF (SELECT pg_catalog.pg_get_userbyid(p.proowner) FROM pg_catalog.pg_proc p
       WHERE p.oid = 'public.pcm_sync_order_refund_payment_status(uuid)'::regprocedure)
     <> 'postgres' THEN
    RAISE EXCEPTION '事後⑦失敗:函式 owner 不是 postgres ⇒ owner 漂移, 正式入口可能全部 permission denied。';
  END IF;

  FOREACH v_fn IN ARRAY v_functions LOOP
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p,
           LATERAL aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
       WHERE p.oid = v_fn::regprocedure
         AND a.grantee <> p.proowner
    ) THEN
      RAISE EXCEPTION '事後⑧失敗:% 有 owner 以外的 grantee ⇒ ACL 漂移。', v_fn;
    END IF;
  END LOOP;

  RAISE NOTICE '[20260905010000] 八組事後斷言全數通過。';
END
$post$;

COMMIT;

-- ══ 5b. 這個常數與 body 的關係(改 body 的人必讀)═══════════════════════════
--   ⛔ ~~本節原本放一份「指紋重算指令」~~ **整段拿掉**(codex R3 must-fix, 主視窗 2026-09-05 裁甲)。
--   🎯 **為什麼拿掉 —— 因為它是【繞過我自己那道硬閘】的說明書**:
--     codex R3 逐字:「若錯誤 body 保留三個 token, 並依該指示同步重算 md5, ②-⑤ 會一起全綠;
--     此指紋只證明【剛建立的 body = 同檔常數】, 不是獨立的語意閘。」
--     ⇒ 📌 **一個錯的 body + 一次照著做的重算 = 四道閘一起說謊。**
--     ⇒ 🔴 **而這是同一夜第二次**:前一次是前置閘①c 的修復指示「只差註解就更新常數再貼」,
--       同樣叫人繞過它自己。**兩次都是我寫的, 兩次都由對抗審查抓到。**
--       ⇒ 🎯 **判別句:我為一道閘寫的「怎麼過」, 有沒有可能就是「怎麼繞」?**
--
--   ✅ **這個常數不是一個需要維護的值** —— 它是本檔 `$fn$` 內原文的 md5。
--     ⇒ body 變了(**含只改一個註解**)⇒ 它不相等 ⇒ 事後那一格會紅。
--     ⚠️ **而它擋不住「同時改 body 與這個常數」的人** —— codex R5 逐字:
--       「同改 body 與常數的 diff 只能看見兩者一起變, 不能辨認意圖。」
--       ⇒ 📌 **所以這一格量的是【有沒有人在不知情下改了它】, 不是【有沒有人在騙我】。**
--     ⇒ **body 變了 = 它不是同一個東西了 = 要出【第二代 migration】。**
--     ⇒ 🔴 **連改一個註解也是** —— `prosrc` 把 `--` 註解一起存進去
--       (🔬 實測:我去 `20260904230000` 訂正兩句純註解, 它的 body md5 當場
--        從 `52d1ab7e…` 變成 `5259cdaf…`;而剝註解 + 去空行後差異 **0** 行、
--        🔵 正對照剝完仍有 72 行碼 ⇒ **行為零改動, 而指紋變了**)。
--     ⇒ ⇒ 📌 **「行為零改動」與「指紋不變」是兩件事, 而這道閘量的是後者。**
--
--   🛑 **所以撞到指紋不符的人, 唯一的路是:停下, 由人判, 要改就出第二代 migration。**
--     **不要自己重算常數重貼** —— 那讓「有東西變了」這件事消失且沒有紀錄。

-- ══ 5. 還原 ═══════════════════════════════════════════════════════════════
-- ⚠️ **下面是註解, 不是可執行的 SQL** —— 要用請自己把 `-- ` 拿掉再貼。
-- 🔵 還原 = 把 `20260823020000:239-286` 那一份原封重貼一次(它是完整定義, 不是 patch),
--    然後重貼 `20260823010000:201` 的 COMMENT 把說明也退回去。
-- 🛑 **而「還原」在這裡只回一半** —— 退回去之後, 人工退款又會變成沒有人管。
