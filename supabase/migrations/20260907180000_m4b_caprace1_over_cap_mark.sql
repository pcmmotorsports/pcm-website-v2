-- ═══ M-4b ⟦b4-CAPRACE1⟧ + ⟦c7-LEDGERGATEREFUSES⟧:超收那一筆【標得出來】═══
-- Sean 2026-09-02 `Q1` = 甲(「記得下來, 但標紅」)· 2026-09-07 `Q56` = 甲(加欄 over_cap_by + cap_state)。
--
-- 🔴🔴 **這一支不是加值功能, 它是【一個現在就開著的缺口的另一半】。**
--    `20260902020000_m4b_pcm01_record_not_block.sql` 做了「記得下來」那一半, 而它自己第 3-4 行寫著
--    「🛑🛑 **本支【不得單獨上線】**」—— 而 2026-09-07 唯讀量到:正式庫現行 `md5(prosrc)`
--    = `372a2f14cc6e82afd23c9daad983ef48` len 6054 = **就是那一支** ⇒ **它正在單獨上線。**
--    ⇒ 今天:超額的人工退款**安靜進帳本**, 而畫面上沒有任何東西會變
--      (那道被拿掉的閘同時是一道**打字檢查**, 而打字檢查那個角色沒有人接手)。
--    🔬 曝險量到 = **0 列**(`order_manual_refunds` 全表 0;而那個 0 不是 RLS 擋掉 ——
--      `current_user = pcm_readonly` 且 `rolbypassrls = t`, 同連線正對照 `orders`=4 / `order_refunds`=1)。
--
-- ══ 本支動兩支函式, 而第二支是【必須】不是【順便】═══════════════════════
--   ① `pcm_manual_refund_rail_cap_guard` —— 超額時寫 `cap_state='over'` + `over_cap_by`
--   ② `pcm_d3d_manual_refund_immutable` —— **把兩個新欄位加進它的逐欄黑名單**
--      🔴 它是**列舉式**的(自己的註解逐字:「逐欄列出, 不用『除了 allowlist 以外』的動態寫法」)
--      ⇒ **新欄位預設不受保護** ⇒ 不加進去, 它們就是這張金流帳本上**唯一可以事後改掉的欄位**。
--      📌 **而那個設計代價對任何加欄位的人都成立, 卻沒有任何閘會提醒他** —— 已記板列。
--
-- 🔬 四個基線 md5 都是唯讀量到的(2026-09-07):
--   cap guard  現行 `372a2f14cc6e82afd23c9daad983ef48` / 6054 ⇒ 貼完應為 `0392cff661cadb69acc953d4fa3ebca6` / 7087
--   immutable  現行 `0226c67f69adc1b3f7629ac0d214bed0` / 3021 ⇒ 貼完應為 `942a79bbd5026d87d01614d2f02aa677` / 3455
--   兩支 owner 皆 `postgres`;cap guard `prosecdef = t` / `search_path=public, pg_temp`;
--   immutable `prosecdef = f` / `search_path=pg_catalog, public` —— **兩支的屬性不同, 下面各釘各的。**
--
-- ⚠️ **`cap_state` 的 DEFAULT 是 `cap_unknown` 而不是 `within`** —— 刻意的:
--    既有列與任何沒被 trigger 判到的路徑, 都落在「**未判定**」而不是被當成「沒超過」。
--    (codex 關卡1 F-1:「NULL = 沒超過」太強, 未超額與未判定會印同一個東西。)
--
-- 🛑 **本支【沒有】做的**:畫面那一半(`manual-refund-read.ts` 取新欄 + ledger section 標紅)由 `account` 做,
--    **db 先貼、前端後上**。⇒ **在前端上線之前, 拍板那句「標紅」仍然沒有交付。**

BEGIN;

