-- ============================================================
-- L5b-2 片 2f 回退腳本 —— admin_initiate_order_refund 還原成 2f 之前的樣子
--   目標 migration = supabase/migrations/20260812170000_m4b_lifecycle_l5b2_2f_initiate_advisory.sql
--   plan = docs/specs/2026-08-12-l5b2-2f-initiate-advisory-plan.md §6
--
-- ⛔⛔ 執行方式(不是建議,是這腳本成立的前提):
--   `psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f scripts/l5b2-2f-rollback.sql`
--   **禁止只抄座標逐句手跑、禁止互動式 \i、禁止逐句貼進 SQL Editor。**
--   理由:下面三道閘全靠「同一個交易 + 失敗即整體回滾」才有後果。
--   `-X`(不載 psqlrc):下一段點名的 ON_ERROR_ROLLBACK 正是 psqlrc 來的,`-f` 一樣會載到它。
--
-- 🔴🔴 **連線拓樸是前提,不是細節**(v9;diff 層 R3 MF —— 這條差點讓災難當天的門整扇焊死):
--   **`$DB_URL` 必須是直連 / session mode(Supabase 專案的 5432),不可以是 transaction pooler(6543)。**
--   為什麼:閘②c 的核准出口靠 session GUC(`SET pcm.rb_2f_inflight_override = …`)跨語句存活。
--   transaction pooler 每個交易可能配到**不同 backend** ⇒ `-c` 的 SET 與 `-f` 的本體落在兩個 session
--   ⇒ `current_setting` 恆 NULL ⇒ **指紋帶對也永遠被擋**,而症狀只有一行「現況帶入值 = <未設定>」,
--   看起來像值班抄錯指紋。**這是拓樸問題,不是操作問題** —— ②c 的失敗訊息已把這句寫進去。
--   ⚠️ 未確認:Supavisor 目前版本對 session GUC 有沒有轉發特例(沒連正式環境驗過)。
--   不影響本條處置 —— 前提寫下來、訊息講得出來,就不會在凌晨三點被誤判成人為疏失。
--   psqlrc 若開 ON_ERROR_ROLLBACK,RAISE 只回滾那一句、而 CREATE OR REPLACE 已落地
--   ⇒ 閘看起來都在,但**一道都沒有效力**(memory feedback_guard-effect-depends-on-how-it-is-executed)。
--
-- 閘(順序固定,缺一不可;v6 由三道擴為五道 —— diff 層 R1 折疊):
--   閘① 成組回退閘:2g 的 writer 若已在庫 ⇒ abort。
--        🔴 這道是 2a 的 rollback 骨架**沒有**的 —— 照抄 2a 不會自己長出來(母 plan §2b :718-726)。
--        理由:2e/2f/2g 是同一組互斥。只撤 2f 而留著 2g,等於「補償方還在排隊、發起方不排了」
--        = 互斥從雙邊變單邊 = 比三支都沒上更危險。
--   閘② 三態閘:只接受「現況 = 2f post-image」(正常回退)或「現況 = 2f pre-image」(已回退過 = no-op)。
--        其餘一律 abort —— 第三態代表有人在 2f 之後又改過這支函式,盲目覆蓋會吃掉他的改動。
--   🆕 閘②b(v6):prosrc 相符還不夠 —— **本腳本有能力覆寫的每一面**都要逐項相符
--        (proconfig / COMMENT / 七個屬性)。只比 prosrc 之下,「2f 之後只改了 COMMENT」
--        會被判成 post-image 而**靜默覆蓋掉那個改動**(R1 A4)。
--        ⚠️ ACL 與 owner 刻意不列入:CREATE OR REPLACE 保留權限、本腳本覆寫不到它們;
--           列進來只會讓「正式庫授權現況 ≠ 本機臨時叢集」變成假性第三態、擋住合法回退。
--        🔴 v6 二折:**兩態逐項比,不再不對稱**。舊版讓 pre-image 態只比 prosrc,理由寫「早退方向安全」——
--           而早退只跳出 DO 區塊,下面的 CREATE OR REPLACE / COMMENT 照跑 ⇒ 那個「安全」不成立。
--   🆕 閘②c(v6):庫裡若仍有**在途** payment_refunds ⇒ abort。
--        閘① 只問「2g writer 在不在」,答否**不等於**沒有在途的補償退款;
--        此刻撤掉否決,那些單下一秒就能再開一筆 = 同一張單兩條退款線並行(動錢、不可逆)。
--        🔴 但它**有核准出口**(v6 二折):災難當天最可能的情境就是「2f 自己把單卡住」,
--           無條件封死等於連逃生門一起焊死。出口 = 操作者先看**是哪幾筆**、再把那組列的**身分指紋**
--           逐字帶進 `-c "SET pcm.rb_2f_inflight_override = '<指紋>'"` 同 session 重跑。
--           🔴 v7:綁**身分**不綁**筆數** —— 綁筆數之下「一筆走終局、同時一筆新在途」count 不變就放行,
--              放的是**沒有人看過**的那一組。核准值另須來自本 session(`pg_settings.source='session'`,
--              擋 `ALTER ROLE/DATABASE … SET` 事先種下的常駐核准)。
--              放行時 RAISE WARNING + 寫一列 `admin_audit_log`(寫失敗只警告、**不擋回退**);
--              COMMIT 前另有 **②c-recheck** 再量一次指紋(窗口縮小、不是關閉)。理由與邊界逐字寫在該閘上方。
--   閘③ 還原:body 與 COMMENT **都來自 20260803150000**;
--        🆕 回退後置(v6)另驗 **COMMENT 全文 md5 + 七屬性 回到 pre-image** —— body 回去了而 COMMENT
--        停在 2f 版本,等於留下「文件說有序列化點、實際沒有」的合約;
--        七屬性沒驗則「誤帶 IMMUTABLE/PARALLEL/COST」也會被宣稱成完整還原。
--        ⚠️ 2e 的回退曾踩過「body 與 COMMENT 來自兩個不同世代的檔」⇒ 本片已逐一開檔確認:
--        ② 的 body 在 20260803150000:423-595、COMMENT 在同檔 :597-604,**同一個世代**。
--
-- ⚠️ 本腳本**不還原** 2f 以外的任何東西(canonical view / 索引 / 狀態機都不是本片建的)。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL transaction_timeout = '120s';

