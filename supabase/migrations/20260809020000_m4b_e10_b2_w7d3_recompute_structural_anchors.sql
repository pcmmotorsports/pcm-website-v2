-- ═══════════════════════════════════════════════════════════════════════════
-- M-4b E10-B2 W7d-3:`pcm_a4a_recompute_order_item_summary` 補 position 結構錨
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 派令:`B-215-A` ②-② → `w7d1` plan §6「W7d-3」→ `B-308-A` 續跑令。
--
-- 🔴 **為什麼是新檔而不是改 `20260806180000`(s2b)**:s2b 不在 pending 批
--    (**同批未收割的十支** = `20260807140000`-`230000`;首版寫「九支」是我數錯,實 ls 為十。
--     R2 N3:`pcm-website-v2/STATUS.md:12` 記那批 08-08 晨已 apply ⇒ 用「pending」形容它並不準)
--    ⇒ s2b **已 apply**。forward-only。
--
-- 🔴 **本檔零行為改動,但不是零寫入**(R1 M3 抓到首版這句自述與內容互斥):
--    ① 一個 DO block 的 assert —— 不 CREATE / ALTER / DROP 任何**函式、表、trigger、權限**。
--    ② 一句 `COMMENT ON FUNCTION` —— 🔴 **這是 DDL**,而且它的副作用**不只寫 `pg_description`**:
--       正式庫的 event trigger `pgrst_ddl_watch` 的 command_tag 白名單**含 `COMMENT`**
--       (`docs/specs/2026-07-19-m4a-b2-create-order-9param-plan.md:41` 實查)⇒ 本句 apply 時會
--       `NOTIFY pgrst, 'reload schema'` **觸發一次 PostgREST schema cache 重載**。
--       低風險(重載本來就會被任何 DDL 觸發、且 NOTIFY 在 COMMIT 才送達),但**不是零副作用**,寫明。
--       它是本檔刻意的另一半產物:把「鎖序是對外契約」寫進 catalog,讓只讀 DB 的人也看得到。
--       🔴 `COMMENT ON` 是**取代**不是追加 —— 本句會覆蓋 s2b 當初寫的那段註解(內容已含在本句裡)。
--    ③ **零應用資料寫入**(不碰任何 public 業務表的列)。
--    失敗的唯一後果 = apply 當場停下,不會留下半套狀態(DO block 全有全無、COMMENT 冪等)。
--
-- ── 為什麼需要這些錨(互補非替代;`B-215-A` ②-② 要求把這段分辨寫進片規格)──────
--
-- s2b **已經有** helper 的三軸 md5 指紋前置閘(`…s2b….sql:156`)。那道抓得到**任何**改動,
-- 但它**說不出哪一條不變式破了** —— 它只會說「指紋不符,有人動過」。
-- `strpos` 結構錨抓得比較少,但**指名道姓**:壞掉時直接講出是鎖序破了、還是第四軸的述詞被拔了。
-- 兩者都留、互不取代。md5 是「有沒有被動過」,結構錨是「哪條契約沒了」。
--
-- ── 🔴 錨 A1 的特殊地位:它是另一個決策的機械守門 ──────────────────────────────
--
-- 2026-08-09 W7d-2 撤片(`B-307-STOP` → `B-308-A` Q1=A),撤回理由是
-- 「`admin_cancel_order` 不在死結環上」。那個結論**依賴一條不變式**:
--
--     本 helper 恆「先鎖 `order_items`、後寫 `order_item_quantity_summary`」
--     ⇒ 全 repo 所有 oiqs 寫入路徑方向一致 ⇒ `order_items ↔ oiqs` 這條邊上構造不出反向對。
--
-- 在本檔之前,那條不變式**只靠人讀原始碼**,沒有任何機制守著。錨 A1 是它的機械守門。
-- (連動:`w7d1` plan §6 的失效條件段;memory `feedback_withdrawal-reason-needs-expiry-condition`。)
--
-- 🔴🔴 **這道守門的天花板,寫在這裡不藏**(R2 M1/N4/N5,三條都是真的):
--   ① **本檔只在自己 apply 那一次跑。** 未來任何 `CREATE OR REPLACE` helper 的片(TS > 020000)
--      **不會重新觸發本檔** ⇒ 對「最可能發生的那條路徑」,本檔本身零守門。
--      **真正接住它的是 `scripts/w7d3-verify.sh`**:該檔重放**整個** migration 目錄(含未來的片)
--      之後才驗錨,而 `w7-coverage.sh` 的釘值閘會在任何新 migration 落檔時逼它重跑。
--      ⇒ **未來改 helper 的片,請把本檔的錨複製一份到你自己的檔案裡**,別只依賴 harness。
--   ② **A1 是文字錨,證的是字面順序、不是執行順序。**
--      「把真字面搬進註解」這一族**已被剝註解殺掉**(見下方 v_def 的處理);
--      但**不可達分支**(`IF false THEN … END IF;`)與「改由另一支被呼叫的函式寫 oiqs」
--      仍然繞得過。它擋的是「順手改壞」,不是有意規避。
--   ③ 錨吃的是**整個 `pg_get_functiondef` 輸出**(含 header 的 `SET …` 那幾行),不只函式體。
--
-- ── 語法眉角(W7d-1 踩過,寫下來免得再犯)────────────────────────────────────
-- `pg_catalog.position('X' IN v_def)` **是語法錯誤** —— `IN` 形式不能 schema-qualify。
-- 本檔一律用 `pg_catalog.strpos(v_def, 'X')`(兩參形式,回傳 0 = 未命中)。
-- 🔴 別改用兩參 `position(a, b)`:那個的**參數順序是相反的**。
-- ═══════════════════════════════════════════════════════════════════════════

