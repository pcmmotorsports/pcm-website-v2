-- ============================================================
-- `#866` 片 2/2:把上限**執行**起來(BEFORE INSERT OR UPDATE trigger)
-- ============================================================
-- 🔴 **這道閘保護的是誰(2026-08-24 R2 F2;先講,免得招牌比事實寬)**
--    ✅ 真正的受益者 = **打錯金額的誠實員工**(要退 1500、打成 15000 ⇒ 當場被擋、沒有登記任何東西)
--    ⚠️ 對**有授權又有意的內部人**,它只是**減速帶**不是牆 —— 他可以先灌一筆假收款(見下方「擋不住什麼」)
--    ⇒ **不要拿這道去回答「錢會不會被偷」那個問題。** 那題的答案在共用密碼那個條目,不在這裡。
-- 前置 = `20260824010000_m4b_866_manual_refund_rail_cap.sql`(建 `pcm_manual_refund_rail_cap`)
-- 命中 = 鐵則 12①(錢)+ 12③(動 DB 結構)⇒ 對抗審查不降級
-- 驗證 = `bash scripts/866-rail-cap-verify.sh`(拋棄式 PG;含突變)
--
-- ── 🔴 為什麼是 trigger 而不是改 RPC(主視窗 2026-08-24 裁【乙】)────────────
-- plan 原本寫「`CREATE OR REPLACE FUNCTION admin_record_manual_refund` 加一道檢查」。實查後改:
--   · 那支 RPC 的**現行版**在 `20260823020000:290-482` = **193 行**
--     (⚠️ **不在建立它的 `20260820021000`** —— 退款通知片 2a 2026-08-23 整支換掉了它)
--   · 甲要**逐字複製那 193 行** ⇒ 🔴 **那就是「兩份會分岔」的形狀本身**,
--     而那條線今天才動過它一次;下次再動,**後 apply 的覆蓋先 apply 的,而且沒有訊號**
--   · 乙 ⇒ 不必複製、零分岔面,而且**覆蓋每一條【一般權限的】寫入路徑**,含
--     **直接在 SQL Editor `INSERT`** —— 而 `manual-refund-entry-gate.ts` 檔頭**明文警告過那條路**
-- 🔴 **而「每一條」那句話原本超出事實,這裡收窄**(2026-08-24 codex nit;與上一輪改的
--    「這道閘保護的是誰」是**兩件事** —— 那是**定位**,這是**射程**):
--      · `owner` / `superuser` 可 `ALTER TABLE … DISABLE TRIGGER`,或以 replica 模式寫入 ⇒ 繞過
--      · ~~`DELETE` 不觸發本閘~~ ⇒ **2026-08-24 已補**(見函式頂端 `TG_OP = 'DELETE'` 那段)
--      · 🔴 **`TRUNCATE` 仍然不觸發 row trigger,而且連 RLS 都不受管**
--        (`docs/patterns/revoking-function-execute-in-supabase.md`)⇒ **這一條還開著,照實寫。**
--    ⇒ **它擋的是「用一般權限、透過正常寫入路徑」的超額登記。** 別的請不要靠它。
-- ⚠️ **代價(照實寫)**:trigger 的錯誤訊息形狀不如寫在 RPC 內好控
--    ⇒ **漂亮的訊息交給畫面層接住**(業務判定單一真相在 DB)。已寫進 plan 未做清單。
--
-- ── ⚠️⚠️ 這道 trigger 唯一會在未來咬人的地方(主視窗要求寫進檔頭)────────────
-- **它對【所有】INSERT 生效,包含日後任何回填 / 資料搬遷。**
-- `order_manual_refunds` 2026-08-22 唯讀實測 **0 列** ⇒ 今天無回填風險 ——
-- 🔴 **但那是【今天】的事實,不是這道 trigger 的性質。**
-- ⇒ 日後要回填歷史退款(例如把紙本帳搬進來)時,那些列**很可能沒有對應的 `order_payments` 收款列**
--   ⇒ 會被這道擋下。**那時要的是一次性的受控停用,不是把這道刪掉。**
--
-- ── 🔴 本片【擋不住】什麼(不宣稱堵死)──────────────────────────────────
-- 分母 `order_payments` **可以被姊妹 RPC 灌水**:
--   `admin_record_manual_payment` 只驗 `p_amount > 0`(`20260810200000:168-170`)、**零上界**,
--   而它**接受 `unpaid` 單**(同檔 `:236-238` allowlist 含 `'unpaid'`)。
-- ⇒ 先灌一筆假的 `bank_transfer` 收款,再退它 ⇒ **本 trigger 會放行**。
-- 🔴 **⇒ 本片把洞從【退款端】搬到【收款端】,不是堵死。**
--    而收款端**沒有一個正確的上限值可以用** —— 溢收在本 repo 是合法業務動作
--    (收兩筆定金 / 客人多匯;DB 的 G3 只擋 `<= 0`、不擋超額)。
-- ⇒ 真正的根因是**兩支 RPC 共用同一道 `authorizeAdminMutation`,而後台是共用密碼**
--   ⇒ 那是**歸屬 / 稽核**問題,不是數字上限問題。**另立條目,不叫它「再補一道上限」。**
-- ⚠️ 而那條路**比原洞吵**:它留下一筆可見的假收款列(進今日已收 / 訂單詳情 / 訂單列表)。
-- ============================================================