DO $rb_2f$
DECLARE
  -- 算法一律 md5;量法 = 臨時叢集套 repo migrations 後 SELECT md5(prosrc)(scripts/l5b2-2f-verify.sh pins)
  c_post_md5 constant text := '6ad5549694cc49bc97b38958724e887a';   -- 2f 之後應有的樣子
  c_pre_md5  constant text := 'f98e25f58dde8306772e157f0c7cc5cb';    -- 2f 之前的樣子(= migration 的 P2)
  -- 🔴 只釘 prosrc 不夠(R1 A4):2f 之後若有人只改 COMMENT、或 ALTER FUNCTION ... SET 加了別的參數,
  --    prosrc 一字未動 ⇒ 三態閘仍判「這是 2f post-image」⇒ 下面的 CREATE OR REPLACE + COMMENT
  --    會把那些改動**靜默覆蓋掉**。CREATE OR REPLACE 是整份宣告重寫:凡沒寫的子句一律回預設。
  --    ⇒ 判定面 = 「**本腳本有能力覆寫的每一項**」,逐項比、逐項報:
  --      prosrc / proconfig / COMMENT / 那七個屬性。
  --    ⚠️ **ACL 與 owner 刻意不列入**:CREATE OR REPLACE 保留既有權限,本腳本覆寫不到它們,
  --       列進來只會讓「正式庫的授權現況與本機臨時叢集不同」變成假性第三態、擋住合法回退。
  --    ⚠️ 同理不用 pg_get_functiondef 的 md5:那是 PG 正規化文字(含 owner 相關呈現),跨版本/跨庫不可攜。
  c_post_proconfig constant text := '{"search_path=public, pg_temp",lock_timeout=10s}';
  c_post_cmt_md5   constant text := 'd9ff6ab4b4086076be9100233f124b97';  -- 2f 之後的 COMMENT 全文 md5
  -- pre-image 態的旁支期望值(冪等路徑同樣會覆寫 ⇒ 同樣要逐項比)
  c_pre_proconfig constant text := '{"search_path=public, pg_temp"}';
  c_pre_cmt_md5   constant text := '9656887fa0b2032d03ac0e39fa2fac8d';  -- = migration P8 的 c_comment_md5
  -- 七屬性字面:兩態共用同一顆(2f 沒動它們、回退也不該動)⇒ 只寫一處,避免改一邊漏一邊
  c_attrs constant text := 'secdef=true volatile=v strict=false parallel=u leakproof=false cost=100 rows=0';
  v_md5  text;
  v_cfg  text;
  v_cmt  text;
  v_attr text;
  v_n    integer;
  v_n_raw integer;  -- 未剝註解的原文掃描命中數(與剝除後不一致 ⇒ 停下讓人判)
  v_ids  text;
  v_fp   text;      -- 在途列的**身分指紋**(md5(id 排序後串接));核准綁它、不綁筆數
  v_view_ok boolean;-- canonical view 在不在(缺席 = 在途集合無法判定,不是沒有在途)
  v_src  text;      -- pg_settings.source:核准值是不是本 session 當場 SET 的
  v_writers text;
  v_override text;
