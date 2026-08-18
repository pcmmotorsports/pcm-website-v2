-- ═══════════════════════════════════════════════════════════════════════════
--  B1-a · 停用 test_01(A 庫 `pcm-website-v2`)
--
--  🔴 這是【草稿】。最終落點 = 本 repo 的 supabase/migrations/,搬過去時改成該目錄的時間戳命名。
--  · 規格:docs/specs/2026-08-16-m4b-e8b-b1-spec.md §3
--  · 🔴 **這一支在【A 庫】,不是報價單庫。** B1-b / B2 在報價單庫。
--    v1 規格曾把兩個庫混在一起寫,被關卡1 抓到 ⇒ 檔頭第一句就講清楚在哪。
--
--  ── 為什麼要做 ────────────────────────────────────────────────────────────
--  `test_01` 是【主管且啟用】(2026-08-16 實查現況;⚠️ **本支不驗 is_manager**,見 §0.2),
--  而 Sean 2026-08-16 逐字:
--      「昨天開給你測試用得帳號…結果好像沒用到…」
--      「原先以為是要設定好帳號給你才可以登入使用,結果最後你開網頁我手動登入就好」
--  ⇒ 為了讓 AI 登入而開,而那個需求最後不存在。確定無用途。
--
--  ⚠️ **順序上它【不是】B1-b 的前置**(規格 §1 更正):
--     `test_01` 不在 B1-b 的 CHECK 白名單裡 ⇒ B1-b 本來就給不了它登入資格。
--     它該做,但不因 B1-b 而急。**這支可以獨立 apply。**
--
--  ── 🔴 為什麼是 is_active=false 而不是 DELETE ────────────────────────────
--  有【兩個】理由,而原本這裡只寫了較弱的那一個(2026-08-17 code-reviewer 抓後補):
--
--  (1) **強的那個:DELETE 根本會被擋下來。**
--      `public.staff(id)` 被 **3 個檔 / 6 處** FK 指著,且**全部 `ON DELETE RESTRICT`**:
--        supabase/migrations/20260730130000_m4b_e10_a7_order_cancellations.sql:112
--        supabase/migrations/20260731120000_m4b_e10_a7b_m_refund_jobs.sql:184-186
--        supabase/migrations/20260810100000_m4b_e10_op1_order_payments_m.sql:243,246
--      數法:`grep -rn 'REFERENCES public\.staff' supabase/migrations/*.sql`
--      ⇒ test_01 只要在那些表寫過任何一列,DELETE 直接噴 23503。
--
--  (2) **弱的那個(原本只寫這個):`admin_audit_log.actor` 是 text 欄不是 FK**
--      (supabase/migrations/20260712210000_m4a_admin_audit_log.sql:45)
--      ⇒ 刪掉它、若它寫過紀錄,就製造一筆孤兒。
--      **目前孤兒 = 0**(2026-08-16 Sean 實查)。
--
--  ⇒ **結論不變**(is_active 可逆、DELETE 不可逆),**而理由要寫全** ——
--     只寫 (2) 會讓下一個人以為「反正孤兒是 0,刪掉也還好」,
--     **而事實是他根本刪不掉,會撞 FK。理由窄會讓人做出不同的決定。**
--
--  ── ✅ 開工前置(已做,2026-08-16)────────────────────────────────────────
--  跑一次:select distinct actor from public.admin_audit_log order by 1;
--  ⇒ 確認 test_01 有沒有寫過紀錄。
--  **實查結果**:只有 `sean` 48 筆、`staff_1` 17 筆 ⇒ **test_01 零筆,沒寫過任何紀錄。**
--  ⇒ 本支照跑;它的名字**不會**留在稽核軌裡(因為它從來沒進去過)。
--
--  ⚠️🔴 **這一段原本寫「那一句【還沒跑】」,2026-08-17 改掉 —— 它與本檔自己矛盾**:
--     同一支檔下面 §1b 就引用了那次實查的數字(sean 48 / staff_1 17),
--     而 `docs/specs/2026-08-17-b1-apply-preflight.md` `#5` 也記「已跑過一次」。
--     ⇒ **數字到貨了,而它旁邊那句「還沒跑」沒有跟著動** ——
--       留著它會讓下一個人去重跑一件已經做完的事,或誤以為這支還缺前置而不敢 apply。
--     📎 這是本條線 2026-08-17 一整天反覆出現的同一個形狀:
--       **改了表格/數字,沒改它旁邊那句散文,而散文才是被引用的那半。**
--
--  ── 出事怎麼退 ────────────────────────────────────────────────────────────
--  🔴 本支改了【三件事】,三件都要退。
--     ⚠️ 2026-08-17 更正(adversarial-reviewer 抓):這一段原本**只列了第 1 條**,
--        卻寫著「完全可逆,零資料損失」⇒ 照它退完,staff_2 仍掛著測試說明、
--        表註解已被換掉,**而檔頭告訴你已經退乾淨了**。
--
--    1. test_01 停用:
--       UPDATE public.staff SET is_active = true, updated_at = now() WHERE id = 'test_01';
--
--    2. staff_2 的 label(本支把它從占位字串改成測試帳號說明):
--       UPDATE public.staff SET label = '員工 2(占位)', updated_at = now() WHERE id = 'staff_2';
--       ⚠️ 這個舊值取自建表 migration 的 seed
--          (supabase/migrations/20260726120000_m4b_e8a1_staff_table.sql:36)。
--          **退之前先確認正式庫的現值真的是它** —— 中間若有人改過,照抄會蓋掉別人的改動。
--
--    3. `COMMENT ON TABLE public.staff`(本支是**整段覆蓋**,不是附加):
--       原文在 supabase/migrations/20260726120000_m4b_e8a1_staff_table.sql:26-27,
--       退的時候把那兩行的字串原樣寫回去。
--       ⚠️ 被覆蓋掉的字面包含「id 是寫入 admin_audit_log.actor 的穩定 slug」。
--
--  🔴🔴 2026-08-18 補(codex 關卡1 R3,角度=災難當天可用性):
--     **上面第 2、3 條都是「把一個【寫死在本檔裡的舊值】寫回去」** ——
--     codex 逐字:「apply 後若有人更新它們,退場會靜默蓋掉較新的人工狀態」。**屬實。**
--     第 2 條旁邊已經有那句警語,**第 3 條沒有** ⇒ 同一個坑只補了一半。
--     ⇒ **退場的第 0 步(不可省)= 先把【現值】撈出來留底,再決定要不要覆蓋:**
--         SELECT id, label, updated_at FROM public.staff WHERE id IN ('test_01','staff_2');
--         SELECT obj_description('public.staff'::regclass, 'pg_class') AS table_comment;
--     ⇒ **現值 ≠ 本檔寫的舊值 ⇒ 停下來問**,不要照抄。
--     📎 形狀:**rollback 腳本假設「世界從 apply 那一刻起沒有動過」,而那個假設不會自己報錯。**
--
--  ⇒ **三條都做完才叫「退乾淨」。** 逐條可逆、**零資料列損失**(沒有任何 DELETE)——
--     ⚠️ 但**不是「完全還原」**:三條 rollback 都寫 `updated_at = now()`
--        ⇒ **`updated_at` 不會回到原值**(code-reviewer 2026-08-17 抓)。
--        要連它一起還原就得先存下原值,而本支刻意不做 —— `updated_at` 本來就該記「最後一次被動的時間」。
--     這是本片刻意選 is_active 而非 DELETE 的直接好處,但**「可逆」不等於「退一條就好」**。
--
--  ⚠️ 前提:所有語句在同一個 session。statement-mode pooler 下 BEGIN 無效且零警告。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL search_path = pg_catalog, public;

