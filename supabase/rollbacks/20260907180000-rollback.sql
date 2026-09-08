-- ═══ 88r · 貼板 88 的還原檔(災難用)═══
-- Sean 2026-09-07 `Q76` = **先寫** ⇒ 貼 88 之前先產這一支。
--
-- 🔴 **為什麼 88 特別需要它, 而 87/84/85/86 不需要**:
--    那幾支改的是 **function** ⇒ `apply-paste-board.sh` 的貼前擷取(存前一代)**本身就是回頭路**。
--    而 **88 是 `ALTER TABLE ADD COLUMN` + `ADD CONSTRAINT`** ⇒ 📌 **存前一代救不了欄位** ——
--    前置⑧ 那個 🟡 對 88 是**真的缺口**, 不是形式。
--
-- 🛑 **這一支【不是】給人隨手跑的**:
--    · 它會**刪掉兩個欄位** ⇒ **那兩欄裡的資料一起沒了**(`over_cap_by` / `cap_state`)。
--    · 今天 `order_manual_refunds` **全表 0 列**(2026-09-07 唯讀量到)⇒ **今天跑它不會丟資料**;
--      🔴 **而那個 0 有時效** —— 跑之前**自己重量一次**:`SELECT count(*) FROM public.order_manual_refunds;`
--      **不是 0 就停下來問人。**
--
-- 🔬 兩支函式還原成貼前那一代, 而那一代是【貼前擷取檔】抓的, 不是我憑記憶寫的:
--    來源 `~/pcm-mailbox/貼板-0906/88-前一代-20260907-162410-36741.sql`
--    pcm_manual_refund_rail_cap_guard   md5 372a2f14cc6e82afd23c9daad983ef48 len 6054
--    pcm_d3d_manual_refund_immutable    md5 0226c67f69adc1b3f7629ac0d214bed0 len 3021
--    ⚠️ 這兩個 md5 是**我從擷取檔自己算的** —— 跑之前可以拿它與正式庫當下比, 不同就停下。

BEGIN;

-- ══ 1. 先確認現在真的是「貼過 88」的狀態, 否則不要動 ══
DO $pre$
DECLARE v_n integer; v_rows bigint;
BEGIN
  SET LOCAL lock_timeout = '5s';
  SELECT count(*) INTO v_n FROM pg_attribute a
   WHERE a.attrelid = 'public.order_manual_refunds'::regclass AND NOT a.attisdropped
     AND a.attname IN ('over_cap_by','cap_state');
  IF v_n <> 2 THEN
    RAISE EXCEPTION '88r 前置閘 P1:那兩欄只找到 % 個 ⇒ 現在不是「貼過 88」的狀態, 停下', v_n;
  END IF;

  -- 🔴 資料保護:有列就停下來問人, 不要讓還原變成刪資料
  SELECT count(*) INTO v_rows FROM public.order_manual_refunds;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION '88r 前置閘 P2:order_manual_refunds 有 % 列 ⇒ DROP COLUMN 會把 over_cap_by / cap_state 一起丟掉。'
      '停下來問人:要嘛先把那兩欄的值抄出去, 要嘛不要跑本支。', v_rows;
  END IF;
  RAISE NOTICE '88r 前置閘 P1-P2 過:兩欄在、表 0 列。';
END
$pre$;

-- ══ 2. 兩支函式還原成貼前那一代(逐字抄自貼前擷取檔)══

CREATE OR REPLACE FUNCTION public.pcm_manual_refund_rail_cap_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  END IF;

  RETURN NEW;
END
$function$
;

CREATE OR REPLACE FUNCTION public.pcm_d3d_manual_refund_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
    CASE WHEN NEW.request_id    IS DISTINCT FROM OLD.request_id    THEN 'request_id' END);

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
$function$
;


-- ══ 3. 拆掉 88 加的東西 ══
ALTER TABLE public.order_manual_refunds DROP CONSTRAINT IF EXISTS order_manual_refunds_cap_state_pair;
ALTER TABLE public.order_manual_refunds DROP COLUMN IF EXISTS cap_state;
ALTER TABLE public.order_manual_refunds DROP COLUMN IF EXISTS over_cap_by;

-- ══ 4. 事後閘 ══
DO $post$
DECLARE v_n integer; v_md5 text;
BEGIN
  SELECT count(*) INTO v_n FROM pg_attribute a
   WHERE a.attrelid = 'public.order_manual_refunds'::regclass AND NOT a.attisdropped
     AND a.attname IN ('over_cap_by','cap_state');
  IF v_n <> 0 THEN
    RAISE EXCEPTION '88r 事後閘 A1:那兩欄還剩 % 個 ⇒ 回滾', v_n;
  END IF;

  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p
   WHERE p.oid = 'public.pcm_manual_refund_rail_cap_guard()'::regprocedure;
  IF v_md5 <> '372a2f14cc6e82afd23c9daad983ef48' THEN
    RAISE EXCEPTION '88r 事後閘 A2:cap guard 還原後 md5 = %(要 372a2f14cc6e82afd23c9daad983ef48)⇒ 回滾', v_md5;
  END IF;

  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p
   WHERE p.oid = 'public.pcm_d3d_manual_refund_immutable()'::regprocedure;
  IF v_md5 <> '0226c67f69adc1b3f7629ac0d214bed0' THEN
    RAISE EXCEPTION '88r 事後閘 A3:immutable 還原後 md5 = %(要 0226c67f69adc1b3f7629ac0d214bed0)⇒ 回滾', v_md5;
  END IF;

  -- 🔴 A4:那張表上的 trigger 一支都不能少(還原不該動它們)
  SELECT count(*) INTO v_n FROM pg_trigger t
   WHERE t.tgrelid = 'public.order_manual_refunds'::regclass AND NOT t.tgisinternal;
  IF v_n <> 3 THEN
    RAISE EXCEPTION '88r 事後閘 A4:非內部 trigger 剩 % 支(要 3)⇒ 回滾', v_n;
  END IF;

  RAISE NOTICE '88r 事後閘 A1-A4 全過:兩欄已移除 · 兩支函式回到貼前 md5 · 三支 trigger 都在。';
END
$post$;

COMMIT;

-- ══ 這一支【證不到】什麼 ══
--  · 它把資料庫**結構**還原, **不還原任何資料** —— 前置閘 P2 就是為了讓「表非 0 列」變成停下, 不是變成刪。
--  · 它**不動** `APPLIED.tsv` 與貼板紀錄 ⇒ 跑完之後**帳本上 88 還是「貼過」** ⇒ 那要人去處理。
--  · 兩支函式的 md5 是**我從貼前擷取檔算的**, 不是從正式庫當下讀的 ⇒ 若貼 88 之後又有人動過那兩支, 本支會在事後閘紅(那是對的)。
