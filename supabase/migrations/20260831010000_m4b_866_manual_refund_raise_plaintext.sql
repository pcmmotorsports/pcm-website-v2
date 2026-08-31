-- #866 片 3/3(訊息層)· ⟦b4-PCM03STARS⟧
-- ─────────────────────────────────────────────────────────────────────────────
-- 做什麼:把 `pcm_manual_refund_rail_cap_guard()` 裡 `PCM02` / `PCM03` 兩句 RAISE 的
--         Markdown 粗體 `**…**` 換成「…」。**只動那三行字面, 行為零改動。**
--
-- 為什麼:那兩句話會被原樣顯示給員工(`manual-refund-repository.ts` 的 `rejected` 這一格
--         刻意把 RPC 的 message 原樣帶出去), 而畫面是**純文字輸出**
--         (`<p role="alert">{state.message}</p>`, 沒有任何 Markdown renderer)
--         ⇒ 員工看到的是字面上的兩顆星星。
--
-- 🔵 為什麼不改走罐頭訊息(`-48` 2026-08-31 裁, 我核過):
--    兩顆星星是**難看**;而罐頭化會讓員工失去「要取消請用作廢」這個**指示**
--    ⇒ 他不知道下一步該做什麼。⇒ 這不是品味題, 是【哪一個資訊比較重要】。
--
-- ⚠️ 🔴 那兩句裡的 `🔴` **刻意留著**, 不在本片範圍:
--    它是一個 emoji(會正常顯示), 不是會露出來的標記語法 ——
--    📌 **`**` 與 `🔴` 在原始碼裡長得像同一種東西(都是「內部文件的排版習慣」),**
--    **而只有一種在純文字畫面上會壞掉。** 要不要拿掉 `🔴` 是文案題, 那是 Sean 的。
--
-- 🛑 **可達性:今天員工撞不到 `PCM03`** —— 它只在 `DELETE` 時 RAISE, 而沒有任何一條路
--    DELETE 那張表(當場量:app 側 `.delete(` ⇒ 0 / migrations 的 `DELETE FROM
--    public.order_manual_refunds` ⇒ 0)。`PCM02` 的可達性**未確認**(要讓
--    `pcm_manual_refund_rail_cap` 回 NULL, 而它兩段都是 `COALESCE(…, 0)`)。
--    ⇒ 📌 **所以這一支的價值是【那道 trigger 是上線中的, 而債是定時的】** ——
--       只要有人日後加一條 DELETE 路徑, 那句話當天就會上畫面。
--
-- 🔴 **抄自哪一代(而這一格是本片最危險的一步)**:
--    `scripts/latest-definition-of.sh pcm_manual_refund_rail_cap_guard`
--    ⇒ newest = `20260824011000`(共 1 代 / 1 個定義點), 本檔逐字從該檔 `:112-216` 抄,
--      只改上述三行。⚠️ `live` 欄答的是**帳本**不是正式庫 —— 兩個宣稱。
--    📌 **`CREATE OR REPLACE` 會把【整個函式本體】換掉 ⇒ 抄錯一代 = 把後面幾代的行為整個回捲,**
--    **而三綠不會紅、diff 上長得像一支正常的新 migration。**
--
-- ⚠️ **本檔尚未 apply。apply 是 Sean 的手。**
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 前置閘:抄的那一代必須就是庫裡現在那一支 ────────────────────────────────
DO $pre$
DECLARE
  v_fp text;