-- ───────────────────────────────────────────────────────────────────────────
--  0. 前提斷言
-- ───────────────────────────────────────────────────────────────────────────
DO $precheck$
DECLARE
  v_active    boolean;
  v_manager   boolean;
  v_total     bigint;
BEGIN
  -- 0.1 🔴 庫別自證 —— 跑錯庫要當場紅,不要靜靜改到別的東西
  --     報價單庫沒有 public.staff;A 庫沒有 public.auth_state。
  IF to_regclass('public.staff') IS NULL THEN
    RAISE EXCEPTION E'B1-a 前提斷言:找不到 public.staff。\n'
      '   ⇒ 你可能連到了【報價單庫】。本支屬 A 庫(pcm-website-v2)。';
  END IF;
  IF to_regclass('public.auth_state') IS NOT NULL THEN
    RAISE EXCEPTION E'B1-a 前提斷言:這個庫有 public.auth_state ⇒ 它是【報價單庫】。\n'
      '   ⇒ 本支屬 A 庫,拒繼續。';
  END IF;

  -- 0.2 test_01 必須存在,而且【現在確實是啟用中】
  --     🔴 若它已經被別人停用了,本支就沒事可做 ——
  --        而「沒事可做卻回報成功」是本 repo 反覆踩過的形狀 ⇒ 明確紅。
  --
  -- ⚠️🔴 **這裡原本寫「啟用中的【主管】」,而 `is_manager` 從頭到尾沒有被判過**
  --    (adversarial-reviewer 2026-08-17 抓)。`v_manager` 只出現在下面那則 NOTICE 裡。
  --    ⇒ **test_01 若已被降成非主管,本支照跑照綠。** 字面已改成它真的驗得出來的範圍。
  --    📌 **刻意不補 is_manager 判斷**:本支的目的是「停用這個帳號」,
  --       而它是不是主管**不改變該不該停用** —— 補一道會讓本支在一個無關的維度上變脆。
  --       ⇒ 這是「把宣稱降到斷言表達得出的層級」,不是「補齊斷言」。
  SELECT is_active, is_manager INTO v_active, v_manager
    FROM public.staff WHERE id = 'test_01';
  IF NOT FOUND THEN
    RAISE EXCEPTION E'B1-a 前提斷言:staff 表裡沒有 test_01。\n'
      '   ⇒ 它可能已經被刪除(而那是規格明文禁止的動作)⇒ 停下回報,不要繼續。';
  END IF;
  IF NOT v_active THEN
    RAISE EXCEPTION E'B1-a 前提斷言:test_01 已經是停用狀態,本支沒有事情可做。\n'
      '   ⇒ 這不是失敗,是【已經有人做過了】。確認是誰做的、為什麼,再決定要不要跳過本支。';
  END IF;

  -- 0.3 分母閘:staff 表不該是空的
  SELECT count(*) INTO v_total FROM public.staff;
  IF v_total = 0 THEN
    RAISE EXCEPTION 'B1-a 前提斷言:staff 表是空的 ⇒ 這個庫的狀態不對,拒繼續。';
  END IF;

  RAISE NOTICE 'B1-a 前提斷言通過:A 庫、test_01 存在且啟用中(is_manager=%),staff 共 % 列。',
    v_manager, v_total;