-- ── 🔴 這道閘丟出來的錯,有【自訂 SQLSTATE】(2026-08-24 codex must-fix 後加)──────
--   `PCM01` = 超過軌別上限(金額問題,員工看得懂、可自行修正)
--   `PCM02` = 算不出上限(**不是**金額問題,要找工程)
--   `PCM03` = 想刪掉一筆退款登記(要用「作廢」;2026-08-24 R3 F2)
-- ⇒ **畫面層請認碼,不要認中文字面** —— 認字面等於把文案變成 API。
-- ⇒ 而 harness 的負測也認碼:少了它,任何 SQL 錯誤都會冒充成「上限命中」。
--
-- ── 🔴 **併發:這道閘擋得住金額,擋不住併發**(2026-08-24 主視窗裁【甲】,不加鎖)────
-- ① 明寫:兩個交易各自登記,彼此看不到對方未提交的列 ⇒ 都讀到同一個 cap ⇒ 合計可超額。
-- ② **那條路只在「有人繞過 RPC 直接寫 SQL」時可達** ——
--    `admin_record_manual_refund` 與 `admin_record_manual_payment` **都已經對 orders 那一列
--    `FOR UPDATE`**(`20260823020000:66`、`20260812150000:394`)⇒ 走 RPC 的併發已被序列化。
-- ③ **為什麼不在本 trigger 內加鎖**(逐字出處 `20260823020000:65-70`):
--      admin_record_manual_refund          :216 `FROM public.orders … FOR UPDATE`  ⇒ orders 先
--      admin_void_manual_refund            對 orders 上鎖命中 0 ⇒ 先鎖 order_manual_refunds(子表)
--      admin_correct_order_refund_verdict  對 orders 上鎖命中 0 ⇒ 先鎖 order_refunds(子表)
--      「而 C 那支已經因為鎖的形狀踩過一次**死結**」
--    ⇒ 在本 trigger 取 orders 鎖 = **製造第二種鎖順序** ⇒ 死結。
--    ⇒ 而死結在正式庫的形態是「畫面轉圈、其中一邊被 PG 砍掉」——
--      **用一個會發生在真人面前的故障,去換一個要先違規才走得到的路,不划算。**
-- ④ 🔴 **失效條件(沒有這一條,這個「不做」半年後看起來像漏做)**:
--    **哪天 `admin_void_manual_refund` 的鎖順序改成「orders 先」** ⇒ 第二種順序消失
--    ⇒ **回訪本決定**,那時「在 trigger 內取 orders 鎖」才變成一行的事。
--
-- ⚠️ 另一格:**單一語句多列**(`INSERT … VALUES (600),(600)`)本窗在
--    **PostgreSQL 17.10 (Homebrew)** 上實測**會被擋**(第二列 PCM01)。
--    🔴 **而 Supabase 的 PG 版本未確認** ⇒ 這一格的狀態是「本機量不到,正式庫未知」,
--       **不是「不會發生」**。
--
-- ══ 0. 前置閘 ═════════════════════════════════════════════════════════
DO $pre$
BEGIN
  IF to_regprocedure('public.pcm_manual_refund_rail_cap(uuid)') IS NULL THEN
    RAISE EXCEPTION '#866 片2 前置閘:pcm_manual_refund_rail_cap 不存在 ⇒ 先 apply 20260824010000';
  END IF;
  IF to_regclass('public.order_manual_refunds') IS NULL THEN
    RAISE EXCEPTION '#866 片2 前置閘:public.order_manual_refunds 不存在';
  END IF;
  -- 🔴 **fail-closed,不是冪等**(2026-08-24 codex must-fix,同片1):
  --    `CREATE OR REPLACE` 會覆寫同名函式而**保留它既有的 owner 與額外 ACL**
  --    ⇒ 別人先種的一支,我們蓋上定義、權限卻還是他的,而 B3 只查 PUBLIC/anon。
  -- 🔴 F4:`refund_amount` 的 `NOT NULL` 是本片比較式的承重件(理由寫在函式 `IF … >` 那一行旁)
  IF NOT EXISTS (SELECT 1 FROM pg_attribute
                  WHERE attrelid = 'public.order_manual_refunds'::regclass
                    AND attname = 'refund_amount' AND attnotnull
                    AND NOT attisdropped AND attnum > 0) THEN
    RAISE EXCEPTION '#866 片2 前置閘:order_manual_refunds.refund_amount 不是 NOT NULL'
      ' ⇒ NULL 金額會讓比較式回 NULL ⇒ 本閘【靜靜放行】';
  END IF;
  IF to_regprocedure('public.pcm_manual_refund_rail_cap_guard()') IS NOT NULL THEN
    RAISE EXCEPTION '#866 片2 前置閘:public.pcm_manual_refund_rail_cap_guard() 已存在。'
      '⇒ 本檔【不覆寫】。要重套先 DROP TRIGGER 再 DROP FUNCTION,並確認那支是我們建的。';
  END IF;