DO $pre$
DECLARE v_md5 text; v_own text; v_cfg text; v_sec boolean; v_n integer;
BEGIN
  SET LOCAL lock_timeout = '5s';
  PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended('order_manual_refunds_cap_mark', 0));

  SELECT count(*) INTO v_n FROM pg_attribute a
   WHERE a.attrelid = 'public.order_manual_refunds'::regclass AND NOT a.attisdropped
     AND a.attname IN ('over_cap_by','cap_state');
  IF v_n <> 0 THEN
    RAISE EXCEPTION '前置閘 P1:那兩欄已經有 % 個存在 ⇒ 本支已 apply 過, 拒絕重貼', v_n;
  END IF;

  SELECT md5(p.prosrc), pg_catalog.pg_get_userbyid(p.proowner),
         coalesce(array_to_string(p.proconfig, ','), ''), p.prosecdef
    INTO v_md5, v_own, v_cfg, v_sec
    FROM pg_proc p WHERE p.oid = 'public.pcm_manual_refund_rail_cap_guard()'::regprocedure;
  IF v_md5 <> '372a2f14cc6e82afd23c9daad983ef48' THEN
    RAISE EXCEPTION '前置閘 P2:cap guard 現行 md5 = % ⇒ 不是我抄的那一版, 停下', v_md5;
  END IF;
  IF v_own <> 'postgres' OR NOT v_sec OR v_cfg <> 'search_path=public, pg_temp' THEN
    RAISE EXCEPTION '前置閘 P3:cap guard 屬性不符(owner=% secdef=% cfg=%)⇒ 停下', v_own, v_sec, v_cfg;
  END IF;

  SELECT md5(p.prosrc), pg_catalog.pg_get_userbyid(p.proowner),
         coalesce(array_to_string(p.proconfig, ','), ''), p.prosecdef
    INTO v_md5, v_own, v_cfg, v_sec
    FROM pg_proc p WHERE p.oid = 'public.pcm_d3d_manual_refund_immutable()'::regprocedure;
  IF v_md5 <> '0226c67f69adc1b3f7629ac0d214bed0' THEN
    RAISE EXCEPTION '前置閘 P4:immutable 現行 md5 = % ⇒ 不是我抄的那一版, 停下', v_md5;
  END IF;
  IF v_own <> 'postgres' OR v_sec OR v_cfg <> 'search_path=pg_catalog, public' THEN
    RAISE EXCEPTION '前置閘 P5:immutable 屬性不符(owner=% secdef=% cfg=%)⇒ 停下', v_own, v_sec, v_cfg;
  END IF;

  RAISE NOTICE '前置閘 P1-P5 全過:兩欄尚未存在 · 兩支函式都是預期版本且屬性相符。';
END
$pre$;

-- ══ 1. 兩個新欄位 ══
ALTER TABLE public.order_manual_refunds
  ADD COLUMN over_cap_by integer,
  ADD COLUMN cap_state   text NOT NULL DEFAULT 'cap_unknown';

ALTER TABLE public.order_manual_refunds
  ADD CONSTRAINT order_manual_refunds_cap_state_pair CHECK (
    (cap_state = 'over'   AND over_cap_by IS NOT NULL AND over_cap_by > 0) OR
    (cap_state IN ('within','cap_unknown') AND over_cap_by IS NULL));

COMMENT ON COLUMN public.order_manual_refunds.over_cap_by IS
  '⟦b4-CAPRACE1⟧ 這一筆【超出軌別可退上限幾元】(NULL = 不適用)。只在 INSERT 當下寫, 之後不可變。';
COMMENT ON COLUMN public.order_manual_refunds.cap_state IS
  '⟦b4-CAPRACE1⟧ within = 沒超過 · over = 超收(看 over_cap_by)· cap_unknown = 算不出上限(與超收【不同】的紅)。';