END
$precheck$;

-- ───────────────────────────────────────────────────────────────────────────
--  1. 停用
--     🔴 只動 is_active 與 updated_at。**不動 is_manager** ——
--        保留它原本的樣子,是為了讓將來翻紀錄的人看得出「這個帳號當時的權限有多大」。
--        把它一起降級會抹掉那個事實。
-- ───────────────────────────────────────────────────────────────────────────
UPDATE public.staff
   SET is_active  = false,
       updated_at = now()
 WHERE id = 'test_01';

-- ───────────────────────────────────────────────────────────────────────────
--  1b. 把 staff_2 指派給 Sean 的一般員工權限測試帳號
--
--  🔴 **這是「指派一個從未被使用的佔位代號」,不是「重用」** ——
--     `staff_2` 在 admin_audit_log 裡【零筆紀錄】(2026-08-16 Sean 實查:只有 sean 48 筆、staff_1 17 筆)
--     ⇒ 沒有任何歷史紀錄的解讀會因為改它的 label 而改變。
--     Sean 拍的「永不重用」講的是**不要重新指派真人用過的代號**;佔位代號存在的目的就是被指派。
--
--  ⚠️ 為什麼不用 staff_1(它有 17 筆):那 17 筆據 Sean 說是他自己測試時挑的,
--     **但那是口頭回答,而 label 是永久且靜默的** —— 錯了不會有任何東西紅。
--     ⇒ 選一個【不需要那個回答就成立】的代號。
--
--  📌 之後真的有第二個員工進來時,他拿【新代號 staff_3】。
-- ───────────────────────────────────────────────────────────────────────────
UPDATE public.staff
   SET label      = 'Sean 測試帳號(一般員工權限,非真員工)',
       updated_at = now()
 WHERE id = 'staff_2';