BEGIN
  IF to_regprocedure('public.pcm_manual_refund_rail_cap_guard()') IS NULL THEN
    RAISE EXCEPTION '#866 片3 前置閘:pcm_manual_refund_rail_cap_guard() 不存在 ⇒ 先 apply 20260824011000';
  END IF;

  -- 🔴🔴 **指紋, 不是計數**(codex 對抗審查 must-fix 1;而這道藥不是我發明的 ——
  --    `docs/patterns/guard-and-instrument-traps.md:14945` 那一條開的就是它:
  --    「剝掉行註解再比對【正規化後的整段字面】」。**我今晚才親手補角度給那一條, 而第一版沒有用它。**)
  -- ⛔ ~~原本用「非註解行含 ** 的行數 = 3」~~ 🔴 **那個判準有【無限多個】世界會印 3** ——
  --    任何邏輯已被改過、而仍恰有 3 行星號的版本都會通過 ⇒ 我會把正式庫上較新的修正整支回捲。
  -- ⚠️ 正規化 = 剝掉 `--` 行註解 + 空白收斂 ⇒ 只有【縮排/註解】的差異不會擋人, 而**任何一個字元的邏輯差異都擋**。
  SELECT md5(regexp_replace(regexp_replace(prosrc, '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_fp FROM pg_proc WHERE oid = 'public.pcm_manual_refund_rail_cap_guard()'::regprocedure;

  IF v_fp = 'df0f12306fa0a4c875e6180b438ee600' THEN
    RAISE EXCEPTION '#866 片3 前置閘:這支已經套用過了(指紋 = 改後那一版)⇒ 不要重跑';
  END IF;
  IF v_fp <> 'dd3bc853caee8e0a761b4a07e96e3a97' THEN
    RAISE EXCEPTION '#866 片3 前置閘:庫裡那支的正規化指紋是 %, 而我抄的那一版是 % ⇒ 它不是 20260824011000 的那一支, 停下來人工核對(不要 force)', v_fp, 'dd3bc853caee8e0a761b4a07e96e3a97';
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public.pcm_manual_refund_rail_cap_guard()
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
      '人工退款登記「不能刪除」 —— 要取消請用「作廢」(它會把額度還回來,而且留得下紀錄)。'
      '🔴 直接刪掉會讓額度憑空回來且「查不到是誰做的」,那正是這道規則要防的。'
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
      '🔴 這與「金額太大」不同:那是金額問題,這是「系統算不出上限」,請找工程確認。'
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
-- ⛔ ~~`COMMENT ON FUNCTION … IS '…2026-08-31 ⟦b4-PCM03STARS⟧…'`~~
-- 🔴 **2026-08-31 拿掉(codex 對抗審查 must-fix 2)** —— `CREATE OR REPLACE` **本來就保留 COMMENT**,
--    而我那一句是**主動覆寫**它 ⇒ 會丟掉原 COMMENT 裡的 bypass / TRUNCATE / 上游灌水那幾段限制說明。
-- 📌 **⇒ 而它剛好打穿本檔檔頭那句「只動三行字面」** —— 我寫那句話的時候,
--    自己正在同一支檔裡刪掉一段文件。**一個「我沒動別的」的宣稱,與一個就在它下面的反例。**
-- 🔵 ⇒ 不補新的 COMMENT:這一片的變更紀錄住在【本檔檔頭】與板子那一列, 那才是它該住的地方。

-- ── 後置斷言 ──────────────────────────────────────────────────────────────
DO $post$
DECLARE
  v_src  text;
  v_norm text;
  v_fp   text;
  v_n    int;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc
   WHERE oid = 'public.pcm_manual_refund_rail_cap_guard()'::regprocedure;
  -- 剝掉 `--` 行註解再看內容 —— **不剝的話, 註解裡的字面會讓下面每一道恆真**
  -- (codex must-fix 3 就是打這一格:原本的「三個碼還在」被【註解裡的 PCM02】騙過。)
  v_norm := regexp_replace(regexp_replace(v_src, '--[^\n]*', '', 'g'), '\s+', ' ', 'g');
  v_fp   := md5(v_norm);



  -- ── ② 星號沒了(這道先跑 ⇒ 它給的是【哪裡不一樣】, 而 ⑦ 只答【有沒有不一樣】)──
  SELECT count(*) INTO v_n FROM regexp_split_to_table(v_src, E'\n') AS l
   WHERE l !~ '^\s*--' AND l LIKE '%**%';
  IF v_n <> 0 THEN
    RAISE EXCEPTION '#866 片3 後置②:非註解行仍有 % 行含 **', v_n;
  END IF;

  -- ── ③ 三個碼還在, 而【比的是 USING ERRCODE 那個形狀, 不是字面出現過】────────
  --    ⛔ ~~原本 `v_src LIKE '%PCM02%'`~~ 🔴 codex must-fix 3:註解裡有 `PCM02` ⇒ 恆真。
  SELECT count(*) INTO v_n FROM (VALUES ('PCM01'),('PCM02'),('PCM03')) t(c)
   WHERE v_norm LIKE '%USING ERRCODE = ''' || t.c || '''%';
  IF v_n <> 3 THEN
    RAISE EXCEPTION '#866 片3 後置③:USING ERRCODE 的三個碼只剩 % 個(剝註解後數的)', v_n;
  END IF;

  -- ── ④ 兩句話的【指示】還在(換星號不得順手把意思改掉)──────────────────
  IF v_norm NOT LIKE '%要取消請用「作廢」%' THEN
    RAISE EXCEPTION '#866 片3 後置④:PCM03 那句的「要取消請用作廢」不見了 ⇒ 指示掉了, 而那是不改罐頭碼的唯一理由';
  END IF;
  IF v_norm NOT LIKE '%請找工程確認%' THEN
    RAISE EXCEPTION '#866 片3 後置④b:PCM02 那句的「請找工程確認」不見了';
  END IF;

  -- ── ⑤ SECURITY DEFINER 與 search_path 還在(codex 指出這兩格沒人驗)──────────
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.pcm_manual_refund_rail_cap_guard()'::regprocedure) THEN
    RAISE EXCEPTION '#866 片3 後置⑤:SECURITY DEFINER 掉了';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
     WHERE oid = 'public.pcm_manual_refund_rail_cap_guard()'::regprocedure
       AND 'search_path=public, pg_temp' = ANY(proconfig)
  ) THEN
    RAISE EXCEPTION '#866 片3 後置⑤b:search_path 不是 public, pg_temp';
  END IF;

  -- ── ⑥ 🔴 trigger:不只「同名的還在」───────────────────────────────────────
  --    codex must-fix 4 逐字:「trigger 若 disabled、改綁別支函式、變 AFTER／STATEMENT, 仍會全綠。
  --    沒有驗 tgfoid、tgenabled、BEFORE、FOR EACH ROW」。⇒ 四格全補。
  --    ⚠️ tgtype 位元:1=ROW · 2=BEFORE(0 才是 AFTER, 2 才是 BEFORE)· 4=INSERT · 8=DELETE · 16=UPDATE
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.order_manual_refunds'::regclass
       AND tgname  = 'trg_pcm_manual_refund_rail_cap'
       AND NOT tgisinternal
       AND tgfoid    = 'public.pcm_manual_refund_rail_cap_guard()'::regprocedure  -- 綁的是這一支
       AND tgenabled = 'O'                                                        -- 沒被 DISABLE
       AND (tgtype & 1) > 0                                                       -- FOR EACH ROW
       AND (tgtype & 2) > 0                                                       -- BEFORE(不是 AFTER)
       AND (tgtype & 4) > 0 AND (tgtype & 8) > 0 AND (tgtype & 16) > 0             -- INSERT+DELETE+UPDATE
  ) THEN
    RAISE EXCEPTION '#866 片3 後置⑥:trigger 不是「BEFORE INSERT OR UPDATE OR DELETE … FOR EACH ROW 綁 _guard 且未 DISABLE」的那一個';
  END IF;
  -- 🔵 ⑥ 的動詞集合那三格為什麼要留:⟦b4-CAPUPDATE1⟧ 記著「兩道閘的動詞集合不一樣」,
  --    而【這一支】是比較寬的那一道。悄悄變窄不會有任何東西紅。
  -- ── ⑦ 🔴🔴 指紋:總簽收, 而它【刻意排在最後】───────────────────────────────
  --    ⛔ ~~原本它是第①道~~ 🔴 **2026-08-31 搬到最後(`⟦b4-MASKEDASSERT1⟧` 的產物)** ——
  --    掃完全 repo 239 支 migration, **只有這一支把整段來源的指紋放在第一道**;
  --    既有的四支(`20260810170000` / `20260810220000` / `20260811060000` / `20260812130000`)
  --    **全部把它放最後, 或讓後面那些讀【不在 prosrc 裡】的性質**。
  --    ⇒ 📌 **我是那個偏離慣例的人, 而偏離的後果是:②〜⑥ 在本體突變下永遠不會開火。**
  --    ✅ 搬到最後之後:**②〜⑥ 先跑, 給的是【哪裡不一樣】;指紋最後跑, 答的是【還有沒有別的地方不一樣】。**
  --       兩種訊息都留得下來, 而不是後者把前者吃掉。
  --    codex must-fix 5 逐字:「五道斷言不證明行為零改動 —— 例如移除
  --    `OLD.order_id = NEW.order_id`, 跨單假餘裕漏洞會復活, 而五道全部通過」。
  --    ✅ 而指紋擋得住那個突變:少一個條件 ⇒ 正規化後的字面不同 ⇒ md5 不同。
  --    📌 **⇒ 前四道人話斷言【不是】證明, 它們是【比較好的錯誤訊息】** ——
  --       指紋紅的時候只會告訴你「不一樣」, 而下面那幾道會告訴你【哪裡】不一樣。
  IF v_fp <> 'df0f12306fa0a4c875e6180b438ee600' THEN
    RAISE EXCEPTION '#866 片3 後置⑦:換上去的那一版指紋是 %, 而本檔預期的是 % ⇒ 我裝上去的不是我寫的那一支', v_fp, 'df0f12306fa0a4c875e6180b438ee600';
  END IF;

END
$post$;

COMMIT;

-- ── rollback(要用時整段貼)────────────────────────────────────────────────
-- 🛑 沒有「一行還原」—— CREATE OR REPLACE 換掉整個本體, 要還原就是把 20260824011000:112-216
--    那一段原樣 CREATE OR REPLACE 回去。⇒ 從那支檔抄, 不要憑記憶重打。