BEGIN
  IF c_post_md5 LIKE '@@%' OR c_pre_md5 LIKE '@@%' THEN
    RAISE EXCEPTION '2f 回退:PIN 值尚未填入 ⇒ 拒繼續'
      USING ERRCODE = 'P2FR0', CONSTRAINT = 'l5b2_2f_rb_pins_required';
  END IF;

  -- ══ 閘① 2g writer 在庫則 abort ═══════════════════════════════════════════
  --   偵測方式兩條並用(單靠任一條都會漏):
  --   ①顯式名單 —— 2g 落地時把它的 writer 函式名填進來(現在還沒有,故為空陣列)。
  --   ②行為特徵 —— 任何會寫 payment_refunds 的函式(剝掉註解再比,避免比到說明文字)。
  --     🔴 正規式放寬過:允許 ONLY、允許 schema 限定、允許引號、允許 INSERT/MERGE。
  --     🔴 註解要**兩種都剝**(R1 B):只剝 `--` 之下,寫在 /* ... */ 裡的
  --        `INSERT INTO payment_refunds` 說明文字會被當成真 writer ⇒ 誤判、擋住合法回退。
  --        (區塊註解正規式為非巢狀版;SQL 的 /* */ 可巢狀 ⇒ 巢狀寫法仍可能殘留片段。
  --         ponytail: 非巢狀剝除,真遇到巢狀誤判再升級。)
  --     🔴 掃**全部非系統 schema**(v6 二折):舊版只掃 public ⇒ 把 writer 建在 private/內部 schema
  --        就整支隱形,而閘① 的整個價值就在「不要只撤一邊」。間接 writer(A 呼叫 B、B 才寫)
  --        也因此涵蓋:被呼叫的那支 B 自己會被掃到。
  --     ⚠️ 仍證不到的:用動態 SQL 組字串寫入的 writer(prosrc 裡看不到那個字面);
  --        view 的 INSTEAD OF rule / trigger 那條路(本閘只看 pg_proc);
  --        以及**完全不經函式的寫入路徑** —— service_role 走 PostgREST / 應用層直接 INSERT 這張表,
  --        pg_proc 裡一個字都沒有。⇒ 本閘證的是「**沒有 2g 那種函式**」,**不是**「沒有任何寫入路徑」。
  --        閘②c 的「集合不會自己長大」不得建立在本閘之上(v6 曾那樣寫,v7 已更正為 ②c-recheck)。
  --     ⚠️ 誤判方向的處置:訊息會印出命中清單,值班逐支開 prosrc 確認 —— 不要為了讓回退過而放寬正規式。
  --     🔴 v7 三折(diff 層 R2 IMP)兩處:
  --       ①**剝註解的順序反了,而且反的方向是 fail-open。** v6 先剝 `/* */` 再剝 `--`:
  --         函式裡任何一個 `--` 註解或字串字面含有 `/*`(regex、路徑字串很常見),
  --         區塊剝除會從那裡一路吃到下一個 `*/`,**把中間真正的 INSERT INTO payment_refunds 一起吃掉**
  --         ⇒ 2g writer 在庫卻零命中 ⇒ 回退照跑 = 只撤一邊。這比誤判嚴重得多(誤判只是擋住合法回退)。
  --         ⇒ 改成**先剝 `--` 再剝 `/* */`**,並且**同時掃一次完全未剝除的原文**:
  --           兩者結論不一致 = 剝除本身可疑 ⇒ 停下來讓人看,不默默走 fail-open 那條。
  --       ②**動詞只認 INSERT/MERGE 太窄**:2g 若用 `UPDATE payment_refunds` 推進在途狀態、
  --         或用 `COPY … FROM`,整道零命中。顯式名單至今為空 ⇒ 只剩行為特徵這一條在守,不能再窄。
  SELECT count(*), string_agg(n.nspname || '.' || p.proname, ', ' ORDER BY n.nspname, p.proname)
    INTO v_n, v_writers
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND n.nspname NOT LIKE 'pg\_toast%'
     AND p.prokind IN ('f', 'p')
     AND ( p.proname = ANY (ARRAY[]::text[])      -- 顯式名單:2g 必填
           OR pg_catalog.regexp_replace(
                pg_catalog.regexp_replace(p.prosrc, '--[^' || pg_catalog.chr(10) || ']*', '', 'g'),
                '/\*[^*]*\*+([^/*][^*]*\*+)*/', '', 'g')
              ~* '((INSERT|MERGE)[[:space:]]+INTO|UPDATE|COPY)[[:space:]]+(ONLY[[:space:]]+)?("?public"?[[:space:]]*\.[[:space:]]*)?"?payment_refunds"?([^a-zA-Z0-9_"]|$)' );

  -- 未剝任何註解的原文掃描:剝除只該讓**誤判**變少,不該讓**命中**消失。
  -- 兩者不一致 ⇒ 剝除吃掉了東西(或註解裡真的寫著那段字面)⇒ 一律停下來讓人判,不放行。
  SELECT count(*) INTO v_n_raw
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND n.nspname NOT LIKE 'pg\_toast%'
     AND p.prokind IN ('f', 'p')
     AND p.prosrc ~* '((INSERT|MERGE)[[:space:]]+INTO|UPDATE|COPY)[[:space:]]+(ONLY[[:space:]]+)?("?public"?[[:space:]]*\.[[:space:]]*)?"?payment_refunds"?([^a-zA-Z0-9_"]|$)';
  IF v_n = 0 AND v_n_raw > 0 THEN
    RAISE EXCEPTION '2f 回退閘①:剝註解後 0 命中、但未剝除的原文有 % 支命中 ⇒ 兩者不一致。'
                    '可能是註解剝除把真正的寫入語句吃掉了(`--` 註解或字串字面含 /* 會讓區塊剝除吃過頭),'
                    '也可能只是說明文字裡寫著那段字面。**這個方向必須人工判**:'
                    '逐支開 prosrc 確認後由 Sean 拍板,不要因為「剝完沒命中」就放行 —— '
                    '放錯的代價是只撤一邊(補償方仍排隊、發起方不排了)。', v_n_raw
      USING ERRCODE = 'P2FR1', CONSTRAINT = 'l5b2_2f_rb_2g_scan_inconsistent';
  END IF;
  IF v_n > 0 THEN
    RAISE EXCEPTION '2f 回退閘①:偵測到 % 支會寫入 payment_refunds 的函式(2g writer 疑似在庫)⇒ 拒回退。'
                    '命中清單:%。'
                    '2e/2f/2g 成組:只撤 2f 而留 2g = 補償方仍排隊、發起方不排了 = 互斥從雙邊變單邊,'
                    '比三支都沒上更危險。**先撤 2g,再跑本腳本**(母 plan §2b)。'
                    '⚠️ 若清單裡的函式其實不寫 payment_refunds(例:巢狀區塊註解沒被剝乾淨、'
                    '說明文字裡有 INSERT INTO payment_refunds)⇒ 這是誤判,'
                    '逐支開 prosrc 確認後由 Sean 拍板,不要自己放寬正規式。', v_n, v_writers
      USING ERRCODE = 'P2FR1', CONSTRAINT = 'l5b2_2f_rb_2g_present';
  END IF;

  -- ══ 閘② 三態閘 ═══════════════════════════════════════════════════════════
  SELECT md5(p.prosrc), p.proconfig::text,
         md5(COALESCE(pg_catalog.obj_description(p.oid, 'pg_proc'), '')),
         -- 🔴 每欄都顯式 ::text:format 的 %s 對 boolean 會印 t/f 而不是 true/false,
         --    期望字面寫成 true/false 會恆不相等(本檔實跑當場撞到過)。
         pg_catalog.format('secdef=%s volatile=%s strict=%s parallel=%s leakproof=%s cost=%s rows=%s',
                           p.prosecdef::text, p.provolatile::text, p.proisstrict::text,
                           p.proparallel::text, p.proleakproof::text, p.procost::text, p.prorows::text)
    INTO v_md5, v_cfg, v_cmt, v_attr
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_initiate_order_refund'
     AND pg_catalog.pg_get_function_identity_arguments(p.oid)
         = 'p_order_id uuid, p_kind text, p_amount integer, p_record_refunded_before bigint, p_record_amount bigint, p_reason text, p_actor text, p_request_id text';

  IF v_md5 IS NULL THEN
    RAISE EXCEPTION '2f 回退閘②:找不到 admin_initiate_order_refund(8 參數簽章)⇒ 拒繼續'
      USING ERRCODE = 'P2FR2', CONSTRAINT = 'l5b2_2f_rb_target_missing';
  END IF;

  IF v_md5 = c_pre_md5 THEN
    -- ⚠️ 字面 vs 事實:這個 RETURN 只跳出**本 DO 區塊**;
    --    下方的 CREATE OR REPLACE / COMMENT 是獨立語句、**仍然會執行**。
    --    效果上冪等(寫回去的內容與現況逐字相同),但**不是「沒有寫入」**——別讀成 no-op。
    -- 🔴 v6 二折(diff 層 R1 MF):正因為它**不是** no-op,這一態也必須逐項比。
    --    舊版在這裡只比 prosrc 就 RETURN,原註解還把不對稱寫成「方向安全」——
    --    那句話只有在「早退 = 不寫入」時才成立,而下面兩句照跑。
    --    實際後果:回退之後值班在 COMMENT 追記一行、或 ALTER FUNCTION 加了個 timeout,
    --    再跑一次本腳本(冪等路徑正是最容易被重跑的那條)就把那些追記靜默吃掉。
    IF v_cfg IS DISTINCT FROM c_pre_proconfig
       OR v_cmt IS DISTINCT FROM c_pre_cmt_md5
       OR v_attr IS DISTINCT FROM c_attrs THEN
      RAISE EXCEPTION '2f 回退閘②b(pre-image 態):prosrc 已是 pre-image,但本腳本會覆寫的其他面與 '
                      'pre-image 不符 ⇒ 有人在回退之後又改過這支函式的旁支。'
                      'proconfig 現況 = [%] 期望 [%];COMMENT md5 現況 = % 期望 %;屬性現況 = [%] 期望 [%]。'
                      '再跑一次會把那些改動靜默吃掉 ⇒ 拒繼續,先查清楚誰改的。',
                      COALESCE(v_cfg, '<null>'), c_pre_proconfig, v_cmt, c_pre_cmt_md5, v_attr, c_attrs
        USING ERRCODE = 'P2FR2', CONSTRAINT = 'l5b2_2f_rb_pre_state_sidecar';
    END IF;
    RAISE NOTICE '2f 回退:現況已是 pre-image(先前已回退過)、且旁支逐項相符 ⇒ 跳過三態閘;'
                 '下方仍會用同一份 pre-image 字面覆寫一次(結果相同,非零寫入)。';
    RETURN;
  END IF;

  IF v_md5 <> c_post_md5 THEN
    RAISE EXCEPTION '2f 回退閘②:現況 prosrc md5 = % ,既不是 2f post-image(%)也不是 pre-image(%)'
                    '⇒ 有人在 2f 之後又改過這支函式。盲目覆蓋會吃掉那個改動,拒繼續 —— 先查清楚。',
                    v_md5, c_post_md5, c_pre_md5
      USING ERRCODE = 'P2FR2', CONSTRAINT = 'l5b2_2f_rb_third_state';
  END IF;

  -- prosrc 相符,但本腳本會覆寫的其他面也必須逐項相符,否則同樣是第三態。
  IF v_cfg IS DISTINCT FROM c_post_proconfig
     OR v_cmt IS DISTINCT FROM c_post_cmt_md5
     OR v_attr IS DISTINCT FROM c_attrs THEN
    RAISE EXCEPTION '2f 回退閘②b:prosrc 雖然等於 2f post-image,但本腳本會覆寫的其他面已被改過 ⇒ 拒繼續。'
                    'proconfig 現況 = [%] 期望 [%];COMMENT md5 現況 = % 期望 %;屬性現況 = [%] 期望 [%]。'
                    '(CREATE OR REPLACE 是整份宣告重寫 ⇒ 直接跑下去會把上述改動靜默吃掉。)'
                    '🔴 **下一步怎麼辦(v9 補;diff 層 R3 IMP)**:製造這個第三態最可能的人**就是值班自己** —— '
                    '凌晨事故的第一手緩解幾乎必然是 `ALTER FUNCTION … SET lock_timeout = ''3s''`(把 Q-2f-1 的 10s 調小),'
                    '而那個動作當場就把現況變成這裡的第三態。⇒ 解法不是「查誰改的」,是**把旁支改回 post-image 字面再重跑**:'
                    '  ALTER FUNCTION public.admin_initiate_order_refund(uuid, text, integer, bigint, bigint, text, text, text) '
                    'SET lock_timeout = ''10s'';   -- proconfig 期望值見上面那行'
                    '(COMMENT / 七屬性同理:先還原成上面印出來的期望字面,再跑本腳本。'
                    '本閘刻意**沒有**核准出口 —— 它擋的是「會被靜默吃掉的改動」,而那些改動改回來的成本很低;'
                    '真的改不回來 ⇒ 停下來找 Sean,不要繞過。)',
                    COALESCE(v_cfg, '<null>'), c_post_proconfig,
                    v_cmt, c_post_cmt_md5, v_attr, c_attrs
      USING ERRCODE = 'P2FR2', CONSTRAINT = 'l5b2_2f_rb_third_state_sidecar';
  END IF;

  -- ══ 閘②c 在途退款閘:撤掉 2f = 撤掉「payment_refunds 有在途就不開新單」那道否決 ═══
  --   🔴 閘① 只問「2g writer 在不在」,答案為否**不等於**現在沒有在途的補償退款
  --      (列可能是 2g 以外的路徑造的、或 2g 已被撤但資料還在)。
  --      此刻撤掉否決,那些單下一秒就能再開一筆退款 = 同一張單兩條退款線並行。
  --
  --   🔴🔴 v6 二折(diff 層 R1 MF:「2f 自己造成卡單時會恰好撤不掉」)——
  --      這道原本寫成無條件封死,而回退腳本被拿出來用的**主要情境就是 2f 把單卡住了**:
  --      2f 的在途定義沒有任何機制保證會走到終局(誠實邊界 4),卡住的列既擋單也撤不掉
  --      ⇒ 條件退化成「只有在不需要回退的時候才准回退」。守門守到把逃生門也焊死,
  --      不是比較安全,是把災難當天唯一的動作變成無路可走。
  --      但也不能翻成預設放行:撤掉否決本身不會讓那些單變安全,同一張單兩條退款線是動錢且不可逆。
  --      ⇒ 解法不是選一邊,是**讓「知情」變成可機械驗證的條件**:
  --        操作者必須先看到**是哪幾筆**,再把那組列的指紋逐字帶進來。
  --
  --   🔴🔴 v7 三折(diff 層 R2 MF:「綁筆數不綁身分」)——
  --      v6 把 override 綁在 `count`。count 是**最容易在觀察與核准之間保持不變的東西**:
  --      一筆走到終局、同時另一筆新的變成在途,數字一模一樣,而核准的人**一筆都沒看過那組新的**。
  --      核准的語意是「我看過這幾筆、我為這幾筆負責」,那就必須綁**身分**而不是**基數**。
  --      ⇒ 改綁 `md5(string_agg(id ORDER BY id))`:換掉任何一筆、多一筆、少一筆,指紋就變。
  --      🔴 順帶更正 v6 寫在這裡的一句字面大於事實:v6 寫「這段期間筆數變了 ⇒ 仍然擋」——
  --         綁 count 之下**筆數變了才擋、換人不擋**,那句話當時就不成立。現在綁指紋才對得上。
  --      ⚠️ **仍然存在的窗**(照實寫,不假裝守到了):
  --        ①本閘讀完到 COMMIT 之間對 payment_refunds **沒有任何鎖或凍結**,新列仍可能committed 進來。
  --          緩解 = 還原做完之後、COMMIT 之前**再量一次同一顆指紋**(見檔尾回退後置的 ②c-recheck),
  --          把窗口從「整段交易」縮到「最後一次量測到 COMMIT」那一瞬間。**縮小不等於關閉。**
  --        ②v6 這裡曾寫「閘① 已證沒有 writer ⇒ 集合不會自己長大」——**那是假全稱句**:
  --          閘① 只掃 `pg_proc`,而 service_role 經 PostgREST / 應用層直接 INSERT 這張表
  --          根本不經過任何函式。閘① 證的是「沒有 2g 那種函式」,不是「沒有寫入路徑」。
  --
  --   🔴🔴 **v9 三折(diff 層 R3 MF):canonical view 缺席時,這道閘會自己殺死回退。**
  --      2f **最壞的事故形態**就是那顆 view 被 drop / rename —— 那時 ② 的 veto 每次呼叫都 42P01,
  --      有 payment_refunds 歷史的訂單全部退不了款,而值班要做的正是「撤掉 2f」。
  --      舊寫法無條件查那顆 view ⇒ 那一天閘②c 自己也 42P01 ⇒ ON_ERROR_STOP 整筆 abort
  --      ⇒ **回滾守門在唯一需要它的那天擋死自己**(D1 前科同型)。
  --      ⇒ 先用 to_regclass 測存在性(它對缺席回 NULL、不丟錯),缺席時**轉核准路徑**:
  --        在途集合此刻**無法判定**(不是「沒有在途」)⇒ 不得默默放行,但要留一條說得清楚的人工出口。
  v_view_ok := pg_catalog.to_regclass('public.payment_refund_effective_terminal') IS NOT NULL;

  IF NOT v_view_ok THEN
    v_override := pg_catalog.current_setting('pcm.rb_2f_inflight_override', true);
    IF v_override IS DISTINCT FROM 'view-absent' THEN
      RAISE EXCEPTION '2f 回退閘②c:canonical view public.payment_refund_effective_terminal **不存在** ⇒ '
                      '在途集合無法判定(這與「沒有在途」是兩件事,不得當成可以放行)。'
                      'ℹ️ 這個狀態本身就是 2f 最壞的事故形態:該 view 缺席時 ② 的否決每次呼叫都會 42P01,'
                      '有 payment_refunds 歷史的訂單會全部退不了款 —— 也就是說,你多半正是為了這件事來跑回退的。'
                      '⇒ 出口:確認過現況之後,用 **view-absent** 這個明確的核准值重跑(同一個 session、直連 5432):'
                      '  psql "$DB_URL" -X -v ON_ERROR_STOP=1 -c "SET pcm.rb_2f_inflight_override = ''view-absent''" '
                      '-f scripts/l5b2-2f-rollback.sql'
                      '⚠️ 這條出口**放棄了在途集合的判定**:回退之後,原本被 2f 擋住的單立刻可以再開一筆並行退款,'
                      '善後(把 view 補回來、逐筆對帳)不在本腳本範圍。'
        USING ERRCODE = 'P2FR1', CONSTRAINT = 'l5b2_2f_rb_terminal_view_missing';
    END IF;
    RAISE WARNING '2f 回退閘②c:**view 缺席、經核准放行** —— 在途集合未判定(canonical view 不存在)。'
                  '執行者 session_user=% / current_user=% / 時間=%',
                  session_user, current_user, pg_catalog.clock_timestamp();
    BEGIN
      INSERT INTO public.admin_audit_log (actor, action, target, before, after, reason, request_id, source_app)
      VALUES (session_user, 'l5b2_2f_rollback.view_absent_override',
              'payment_refund_effective_terminal:missing', NULL,
              jsonb_build_object('current_user', current_user), NULL,
              pg_catalog.gen_random_uuid()::text, 'admin');
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '2f 回退閘②c:view 缺席核准的留痕寫入失敗(%)⇒ **回退繼續**,請人工補記。', SQLERRM;
    END;
    v_n := 0;   -- 後面的指紋路徑一律跳過(集合未判定,不是空集合)
  ELSE

  SELECT count(*), string_agg(pr.id::text, ', ' ORDER BY pr.created_at, pr.id)
    INTO v_n, v_ids
    FROM public.payment_refunds pr
   WHERE NOT EXISTS (SELECT 1 FROM public.payment_refund_effective_terminal et WHERE et.refund_id = pr.id)
     AND NOT EXISTS (SELECT 1 FROM public.payment_refunds s WHERE s.supersedes_refund_id = pr.id)
     AND NOT EXISTS (SELECT 1 FROM public.payment_refund_events e
                      WHERE e.refund_id = pr.id AND e.event_type = 'result_success');
  -- 身分指紋:與筆數無關,換掉任何一筆就變(排序用 id,與觀察時的列表同一組值)
  SELECT md5(COALESCE(pg_catalog.string_agg(t.id::text, ',' ORDER BY t.id), ''))
    INTO v_fp
    FROM (SELECT pr.id
            FROM public.payment_refunds pr
           WHERE NOT EXISTS (SELECT 1 FROM public.payment_refund_effective_terminal et WHERE et.refund_id = pr.id)
             AND NOT EXISTS (SELECT 1 FROM public.payment_refunds s WHERE s.supersedes_refund_id = pr.id)
             AND NOT EXISTS (SELECT 1 FROM public.payment_refund_events e
                              WHERE e.refund_id = pr.id AND e.event_type = 'result_success')) t;
  IF v_n > 0 THEN
    v_override := pg_catalog.current_setting('pcm.rb_2f_inflight_override', true);
    -- 🔴 核准值不得是**事先種在庫裡**的常駐值(v7:diff 層 R2 nit)。
    --    自訂 GUC 可以被 `ALTER ROLE/DATABASE … SET` 常駐 ⇒ 核准能在事前種好、
    --    之後每一次回退都自動帶著它跑,「一次性知情核准」就不成立。
    --    ⚠️ 量法走 `pg_db_role_setting`,**不是** `pg_settings.source` ——
    --       本機臨時叢集實測(PG 17.10,2026-08-13):自訂 GUC 不論用 SET 或 ALTER DATABASE … SET,
    --       在 `pg_settings` **都查不到列**(`current_setting` 讀得到值),⇒ source 欄分不出來;
    --       而 `pg_db_role_setting.setconfig` 只收 ALTER ROLE/DATABASE 那一類,正是要擋的東西。
    SELECT pg_catalog.string_agg(c, ' | ') INTO v_src
      FROM pg_catalog.pg_db_role_setting s,
           LATERAL pg_catalog.unnest(s.setconfig) AS c
     WHERE c LIKE 'pcm.rb\_2f\_inflight\_override=%';
    IF v_override IS NOT NULL AND v_src IS NOT NULL THEN
      RAISE EXCEPTION '2f 回退閘②c:核准值被 ALTER ROLE/DATABASE 常駐在庫裡(%)⇒ 拒用。'
                      '常駐值會讓每一次回退都自動帶著核准跑,那不是核准、是預設放行。'
                      '請先 `ALTER DATABASE/ROLE … RESET pcm.rb_2f_inflight_override`,'
                      '再用 -c "SET …" 在同一個 session 當場帶入。', v_src
        USING ERRCODE = 'P2FR1', CONSTRAINT = 'l5b2_2f_rb_override_not_session';
    END IF;
    IF v_override IS DISTINCT FROM v_fp THEN
      RAISE EXCEPTION '2f 回退閘②c:目前有 % 筆 payment_refunds 仍符合本片的「在途」定義 ⇒ 拒回退。'
                      '撤掉 2f 就是撤掉那道否決,這些訂單立刻可以再開一筆並行的退款(動錢、不可逆)。'
                      '在途列 id:%。'
                      '正常路徑 = 先讓它們走到有效終局(或被沿鏈接手)再跑本腳本。'
                      '若這些單正是被 2f 卡住的、非撤不可 ⇒ 由 Sean 拍板後,把**這一組列的指紋**逐字帶進來重跑'
                      '(同一個 session 先 SET 再跑檔,兩個 -c/-f 依序執行):'
                      '  psql "$DB_URL" -X -v ON_ERROR_STOP=1 -c "SET pcm.rb_2f_inflight_override = ''%''" -f scripts/l5b2-2f-rollback.sql'
                      '🔴 指紋綁的是**哪幾筆**、不是幾筆:期間換掉任何一筆(即使筆數不變)⇒ 指紋就變 ⇒ 仍然擋 '
                      '—— 因為核准的意思是「我看過這幾筆」。現況帶入值 = %。'
                      '🔴🔴 **如果你已經帶了值、這裡卻顯示 <未設定> ⇒ 那不是你抄錯,是連線拓樸問題**:'
                      '`$DB_URL` 走的若是 transaction pooler(Supabase 的 6543),`-c` 的 SET 與 `-f` 的本體'
                      '可能落在**不同 backend** ⇒ session GUC 跨語句活不下來,指紋帶對也永遠被擋。'
                      '⇒ 改用**直連 / session mode(5432)**再跑一次。(這條前提也寫在本檔檔頭。)',
                      v_n, COALESCE(v_ids, '<無>'), v_fp, COALESCE(v_override, '<未設定>')
        USING ERRCODE = 'P2FR1', CONSTRAINT = 'l5b2_2f_rb_refund_in_flight';
    END IF;
    -- ══ 留痕:WARNING(給值班當場看)+ admin_audit_log 一列(給事後查)══════════
    --   🔴 v7 三折(diff 層 R2 IMP):WARNING 只進 server log,而 log 保留策略一變這筆核准就查不到;
    --      這是**動錢且不可逆**的核准,該落一列在庫裡。
    --   ⚠️ 但 audit 寫入**不得讓回退本身失敗**:災難當天 audit 表可能正好是壞的那張,
    --      為了留痕而擋住唯一的逃生動作是本末倒置 ⇒ 包 EXCEPTION、失敗改印 WARNING 並繼續。
    --      這是刻意的不對稱:留痕盡力而為,回退能力優先。
    RAISE WARNING '2f 回退閘②c:**經核准放行** —— 現有 % 筆在途 payment_refunds(id:%),'
                  'override 指紋相符(%)。放行後這些訂單可再開並行退款,善後不在本腳本範圍。'
                  '執行者 session_user=% / current_user=% / 時間=%',
                  v_n, v_ids, v_fp, session_user, current_user, pg_catalog.clock_timestamp();
    BEGIN
      INSERT INTO public.admin_audit_log (actor, action, target, before, after, reason, request_id, source_app)
      VALUES (session_user, 'l5b2_2f_rollback.inflight_override',
              'payment_refunds:' || v_fp, NULL,
              jsonb_build_object('inflight_count', v_n, 'inflight_ids', v_ids,
                                 'fingerprint', v_fp, 'current_user', current_user),
              -- 🔴 source_app 只吃 {'admin','quote'}(admin_audit_log_source_app_check,實測)——
              --    第一版寫 'script' 被 CHECK 擋下,而外層 EXCEPTION 把它**吞成一行 WARNING**
              --    ⇒ 「核准會落一列」當時是假的。是 N5d-audit 那格把它抓出來的:
              --    刻意吞例外的設計,一定要配一個「正常情況下真的有寫進去」的斷言,否則吞掉的是事實。
              NULL, pg_catalog.gen_random_uuid()::text, 'admin');
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '2f 回退閘②c:核准留痕寫入 admin_audit_log 失敗(%)⇒ **回退繼續**,'
                    '這筆核准只剩上面那行 WARNING 在 server log。請人工補記。', SQLERRM;
    END;
  END IF;

  END IF;   -- v_view_ok 的 ELSE 收尾

  RAISE NOTICE '2f 回退閘①② 通過(2g 不在庫、在途集合 % 、現況逐項 = 2f post-image)⇒ 執行還原。',
               CASE WHEN v_view_ok THEN '已判定且無在途(或已核准放行)' ELSE '**未判定:canonical view 缺席、已核准放行**' END;