END
$pre$;

-- ══ 1. 檢查函式 ═══════════════════════════════════════════════════════
-- 🔴 **UPDATE 的餘裕與 INSERT 不同,而那是本檔最容易寫錯的一格**:
--    `pcm_manual_refund_rail_cap` 會扣掉「**已在表內且未作廢**」的列。
--    · INSERT:新列還不在表內 ⇒ 餘裕就是 cap
--    · UPDATE:**OLD 那筆已經被扣過了** ⇒ 餘裕 = cap + OLD.refund_amount(OLD 未作廢時)
--      少了這一項 ⇒ 把 500 改成 500 都會被拒(它把自己扣了兩次)。
CREATE FUNCTION public.pcm_manual_refund_rail_cap_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_cap       bigint;
  v_headroom  bigint;
BEGIN
  -- 🔴🔴 **`DELETE`(2026-08-24 R3 / Fable F2 must-fix)—— 選【甲】:在這裡擋,不 REVOKE。**
  --
  -- 病灶:本閘原本是 `BEFORE INSERT OR UPDATE`,而**沒有任何一片管這張表的 `DELETE` 權限**。
  --   刪掉一筆退款登記 ⇒ **額度憑空回來,而且零痕跡**(作廢至少留 `voided_at`;DELETE 什麼都不留)
  --   ⇒ 可以退第二次。
  -- 📌 **它與「作廢後復活」是同一族的第二個成員** —— 上一輪修掉復活,這是另一條門。
  -- 🔴 而最該記住的是它怎麼活下來的:
  --   **「我這片不管它」+「沒有別片管它」= 沒有人管它,而前一句單獨看完全合理。**
  --
  -- 為什麼選甲不選乙(REVOKE DELETE):
  --   · 甲**對所有角色生效,包含日後新增的** —— REVOKE 是逐角色的,而
  --     `ALTER DEFAULT PRIVILEGES` 可能早就發過整套(本 repo 今天已有兩次實錘)
  --   · 甲**與本片其他規則住在同一個檔** ⇒ 讀的人一次看得完,不必去翻 GRANT 的歷史
  --   · ⚠️ 甲的上限與本檔其他規則相同:`owner`/`superuser` 仍可 DISABLE TRIGGER。**照實寫。**
  -- ⚠️ **代價**:日後要清理歷史退款列時會被擋 ⇒ 那時要的是**一次性的受控停用**,不是刪掉這道。
  -- 🔴🔴 **而少了這道分支,結果【不是「刪得掉」】—— 是「靜靜地什麼都沒發生」**
  --    (2026-08-24 harness `M6` 實測,不是推論):
  --      DELETE 時 `NEW` 是 NULL ⇒ 下面每一個 `NEW.*` 都是 NULL
  --      ⇒ `NULL > v_headroom` 不成立 ⇒ 一路走到 `RETURN NEW`,而 **NEW 是 NULL**
  --      ⇒ **BEFORE ROW trigger 回 NULL = 取消這個動作,而且不報錯。**
  --    ⇒ 操作的人以為刪掉了,資料還在,沒有錯誤訊息也沒有 SQLSTATE。
  --    📌 **所以這道分支真正在做的事,是把【沉默】換成【一句說得出理由的拒絕】。**
  --
  -- 🔴🔴 **而最該讓下一個人知道的是這一句**:
  --    **這不是本片造成的行為,是本片【照出來】的 —— 而在本片之前,沒有人觀察過這張表的 DELETE。**
  --    那個「靜靜取消」從 `20260820010000` 建表之後就一直是這張表的行為,
  --    只是**沒有任何一片管過 DELETE**,所以也**沒有任何一發量測會經過它**。
  --    📌 一般化:**「接線 / 加一道分支」這個動作本身,常常是那個東西第一次被檢驗。**
  --      ⇒ 所以動一支老東西時,**先假設你會照出一些不是你造成的東西**,
  --        而它們會長得像你剛弄壞的 —— 判別法是問「這個行為在我動手【之前】存不存在」。
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      '人工退款登記**不能刪除** —— 要取消請用「作廢」(它會把額度還回來,而且留得下紀錄)。'
      '🔴 直接刪掉會讓額度憑空回來且**查不到是誰做的**,那正是這道規則要防的。'
      USING ERRCODE = 'PCM03';
  END IF;

  IF NEW.voided_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_cap := public.pcm_manual_refund_rail_cap(NEW.order_id);

  IF v_cap IS NULL THEN
    -- 🔴 **自訂 SQLSTATE `PCM02`,而它有兩個用途,兩個都承重**:
    --   ① 畫面層要把這個錯翻成人話 ⇒ 它需要一個**機器認得的碼**;
    --      釘中文訊息字面 = 把文案變成 API,改一個字就壞。
    --   ② harness 的負測要分得出「**是我們這道閘擋的**」與「別的錯誤剛好也讓它失敗」。
    --      2026-08-24 codex 抓到:原本的負測只問「有沒有 error」
    --      ⇒ FK / CHECK / NOT NULL / 權限 / 斷線**全都會冒充成「上限命中」**。
    -- ⚠️ **這一段幾乎不會走到,而措辭要照實**(2026-08-24 codex nit):
    --    真的「讀不到帳本」通常直接拋權限 / relation 不存在的錯,**不會回 NULL 走到這裡**。
    --    會讓它回 NULL 的是**算式本身出了預期外的狀況** ⇒ 所以不寫「讀不到帳本」,
    --    寫「算不出來」。行為仍是 fail-closed,只是**不宣稱知道原因**。
    RAISE EXCEPTION
      '這張單算不出可退上限 ⇒ 為了安全先擋下,沒有登記任何東西。'
      '🔴 這與「金額太大」不同:那是金額問題,這是**系統算不出上限**,請找工程確認。'
      USING ERRCODE = 'PCM02';
  END IF;

  v_headroom := v_cap;
  -- 🔴 `OLD.order_id = NEW.order_id` 這一項是 2026-08-24 codex 抓到的洞,**不是防禦性贅字**:
  --    少了它 ⇒ 把 A 單上一筆已退 1000 的列 `UPDATE … SET order_id = B` 時,
  --    cap 算的是 **B 單**(零實收 ⇒ 0),而餘裕卻加回 **A 單那筆**的 1000
  --    ⇒ B 拿到 1000 的假餘裕 ⇒ **通過**。
  --    ⚠️ 而這**不是併發** —— 是單一交易裡的一個合法 UPDATE,一個人就做得到。
  IF TG_OP = 'UPDATE' AND OLD.voided_at IS NULL AND OLD.order_id = NEW.order_id THEN
    v_headroom := v_cap + OLD.refund_amount;
  END IF;

  -- 🔴 **這一行的承重件不在本檔**(2026-08-24 R3 / Fable F4):
  --    `NEW.refund_amount` 若是 `NULL` ⇒ `NULL > v_headroom` 回 `NULL` ⇒ `IF` 不成立
  --    ⇒ **靜靜放行**。今天不會發生,靠的是**另一支 migration**:
  --      `20260820010000` 的 `refund_amount integer NOT NULL CHECK (refund_amount > 0)`
  --    ⇒ **那道 NOT NULL 是這道 trigger 的承重件,而它寫在別人的檔裡。**
  --    ⇒ 有人日後放寬它,這裡不會報錯,只會**靜靜放行**。
  --    ✅ 所以前置閘現在**也驗那道 NOT NULL**(見 §0)—— 讓依賴變成會執行的東西,不是註解。
  IF NEW.refund_amount > v_headroom THEN
    -- 🔴 **負餘裕也走這句人話**(F-nit):髒資料下 cap 可能是負的,
    --    而「軌別上限 -500」對員工是不可讀的。**fail-closed 的行為對,訊息也要對。**
    RAISE EXCEPTION
      -- ⚠️ **「總共只收到」這個說法不精確**(2026-08-24 codex nit,照實留著):
      --    `v_headroom` 已經扣掉這張單其他未作廢的退款,UPDATE 時還加回 OLD
      --    ⇒ 它是**還能退多少**,不是**收到多少**。改成精確措辭要動文案,
      --    而文案的權威不在本檔 ⇒ 留給畫面層那片一起定(未做清單已記)。
      '這張單在【現金 / 匯款】上目前只剩 % 元可退,退不了 % 元。'
      '(卡片刷的錢不算在這裡 —— 那要走卡片退款。'
      '若這張單確實收過現金或匯款,請先把那筆收款登記進系統。)',
      GREATEST(v_headroom, 0), NEW.refund_amount
      USING ERRCODE = 'PCM01';
  END IF;

  RETURN NEW;
