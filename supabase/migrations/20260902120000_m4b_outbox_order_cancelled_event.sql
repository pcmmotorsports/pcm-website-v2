-- M-4b · `email_outbox.event_type` 加第三個事件 `order_cancelled`
--
-- 出處:Sean 2026-09-02 拍甲(`拍板-20260902-上午.md` Q17)——
--   逐字「當我們退款完成後,我們可以人工再判斷要不要把這一筆訂單做『訂單取消』,
--   取消的話就變成【後台狀態變更】、【客人訂單狀態變更】、【客人收到訂單取消信件】。」
--   四批拍板:甲 只鬆開一個口 · 甲 現在開(只開刷卡且已全額退款)
--            · 甲 分兩步(今天 = 標記 + 信,**一個數量都不碰**)· 甲 只標記 + 留可辨識的訊號
--
-- 🛑 **部署順序:先 apply 本支,再部署會寫這個字面的那幾片。**
--    本片是本條線的**第一顆**,它刻意只做 CHECK 放寬、不帶任何其他改動 ——
--    這樣它可以先上,而後面幾片各自按自己的節奏跟上。
--
-- ── 🔴 反序部署的後果 —— 而【今天】的形狀與這個 repo 過去寫過的不一樣,不要抄舊句 ──────
--    ⚠️ 兩種反序要分開講,它們的後果不同:
--
--    甲 **碼先上、CHECK 後上**(enqueue 已在寫 `order_cancelled`,而正式庫還是兩值):
--      INSERT 被 **23514** 拒 ⇒ 那一筆取消**排不進 outbox** ⇒ 客人收不到取消信。
--      ⚠️ 而**後台的標記本身會不會一起失敗**,取決於呼叫端把 enqueue 放在哪一層 ——
--        那是片④的事,**本檔不宣稱**,由片④自己寫清楚並附測試。
--
--    乙 **CHECK 與 enqueue 先上、模板後上**(outbox 裡有 `order_cancelled` 列而 sweeper 不認得):
--      🔴 **舊的說法是「一封內容只有 `order_cancelled` 的信會寄給真客人」—— 那句話今天【已經不成立】。**
--        `sweep-email-outbox.ts:350-351` 的 default 分支**現在是 throw**
--        (`job.eventType satisfies never; throw new Error('…未知 event_type、fail-closed 不寄');`)。
--        ~~那個「垃圾內文寄給真客人」的行為是【修之前】的~~,而修它的理由就寫在那一段註解裡。
--      ✅ **今天真正的後果**:throw ⇒ 呼叫端 per-job catch 計 error ⇒ 列留 `sending`
--        ⇒ 回收 → 重試 → **耗盡 attempts 進死信**。
--        ⇒ 而死信之後那一列**佔住唯一鍵** ⇒ 那位客人**再也收不到這封取消信,而零訊號**。
--      📌 ⇒ **失敗方向是對的(不寄垃圾),而它仍然是一個安靜的漏信面** —— 這與
--        `20260830060000` 那片講 `skipped_shipment_voided` 的漏信面是**同一個母題**。
--
-- 🔴 **而沒有機制擋得住這個順序**:`scripts/deploy-order-gate.sh` 掃的是 `.from()` / `.rpc(`,
--    一個寫在 use-case 裡的 event_type 字串對它是隱形的 ——
--    這一句與 `20260830060000` 檔頭那句**是同一個事實,不是我抄它**:兩片動的都是這張表的 CHECK。
--
-- ── 為什麼要開第三個值,而不是塞進既有兩個 ──────────────────────────────────
--    `order_created` = 付款成功通知;`order_shipped` = 出貨通知。
--    取消通知**兩個都不是** —— 而 `event_type` 同時是**去重鍵的一半**
--    (`UNIQUE (event_type, dedup_key)`,`20260717020000:349`)⇒ 借用任一個既有值,
--    會讓取消信與那條線的信**互相擋掉對方的唯一鍵**。
--    ⇒ 借用不是「比較省」,它是**製造一個漏信面**。
--
-- ── 🔵 本片【不做】什麼(寫出來,免得被讀成「取消功能做好了」)─────────────────
--    ✗ 不建欄、不建函式、不動任何品項數量、不動 `orders`
--    ✗ 不寫模板、不接 enqueue、不開後台入口(片②③④)
--    ✗ **不涵蓋部分退款** —— Sean 拍甲逐字「只開刷卡且已全額退款」;
--      那道閘住在片②的函式裡,本片只是把值域打開,**值域打開不等於任何人可以用它**。
--
-- 🔴🔴 **而有一張【已經寫好而還沒有人執行】的紙條,本片就是它等的那一天**(R3 抓,本窗開檔核過):
--    `packages/adapters/src/email/SupabaseEmailOutboxAdapter.ts` 逐字寫著
--    「**日後真的加第三個事件型別時,要先照
--      `docs/runbooks/throwaway-postgres-for-migration-verification.md` 跑一發真的 PostgREST
--      驗那個 `in` 文法**,再回來改這裡」
--    (錨字串:「日後真的加第三個事件型別時」;它旁邊那段的理由是「值域只有兩個 ⇒ 排除兩個 = 排除全部」)。
--    而 `packages/ports/src/IEmailOutbox.ts` 的 `EmailOutboxEventType` **今天仍是兩值 union**。
--    ✅ **今天不會壞** —— 本片一行 TS 都沒動,而 `sweep-email-outbox.ts` 唯一那個呼叫端只傳一個元素。
--    🛑 **但那張紙條的觸發條件【已經成立】** ⇒ **片② 把 union 加到三值之前,先跑那一發 PostgREST。**
--    📌 ⇒ 一張寫得很清楚的紙條,只有在【有人剛好翻到那支檔】時才會被執行 ——
--      所以它要被抄到**下一個人一定會讀的那支檔**,而那就是這裡。
--
-- ── 量測(字面值三來源律:下面兩個期望字面是【量到的】,不是背的)────────────────
--    2026-09-02 於拋棄式 PG **17.10**(Homebrew, aarch64-darwin23.6.0)實跑:
--      建 `CHECK (event_type IN ('order_created','order_shipped'))` ⇒ `pg_get_constraintdef` 回
--        `CHECK ((event_type = ANY (ARRAY['order_created'::text, 'order_shipped'::text])))`
--      建放寬後那條 ⇒ 回本檔 `v_expect` 那一段
--      🔵 **負對照(尺會動)**:同一支庫上建 `CHECK (TRUE OR event_type IN (…))`
--        ⇒ 回 `CHECK ((true OR (event_type = ANY (ARRAY[…]))))` ⇒ **與 `v_expect_old` 逐字不同**
--        ⇒ 那個「恆真」的壞世界**過不了**前置閘③。
--    ⚠️ **代價同 `20260830060000:125-131`**(錨:「`pg_get_constraintdef()` 回的是**重建後的文字**」;
--      ~~原本寫 `:86-92`~~ **錯了** —— 那個範圍是靜態閘與 NOT VALID 兩步。
--      🔴 **而那個錯座標是【抄過來的】不是算錯的**:`20260830060000:150` 自己那句就寫著 `:86-92`
--      ⇒ 📌 **一個錯的行號被引用時,它會連著錯一起被複製 —— 而抄的人不會去核。**
--      那支已 apply 不能改,本支可以 ⇒ 修在這裡):`pg_get_constraintdef()` 的格式**跨 PG 大版本可能改**
--      ⇒ 在別的版本上會**假紅**。貼上去之前先在目標庫跑一次:
--        SELECT pg_get_constraintdef(oid) FROM pg_constraint
--          WHERE conrelid='public.email_outbox'::regclass AND conname='email_outbox_event_type_check';
--      與本檔 `v_expect_old` 逐字比 —— 只差空白/括號排版 = 版本差異,值不一樣 = 部署態不符。