END;
$rb_2f$;

-- ══ 閘③ 還原 body 與 COMMENT(來源逐字 = 20260803150000,同一世代)═══════════
CREATE OR REPLACE FUNCTION public.admin_initiate_order_refund(
  p_order_id               uuid,
  p_kind                   text,
  p_amount                 integer,   -- partial 必填正整數;full 必須 NULL
  p_record_refunded_before bigint,    -- G0 baseline(action 從 Record 查得;缺欄時 action 已 abort)
  p_record_amount          bigint,    -- G0 那次 Record 的 amount(剩餘額);full 必填(凍結額)、partial 必須 NULL
  p_reason                 text,
  p_actor                  text,
  p_request_id             text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_actor    text;
  v_req      text;
  v_reason   text;
  v_ps       text;
  v_rec      text;
  v_frozen   integer;
  v_brid     text;
  v_row      public.order_refunds%ROWTYPE;
  v_id       uuid;
  v_conname  text;
BEGIN
  -- 步 1. 輸入衛生(G11;RAISE 面,鏡像 A6 步 1;slug regex 拒 unicode ⇒ 裸 btrim 已足)
  IF p_actor IS NULL OR btrim(p_actor) = '' THEN
    RAISE EXCEPTION 'admin_initiate_order_refund: 缺 actor';
  END IF;
  v_actor := btrim(p_actor);
  IF v_actor !~ '^[a-z0-9_]{1,64}$' THEN
    RAISE EXCEPTION 'admin_initiate_order_refund: actor 非法(須為 staff slug)';
  END IF;
  IF p_request_id IS NULL
     OR p_request_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'admin_initiate_order_refund: request_id 非法(須為 UUID v4 小寫;表單渲染時 server 發)';
  END IF;
  v_req := p_request_id;
  IF p_reason IS NULL THEN
    RAISE EXCEPTION 'admin_initiate_order_refund: 缺 reason';
  END IF;
  v_reason := btrim(p_reason);
  IF v_reason = '' OR char_length(v_reason) > 200 OR v_reason ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'admin_initiate_order_refund: reason 非法(1-200 字、零控制字元)';
  END IF;

  -- 步 2. kind 與金額參數互斥(RAISE 面;fail-closed 嚴格互斥;損壞輸入=RAISE 非業務碼)
  IF p_kind IS NULL OR p_kind NOT IN ('full', 'partial') THEN
    RAISE EXCEPTION 'admin_initiate_order_refund: kind 須為 full|partial(got %)', COALESCE(p_kind, '<null>');
  END IF;
  IF p_record_refunded_before IS NULL OR p_record_refunded_before < 0 THEN
    RAISE EXCEPTION 'admin_initiate_order_refund: record_refunded_before 須為非負整數(G0 baseline;Record 欄缺時 action 必須 abort、不得傳 0 充數)';
  END IF;
  IF p_kind = 'partial' THEN
    IF p_amount IS NULL OR p_amount <= 0 THEN
      RAISE EXCEPTION 'admin_initiate_order_refund: partial 必須帶正整數 amount';
    END IF;
    IF p_record_amount IS NOT NULL THEN
      RAISE EXCEPTION 'admin_initiate_order_refund: partial 不得帶 record_amount(凍結額=員工輸入額)';
    END IF;
    v_frozen := p_amount;
  ELSE  -- full
    IF p_amount IS NOT NULL THEN
      RAISE EXCEPTION 'admin_initiate_order_refund: full 不得帶 amount(凍結額=Record 剩餘額;plan G3)';
    END IF;
    IF p_record_amount IS NULL OR p_record_amount < 0 THEN
      RAISE EXCEPTION 'admin_initiate_order_refund: full 必須帶非負 record_amount(G0 那次 Record 的 amount;負值=損壞輸入)';
    END IF;
    IF p_record_amount > 2147483647 THEN
      RAISE EXCEPTION 'admin_initiate_order_refund: record_amount 超出 integer 範圍';
    END IF;
    v_frozen := p_record_amount::integer;   -- =0 時走步 6 的 NOTHING_LEFT(業務態非損壞)
  END IF;

  -- 步 3. 鎖訂單(G1:FOR NO KEY UPDATE —— FOR UPDATE 與 FK RI KEY SHARE 死結 40P01 實錘;
  --   鎖順序沿既有約定 orders → order_refunds;INSERT trigger 的 FOR SHARE 同列同交易相容)
  SELECT o.payment_status::text, o.tappay_rec_trade_id
    INTO v_ps, v_rec
    FROM public.orders o
   WHERE o.id = p_order_id
     FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'ORDER_NOT_FOUND');
  END IF;

  -- 步 4. 查驗式冪等(G4;**先於一切業務前置** —— 重播必須拿到 DUPLICATE 而非被
  --   後續業務態遮蔽;以 S4 唯一鍵找列、逐欄比指紋)
  SELECT * INTO v_row FROM public.order_refunds WHERE request_id = v_req;
  IF FOUND THEN
    IF v_row.order_id = p_order_id AND v_row.kind = p_kind
       AND v_row.refund_amount = v_frozen AND v_row.rec_trade_id = v_rec THEN
      IF v_row.status IN ('processing', 'confirmed') THEN
        RETURN jsonb_build_object('result', 'DUPLICATE_REQUEST', 'refund_id', v_row.id,
          'bank_refund_id', v_row.bank_refund_id, 'refund_amount', v_row.refund_amount,
          'status', v_row.status);
      END IF;
      RAISE EXCEPTION 'admin_initiate_order_refund: 該 request 的前次嘗試已終結為 %(deferred/failed 不得同鍵重放;請開新請求=新表單=新 token)', v_row.status;
    END IF;
    RAISE EXCEPTION 'admin_initiate_order_refund: request_id 已被使用且指紋不符(order/kind/金額/rec 任一變動;full 的凍結額會隨 Record 漂移 —— 金額已變動,請重新發起)';
  END IF;

  -- 步 5. 業務前置(友善碼面;P7C02/P7C03 仍是深層防線、不重複計門)
  IF v_ps = 'refunded' THEN
    RETURN jsonb_build_object('result', 'REFUND_LEDGER_FULL');   -- Sean Q1=A 硬擋(G12)
  END IF;
  IF v_ps NOT IN ('paid', 'partiallyRefunded') THEN
    RETURN jsonb_build_object('result', 'ORDER_NOT_REFUNDABLE');
  END IF;
  IF v_rec IS NULL OR btrim(v_rec) = '' THEN
    RETURN jsonb_build_object('result', 'ORDER_NO_CARD_TRANSACTION');
  END IF;

  -- 步 6. full 的「已無可退」業務態(fable F2:凍 0 元會撞 refund_amount>0 CHECK 成裸錯)
  IF p_kind = 'full' AND v_frozen < 1 THEN
    RETURN jsonb_build_object('result', 'REFUND_NOTHING_LEFT');
  END IF;

  -- 步 7. bank_refund_id 生成(G2:rotation-always 一列一鍵;16 bytes→base64→+/→ab→截 20
  --   = 恰 20 字 [A-Za-z0-9ab]、熵 ≥90-bit;生成即形狀,不設驗證(恆真=死規則,關卡2 折入);
  --   撞鍵由 UNIQUE 承接、機率天文小、fail-loud)
  v_brid := substr(translate(encode(extensions.gen_random_bytes(16), 'base64'), '+/', 'ab'), 1, 20);

  -- 步 8. 單列 INSERT(S5/S4 撞鍵在此收斂成具名結果;其餘 unique 撞鍵 fail-loud)
  BEGIN
    INSERT INTO public.order_refunds
      (order_id, bank_refund_id, rec_trade_id, refund_amount, status, reason, actor,
       request_id, kind, record_refunded_before)
    VALUES
      (p_order_id, v_brid, v_rec, v_frozen, 'processing', v_reason, v_actor,
       v_req, p_kind, p_record_refunded_before)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_conname = CONSTRAINT_NAME;
    IF v_conname = 'order_refunds_single_processing_per_order' THEN
      RETURN jsonb_build_object('result', 'REFUND_IN_FLIGHT');   -- 接線債②:同單已有進行中退款
    END IF;
    IF v_conname = 'order_refunds_request_id_key' THEN
      -- 同 token 併發競態:另一連線剛插入 ⇒ 重跑步 4 的查驗(嚴格同判準)
      SELECT * INTO v_row FROM public.order_refunds WHERE request_id = v_req;
      IF FOUND AND v_row.order_id = p_order_id AND v_row.kind = p_kind
         AND v_row.refund_amount = v_frozen AND v_row.rec_trade_id = v_rec
         AND v_row.status IN ('processing', 'confirmed') THEN
        RETURN jsonb_build_object('result', 'DUPLICATE_REQUEST', 'refund_id', v_row.id,
          'bank_refund_id', v_row.bank_refund_id, 'refund_amount', v_row.refund_amount,
          'status', v_row.status);
      END IF;
      RAISE EXCEPTION 'admin_initiate_order_refund: request_id 併發撞鍵且查驗不過;拒繼續';
    END IF;
    RAISE;  -- bank_refund_id 撞鍵等 = 異常,fail-loud
  END;

  -- 步 9. 同交易稽核(G9;audit INSERT 不包 EXCEPTION handler —— 失敗必整筆 rollback)
  -- 🔴 audit.reason 一律 NULL(零自由文字/零 PII;退款理由存帳本列 reason 欄、RLS 保護;
  --    關卡2 codex MF3 折入)。after 恰 8 鍵、全部取自實際寫入值。
  INSERT INTO public.admin_audit_log (actor, action, target, before, after, reason, request_id, source_app)
  VALUES (v_actor, 'order_refund.initiate', 'order:' || p_order_id::text, NULL,
          jsonb_build_object(
            'order_id', p_order_id,
            'refund_row_id', v_id,
            'kind', p_kind,
            'refund_amount', v_frozen,
            'rec_trade_id', v_rec,
            'bank_refund_id', v_brid,
            'record_refunded_before', p_record_refunded_before,
            'request_id', v_req),
          NULL, v_req, 'admin');

  RETURN jsonb_build_object('result', 'INITIATED', 'refund_id', v_id,
    'bank_refund_id', v_brid, 'refund_amount', v_frozen, 'status', 'processing');