-- ══ 2. cap guard:超額時標記, 而不是擋 ══
CREATE OR REPLACE FUNCTION public.pcm_manual_refund_rail_cap_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
-- 🔴🔴 **[2026-09-07 本支收緊] `search_path` 由 `public, pg_temp` 改成 `''`** ——
--    `scripts/definer-search-path-gate.py` 在本支被擋下, 而它是對的:
--    「把可寫的 schema 排在 pg_catalog 前面 = SECURITY DEFINER 提權的標準路徑
--      (repo 零處 REVOKE CREATE ON SCHEMA public ⇒ 任何人都建得出同名函式)」。
--    🔬 **改得動的前提我量過**:本函式 body 裡的呼叫**只有一個** ——
--      `public.pcm_manual_refund_rail_cap(...)`, **已經是全名** ⇒ 改成 '' 不會找不到東西。
--    ⚠️ **這是本支【順帶】的收緊, 不是本題要的** —— 而閘擋在這裡, 我不繞過它。
SET search_path = ''
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
      '人工退款登記「不能刪除」 —— 要取消請用「作廢」(它會把額度還回來,而且留得下紀錄)。'
      '🔴 直接刪掉會讓額度憑空回來且「查不到是誰做的」,那正是這道規則要防的。'
      USING ERRCODE = 'PCM03';
  END IF;

  -- 🔴🔴 **[⟦b4-CAPRACE1⟧ 2026-09-07] 只在 INSERT 判定與寫入這兩欄**(codex 關卡1 F-2)。
  --    本 trigger 是 BEFORE INSERT OR UPDATE OR DELETE, 而它跑在 order_manual_refunds_immutable_bu
  --    **之後**(名稱字母序)⇒ **它改了 NEW 之後, immutable 不會再驗一次。**
  --    反例(codex 給的, 成立):原本未超額的列, 後來額度被別筆耗盡, 對它做一個【值不變的 UPDATE】,
  --    也會被補上一個**歷史上不存在的**超額標記。⇒ UPDATE 一律原樣搬回 OLD。
  IF TG_OP = 'UPDATE' THEN
    NEW.cap_state   := OLD.cap_state;
    NEW.over_cap_by := OLD.over_cap_by;
  END IF;

  -- 🔴 **防偽輸入**(codex 關卡1 F-3 ⑦):呼叫者可以在 INSERT 時**自己預填** over_cap_by = 1。
  --    nullable 與「沒有預設」**擋不住**這件事 ⇒ **先無條件覆蓋成「未判定」**, 下面各分支再改寫。
  IF TG_OP = 'INSERT' THEN
    NEW.cap_state   := 'cap_unknown';
    NEW.over_cap_by := NULL;
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
    -- ⛔ ~~2026-09-02 `⟦b4-PCM01RECORD⟧`:這一格【刻意沒有跟著 PCM01 一起放行】~~
    -- ✅ **2026-09-02 01:2x Sean 拍【甲】:「一起改, 標一個不同的紅」** ——
    --    題目逐字是我自己開的那一列 `⟦5b-PCM02SAMEHARM⟧`(前一題沒有問到它)。
    --    ⇒ 而他選甲的理由與 `PCM01` 那一題同一條:**錢已經退了, 帳一定要跟得上事實。**
    -- 🔴🔴 **而「不同的紅」是承重的, 不是修飾** —— 兩種紅的【下一步相反】:
    --    超額(`PCM01` 那條)⇒ **確認金額**(數字可能打錯)
    --    算不出上限(這一條)⇒ **找工程**(系統不知道自己在看什麼, 而金額可能完全沒問題)
    --    ⇒ 📌 **合成同一種紅 = 把「該找工程的人」送去改金額** ——
    --      而那正是 `⟦b4-PCM05SPLIT⟧` 那一條(一碼兩義而下一步相反), 我剛做過它。
    -- ⚠️ **而 `v_cap` 是 NULL ⇒ `v_headroom` 也是 NULL ⇒ 下面那個超額比較【不會成立】**
    --    ⇒ 所以這一筆**只會有這一句 WARNING**, 不會同時吐超額那一句。**那是對的**:
    --      我們不知道上限, 就不該宣稱它超額。
    RAISE WARNING
      '人工退款登記:這張單【算不出可退上限】—— 已照實登記, 而系統無法判斷它有沒有超額。'
      '🔴 這與「金額太大」不同:那是金額問題, 這是系統算不出上限 ⇒ **請找工程確認**, 不要改金額重送。'
      '⇒ 畫面層應以 pcm_manual_refund_rail_cap(order_id) IS NULL 標一個【與超額不同】的紅。';
    RETURN NEW;
  END IF;

  v_headroom := v_cap;
  -- 🔴 `OLD.order_id = NEW.order_id` 這一項是 2026-08-24 codex 抓到的洞,**不是防禦性贅字**:
  --    少了它 ⇒ 把 A 單上一筆已退 1000 的列 `UPDATE … SET order_id = B` 時,
  --    cap 算的是 **B 單**(零實收 ⇒ 0),而餘裕卻加回 **A 單那筆**的 1000
  --    ⇒ B 拿到 1000 的假餘裕 ⇒ **通過**。
  --    ⚠️ 而這**不是併發** —— 是單一交易裡的一個合法 UPDATE,一個人就做得到。
  -- 🔵 **2026-09-02:這一段【留著】, 即使 PCM01 不再擋。**
  --    它算的 `v_headroom` 現在是【警告訊息裡那個數字】的來源 ——
  --    ⇒ 算錯它, 員工看到的「餘裕 N 元」就是錯的。**它從守門件變成量測件, 而不是變成廢的。**
  IF TG_OP = 'UPDATE' AND OLD.voided_at IS NULL AND OLD.order_id = NEW.order_id THEN
    v_headroom := v_cap + OLD.refund_amount;
  END IF;

  -- 🔴 **這一行的承重件不在本檔**(2026-08-24 R3 / Fable F4):
  --    `NEW.refund_amount` 若是 `NULL` ⇒ `NULL > v_headroom` 回 `NULL` ⇒ `IF` 不成立
  --    ⇒ **靜靜放行**。今天不會發生,靠的是**另一支 migration**:
  --      `20260820010000` 的 `refund_amount integer NOT NULL CHECK (refund_amount > 0)`
  --    ⇒ **那道 NOT NULL 是這道 trigger 的承重件,而它寫在別人的檔裡。**
  --    ⇒ 有人日後放寬它,這裡不會報錯,只會**靜靜放行**。
  -- ⛔ ~~✅ 所以前置閘現在**也驗那道 NOT NULL**(見 §0)—— 讓依賴變成會執行的東西,不是註解。~~
  -- 🔴🔴 **【R3 must-fix】那個 ✅ 是我從上一代逐字抄過來的, 而它在【本檔】指向一個不存在的東西**:
  --    **本檔沒有 §0, 也沒有任何前置閘。**上一代(`20260831010000`)有, 本檔沒有帶過來。
  --    ⇒ 📌 **一個指向不存在檢查的 ✅, 會關掉下一個人的查證** —— 而它比「沒寫」糟:
  --      沒寫的話他會自己去看;寫了他就不看了。
  --    🔴 **而成因是【逐字沿用】這個動作本身**:我為了不刪 Sean 的拍板紀錄而整段照抄,
  --      而照抄會把**只在原檔成立的句子**一起搬過來。
  --      ⇒ ⇒ **「不刪註解」與「註解仍然為真」是兩件事, 而前者做到了不保證後者。**
  --    ✅ **現況**:那道 NOT NULL(`20260820010000` 的 `refund_amount integer NOT NULL`)
  --      **今天仍然是這道 trigger 的承重件, 而【本檔沒有驗它】。**
  --      ⇒ 有人放寬它 ⇒ 這裡不會報錯, 只會**靜靜地不出聲**(見下一段)。
  -- 🔵 **2026-09-02:放行不再是「洞」, 而【少一句警告】仍然是。**
  --    `NULL > v_headroom` 回 NULL ⇒ 這個 `IF` 不成立 ⇒ **不會 WARNING**
  --    ⇒ 那一筆會靜靜進去而沒有人知道它超額 ⇒ **那道 NOT NULL 仍然承重, 只是承的東西換了。**
  IF NEW.refund_amount > v_headroom THEN
    IF TG_OP = 'INSERT' THEN
      NEW.cap_state := 'over';
      -- 🔵 **負餘裕時整筆都算超出** —— GREATEST(v_headroom, 0):餘裕 -500 再退 100 ⇒ 100。
      NEW.over_cap_by := NEW.refund_amount - GREATEST(v_headroom, 0);
    END IF;
    -- ══ 🔴🔴 **Sean 2026-09-02 拍【甲】:從 `RAISE EXCEPTION` 換成 `RAISE WARNING`** ══
    --   而那一個字就是本支的全部:`WARNING` 不中止交易 ⇒ 那一列**進得去**。
    -- ⛔ ~~而它仍然進 DB log ⇒ **事後查得到**。~~
    -- 🔴 **【codex must-fix】那句話是【沒有保證的】, 而我寫得像保證。**
    --    `log_min_messages` 可以把 `WARNING` 濾掉;`client_min_messages` 也可以讓 client 完全收不到。
    --    ⇒ 📌 **所以正確的說法是:它【有機會】進 log, 而那取決於我們控制不到的設定。**
    --    ⇒ ⇒ **它不是一個可以依賴的訊號** —— 而那正是「標紅那一半必須一起上」的第二個理由:
    --      **這一支自己留下的痕跡, 我證不出它一定在。**
    -- ⚠️ **而 `WARNING` 員工看不到** —— 它不是「標紅」, 它是(可能的)留痕。
    --    **「標紅」是畫面層那一半, 而視覺是 Sean 的 ⇒ 本支刻意不碰。**
    -- 🔵 **而訊息裡不再出現「只剩 N 元可退」** —— 那正是上面「第二個獨立的洞」的來源:
    --    一個可編輯的表單 + 一句「只剩 N」= 在邀請員工把金額改成 N 再送一次。
    --    ⇒ 現在這段話是給【log】看的, 不是給員工照著做的。
    -- ⚠️ **負餘裕照實印, 不夾底**(舊版對員工顯示時用 `GREATEST(...,0)`, 理由是「-500 不可讀」)——
    --    而這裡的讀者是工程, 而**夾底會把「超收多少」這個資訊丟掉**。
    RAISE WARNING
      '人工退款登記超過這張單【現金 / 匯款】軌的可退上限:餘裕 % 元, 這一筆 % 元。'
      '⇒ 已【照實登記】(Sean 2026-09-02 拍甲:帳要跟得上事實), 而這張單的軌別餘裕會變成負數。'
      '⇒ 畫面層應以 pcm_manual_refund_rail_cap(order_id) < 0 標紅。',
      v_headroom, NEW.refund_amount;
  ELSE
    IF TG_OP = 'INSERT' THEN
      NEW.cap_state   := 'within';
      NEW.over_cap_by := NULL;
    END IF;
  END IF;

  RETURN NEW;