BEGIN;

-- 鎖與逾時的完整理由(為什麼 NOT VALID 兩步在單一交易裡拿不到好處、
-- 為什麼 lock_timeout 只封「等鎖」而不是總時長)寫在 `20260830060000:82-101`
-- (錨:「`ALTER TABLE ... ADD CONSTRAINT` 取 **ACCESS EXCLUSIVE** 且全表掃描」;~~原寫 `:105-140`~~ 錯),
-- 那一段是 codex R1/R2 逐條打出來的,**不在這裡重寫一遍**(重寫 = 兩份會各自漂)。
-- 🔵 而本片的掃描**保證會過**:三個值 ⊃ 原兩個值 ⇒ 每一列本來就滿足較嚴的舊約束。
-- ⚠️ 未量:`email_outbox` 今天有幾列(要 DB access)⇒ **掃描要多久,未知** ——
--    不得寫成「表很小所以沒關係」。
-- 🔴 **而【誰】替那個未知封頂,codex R1 更正了我(原句作廢、留痕)**:
--    ~~「`lock_timeout` 的用途正是讓這個未知有上界」~~ —— **錯了**。
--    `lock_timeout` 只封「**等鎖**」那一段;鎖一旦到手,掃描跑多久與它無關。
--    ⇒ 替掃描封頂的是 **`statement_timeout`**(單句上限 60s)。
--    ⇒ 兩者**各封一段、都不是整筆交易的總上限** ⇒ 本片對「總時長」沒有上界。
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 先拿鎖再檢查(理由同 `20260830060000:105-116`,錨:「**先拿鎖,再檢查**」;
-- ~~原寫 `:142-155`~~ 錯 —— 那個範圍是前置閘①的 IF 區塊。
-- 一句話:否則檢查與改動之間有一個窗口,並行 DDL 可以在那裡把同名約束換掉而本檔無聲覆蓋它)。
LOCK TABLE public.email_outbox IN ACCESS EXCLUSIVE MODE;