END;
$fn$;

COMMENT ON FUNCTION public.admin_initiate_order_refund(uuid, text, integer, bigint, bigint, text, text, text) IS
  'M-3 A7c RW1a 退款登記 RPC(=RF2b 的 initiate 半邊;plan v3.2 §2)。帳先記(INSERT processing 列、RPC 自產 bank_refund_id 一列一鍵)、呼叫端再打 TapPay refund()。'
  '固定回傳碼 8 碼(jsonb.result;呼叫端必斷言 ∈ 全集):INITIATED / DUPLICATE_REQUEST / ORDER_NOT_FOUND / ORDER_NOT_REFUNDABLE / ORDER_NO_CARD_TRANSACTION / REFUND_LEDGER_FULL / REFUND_IN_FLIGHT / REFUND_NOTHING_LEFT。'
  '🔴 檢查順序=合約:鎖訂單 → 冪等查驗(G4,先於一切業務前置 —— 重播恆得 DUPLICATE、不被 REFUND_LEDGER_FULL 等遮蔽)→ G12/白名單/卡交易 → NOTHING_LEFT。'
  '🔴 DUPLICATE_REQUEST=查驗式冪等(同 request_id + 指紋 order/kind/金額/rec 全符 + 列在 processing|confirmed)⇒ 按成功處理;同鍵但指紋不符或前次已 deferred/failed = RAISE fail-loud。'
  '🔴 REFUND_IN_FLIGHT=同單已有 processing 列(S5;接線債② single-flight)。REFUND_LEDGER_FULL=Sean Q1=A refunded 硬擋。'
  'kind=full 凍結額=呼叫端提供的 Record 剩餘額(G0:action 先 recordQuery 並斷言 record_status∈{0,1,2}、refunded_amount 欄缺=abort 嚴禁 ??0、full 時 amount>0);partial=員工輸入。'
  'audit(action=order_refund.initiate、after 恰 8 鍵、reason=NULL 零自由文字)。鎖序=orders FOR NO KEY UPDATE → order_refunds。EXECUTE 僅 service_role。';