DO $w7d3$
DECLARE
  v_raw  text;   -- pg_get_functiondef 原文(含註解)
  v_def  text;   -- 🔴 剝掉註解之後的版本 —— **所有錨一律吃這個**
  v_lock int;
  v_ups  int;
BEGIN
  -- ── 前置:被測物存在且簽章唯一(錨若打在不存在的東西上,全部恆真)────────────
  IF (SELECT count(*) FROM pg_catalog.pg_proc
       WHERE pronamespace = 'public'::regnamespace
         AND proname = 'pcm_a4a_recompute_order_item_summary') <> 1 THEN
    RAISE EXCEPTION 'W7d-3 前置閘:pcm_a4a_recompute_order_item_summary 的 overload 數不是 1;'
                    '錨會打空 ⇒ 拒繼續' USING ERRCODE = 'P2B10';
  END IF;

  v_raw := pg_catalog.pg_get_functiondef(
             'public.pcm_a4a_recompute_order_item_summary(uuid)'::regprocedure);

  -- 🔴🔴 **錨之前先把註解剝掉**(codex 關卡2 MF2/MF3;這是整片最重要的一次修正)
  --
  --   codex 的一擊:把**真鎖整段搬進 `/* … */`**、函式直接進 upsert ⇒
  --   區塊錨命中(命中的是註解裡那份)、NKU 恰一次(只剩註解那份)、位置在 upsert 之前
  --   ⇒ **A1 全綠,而函式根本沒有鎖**。同一招對 A4/A5/A6 全部適用,因為它們都是
  --   raw substring existence —— 字面搬進註解、真查詢改壞,五條錨一起變成裝飾品。
  --
  --   ⇒ 所有錨改吃 `v_def` = **剝掉註解之後**的文字。這一步把「inert copy」整族殺掉:
  --      註解裡的字面不再算數,錨命中的必定是真的會被執行的那段。
  --   ⚠️ 順序有意義:先剝區塊註解再剝行註解 —— 反過來的話 `/*` 若與 `--` 交錯會剝不乾淨。
  v_def := pg_catalog.regexp_replace(v_raw,  '/\*.*?\*/', '', 'gs');   -- 區塊註解
  v_def := pg_catalog.regexp_replace(v_def, '--[^\n]*',   '', 'g');    -- 行註解

  -- fail-closed:剝完不該把整個函式體剝光(剝法寫錯時這道會擋下,而不是讓所有錨恆假)
  IF pg_catalog.length(v_def) < pg_catalog.length(v_raw) / 2 THEN
    RAISE EXCEPTION 'W7d-3 前置閘:剝註解後長度剩 %/%(不到一半)⇒ 剝法可能有錯,拒繼續',
      pg_catalog.length(v_def), pg_catalog.length(v_raw) USING ERRCODE = 'P2B10';
  END IF;

  -- ══ A1 鎖序不變式(本檔最重要的一條;W7d-2 撤片理由的機械守門)═══════════════
  --
  -- 🔴🔴 **首版這裡是繞得過的**(code-reviewer R1 M1 抓到,理由值得留著):
  --    首版寫 `strpos(v_def, 'FOR NO KEY UPDATE')` —— `strpos` 只回**第一個**出現位置,
  --    而它**完全沒把那個 NKU 綁到哪一句上**。於是兩種繞法:
  --      反例 A:在 upsert 之前擺一行**註解**含 `FOR NO KEY UPDATE` 字面,真鎖搬到 upsert 之後
  --              ⇒ v_lock 指到註解、< v_ups、A1 全綠。
  --              (而本檔 :123 的新 COMMENT 正好把那句話寫成全稱 —— 下一個人抄進本體註解就通了。)
  --      反例 B:函式開頭多鎖一張別的表(例如 `PERFORM 1 FROM public.orders … FOR NO KEY UPDATE;`),
  --              order_items 的鎖搬到 upsert 之後 ⇒ **六條錨全綠而鎖序不變式已破**。
  --    ⇒ 那會讓「W7d-2 撤片理由的唯一機械守門」擋不住它唯一要擋的那件事。
  --
  -- 修法兩道,缺一不可:
  --   ① `v_lock` 錨**整個 parent 鎖語句區塊**(表名+述詞+NKU 三者連在一起),不是光錨 NKU 字面。
  --   ② NKU 在全文出現次數**必須恰好 1** —— 一次殺掉「註解裡抄一份」與「多鎖第二張表」兩種繞法。
  v_lock := pg_catalog.strpos(
              v_def,
              E'FROM public.order_items oi\n   WHERE oi.id = p_order_item_id\n   FOR NO KEY UPDATE;');
  v_ups  := pg_catalog.strpos(v_def, 'INSERT INTO public.order_item_quantity_summary');

  IF v_lock = 0 THEN
    RAISE EXCEPTION 'W7d-3 錨 A1:找不到「鎖 order_items 的那一整句」'
                    '(FROM public.order_items oi / WHERE oi.id = p_order_item_id / FOR NO KEY UPDATE 三者相連)。'
                    '⇒ 重算彼此不再互斥,且 W7d-2「cancel 不在死結環上」的撤片理由失效'
      USING ERRCODE = 'P2B12';
  END IF;

  -- ②:NKU 恰一次。多出來的那一把(不論在註解裡還是真的多鎖一張表)都讓「第一個 NKU」
  --    不再等於「鎖 parent 的那一把」,順序比較就失去意義。
  IF (pg_catalog.length(v_def)
      - pg_catalog.length(pg_catalog.replace(v_def, 'FOR NO KEY UPDATE', '')))
     / pg_catalog.length('FOR NO KEY UPDATE') <> 1 THEN
    RAISE EXCEPTION 'W7d-3 錨 A1:FOR NO KEY UPDATE 在 helper 裡出現 % 次(必須恰 1)。'
                    '多一份(即使只是註解)就能讓順序比較指到錯的那一把 ⇒ A1 被繞過',
      (pg_catalog.length(v_def)
       - pg_catalog.length(pg_catalog.replace(v_def, 'FOR NO KEY UPDATE', '')))
      / pg_catalog.length('FOR NO KEY UPDATE')
      USING ERRCODE = 'P2B12';
  END IF;
  IF v_ups = 0 THEN
    RAISE EXCEPTION 'W7d-3 錨 A1:找不到 oiqs 的 upsert ⇒ 錨打空,拒繼續'
      USING ERRCODE = 'P2B12';
  END IF;

  -- 🔴 R2 M2:上面的 `v_ups` 只錨**寫入側的 INSERT**。若有人在鎖**之前**插一句
  --    `UPDATE public.order_item_quantity_summary SET …` 或 `DELETE FROM …`,
  --    那也是「在鎖之前寫 oiqs」= 不變式已破,但五條錨會全綠(R1 M1 反例 B 的鏡像,破在寫入側)。
  --    ⇒ 比照 NKU 那道:oiqs 這個表名在 helper 裡**出現次數必須恰 1**(實測現況=1)。
  IF (pg_catalog.length(v_def)
      - pg_catalog.length(pg_catalog.replace(v_def, 'order_item_quantity_summary', '')))
     / pg_catalog.length('order_item_quantity_summary') <> 1 THEN
    RAISE EXCEPTION 'W7d-3 錨 A1:order_item_quantity_summary 在 helper 裡出現 % 次(必須恰 1)。'
                    '多出來的那一處若排在 parent 鎖之前,就是「先寫 oiqs 才鎖」= 不變式已破,'
                    '而只錨 INSERT 的順序比較看不到它',
      (pg_catalog.length(v_def)
       - pg_catalog.length(pg_catalog.replace(v_def, 'order_item_quantity_summary', '')))
      / pg_catalog.length('order_item_quantity_summary')
      USING ERRCODE = 'P2B12';
  END IF;
  IF v_lock >= v_ups THEN
    RAISE EXCEPTION 'W7d-3 錨 A1:鎖序反了 —— parent 鎖(位置 %)不在 oiqs upsert(位置 %)之前。'
                    '全 repo 的 oiqs 寫入方向一致是「order_items ↔ oiqs 這條邊構造不出反向對」的'
                    '唯一理由;它一破,W7d-2 撤片理由當場失效、該片要重開', v_lock, v_ups
      USING ERRCODE = 'P2B12';
  END IF;

  -- ══ A2 鎖的原語必須是 NKU,不得退回 FOR UPDATE ═══════════════════════════════
  -- A2b1 實測:`FOR UPDATE` 與 FK RI 的 KEY SHARE 互斥 ⇒ 40P01(memory 有實錘)。
  -- 註:`FOR NO KEY UPDATE` 不含子字串 `FOR UPDATE`;`ON CONFLICT … DO UPDATE` 也不含。
  -- 🔴 本錨對**註解裡**的 `FOR UPDATE` 也會紅 —— 這是刻意的 fail-closed,不是誤報。
  --    (下一個人若覺得被誤擋,正確處置是改掉那句註解的措辭,不是把錨拆掉。)
  -- 🔴 誠實界:本錨**不涵蓋** `FOR SHARE` / `FOR KEY SHARE`,它們沒有被宣稱擋。
  IF pg_catalog.strpos(v_def, 'FOR UPDATE') <> 0 THEN
    RAISE EXCEPTION 'W7d-3 錨 A2:helper 出現 FOR UPDATE(應一律 FOR NO KEY UPDATE)。'
                    'FOR UPDATE 與 FK RI 的 KEY SHARE 互斥 ⇒ 會製造新的 40P01'
      USING ERRCODE = 'P2B12';
  END IF;

  -- ══ A3(已移除,理由留著)══════════════════════════════════════════════════
  -- 首版有一條 A3 = `strpos(v_def,'FROM public.order_items oi') = 0` 就紅。
  -- R1 M2 指出它名不副實(只證字面存在,證不到「有鎖」),我把宣稱降級後**實跑發現更嚴重的事**:
  -- 修好的 A1 區塊錨本身就含 `FROM public.order_items oi`,所以**任何**改掉表名/別名的突變
  -- 都先撞 A1 ⇒ **寫不出只紅 A3 的負測**。那是「被嚴格蘊含 ⇒ 疑似 no-op」的教科書形狀
  -- (memory `feedback_unconstructible-negative-test-means-noop-guard`)。
  -- ⇒ 直接刪掉,不留一條永遠紅不起來的格假裝有在守。表名由 A1 的區塊錨守。

  -- ══ A4 第四軸真相式的兩個述詞(Q3=A 拍板的字面)═══════════════════════════════
  -- 這兩行不是風格問題:少一行就是「作廢的箱子還算出貨量」或「草稿箱也算出貨量」。
  IF pg_catalog.strpos(v_def, 's.deleted_at IS NULL') = 0 THEN
    RAISE EXCEPTION 'W7d-3 錨 A4:第四軸少了 s.deleted_at IS NULL ⇒ 作廢的箱子仍被算成出貨量'
                    '(推翻 08-05 Q3=A「作廢即退量」)' USING ERRCODE = 'P2B12';
  END IF;
  IF pg_catalog.strpos(v_def, 's.shipped_at IS NOT NULL') = 0 THEN
    RAISE EXCEPTION 'W7d-3 錨 A4:第四軸少了 s.shipped_at IS NOT NULL ⇒ 未寄出的草稿箱被算成出貨量'
      USING ERRCODE = 'P2B12';
  END IF;

  -- ══ A5 instock 走 receipts 直讀,不吃累計欄 ═══════════════════════════════════
  -- 契約:`received_quantity` 那個累計欄有 bug 時摘要仍要對(s2b:206 的設計理由)。
  IF pg_catalog.strpos(v_def, 'FROM public.order_item_procurement_receipts r') = 0 THEN
    RAISE EXCEPTION 'W7d-3 錨 A5:instock 不再走 receipts 直讀' USING ERRCODE = 'P2B12';
  END IF;
  IF pg_catalog.strpos(v_def, 'received_quantity') <> 0 THEN
    RAISE EXCEPTION 'W7d-3 錨 A5:helper 出現 received_quantity ⇒ 摘要改吃累計欄,'
                    '該欄一有 bug 摘要就跟著錯(這正是原設計要避開的)' USING ERRCODE = 'P2B12';
  END IF;

  -- ══ A6 寫入是冪等 upsert,不是盲目 INSERT ═══════════════════════════════════
  IF pg_catalog.strpos(v_def, 'ON CONFLICT (order_item_id) DO UPDATE') = 0 THEN
    RAISE EXCEPTION 'W7d-3 錨 A6:oiqs 寫入的字面不再是 ON CONFLICT (order_item_id) DO UPDATE。'
                    '🔴 這是**形狀凍結**不是冪等守門 —— 改成具名 constraint 形語意等價、照樣冪等,'
                    '本錨一樣會紅。它擋的是「悄悄換掉衝突處理方式」,真正沒有 upsert 才會撞 PK'
      USING ERRCODE = 'P2B12';
  END IF;

  RAISE NOTICE 'W7d-3:五條結構錨全過(A1 鎖序區塊+NKU 恰一次 / A2 不得 FOR UPDATE / A4 第四軸述詞 / A5 receipts 直讀 / A6 upsert 形狀)';