-- ── 0. 前置閘(forward-only;已在鎖底下)────────────────────────────────
DO $$
DECLARE
  v_def text;
  v_valid boolean;
  v_others text;
  v_expect_old constant text :=
    'CHECK ((event_type = ANY (ARRAY[''order_created''::text, ''order_shipped''::text])))';
BEGIN
  SELECT pg_catalog.pg_get_constraintdef(c.oid), c.convalidated INTO v_def, v_valid
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.email_outbox'::regclass
     AND c.conname = 'email_outbox_event_type_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '前置閘①:找不到 email_outbox_event_type_check ⇒ 部署態與預期不符,停下';
  END IF;
  IF pg_catalog.strpos(v_def, 'order_cancelled') > 0 THEN
    RAISE EXCEPTION '前置閘②:order_cancelled 已經在 CHECK 裡了 ⇒ forward-only,拒重跑';
  END IF;
  -- 🔴 **③ 排在 ④ 前面是量出來的, 不是排版**(2026-09-02 harness 世界⑤):
  --    `pg_get_constraintdef()` 對 NOT VALID 的約束會在字串**尾巴接上 ` NOT VALID`**
  --    ⇒ 逐字比對先炸 ⇒ 而它的訊息會把人派去追「PG 版本格式差異」這個**不存在的**假說。
  --    ⇒ 先問「validated 了沒」,答案是否時直接說出來;確定 validated 之後,
  --      逐字不符就真的只剩那兩個假說。
  --    📌 **兩道閘都會紅,而只有一道說得出真正的原因 —— 順序決定讀的人往哪裡看。**
  -- ⚠️ **代價(codex R1 抓,寫出來不要藏)**:當現行約束**同時** NOT VALID **又**已經漂移
  --    (例如被換成 `TRUE OR …`)時,③ 先紅 ⇒ **④ 那個「定義也不對」的資訊被遮住**
  --    ⇒ 修完 NOT VALID 再跑一次才會看到第二個紅。
  --    ⇒ 所以正確的說法是「**它讓最常見的那個世界說得出真正的原因**」,
  --      **不是**「每個世界都只有一道紅、而那道一定說得出原因」。
  IF NOT v_valid THEN
    RAISE EXCEPTION '前置閘③:現行 CHECK 是 NOT VALID ⇒ 它沒有驗過既有資料,停下人工對齊';
  END IF;
  -- 🔴 整段逐字比對,不是「兩個字串有出現」——
  --    後者對 `CHECK ((TRUE OR event_type IN (…)))` 這種恆真的壞世界是瞎的(負對照已實測)。
  IF v_def <> v_expect_old THEN
    -- 兩個假說都寫進訊息:讀到這個紅的人只看得到錯誤訊息、不會讀註解
    -- (同 `20260830060000` R3 抓到的那一格)。
    RAISE EXCEPTION '前置閘④:現行 CHECK 與預期【不是同一段】。兩個可能:①這個庫上的版本與我預期的不同 ②PG 版本的 pg_get_constraintdef 格式差異(本檔期望字面取自 PG 17.10)。判別法:把下面兩段逐字比一次 —— 只差空白/括號排版=②,值不一樣=①。實際:% / 預期:%', v_def, v_expect_old;
  END IF;
  -- 🔴🔴 **前置閘⑤(codex R1 must-fix)**:上面四道全部只看【那一條具名約束】——
  --    而「那一條長對了」與「這一欄的值域真的是那三個值」**是兩個宣稱**。
  --    正式庫上若另有一條**別的名字**的 CHECK 也管著 `event_type`
  --    (例:`CHECK (event_type <> 'order_cancelled')`),四道閘會**全部綠**,
  --    而 apply 之後第一次寫第三個值仍然被 **23514** 拒 ——
  --    📌 **一個「放寬成功」的綠,與一個「放寬了但還是寫不進去」的世界,印同一個東西。**
  --    ⇒ 改成問【集合】:這一欄上到底掛了幾條 CHECK。
  --    🔵 `conkey` 確實抓得到「提到這一欄」的 CHECK 而不會多抓無關的
  --      (2026-09-02 拋棄式 PG 17.10 實測:三條 CHECK 只回那兩條提到該欄的)。
  --    ⚠️ 射程:它看 **CHECK 與 FOREIGN KEY**(含 whole-row)。
  --      **觸發器 / RULE / DOMAIN 約束仍不在它的分母裡** —— 那三種擋得住第三個值而本閘看不到。
  SELECT string_agg(c.conname, ', ' ORDER BY c.conname) INTO v_others
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_attribute a
      ON a.attrelid = c.conrelid AND a.attname = 'event_type'
   WHERE c.conrelid = 'public.email_outbox'::regclass
     -- 🔴 R2 must-fix(1/2):`contype = 'c'` **排掉了 FOREIGN KEY** ——
     --    一條指向「只有舊兩值」的參照表的 FK,會讓第三個值以 **23503** 被拒,
     --    而本閘完全看不到它。⇒ CHECK 與 FK **兩種都要**。
     --    ⚠️ **刻意不含 `'u'`(UNIQUE)** —— 唯一鍵**不限制值域**,收它沒有用。
     --      🔴 **而理由只有這一個**(R3 抓、本窗實測更正;原句作廢留痕):
     --      ~~「這張表本來就有 `UNIQUE (event_type, dedup_key)` ⇒ 收 'u' 會讓本閘每次都紅」~~ —— **假的**。
     --      那個唯一鍵是 `CREATE UNIQUE INDEX email_outbox_event_uniq`(`20260717020000:377`),
     --      而 **`CREATE UNIQUE INDEX` 在 `pg_constraint` 裡一列都沒有**
     --      (2026-09-02 PG 17.10 實測 ⇒ 0;🔵 正對照 `ALTER TABLE … ADD CONSTRAINT … UNIQUE` ⇒ 1 列 `contype='u'`)。
     --      ⇒ 📌 **一個【行為正確而理由是假的】守門,會把下一個想放寬射程的人勸退。**
     --      ⇒ 具體被勸退的那一格:**`'x'`(EXCLUDE)真的擋得住值域,而它今天不在分母裡。**
     AND c.contype IN ('c', 'f')
     -- 🔴 R2 must-fix(2/2):`attnum = ANY(conkey)` **漏掉 whole-row 的寫法** ——
     --    `CHECK (f(tbl.*))` 這種間接讀該欄的約束,`conkey` 存的是 **{0}** 不是欄的 attnum。
     --    (2026-09-02 拋棄式 PG 17.10 實測:同表兩條 CHECK ⇒ `c_named|{1}` / `c_wholerow|{0}`,
     --     而原查詢**只撈到 c_named**。)⇒ 兩種都收。
     --    ⚠️ 代價:表上**任何**別欄的 whole-row CHECK 也會讓本閘紅 ⇒ **會誤報**。
     --      這是刻意的 fail-closed:誤報會停下來問人,漏報會讓 apply 印綠而寫不進去。
     AND (0 = ANY (c.conkey) OR a.attnum = ANY (c.conkey))
     AND c.conname <> 'email_outbox_event_type_check';
  IF v_others IS NOT NULL THEN
    RAISE EXCEPTION '前置閘⑤:event_type 這一欄上除了 email_outbox_event_type_check 之外還掛著別的【CHECK 或 FOREIGN KEY】(含 whole-row 寫法)⇒ 放寬了也可能寫不進去(23514 或 23503),停下人工確認。⚠️ 本閘刻意誤報大於漏報:別欄的 whole-row CHECK 也會命中。多出來的:%', v_others;
  END IF;