-- ══ 回退後置:確認真的回到 pre-image ════════════════════════════════════════
DO $rb_post_2f$
DECLARE
  c_pre_md5 constant text := 'f98e25f58dde8306772e157f0c7cc5cb';
  -- 2f **之前**的 COMMENT 全文 md5(= migration 前置閘 P8 的 c_comment_md5,同一顆值、同一個量法)
  c_pre_cmt_md5 constant text := '9656887fa0b2032d03ac0e39fa2fac8d';
  -- 🔴 七屬性也要驗(v6 二折):CREATE OR REPLACE 沒寫的子句一律回 PG 預設,
  --    而本腳本的還原文字若哪天被人加了 IMMUTABLE / PARALLEL SAFE / COST,
  --    prosrc、proconfig、COMMENT 三面全綠,函式的執行語意卻已經和 pre-image 不同,
  --    而後置還會印「皆已回到 pre-image」——**宣稱比事實大**正是本片一路在修的那個病。
  --    字面與閘②b 的 c_attrs 同一顆(2f 沒動它們、回退也不該動)。
  c_attrs constant text := 'secdef=true volatile=v strict=false parallel=u leakproof=false cost=100 rows=0';
  -- pre-image 的 proconfig 整串(與上方閘②b 的 c_pre_proconfig 同一顆字面)
  c_pre_proconfig constant text := '{"search_path=public, pg_temp"}';
  v_md5 text;
  v_txt text;
  v_cmt text;
  v_attr text;
  v_fp2 text;
  v_n2  integer;