END
$fn$;

COMMENT ON FUNCTION public.pcm_manual_refund_rail_cap_guard() IS
  '#866 執行點:人工退款不得超過該單在現金/匯款兩軌的淨實收。'
  'BEFORE INSERT OR UPDATE(不限欄位)ON order_manual_refunds ⇒ 含作廢後的復活那條路。'
  '⚠️ 射程上限:owner/superuser 可 DISABLE TRIGGER 或走 replica 模式繞過;'
  'TRUNCATE 不觸發 row trigger(DELETE 已於 2026-08-24 納入,回 PCM03)。'
  '⚠️ 它主要擋的是【打錯金額的誠實員工】(1500 打成 15000),對有授權的內部人只是減速帶。'
  '⚠️ 它擋不住上游:admin_record_manual_payment 零上界且接受 unpaid 單 ⇒ 分母可被灌水(見本片檔頭)。';

REVOKE ALL ON FUNCTION public.pcm_manual_refund_rail_cap_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_manual_refund_rail_cap_guard() FROM anon;
REVOKE ALL ON FUNCTION public.pcm_manual_refund_rail_cap_guard() FROM authenticated;

-- ══ 2. 掛上去 ═════════════════════════════════════════════════════════
-- ~~🔴 `UPDATE OF refund_amount` —— 不是全部 UPDATE:作廢那條路不動 `refund_amount`
--    ⇒ 用欄位限定就分得開,不必在函式裡再判一次。~~
-- 🔴🔴 **2026-08-24 R2 抓到:那個欄位限定【就是】唯一的洞源。撤掉。**
--    復活序列(本窗複打,每一步都走得通):
--      登記 1000(過)→ 作廢(過)→ 再登記 1000(額度已還,過)
--      → `UPDATE … SET voided_at = NULL` ⇒ **不動 `refund_amount` ⇒ trigger 不觸發**
--      ⇒ 總退 2000 / 實收 1000
--    🔴 而下面 COMMENT 原本逐字寫著「含 SQL Editor 直接寫」——
--       **`SET voided_at = NULL` 正是只有 SQL Editor 會做的動作**
--       (實查:`voided_at` 全 repo 只有兩處實碼在寫,`20260814180000:350` 與
--        `20260820100000:359`,**兩處皆 `= now()`,零處 `= NULL`**)
--       ⇒ **招牌指名的那條路,恰好是漏的那條。**
--    📌 原理由的**前半是真的**(作廢確實不動 `refund_amount`),
--       **後半的結論不成立** —— 函式 `:67-69` 本來就用 `NEW.voided_at IS NOT NULL` 早退分得開,
--       **不需要 trigger 幫它分**;而多加的那道限定只做了一件事:放掉一條路。
--
--    ✅ 拿掉之後三種 UPDATE 逐格推過,**零誤擋**(harness 3b 有對應的格子):
--      作廢        `NEW.voided_at` NOT NULL   ⇒ `:67` 早退                不擋
--      復活        `OLD.voided_at` NOT NULL   ⇒ 餘裕不加回 OLD            **正確地檢查**
--      改無關欄位  `NEW.refund_amount = OLD`  ⇒ 餘裕 = cap + OLD ⇒ 相等    恆過
--
-- 🔴 **本片給下一個人的判別句(比這個 bug 本身重要)**:
--    我對 **INSERT 那一側**的性質論證寫得很嚴(見檔頭 `:20-24`「今天的事實不是 trigger 的性質」),
--    **而 UPDATE 那一側,我套了一句「今天只動那一欄」就過了。**
--    ⇒ **同一份檔裡對一半嚴格、對另一半寬容,寫的人不會察覺** ——
--      因為嚴格的那一半就在旁邊,**它讓整份看起來是嚴格的。**
DROP TRIGGER IF EXISTS trg_pcm_manual_refund_rail_cap ON public.order_manual_refunds;
CREATE TRIGGER trg_pcm_manual_refund_rail_cap
  BEFORE INSERT OR UPDATE OR DELETE ON public.order_manual_refunds
  FOR EACH ROW
  EXECUTE FUNCTION public.pcm_manual_refund_rail_cap_guard();