END
$$;

-- ── 1. 換 CHECK(ADD NOT VALID → VALIDATE → DROP 舊 → RENAME)──────────────
ALTER TABLE public.email_outbox
  ADD CONSTRAINT email_outbox_event_type_check_v2
  CHECK (event_type IN ('order_created', 'order_shipped', 'order_cancelled')) NOT VALID;
ALTER TABLE public.email_outbox VALIDATE CONSTRAINT email_outbox_event_type_check_v2;
ALTER TABLE public.email_outbox DROP CONSTRAINT email_outbox_event_type_check;
ALTER TABLE public.email_outbox
  RENAME CONSTRAINT email_outbox_event_type_check_v2 TO email_outbox_event_type_check;

-- ── 2. event_type 的 COMMENT(🔴 這一欄【今天沒有 COMMENT】,本片是第一次給它)──────
--    2026-09-02 實查:`grep -rn "COMMENT ON COLUMN public.email_outbox.event_type" supabase/migrations/*.sql`
--    ⇒ rc=1、零命中 ⇒ 契約至今只住在 `20260717020000:299` 的**行尾註解**裡,
--      而行尾註解 `\d+` 看不到、psql 讀不到 ⇒ 只有開那支檔的人看得到。
COMMENT ON COLUMN public.email_outbox.event_type IS
  '事件型別(CHECK 白名單;**新增事件 = 新 migration**)。3 值:
order_created(付款成功通知)/ order_shipped(出貨通知)/ 🔴 order_cancelled(2026-09-02 新增:訂單取消通知)。
🔴 **它同時是去重鍵的一半**(唯一索引 `email_outbox_event_uniq ON public.email_outbox (event_type, dedup_key)`)
⇒ **不可以借用既有值來省一個 migration** —— 借用會讓兩條線的信互相擋掉對方的唯一鍵 = 製造漏信面。
🔴 **order_cancelled 的射程(Sean 2026-09-02 拍甲)**:只涵蓋【刷卡 且 已全額退款】的整單取消,
且那一次取消**一個品項數量都不會動**(分兩步的第一步)。**部分退款不涵蓋**、部分品項取消不涵蓋。
⚠️ **值域打開 ≠ 有人可以用它** —— **本 CHECK 一個字都不管刷卡與退款**,它只管值域。
🛑 **中間態(四片分開上的代價,兩個風險而機率差很多 —— 大的先寫)**:
① 🔴 **真正會發生的是【部署順序】** —— enqueue(片④)先上而模板(片③)後上 ⇒ 見下面「反序部署」那段。
   **而沒有任何機制擋得住那個順序**(`scripts/deploy-order-gate.sh` 掃 `.from()` / `.rpc(`,
   一個寫在 use-case 裡的 event_type 字串對它是隱形的)⇒ 靠人。
② ⚠️ **本片 apply 當下那三道業務閘還不存在**(codex R1 抓;不要把未來式寫成現在式):
   寫這一列的那支函式是**片②**。在它落地之前,拿得到 service_role 的路徑可以寫一列 order_cancelled
   而沒有東西問它是不是刷卡、是不是已全額退款 —— **但那要有人主動走一條今天沒有呼叫端的路**
   ⇒ 機率遠低於 ①。片② 落地時要把三道閘寫進函式並附負向測試。