BEGIN
  SELECT md5(p.prosrc), p.proconfig::text,
         md5(COALESCE(pg_catalog.obj_description(p.oid, 'pg_proc'), '')),
         pg_catalog.format('secdef=%s volatile=%s strict=%s parallel=%s leakproof=%s cost=%s rows=%s',
                           p.prosecdef::text, p.provolatile::text, p.proisstrict::text,
                           p.proparallel::text, p.proleakproof::text, p.procost::text, p.prorows::text)
    INTO v_md5, v_txt, v_cmt, v_attr
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_initiate_order_refund'
     AND pg_catalog.pg_get_function_identity_arguments(p.oid)
         = 'p_order_id uuid, p_kind text, p_amount integer, p_record_refunded_before bigint, p_record_amount bigint, p_reason text, p_actor text, p_request_id text';

  IF v_md5 IS DISTINCT FROM c_pre_md5 THEN
    RAISE EXCEPTION '2f 回退後置:還原後 prosrc md5 = % ,期望 pre-image % ⇒ 還原不完整,整筆回滾',
                    COALESCE(v_md5, '<不存在>'), c_pre_md5
      USING ERRCODE = 'P2FR3', CONSTRAINT = 'l5b2_2f_rb_not_restored';
  END IF;

  -- 🔴 lock_timeout 必須跟著消失:留著它 = 回退後仍有 2f 才引入的、對員工可見的行為。
  --    🔴 v7 三折(diff 層 R2 MF):v6 這裡是**子字串比對**(含/不含兩個 LIKE),
  --       那擋得住「lock_timeout 沒消失」,擋不住「多了一個別的 SET」——
  --       還原文字若被加 `SET row_security = off`,prosrc / COMMENT / 七屬性四面全綠,
  --       而後置照印「皆已回到 pre-image」。同一題在 migration 後置④ 早就是整串相等,
  --       兩側判準不對稱本身就是徵兆。⇒ 改用同檔既有的 c_pre_proconfig 整串比。
  IF v_txt IS DISTINCT FROM c_pre_proconfig THEN
    RAISE EXCEPTION '2f 回退後置:proconfig = % ,必須逐字等於 pre-image 的 %(lock_timeout 必須消失,'
                    '且不得多出任何本來沒有的 SET),整筆回滾',
                    COALESCE(v_txt, '<null>'), c_pre_proconfig
      USING ERRCODE = 'P2FR3', CONSTRAINT = 'l5b2_2f_rb_proconfig';
  END IF;

  -- 🔴 COMMENT 也要驗回到 pre-image(R1 B):body 回去了而 COMMENT 還停在 2f 版本,
  --    等於留下一份「文件說有序列化點、實際沒有」的合約 —— 讀 COMMENT 的人會被誤導。
  IF v_cmt IS DISTINCT FROM c_pre_cmt_md5 THEN
    RAISE EXCEPTION '2f 回退後置:還原後 COMMENT 全文 md5 = % ,期望 pre-image % '
                    '⇒ COMMENT 沒回到 2f 之前的版本(合約字面與實際行為不一致),整筆回滾',
                    v_cmt, c_pre_cmt_md5
      USING ERRCODE = 'P2FR3', CONSTRAINT = 'l5b2_2f_rb_comment_not_restored';
  END IF;

  IF v_attr IS DISTINCT FROM c_attrs THEN
    RAISE EXCEPTION '2f 回退後置:還原後的七屬性 = [%],期望 [%] ⇒ 還原文字帶進了 pre-image 沒有的屬性'
                    '(IMMUTABLE / PARALLEL / COST / STRICT 之類),整筆回滾',
                    v_attr, c_attrs
      USING ERRCODE = 'P2FR3', CONSTRAINT = 'l5b2_2f_rb_attrs_not_restored';
  END IF;

  -- ══ ②c-recheck:在途集合在本交易期間有沒有變(v7 三折;窗口縮小、不是關閉)══════
  --   閘②c 在交易**開頭**量了一次身分指紋,而本腳本對 payment_refunds **沒有任何鎖**
  --   ⇒ 從那次量測到 COMMIT 之間,新的在途列仍可能 committed 進來(PostgREST / 應用層直寫都不經函式)。
  --   ⇒ 還原做完、COMMIT 之前**再量一次**:READ COMMITTED 之下每個新語句都看得到已提交的新列
  --      ⇒ 指紋一變就整筆回滾。
  --   ⚠️ 誠實邊界:這只把窗口從「整段交易」縮到「最後這次量測到 COMMIT」那一瞬間。
  --      要真正關閉需要述詞鎖(PG 沒有可用形式)或 SERIALIZABLE 隔離級 —— 兩者都不在本腳本範圍。
  --      **縮小不等於關閉,不要讀成「已排除競態」。**
  --   🔴 v9 三折:這裡與閘②c 同一個問題 —— view 缺席時直接查它會 42P01,
  --      而**回退後置一 abort 就是整筆回滾** ⇒ 前面所有還原白做,又是「守門在最需要它那天擋死自己」。
  --      ⇒ 同樣先測存在性;缺席時**跳過 recheck 並大聲說出來**(不是靜默通過)。
  IF pg_catalog.to_regclass('public.payment_refund_effective_terminal') IS NULL THEN
    RAISE WARNING '2f 回退後置 ②c-recheck:**跳過** —— canonical view 不存在,在途集合無法判定。'
                  '這一趟回退沒有「集合自量測後未變動」的保證,請人工對帳 payment_refunds。';
    v_n2 := 0; v_fp2 := NULL;
  ELSE
  SELECT count(*), md5(COALESCE(pg_catalog.string_agg(t.id::text, ',' ORDER BY t.id), ''))
    INTO v_n2, v_fp2
    FROM (SELECT pr.id
            FROM public.payment_refunds pr
           WHERE NOT EXISTS (SELECT 1 FROM public.payment_refund_effective_terminal et WHERE et.refund_id = pr.id)
             AND NOT EXISTS (SELECT 1 FROM public.payment_refunds s WHERE s.supersedes_refund_id = pr.id)
             AND NOT EXISTS (SELECT 1 FROM public.payment_refund_events e
                              WHERE e.refund_id = pr.id AND e.event_type = 'result_success')) t;
  END IF;
  IF v_n2 > 0
     AND v_fp2 IS DISTINCT FROM pg_catalog.current_setting('pcm.rb_2f_inflight_override', true) THEN
    RAISE EXCEPTION '2f 回退後置 ②c-recheck:在途集合在本交易期間變了(現況 % 筆、指紋 %),'
                    '與交易開頭被核准的那一組不同 ⇒ 這次回退會放行**沒有人看過**的在途列,整筆回滾。'
                    '請重新觀察、重新取得核准後再跑。', v_n2, v_fp2
      USING ERRCODE = 'P2FR1', CONSTRAINT = 'l5b2_2f_rb_inflight_changed';
  END IF;

  RAISE NOTICE '2f 回退完成:prosrc / proconfig / COMMENT / 七屬性 皆已回到 pre-image;'
               '在途集合自閘②c 量測後未變動(% 筆)。', v_n2;
END;
$rb_post_2f$;

COMMIT;