-- ══ 3. 後置斷言(同一交易;不過 ⇒ 整筆 ROLLBACK)═══════════════════════
-- ⚠️ **只驗「裝上去了」與「權限」——【不驗行為】**。
--    行為要捏資料,而捏的資料過不了本表的 FK(`order_id → orders`)⇒ 在正式庫必炸。
--    🔴 那是本片 1/2 親手踩過的坑(A5/A6 已因此撤回)⇒ **行為的證人在 harness,不在這裡。**
DO $post$
DECLARE
  -- 🔴 新物件收權斷言的【清單】(`scripts/migration-new-file-static-checks.sh` ③ 要它可被數)。
  --    簽章逐字從本檔 `:112` 的 `CREATE FUNCTION` 抄(`to_regprocedure` 對參數型別逐字比對)。
  v_relations text[] := ARRAY[]::text[];
  v_functions text[] := ARRAY[
    'public.pcm_manual_refund_rail_cap_guard()'
  ]::text[];
  v_n int;
  v_fn oid;
  r    text;
BEGIN
  -- ══ B0 清單迴圈 ══════════════════════════════════════════════════════════
  -- 🔴🔴 **本迴圈的形狀【刻意與片1 / `#858` 那支不同,少了一道】,不要照抄回去。**
  --    那兩支的第三格是「service_role **必須有** EXECUTE」。**這一支不能那樣寫** ——
  --    ```
  --    這是一支【trigger 函式】:它由 trigger 呼叫,而 trigger 執行時走的是【表擁有者】的身分,
  --    不看呼叫者對這支函式有沒有 EXECUTE
  --    ⇒ 本檔【刻意沒有】GRANT EXECUTE … TO service_role(:226-228 只有三道 REVOKE)
  --    ⇒ 照抄片1 那一格會斷言一個【我們刻意不給】的權限 ⇒ apply 直接紅
  --    ```
  --    📌 判別句:**一份「合格範本」保證的是格式,不是語意。抄之前要問這個物件是不是同一種東西。**
  --    ⇒ 這裡改成斷言「**沒有任何一個 client 角色叫得動它**」——那才是這支函式該有的樣子。
  FOREACH r IN ARRAY v_functions LOOP
    v_fn := pg_catalog.to_regprocedure(r);
    IF v_fn IS NULL THEN
      RAISE EXCEPTION '#866 片2 B0 失敗:找不到函式 %(簽名打錯或沒建成)⇒ 拒繼續', r;
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '#866 片2 B0 失敗:% 對 anon/authenticated 開著 EXECUTE(三道 REVOKE 少了一道?)', r;
    END IF;
    -- ⚠️ service_role 這一格**不斷言「必須有」,而是斷言「不該有」** —— 見上面那段。
    --    它若哪天有了,代表有人為了「讓它跑得動」加了一道不需要的 GRANT ⇒ 那是要被看見的。
    IF pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '#866 片2 B0 失敗:% 對 service_role 開著 EXECUTE ⇒ trigger 函式不需要它,'
                      '有人加了一道多餘的 GRANT(trigger 走表擁有者身分,不看呼叫者的 EXECUTE)', r;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_n FROM pg_trigger
   WHERE tgrelid = 'public.order_manual_refunds'::regclass
     AND tgname = 'trg_pcm_manual_refund_rail_cap' AND NOT tgisinternal;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '#866 片2 B1 失敗:trigger 沒掛上(找到 % 個,預期 1)', v_n;
  END IF;

  -- B2 它必須同時吃 INSERT 與 UPDATE。tgtype 的 bit1=ROW / bit2=BEFORE / bit3=INSERT / bit5=UPDATE
  SELECT count(*) INTO v_n FROM pg_trigger
   WHERE tgrelid = 'public.order_manual_refunds'::regclass
     AND tgname = 'trg_pcm_manual_refund_rail_cap'
     AND (tgtype & 4) <> 0        -- INSERT
     AND (tgtype & 16) <> 0       -- UPDATE
     AND (tgtype & 8) <> 0        -- DELETE(F2:刪除那條門)
     AND (tgtype & 2) <> 0        -- BEFORE
     AND (tgtype & 1) <> 0;       -- FOR EACH ROW
  IF v_n <> 1 THEN
    RAISE EXCEPTION '#866 片2 B2 失敗:trigger 的時機/事件不對(BEFORE INSERT OR UPDATE FOR EACH ROW)';
  END IF;

  -- 🔴 **B2b:名字對、事件對,不代表它【接到我們這支函式】、也不代表它是【開著】的**
  --    (2026-08-24 codex must-fix)。三件各自都能單獨壞掉,而 B1/B2 全部看不到:
  --      · `tgfoid`     綁到別支函式 ⇒ 名字與事件完全一樣
  --      · `tgenabled`  被 `ALTER TABLE … DISABLE TRIGGER` 關掉 ⇒ 它還在 pg_trigger 裡
  --      · `tgqual`     有 WHEN 條件 ⇒ 它只在某些列才跑,而斷言看不出來
  SELECT count(*) INTO v_n FROM pg_trigger
   WHERE tgrelid = 'public.order_manual_refunds'::regclass
     AND tgname = 'trg_pcm_manual_refund_rail_cap'
     AND tgfoid = 'public.pcm_manual_refund_rail_cap_guard()'::regprocedure
     AND tgenabled = 'O'          -- O = 一般模式下啟用(D=停用 / R=replica / A=always)
     AND tgqual IS NULL;          -- 沒有 WHEN 條件 ⇒ 每一列都跑
  IF v_n <> 1 THEN
    RAISE EXCEPTION '#866 片2 B2b 失敗:trigger 不是綁到 rail_cap_guard、或被停用、或帶了 WHEN 條件';
  END IF;

  -- B3 對照組:PUBLIC / anon 不得有 guard 函式的 EXECUTE
  SELECT count(*) INTO v_n
    FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid = 'public.pcm_manual_refund_rail_cap_guard()'::regprocedure
     AND (a.grantee = 0 OR a.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'anon'));
  IF v_n <> 0 THEN
    RAISE EXCEPTION '#866 片2 B3 失敗:guard 函式對 PUBLIC/anon 仍有 % 筆授權', v_n;
  END IF;

  RAISE NOTICE '#866 片2 B1-B3 全過(行為的證人在 scripts/866-rail-cap-verify.sh)';
END
$post$;

-- ══ 4. 回退法(⚠️ 未驗:本 repo 慣例 down-migration 不會被跑過)═══════════
-- DROP TRIGGER IF EXISTS trg_pcm_manual_refund_rail_cap ON public.order_manual_refunds;
-- DROP FUNCTION IF EXISTS public.pcm_manual_refund_rail_cap_guard();
-- 🔴 回退 = **把那個洞打開**。要回退請先確認為什麼,並在 commit body 寫明。