COMMENT ON TABLE public.staff IS
  '後台操作者名冊。🔴 id 為永久識別碼、永不重用(Sean 2026-08-16 拍板):'
  '離職 = is_active=false,不是 DELETE;新人拿新代號,不撿空出來的。'
  '原因:admin_audit_log.actor 是 text 欄不是 FK,重用代號會讓歷史稽核紀錄改變解讀。'
  ' '
  '🔴 給要查舊稽核紀錄的人(2026-08-16 補):真登入線上線【之前】的 actor 值,'
  '是使用者自己從下拉選單挑的、系統不驗證(apps/admin/src/lib/session/actor.ts 自陳非授權邊界)'
  '⇒ 那些紀錄【不識別任何人】。不要拿它們當「某個人做過什麼」的證據。'
  '具體:staff_1 的 17 筆與 sean 的 48 筆皆屬此列(2026-08-16 實查)。'
  '真正能對應到人的紀錄,從真登入線上線那一刻才開始。';

-- ───────────────────────────────────────────────────────────────────────────
--  2. 落地斷言 —— 驗【結果】不是驗「UPDATE 執行了」
-- ───────────────────────────────────────────────────────────────────────────
DO $verify$
DECLARE
  v_active   boolean;
  v_others   bigint;
  v_active_ids text;