🛑 **反序部署**:enqueue 先上而模板後上 ⇒ sweeper 的 default 分支 throw
(`packages/use-cases/src/sweep-email-outbox.ts`,錨字串 `satisfies never` 與訊息 `未知 event_type、fail-closed 不寄`
—— 🔴 **本 COMMENT 刻意不寫行號**:它會被寫進正式庫,而讀 `\d+` 的人沒有 repo 可以 grep,
行號漂了他發現不了。錨字串漂了至少 grep 得到零命中。)⇒ 計 error、列留 sending、耗盡 attempts 進死信
⇒ 那一列佔住唯一鍵 ⇒ **那位客人再也收不到這封信而零訊號**(同 skipped_shipment_voided 的母題)。';

-- ── 3. 事後閘 ───────────────────────────────────────────────────────────
DO $$
DECLARE
  v_def text;
  v_valid boolean;
  v_com text;
  v_others text;
  v_expect constant text :=
    'CHECK ((event_type = ANY (ARRAY[''order_created''::text, ''order_shipped''::text, ''order_cancelled''::text])))';
BEGIN
  SELECT pg_catalog.pg_get_constraintdef(c.oid), c.convalidated INTO v_def, v_valid
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.email_outbox'::regclass
     AND c.conname = 'email_outbox_event_type_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '事後閘①:改名之後找不到 email_outbox_event_type_check';
  END IF;
  IF v_def <> v_expect THEN
    RAISE EXCEPTION '事後閘②:CHECK 與預期【不是同一段】。實際:% / 預期:%', v_def, v_expect;
  END IF;
  IF NOT v_valid THEN
    RAISE EXCEPTION '事後閘③:新 CHECK 仍是 NOT VALID ⇒ VALIDATE 沒跑到';
  END IF;

  v_com := pg_catalog.col_description('public.email_outbox'::regclass,
             (SELECT attnum FROM pg_catalog.pg_attribute
               WHERE attrelid = 'public.email_outbox'::regclass AND attname = 'event_type'));
  IF v_com IS NULL OR pg_catalog.strpos(v_com, 'order_cancelled') = 0 THEN
    RAISE EXCEPTION '事後閘④:event_type 的 COMMENT 沒有提到 order_cancelled ⇒ 契約與碼分岔了';
  END IF;
  IF pg_catalog.strpos(v_com, '3 值') = 0 THEN
    RAISE EXCEPTION '事後閘⑤:event_type 的 COMMENT 裡找不到「3 值」這兩個字 ⇒ 還寫著舊的值數。(本閘找【任意位置】,不是開頭。)';
  END IF;

  -- 🔴 事後閘⑥(同 codex R1 must-fix 的另一半):改完之後這一欄上仍然只准有我們這一條。
  --    前置閘⑤ 擋的是「本來就有第二條」。
  -- 🛑 **而本閘自陳的那個場景【到不了】**(R3 抓、本窗 PG 17.10 實測更正;原句作廢留痕):
  --    ~~「例如 DROP 舊約束那一行被誰改掉 ⇒ 新舊兩條同時存在 ⇒ 舊那條照樣拒第三值」~~
  --    ⇒ 實測:拿掉 DROP 之後,下一行的 `RENAME CONSTRAINT … TO email_outbox_event_type_check`
  --      **會先炸** `ERROR: constraint "…" for relation "…" already exists` ⇒ 根本走不到本閘。
  --    ⇒ 而在 ACCESS EXCLUSIVE + 單一交易底下,前置閘⑤ 之後也不可能冒出第二條。
  --    📌 ⇒ **本閘今天是一道【不會叫的閘】。** 留著無害(它對「未來有人重排這幾行」仍是網),
  --      而**理由必須寫成真的** —— 否則它會被日後引用成「我們有擋」,而那是一句沒有人驗過的話。
  SELECT string_agg(c.conname, ', ' ORDER BY c.conname) INTO v_others
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_attribute a
      ON a.attrelid = c.conrelid AND a.attname = 'event_type'
   WHERE c.conrelid = 'public.email_outbox'::regclass
     -- 🔴 R2 must-fix(1/2):`contype = 'c'` **排掉了 FOREIGN KEY** ——
     --    一條指向「只有舊兩值」的參照表的 FK,會讓第三個值以 **23503** 被拒,
     --    而本閘完全看不到它。⇒ CHECK 與 FK **兩種都要**。
     --    ⚠️ **刻意不含 `'u'`(UNIQUE)** —— 唯一鍵**不限制值域**,收它沒有用。
     --      🔴 **而理由只有這一個**(R3 抓、本窗實測更正;原句作廢留痕):
     --      ~~「這張表本來就有 `UNIQUE (event_type, dedup_key)` ⇒ 收 'u' 會讓本閘每次都紅」~~ —— **假的**。
     --      那個唯一鍵是 `CREATE UNIQUE INDEX email_outbox_event_uniq`(`20260717020000:377`),
     --      而 **`CREATE UNIQUE INDEX` 在 `pg_constraint` 裡一列都沒有**
     --      (2026-09-02 PG 17.10 實測 ⇒ 0;🔵 正對照 `ALTER TABLE … ADD CONSTRAINT … UNIQUE` ⇒ 1 列 `contype='u'`)。
     --      ⇒ 📌 **一個【行為正確而理由是假的】守門,會把下一個想放寬射程的人勸退。**
     --      ⇒ 具體被勸退的那一格:**`'x'`(EXCLUDE)真的擋得住值域,而它今天不在分母裡。**
     AND c.contype IN ('c', 'f')
     -- 🔴 R2 must-fix(2/2):`attnum = ANY(conkey)` **漏掉 whole-row 的寫法** ——
     --    `CHECK (f(tbl.*))` 這種間接讀該欄的約束,`conkey` 存的是 **{0}** 不是欄的 attnum。
     --    (2026-09-02 拋棄式 PG 17.10 實測:同表兩條 CHECK ⇒ `c_named|{1}` / `c_wholerow|{0}`,
     --     而原查詢**只撈到 c_named**。)⇒ 兩種都收。
     --    ⚠️ 代價:表上**任何**別欄的 whole-row CHECK 也會讓本閘紅 ⇒ **會誤報**。
     --      這是刻意的 fail-closed:誤報會停下來問人,漏報會讓 apply 印綠而寫不進去。
     AND (0 = ANY (c.conkey) OR a.attnum = ANY (c.conkey))
     AND c.conname <> 'email_outbox_event_type_check';
  IF v_others IS NOT NULL THEN
    RAISE EXCEPTION '事後閘⑥:改完之後 event_type 這一欄上還掛著別的【CHECK 或 FOREIGN KEY】(含 whole-row 寫法)⇒ 第三個值仍可能寫不進去。多出來的:%', v_others;
  END IF;

  RAISE NOTICE '事後閘通過(定義層六格:①②③④⑤⑥):①改名後找得到 ②CHECK 逐字相符 ③已 validated ④COMMENT 有 order_cancelled ⑤COMMENT 已寫 3 值 ⑥這一欄上沒有第二條 CHECK。🛑 **它們證不到的**:(a)**不驗行為** —— 「CHECK 的字面對了」與「它擋不擋得住東西」是兩個宣稱,行為那一層在 scripts/email-outbox-order-cancelled-verify.sh(拋棄式 PG);(b)④⑤ 是**字串有沒有出現**,不是語意 —— 一句「order_cancelled 已作廢、不是 3 值」**兩道都會過**(codex R1 nit)⇒ 它們擋的是「忘了改 COMMENT」,擋不住「改成相反的意思」;(c)⑤⑥ 看的是 **CHECK 與 FOREIGN KEY**(含 whole-row `conkey={0}`)—— **觸發器 / RULE / DOMAIN 不在分母裡**,那三種擋得住第三個值而它們看不到。';
END
$$;

-- ── 4. 行為那一層【刻意不在本檔做】────────────────────────────────────────
-- 🔴 上面【六道】閘(前置 ①-⑤ + 事後 ①-⑥)驗的是【定義】。**一個 CHECK 的字面對了,與它擋不擋得住東西,是兩個宣稱。**
-- 🛑 **不要在這裡加「對真表 INSERT 一列再回捲」的探針** —— Sean 2026-08-30 拍板【甲】把
--    同族的那一道拿掉了,完整理由(它存在的理由與它的危險是同一個前提 / 結構性死結環 /
--    最危險的那一格 harness 量不到)在 `20260830060000:230-270`。**動手之前先讀那一段。**
-- ✅ 行為驗證落點:`scripts/email-outbox-order-cancelled-verify.sh`(拋棄式 PG,本片同時新增)。
COMMIT;