END
$fn$;

-- ══ 3. immutable:把兩個新欄位加進逐欄黑名單 ══
CREATE OR REPLACE FUNCTION public.pcm_d3d_manual_refund_immutable()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $fn$
DECLARE v_bad text;
BEGIN
  -- ── ① 帳體:一律不可變 ────────────────────────────────────────────────
  --    🔴 逐欄列出,不用「除了 allowlist 以外」的動態寫法。理由見檔頭。
  --    ⚠️ `request_id` 也在裡面 —— 它是 `20260820021000:128` 後加的 NOT NULL 欄,
  --       **建表那支裡沒有它**。(「這張表長怎樣」的分母,是所有寫過它的 migration。)
  v_bad := pg_catalog.concat_ws(', ',
    CASE WHEN NEW.id            IS DISTINCT FROM OLD.id            THEN 'id' END,
    CASE WHEN NEW.order_id      IS DISTINCT FROM OLD.order_id      THEN 'order_id' END,
    CASE WHEN NEW.rail          IS DISTINCT FROM OLD.rail          THEN 'rail' END,
    CASE WHEN NEW.refund_amount IS DISTINCT FROM OLD.refund_amount THEN 'refund_amount' END,
    CASE WHEN NEW.reason        IS DISTINCT FROM OLD.reason        THEN 'reason' END,
    CASE WHEN NEW.actor         IS DISTINCT FROM OLD.actor         THEN 'actor' END,
    CASE WHEN NEW.occurred_at   IS DISTINCT FROM OLD.occurred_at   THEN 'occurred_at' END,
    CASE WHEN NEW.created_at    IS DISTINCT FROM OLD.created_at    THEN 'created_at' END,
    CASE WHEN NEW.request_id    IS DISTINCT FROM OLD.request_id    THEN 'request_id' END,
    -- 🔴🔴 **[⟦b4-CAPRACE1⟧ 2026-09-07] 新欄位必須進這個清單, 而那是【硬性的】。**
    --    本函式**逐欄列舉**(它自己的註解逐字:「逐欄列出, 不用『除了 allowlist 以外』的動態寫法」)
    --    ⇒ 📌 **新欄位【預設不受保護】** —— 不加進來, over_cap_by / cap_state 就是這張金流帳本上
    --    **唯一可以事後 UPDATE 改掉的欄位**, 而改它 = 把「這筆超收過」抹掉。
    CASE WHEN NEW.over_cap_by   IS DISTINCT FROM OLD.over_cap_by   THEN 'over_cap_by' END,
    CASE WHEN NEW.cap_state     IS DISTINCT FROM OLD.cap_state     THEN 'cap_state' END);

  IF v_bad IS NOT NULL AND v_bad <> '' THEN
    RAISE EXCEPTION
      '人工退款登記的這些欄位不可變更:%。'
      '🔴 帳不塗改 —— 登錯了請用「作廢」,再另外登一筆新的;改列等於繞過 append-only。',
      v_bad
      USING ERRCODE = 'P2B45', CONSTRAINT = 'pcm_d3d_immutable_violation';
  END IF;

  -- ── ② 作廢是終態:已作廢的列,那三欄一個字都不能再動 ────────────────────
  --    🔴 這一格就是 Sean 那句話本身。它同時擋掉兩種形狀:
  --      · **復活**(`voided_at` 非 NULL ⇒ NULL)
  --      · **改作廢理由 / 改作廢的人**(那是塗改稽核痕跡,比復活更難發現)
  --    ⚠️ 表上的 `order_manual_refunds_void_trio` CHECK 只保證三欄**三向配對**
  --       (`num_nonnulls(...) IN (0,3)`,`20260820090000:115`)——
  --       它**擋不住把三欄一起清掉**(0 也在允許集合裡)。⇒ 那正是本格要擋的。
  IF OLD.voided_at IS NOT NULL THEN
    v_bad := pg_catalog.concat_ws(', ',
      CASE WHEN NEW.voided_at   IS DISTINCT FROM OLD.voided_at   THEN 'voided_at' END,
      CASE WHEN NEW.void_reason IS DISTINCT FROM OLD.void_reason THEN 'void_reason' END,
      CASE WHEN NEW.voided_by   IS DISTINCT FROM OLD.voided_by   THEN 'voided_by' END);

    IF v_bad IS NOT NULL AND v_bad <> '' THEN
      RAISE EXCEPTION
        '這一筆已經作廢了,作廢紀錄不能再改(你動到的是:%)。'
        '🔴 Sean 2026-08-30 拍板:**不能改回「有退過」,要另外開一筆新的更正紀錄(帳不塗改)**。'
        '⇒ 若這筆退款其實真的發生了,請用 admin_record_manual_refund **登一筆新的**,'
        '作廢的這一列原樣留著。'
        '🔴🔴 **而那一筆【必須用新的 request_id】** —— 沿用原本那把會【什麼都不做而回報成功】:'
        'admin_record_manual_refund 的冪等格是 (order_id, request_id) 且**不濾 voided_at**'
        '(20260823020000:394-403)⇒ 它會命中那個已作廢的列、回 idempotent:true, '
        '而後台把 idempotent 當成功顯示(manual-refund-actions.ts:150)⇒ **一列都沒寫、帳仍是沒退過**。'
        '⚠️ 而若你只改了內容(例如換個理由), 會撞到它的同鍵不同內容拒絕, '
        '那則訊息逐字叫你「不要用新的 request_id」—— **那句話的前提是「你在重送同一筆」, '
        '不涵蓋「原本那筆被作廢了」這個情況。**'
        '⇒ 補登完請核 pcm_order_refundable_remaining 是否回到預期值(D1 明文不擋'
        '「同一筆錢用不同 request_id 登兩次」, 20260820021000:333-335 ⇒ 那一半只有對帳看得到)。',
        v_bad
        USING ERRCODE = 'P2B46', CONSTRAINT = 'pcm_d3d_void_is_terminal';
    END IF;
  END IF;

  RETURN NEW;