END
$w7d3$;

COMMENT ON FUNCTION public.pcm_a4a_recompute_order_item_summary(uuid) IS
  'M-4b E10 A4a 核心:鎖 parent(FOR NO KEY UPDATE,A2b1 同原語)後由**四張**真相表重算 '
  'order_item_quantity_summary 並 upsert(惰性建列)。instock 直讀 receipts JOIN、不經 '
  'received_quantity 累計欄;shipped 直讀 shipment_items JOIN shipments(deleted_at IS NULL '
  'AND shipped_at IS NOT NULL)。🔴 2026-08-06 B2-S2b 四軸化:呼叫者 = A4a 四支 trigger + '
  'B2-S2b 的 shipments_summary_recompute_ac + 兩片的 backfill。🔴 本函式維持 '
  'search_path = public, pg_temp(既有函式只加軸、不趁機改執行環境);B2-S2b 新建的 trigger '
  '函式用 search_path = '''' —— 兩種慣例並存是刻意的。'
  '🔴 2026-08-09 W7d-3 加註:本函式「先鎖 order_items、後寫 oiqs」的**順序是對外契約**,'
  '不是實作細節 —— 它是「全 repo oiqs 寫入方向一致」的唯一理由,而那又是 W7d-2 判定 '
  'admin_cancel_order 不在死結環上、據以撤片的前提。要改這個順序,先去看 '
  'docs/specs/2026-08-08-e10-b2-w7d1-ship-deadlock-and-translator-direction-plan.md 的 §6 失效條件段:W7d-2 必須同時重開。'
  '機械守門在 migration 20260809020000 的錨 A1。';