BEGIN
  SELECT is_active INTO v_active FROM public.staff WHERE id = 'test_01';
  IF v_active IS NULL THEN
    RAISE EXCEPTION 'B1-a 落地斷言:test_01 不見了 —— 本支只該 UPDATE,不該讓它消失。';
  END IF;
  IF v_active THEN
    RAISE EXCEPTION 'B1-a 落地斷言:test_01 仍是 is_active=true,停用沒有生效。';
  END IF;

  -- ⛔ 2026-08-18 移除(codex 關卡1 R4 nit,角度=斷言之間的相依):
  --    ~~SELECT EXISTS(… id='test_01') INTO v_still; IF NOT v_still THEN RAISE '那一列不見了'~~
  --    `staff.is_active` 是 `NOT NULL` ⇒ 上面 `SELECT is_active INTO v_active` 只有在
  --    **那一列不存在**時才會得到 NULL,而那個情況已經在前面 RAISE 過了(「test_01 不見了」)。
  --    ⇒ 這一道**永遠到不了失敗分支 = 恆真**,而它讀起來像「有人在守『不可以被刪掉』」。
  --    📎 與本輪在 B2-seed 移除的那道 RLS 重複斷言同一族:
  --      **恆真的斷言比沒有斷言更糟 —— 它讓下一個人以為那一面有守。**
  --    ✅ 真正守「本支只 UPDATE 不 DELETE」的是前面那道(v_active IS NULL ⇒ 紅)。

  -- 🔴 對照組:本支【只該動一列】。其餘 staff 的 is_active 不得被改到。
  --    2026-08-16 Sean 實查:sean/staff_1/staff_2 啟用、op4_backfill/payment_confirmer 停用。
  --    ⇒ 啟用中的應為 3 列(test_01 停用之後)。
  -- 🔴🔴 2026-08-18 更正(codex 關卡1 R3,角度=測試假綠):
  --    ⛔ ~~原本只驗「啟用中的 staff 共 3 列」~~ —— codex 逐字:「一個真人被停用、另一個系統帳號
  --       被啟用時仍是 3,整支照綠」。**屬實:數量相同的世界有很多個,我只想到其中一個。**
  --    ⇒ 改成驗【是哪三個】,不是【有幾個】。數量那句留在訊息裡幫忙診斷。
  SELECT count(*) INTO v_others FROM public.staff WHERE is_active;
  SELECT string_agg(id, ',' ORDER BY id) INTO v_active_ids FROM public.staff WHERE is_active;
  IF v_active_ids IS DISTINCT FROM 'sean,staff_1,staff_2' THEN
    RAISE EXCEPTION E'B1-a 落地斷言:啟用中的 staff 是 [%](共 % 列),預期恰好 sean,staff_1,staff_2。\n'
      '   ⇒ 要嘛我動到了不該動的列,要嘛這個庫的 staff 現況已經跟 2026-08-16 的實查不同。\n'
      '   ⇒ 兩種都要停下來看,不要當成通過。', COALESCE(v_active_ids, '(空)'), v_others;
  END IF;

  -- 🔴 staff_2 的 label 必須真的改到,而且不得再含「員工 2」那種會被誤讀成真員工的字
  DECLARE v_label text; v_s1 text;
  BEGIN
    -- 🔴🔴 **`IS DISTINCT FROM` 不是 `<>`,這一行是承重的**(2026-08-17 B 窗實測後修):
    --    `SELECT … INTO` **沒有 `STRICT`** ⇒ 零列不報錯,只把變數設成 NULL。
    --    而 `NULL <> '…'` 的結果是 **NULL**,`IF NULL` 走 **false 分支**
    --    ⇒ **staff_2 整列不存在時,這道斷言【不會叫】= 指派沒發生也整支綠。**
    --    實測(拋棄式 PG 17.10):staff_2 不存在 + 用另一個人把「啟用中」湊回 3
    --      ⇒ 舊寫法 **rc=0(整支綠)**,而 staff_2 從頭到尾不存在。
    --      正向對照:staff_2 存在 ⇒ rc=0 且 label 確實被改 ⇒ 量具分得出,而舊斷言分不出。
    --    ⚠️ 平常看不到,是因為上面「啟用中 = 3」那道閘通常先紅;
    --       **只要有別人補上那個名額,閘就過了,而這道靜默放行。**
    --    ⇒ `IS DISTINCT FROM` 對 NULL 回 **true** ⇒ 缺列時會叫。
    --    📎 這道斷言存在的唯一目的就是在 apply 當天叫;叫不出來的警報器比沒有警報器更糟。
    SELECT label INTO v_label FROM public.staff WHERE id = 'staff_2';
    IF v_label IS DISTINCT FROM 'Sean 測試帳號(一般員工權限,非真員工)' THEN
      RAISE EXCEPTION 'B1-a 落地斷言:staff_2 的 label 是「%」,指派沒有生效。', v_label;
    END IF;
    -- 對照組:staff_1 的 label【不得】被動到(本支刻意不碰它)
    -- 🔴 **同一個病的第二處** —— 修的時候一起修,不要只改被指名那一處。
    --    這是【對照組】:它要證「staff_1 沒被動到」。而 staff_1 整列不見時
    --    `v_s1` 是 NULL ⇒ 舊寫法 `NULL <> '…'` ⇒ NULL ⇒ 不叫
    --    ⇒ **「有人把 staff_1 刪掉」與「staff_1 好好的」在舊斷言眼裡一模一樣。**
    SELECT label INTO v_s1 FROM public.staff WHERE id = 'staff_1';
    IF v_s1 IS DISTINCT FROM '員工 1(占位)' THEN
      RAISE EXCEPTION E'B1-a 落地斷言:staff_1 的 label 變成「%」——本支不該碰它。\n'
        '   ⇒ 要嘛我動錯列,要嘛它已經被別人改過。兩種都停下來看。', v_s1;
    END IF;
  END;

  RAISE NOTICE '✅ B1-a 落地斷言通過:test_01 已停用且該列仍在、staff_2 已指派、staff_1 未被動到、啟用中的 staff 共 3 列。';
END
$verify$;

COMMIT;