END
$fn$;

-- ══ 4. 事後閘 ══
DO $post$
DECLARE v_md5 text; v_own text; v_cfg text; v_sec boolean; v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM pg_attribute a
   WHERE a.attrelid = 'public.order_manual_refunds'::regclass AND NOT a.attisdropped
     AND a.attname IN ('over_cap_by','cap_state');
  IF v_n <> 2 THEN
    RAISE EXCEPTION '事後閘 A1:兩欄只建出 % 個 ⇒ 回滾', v_n;
  END IF;

  SELECT md5(p.prosrc), pg_catalog.pg_get_userbyid(p.proowner),
         coalesce(array_to_string(p.proconfig, ','), ''), p.prosecdef
    INTO v_md5, v_own, v_cfg, v_sec
    FROM pg_proc p WHERE p.oid = 'public.pcm_manual_refund_rail_cap_guard()'::regprocedure;
  IF v_md5 <> '0392cff661cadb69acc953d4fa3ebca6' THEN
    RAISE EXCEPTION '事後閘 A2:cap guard 貼完 md5 = %(要 0392cff6…)⇒ 回滾', v_md5;
  END IF;
  -- 🔴 貼完的期望值是 `search_path=""`(本支把它收緊了), **不是**貼前的 `public, pg_temp`。
  IF v_own <> 'postgres' OR NOT v_sec OR v_cfg <> 'search_path=""' THEN
    RAISE EXCEPTION '事後閘 A3:cap guard 屬性不符預期(owner=% secdef=% cfg=%)⇒ 回滾', v_own, v_sec, v_cfg;
  END IF;

  SELECT md5(p.prosrc), pg_catalog.pg_get_userbyid(p.proowner),
         coalesce(array_to_string(p.proconfig, ','), ''), p.prosecdef
    INTO v_md5, v_own, v_cfg, v_sec
    FROM pg_proc p WHERE p.oid = 'public.pcm_d3d_manual_refund_immutable()'::regprocedure;
  IF v_md5 <> '942a79bbd5026d87d01614d2f02aa677' THEN
    RAISE EXCEPTION '事後閘 A4:immutable 貼完 md5 = %(要 942a79bb…)⇒ 回滾', v_md5;
  END IF;
  IF v_own <> 'postgres' OR v_sec OR v_cfg <> 'search_path=pg_catalog, public' THEN
    RAISE EXCEPTION '事後閘 A5:immutable 屬性被洗掉(owner=% secdef=% cfg=%)⇒ 回滾', v_own, v_sec, v_cfg;
  END IF;

  -- 🔴 A6:新欄位**真的進了 immutable 的黑名單**(字面在 prosrc 裡)——
  --    這是本支存在的第二個理由, 少了它那兩欄是可以被事後改掉的。
  SELECT count(*) INTO v_n FROM pg_proc p
   WHERE p.oid = 'public.pcm_d3d_manual_refund_immutable()'::regprocedure
     AND pg_catalog.strpos(p.prosrc, 'NEW.over_cap_by') > 0
     AND pg_catalog.strpos(p.prosrc, 'NEW.cap_state')   > 0;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '事後閘 A6:immutable 的黑名單裡找不到那兩欄 ⇒ 回滾';
  END IF;

  -- 🔴 A7:三個 trigger 都還在、都還啟用(本支不該動到它們, 而「不該」要被驗)
  SELECT count(*) INTO v_n FROM pg_trigger t
   WHERE t.tgrelid = 'public.order_manual_refunds'::regclass AND NOT t.tgisinternal
     AND t.tgenabled IN ('O','A');
  IF v_n <> 3 THEN
    RAISE EXCEPTION '事後閘 A7:那張表上啟用中的非內部 trigger 有 % 支(貼前是 3)⇒ 回滾', v_n;
  END IF;

  RAISE NOTICE '事後閘 A1-A7 全過:兩欄在 · 兩支 md5 與屬性都對 · 黑名單含新欄 · 三個 trigger 都還在。';
END
$post$;

COMMIT;

-- ══ 這一支【證不到】什麼 ══
--  · **畫面那一半沒有做** ⇒ 貼完之後「標紅」**仍然沒有交付**, 只是資料庫記得了。
--  · 本支**沒有跑過任何行為測試** —— 我這個窗沒有寫入權。驗收 12 條(plan §F-3)要在拋棄式 DB 上跑。
--  · `cap_state` 的三態**只在 INSERT 寫**;`UPDATE` 原樣搬回 OLD ⇒ **它記的是「登記當下」**,
--    不是「現在還超不超」。要問後者請當場算 `pcm_manual_refund_rail_cap(order_id)`。
--  · advisory lock **只擋也拿同一把鍵的人** —— SQL Editor 手改不受它管。
