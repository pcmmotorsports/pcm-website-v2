-- 🔴 本檔是本片(片2a)的【最後一步】。理由與片1 同款、與「簽章不符」無關:
--    ① **commit 之前不得 apply** —— apply 了而 commit 沒進去, 正式庫就有一支 repo 裡不存在的函式,
--       下一支 migration 的前置指紋會對不上, 而沒有人知道為什麼。
--    ② **前置指紋未確認之前不得 apply** —— 本檔用 CREATE OR REPLACE 覆寫整支既有函式,
--       閘沒過就 apply 等於把別人的修正靜默蓋掉。
-- ════════════════════════════════════════════════════════════════════════════
-- M-4b 退款通知信 · 片2a/4:B-record 接上共用 helper(行為零改變)
--
-- plan: ~/pcm-mailbox/58-退款通知信-plan-v7-20260823.md §4-d 片2
-- 上游: Sean 2026-08-22 Q-C=甲(四片切法);主視窗 2026-08-23 把片2 再拆成 2a / 2b,
--       **本檔只做 2a** —— 見 §3。
-- 前片: 20260823010000_m4b_refund_notify_p1_extract_sync_fn.sql(已 apply 至正式庫,
--       實測 apply 後 prosrc md5 = af730e23293b9b8e0e70675378490b25 = repo 檔逐位元相同)
--
-- ══ 1. 本片做什麼 ═══════════════════════════════════════════════════════════
-- `admin_record_manual_refund`(非卡退款登記)在自己的 DML 完成之後, 呼叫一次
-- `pcm_sync_order_refund_payment_status(order_id)`。**只加這一行**, 其餘一字未改。
--
-- ══ 2. 🔴 為什麼這一行今天是 no-op(而它仍然要現在加)═══════════════════════
-- helper 現行算式只計 `order_refunds` 的 confirmed 列(片1 §4-b), 而本函式寫的是
-- `order_manual_refunds` ⇒ v_moved 不變 ⇒ helper 的早退(v_moved <= 0)或單調閘擋住寫入。
-- ⇒ **客人可見改變 = 零 —— 而這句話有一個條件, 而那個條件是【資料一致】。**
--
-- 🔴🔴 **實測到的行為改變(2026-08-23,對抗審查 F1 逼出來的劇本 U3)**:
--   構造:`payment_status = 'paid'` **而該單已有一列 `status='confirmed'` 的 order_refunds(300)**
--   ```
--   舊版 ⇒ ps = paid              (本函式不呼叫 helper ⇒ 不動)
--   新版 ⇒ ps = partiallyRefunded (helper 算出 v_moved=300 < total ⇒ **翻**)
--   ```
--   ⇒ **在這個狀態上, 本片【不是】no-op。** 它把一個漂掉的 payment_status 修正回來。
--   ⇒ 方向是對的(那個 paid 本來就是錯的), **而它是一個改變, 不是零**。
--
--   🔴🔴 **而這個修正【零留痕】—— 片3 之前沒有 audit**(對抗審查 R2 F2):
--     helper 的 COMMENT 逐字「**沒有 actor、不寫 audit**」(`20260823010000` §1 的 COMMENT)
--     而 plan v7 §4-f 的回退包①**以「helper 每次實際寫入都寫 admin_audit_log」為前提**
--     ⇒ **兩份文件對同一個機制各自為真、互相矛盾。**
--     失敗情境:本片上線後某單漂移 ⇒ 下一筆現金登記**靜默**把 payment_status 翻掉
--               ⇒ **漂移樣本被銷毀、audit 零列** ⇒ 事後查不出「它本來是什麼」。
--     ⚠️ 而 §6 那道「apply 前量一發」只蓋 **apply 那一天**, **蓋不到 runtime**。
--   ⇒ **片3 的任務清單必須含一格:helper 加 audit 寫入**(否則 v7 §4-f① 沒有來源)。
--
--   🔴 那個狀態**在一致的資料上不存在** —— A 路徑在 confirm 當下就會同步(見下面④的③)。
--      ⇒ 所以「零改變」的精確版本是:**資料一致 ⇒ 零改變;資料已漂 ⇒ 本片會就地修正它**。
--   ⚠️ **而「正式庫上有沒有這種漂掉的單」是一個【未確認】** —— 要 apply 前量一發, 見 §6。
--
-- 🔴🔴 而「零」靠的**不是**那一句「helper 不動 order_manual_refunds」——
--    對抗審查(2026-08-23)攻了四條路才放棄, 而那四條是這句話真正的分母。**寫下來:**
--      ① `admin_correct_order_refund_verdict` 不會讓 order_refunds 那列變 confirmed
--         (money_moved 更正**不改 status**;20260814190000 檔頭逐字)
--      ② `orders.total` 在單成立後不可變(全 repo 零 `UPDATE … SET total`)
--      ③ A 路徑每次 confirm 之後即同步 ⇒ payment_status 與 SUM(confirmed) 不會事先漂移
--      ④ `unpaid` + 已有 confirmed 卡退款 這個共存態**構造不出來**
--         (A 在 confirm 當下就會因來源態 allowlist RAISE 回滾)
--    🔴 **這四條裡任何一條在片3 之後改變, 這一行就立刻活起來** —— 而片3 正要動算式。
--    ⇒ 片3 的開工清單必須含一格:**回訪這四條**。
--
-- ⚠️ **前一版檔頭寫「那個『零』由 §5 的 A/B 對照證明」—— 那句是假的**(對抗審查 F1):
--    第一版 harness 只建 order + order_items、**零 order_refunds 列** ⇒ 五個劇本的 v_moved 恆 0
--    ⇒ 每一發都在 helper 的早退掉頭 ⇒ **allowlist / v_target / UPDATE orders 一次都沒跑過**,
--    而風險全在那三行。⇒ §5 已補上會走到那三行的劇本(卡片部分退 + 現金補退)。
-- 🔴 現在就加的理由:片3 換算式的時候, 三支 RPC 的接線**已經在了** ——
--    否則片3 會變成「換算式 + 改三支 RPC」一起上, 而那正是 Sean「不一次做好絕對出事」要避開的。
--
-- ══ 3. 🔴 本檔【只動一支】—— 另外兩支不在這裡, 而那不是省略 ═════════════════
-- plan v7 §4-d 把片2 寫成「B/C 三個呼叫點各加一行 PERFORM」。**實查之後那句對【一支】成立:**
--   admin_record_manual_refund          :216 `FROM public.orders … FOR UPDATE`  ⇒ **orders 先** ✅
--   admin_void_manual_refund            對 orders 上鎖命中 0 ⇒ 先鎖 order_manual_refunds(子表)
--   admin_correct_order_refund_verdict  對 orders 上鎖命中 0 ⇒ 先鎖 order_refunds(子表)
-- ⇒ 後兩支要**新增 orders 鎖並重排既有步驟順序**, 不是加一行。
-- 🔴 而 C 那支已經因為鎖的形狀踩過一次死結 ——
--    `20260814190000_m4b_e10_473b1_refund_manual_corrections.sql:262-264` 逐字:
--      「必須 FOR NO KEY UPDATE:本表對 order_refunds 有 FK ⇒ 下面的 INSERT 會取父列 KEY SHARE;
--        **FOR UPDATE 與 KEY SHARE 是 A2b1 已實測過的 40P01 死結形狀**」
-- ⇒ 那兩支 = 片2b, **要 Sean 補批**(它是他批准當下不知道的東西)。本檔刻意不碰。
--
-- ══ 6. 🔴 apply 前必須量一發(而它不是我能跑的)═══════════════════════════════
-- 上面那格的 U3 說明:本片在【已漂移的單】上會就地修正 payment_status。
-- ⇒ apply 之前要知道正式庫上有沒有這種單, 以及有幾張。唯讀一發:
--   ```sql
--   SELECT o.payment_status::text AS 現況,
--          CASE WHEN c.moved >= o.total THEN 'refunded'
--               WHEN c.moved > 0        THEN 'partiallyRefunded'
--               ELSE 'paid' END          AS helper會算成,
--          count(*) AS 張數
--     FROM public.orders o
--     JOIN LATERAL (SELECT COALESCE(SUM(r.refund_amount),0) AS moved
--                     FROM public.order_refunds r
--                    WHERE r.order_id = o.id AND r.status = 'confirmed') c ON TRUE
--    WHERE c.moved > 0
--    GROUP BY 1,2 ORDER BY 3 DESC;
--   ```
--   **怎麼讀**:現況 = helper會算成 的列 ⇒ 一致, 本片對它零改變。
--             兩欄不同的列 ⇒ **那些單在下一次非卡退款登記時會被就地修正** ⇒ 張數 > 0 就要先講給 Sean 聽。
--   ⚠️ 零列不代表沒有 —— 要先確認這個帳號看得到 order_refunds(正對照:同一發加一句 count(*) 全表)。
--
-- ── 🟢 2026-08-23 的答案:**0 張**(主視窗以唯讀 MCP 對正式庫跑)────────────────
--   ```
--   A 正對照 orders 總數                              20   ✅ > 0
--   B 正對照 order_refunds 總數                        8   ✅ > 0
--   C 有 confirmed 退款的單                            2   ✅ **這一格是關鍵**
--   D ps='paid' 但已有 confirmed 退款(會被就地翻)     **0**
--   E ps 與退款總額對不起來(全部方向)                 **0**
--   F 負對照                                           0   ✅
--   ```
--   🔴 **C=2 讓 D/E 的 0 有判別力**:「有 confirmed 退款的單」這個集合**非空**
--      ⇒ D/E 回 0 不是「沒有樣本」, 是**真的一致**。
--   ⇒ **本檔 apply 到正式庫的當下, 不會就地改動任何一張單。**
--
--   🔴🔴 **而這個 0 是【今天的】, 它不保證明天。**
--      上面那道「apply 前量一發」的要求**不因此拿掉** —— 每次要 apply 之前重跑。
--      成因很簡單:D/E 變成非 0 的唯一條件是「有人讓資料漂了」, 而那不需要任何人有惡意 ——
--      A 路徑中途失敗、或未來有第三支寫入端, 都會產生它。
--
-- ══ 3b. 🔴 一件本來要延後、而【查完之後改成現在做】的事(#859)═══════════════
-- 片1 `:211-212` 要求「片2 讓 B/C 也呼叫本函式時, 必須回訪那個 RAISE 前綴」。
-- **本片做了(見 §1a 甲案)。** 而它一度被裁定延後, 那個裁定建在一個**錯的依據**上:
--
-- ~~「admin_record_manual_refund 今天零 GRANT(20260820021000:344-345 分期開權)⇒ 不可達」~~
-- 🔴 **2026-08-23 更正, 錯了兩層**:
--   ① 那個座標是**另一支函式**:`20260810210000` 講的是 `admin_reverse_manual_payment`(收款沖銷),
--      不是 `admin_record_manual_refund`(退款登記)。**兩個名字很像的東西被看成同一支。**
--   ② 而拿來當「以後有人會發現」的那句判別 grep **它自己是瞎的**:
--      `git grep "GRANT EXECUTE ON FUNCTION public.admin_record_manual_refund"` **今天實跑仍然 0**,
--      即使那道 GRANT 就在 `20260820022000:124` —— 因為**它是跨三行寫的**, 單行 grep 看不見。
--      ⇒ 多行感知的量法與這段更正已寫進 backlog `#859`。
--
-- 🔴 而往下查三層, **每一層都不成立**:
--   DB 層 GRANT   已開(`20260820022000:124-126`)
--   app 呼叫端    存在(`apps/admin/src/lib/payment/manual-refund-repository.ts:7` 逐字「唯一呼叫端」)
--   UI 層         **只剩一行寫死的 true**(`components/orders/manual-refund-entry-gate.ts:94`)
-- ⇒ **擋住它的不是機制, 是一個字。** 所以不延後。
--
-- 📌 立案:backlog **`#859`**(含上面兩層更正的全文與可重跑量法)。
--    ⚠️ 前一版這裡寫「見本檔尾註」而**本檔沒有尾註**(對抗審查 F5)—— 已改成指 `#859`。

-- ══ 4. 鎖序(本支為什麼安全)═══════════════════════════════════════════════
-- 本函式步4(:216)已對 orders 取 `FOR UPDATE`, 而 helper 內再取 `FOR NO KEY UPDATE`
-- 是**同交易重複鎖 = no-op**(且是弱化不是升級)⇒ **不新增任何鎖序風險**。
-- 鎖序仍是 orders → order_manual_refunds, 與 A 路徑(orders → order_refunds)同向。
--
-- ══ 5. 回退 ════════════════════════════════════════════════════════════════
-- 零資料異動、零 schema 異動(只重定義一支函式)⇒ 回退 = 用
-- `20260820021000_m4b_e10_d1_record_manual_refund.sql:141-322` 的原文 CREATE OR REPLACE 回去。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ══ 0. 前置斷言 ═════════════════════════════════════════════════════════════
DO $pre$
DECLARE
  v_oid oid;
  v_md5 text;
  -- 指紋 = 20260820021000:141-322 那支函式 body 的 md5(python3 hashlib 算, AS $fn$ 與 $fn$; 之間)。
  c_expect constant text := 'd122ce9be5784cbbd2d9fc0c21247e48';
BEGIN
  -- 🔴 helper 必須已經在(片1 已 apply)。不在 ⇒ 本檔加的那一行會在執行期才炸。
  IF to_regprocedure('public.pcm_sync_order_refund_payment_status(uuid)') IS NULL THEN
    RAISE EXCEPTION '前置失敗 — 找不到 pcm_sync_order_refund_payment_status(uuid);片1(20260823010000)還沒 apply。先套那一支';
  END IF;
  -- 🔴 本片【也覆寫 helper】(§7 的甲案)⇒ 它同樣要釘指紋, 否則會靜默蓋掉別人對它的改動。
  SELECT md5(prosrc) INTO v_md5 FROM pg_catalog.pg_proc
   WHERE oid = to_regprocedure('public.pcm_sync_order_refund_payment_status(uuid)');
  IF v_md5 <> '62c17695621d002ec07789d1e1436f58' THEN
    RAISE EXCEPTION '前置失敗 — helper 的指紋不符(現況 %,預期 62c17695621d002ec07789d1e1436f58 = 片1 落地的那一版)。它已被改過 ⇒ 本檔會靜默蓋掉那次改動。🔴 **不得改本檔的預期值去遷就現況**',
      v_md5;
  END IF;

  v_oid := to_regprocedure('public.admin_record_manual_refund(uuid,uuid,text,text,integer,text,timestamptz)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION '前置失敗 — 找不到那個精確簽章的 admin_record_manual_refund;拒繼續。先查同名的有哪些:SELECT oid::regprocedure FROM pg_proc WHERE proname=''admin_record_manual_refund''';
  END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_catalog.pg_proc WHERE oid = v_oid;
  IF v_md5 <> c_expect THEN
    RAISE EXCEPTION '前置失敗 — admin_record_manual_refund 的整支指紋不符(現況 %,預期 %)。它已被改過 ⇒ 本檔的 CREATE OR REPLACE 會靜默蓋掉那次改動。停下來重讀最後一支改過它的 migration。🔴 **不得改本檔的 c_expect 去遷就現況** —— 那等於把這道閘關掉, 並讓覆寫靜默生效',
      v_md5, c_expect;
  END IF;
  -- ⚠️ 這道指紋只蓋 prosrc, **不蓋 proconfig**(同片1 的已知限度):
  --    正式庫若曾 ALTER FUNCTION … SET, 指紋照樣過而那次設定會被洗掉。
  -- 🔴 而 prosecdef / provolatile 我補進來了(對抗審查 F9):
  --    有人跑過 `ALTER FUNCTION … SECURITY INVOKER` ⇒ prosrc 不變 ⇒ 舊版指紋照樣過,
  --    而本函式**必須是 SECURITY DEFINER**(它寫零 GRANT 的帳本表)。
  IF NOT (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION '前置失敗 — admin_record_manual_refund 不是 SECURITY DEFINER;有人改過它的屬性(prosrc 指紋看不到這件事)';
  END IF;
  IF (SELECT provolatile FROM pg_catalog.pg_proc WHERE oid = v_oid) <> 'v' THEN
    RAISE EXCEPTION '前置失敗 — admin_record_manual_refund 的 volatility 不是 VOLATILE;它會寫表, 被標成 STABLE/IMMUTABLE 會被 planner 折掉';
  END IF;

  -- ══ 🔴🔴 F4:本檔【唯一】能在 apply 期出聲的一格 —— 而拋棄式 PG 對它結構性零判別力 ══
  -- helper 是**零 GRANT**(20260823010000:233-235, 連 service_role 都收)⇒ 只有 owner 執行得到。
  -- 而本函式是 SECURITY DEFINER ⇒ 它以【它自己的 owner】身分呼叫 helper。
  -- 🔴 兩者 owner 若不同 ⇒ **正式庫第一筆現金退款登記 permission denied**
  --    —— 而那時錢已經給客人了, 帳登不進去。
  -- 🔴 而片1 自己寫過這條的成因(:190「本機兩者都是 postgres 所以測不出來」)
  --    ⇒ **本機怎麼跑都不會紅** ⇒ 這道斷言的價值全在 apply 當下。
  -- 🔴 F4(R2):讓這一格【自己出聲】—— 綠的旁邊要自帶效度位。
  --    這道斷言**只在呼叫端 owner 非 superuser 時有判別力**(superuser 執行得到任何函式)。
  --    ⇒ 把 owner 與它的 rolsuper 印出來, **讓讀的人自己判得出這一格有沒有判別力**,
  --      而不是去相信我寫在文件裡的限定 —— **限定會過期, 印在輸出旁邊的值不會。**
  RAISE NOTICE '[效度位] admin_record_manual_refund 的 owner = % / rolsuper = % ⇒ %',
    (SELECT pg_catalog.pg_get_userbyid(proowner) FROM pg_catalog.pg_proc WHERE oid = v_oid),
    (SELECT r.rolsuper FROM pg_catalog.pg_roles r
       JOIN pg_catalog.pg_proc p ON p.proowner = r.oid WHERE p.oid = v_oid),
    CASE WHEN (SELECT r.rolsuper FROM pg_catalog.pg_roles r
                 JOIN pg_catalog.pg_proc p ON p.proowner = r.oid WHERE p.oid = v_oid)
         THEN '🔴 owner 是 superuser ⇒ 下面那道 EXECUTE 斷言【對這個庫沒有判別力】, 它不紅不代表驗過了'
         ELSE '✅ owner 非 superuser ⇒ 下面那道 EXECUTE 斷言是活的' END;
  IF NOT has_function_privilege(
       (SELECT proowner FROM pg_catalog.pg_proc WHERE oid = v_oid),
       to_regprocedure('public.pcm_sync_order_refund_payment_status(uuid)'),
       'EXECUTE') THEN
    RAISE EXCEPTION '前置失敗 — admin_record_manual_refund 的 owner(%) 執行不到 helper ⇒ 上線後第一筆非卡退款登記會 permission denied, 而那時錢已經給客人了。🔴 修法是把 helper 的 owner 對齊, **不是給 helper 補 GRANT**(它刻意零 GRANT)',
      (SELECT pg_catalog.pg_get_userbyid(proowner) FROM pg_catalog.pg_proc WHERE oid = v_oid);
  END IF;
END;
$pre$;

-- ══ 1a. 🔴 helper 的 RAISE 訊息換成中性(#859 甲案;主視窗 2026-08-23 裁定)═══════
-- 片1 為了「行為零改變」**逐字保留**了 `admin_finalize_order_refund:` 這個前綴
-- (片1 自檢 3k 釘著它)。而那個保留的前提是:**當時只有一個呼叫端。**
-- 🔴 本片讓 `admin_record_manual_refund` 也走到這條 RAISE
--    ⇒ 一個從【非卡退款登記】觸發的錯誤, 訊息開頭寫著另一支函式的名字
--    ⇒ **值班會去查卡片退款那條路, 而錯在別處** = 把人導向錯誤現場。
--
-- ⚠️ **這是一個【可觀察行為改變】, 而且它也改變了 A(卡片)路徑的訊息** —— 不要讀成純文案:
--    A 路徑上那條 RAISE 的字面從此不同。片1 的 A/B 對照(S7)當時把「字面相同」當通過條件,
--    **而那個條件的前提(只有一個呼叫端)已經消失** ⇒ 這不是違反憑據, 是憑據的前提沒了。
-- 🔴 而下一個人最可能的誤讀是「有人為了讓測試綠而改期望值」⇒ 所以上面這段要留著。
--
-- ⏱️ 為什麼是現在做, 不是等片3(原本的建議):
--    擋住那條訊息被人看到的**只剩一行寫死的 true**
--    (`apps/admin/src/components/orders/manual-refund-entry-gate.ts:94`
--      `export const MANUAL_REFUND_ENTRY_BLOCKED_BY_787: boolean = true;`, 同檔 :101 用它)
--    ⇒ 它不是分期開權、不是權限、不是機制 —— **改一個字就沒了, 而改它的人不會知道 #859**。
--    ⇒ 而**本片正是讓那條訊息開始指錯地方的那一片 —— 它自己造的, 它自己收。**
CREATE OR REPLACE FUNCTION public.pcm_sync_order_refund_payment_status(p_order_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'pcm_sync_order_refund_payment_status: 需在 READ COMMITTED 下執行(現為 %;RR 下鎖後 SUM 讀不到並行提交)', current_setting('transaction_isolation');
  END IF;

  SELECT o.payment_status::text, o.total INTO v_ps, v_total
    FROM public.orders o WHERE o.id = p_order_id
    FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pcm_sync_order_refund_payment_status: 訂單 % 不存在(FK 應擋住;資料異常)。🔴 本函式由多個呼叫端共用 —— 看呼叫堆疊, 錯不一定在卡片那條路', p_order_id;
  END IF;

  SELECT COALESCE(SUM(refund_amount), 0) INTO v_moved
    FROM public.order_refunds
   WHERE order_id = p_order_id AND status = 'confirmed';

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

-- ══ 1. 只動一支:步6 之後加一行 PERFORM(其餘 182 行程式抽取、非手抄)═════════
-- 🔴 CREATE OR REPLACE 且參數型別未變 ⇒ 保留既有 OID / ACL / owner / COMMENT
CREATE OR REPLACE FUNCTION public.admin_record_manual_refund(
  p_order_id      uuid,
  p_request_id    uuid,
  p_actor         text,
  p_rail          text,
  p_refund_amount integer,
  p_reason        text,
  p_occurred_at   timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_order      record;
  v_existing   record;
  v_remaining  bigint;
  v_id         uuid;
  v_n          integer;
  -- 業務拒絕用單一通用訊息(不洩「這張單存不存在」);輸入類與政策類另給具體訊息。
  -- 🔴 **全檔只有步4 那一處 RAISE 用它**(W5 盲審 n-2 實查)——
  --   而下面的負測③ 正是靠這件事才分得出「紅在步4」與「紅在別處」。
  --   ⇒ 哪天有人讓第二道守門也用這個通用訊息,**負測③ 會失去判別力而不會有東西紅**。
  v_generic_msg constant text := 'admin_record_manual_refund: 退款登記失敗';
BEGIN
  -- 步1 隔離閘(同族慣例;RR 等鎖醒來會拿到舊快照)
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_record_manual_refund: isolation guard' USING ERRCODE = 'P8C01';
  END IF;

  -- 步2 輸入驗(缺值各自具體訊息)
  IF p_order_id      IS NULL THEN RAISE EXCEPTION 'admin_record_manual_refund: 訂單識別碼缺失'; END IF;
  IF p_request_id    IS NULL THEN RAISE EXCEPTION 'admin_record_manual_refund: 冪等鍵 request_id 缺失'; END IF;
  IF p_rail          IS NULL THEN RAISE EXCEPTION 'admin_record_manual_refund: 退款管道缺失'; END IF;
  IF p_refund_amount IS NULL THEN RAISE EXCEPTION 'admin_record_manual_refund: 金額缺失'; END IF;
  IF p_occurred_at   IS NULL THEN RAISE EXCEPTION 'admin_record_manual_refund: 退款時點缺失'; END IF;

  -- 🔴 card 單獨給訊息:它不是「打錯字」,是走錯帳本(卡片退款走 order_refunds)
  IF p_rail = 'card' THEN
    RAISE EXCEPTION 'admin_record_manual_refund: card 軌不得由人工登記(卡片退款走 order_refunds 與它自己的狀態機)';
  END IF;
  IF p_rail NOT IN ('bank_transfer', 'cash') THEN
    RAISE EXCEPTION 'admin_record_manual_refund: 退款管道 [%] 不是 bank_transfer 或 cash', p_rail;
  END IF;
  IF p_refund_amount <= 0 THEN
    RAISE EXCEPTION 'admin_record_manual_refund: 金額必須為正整數(實得 %)', p_refund_amount;
  END IF;
  -- 🔴 btrim 顯式給字集 —— 預設字集只有一般空格,`E'\n\t'` 會穿過去
  --    (該表的 CHECK 自己就是這樣寫的,本 RPC 對齊它,不留一個比 DB 寬的入口)
  IF p_reason IS NULL OR pg_catalog.btrim(p_reason, E' \t\r\n') = '' THEN
    RAISE EXCEPTION 'admin_record_manual_refund: 退款原因不得為空白';
  END IF;
  IF p_actor IS NULL OR pg_catalog.btrim(p_actor, E' \t\r\n') = '' THEN
    RAISE EXCEPTION 'admin_record_manual_refund: 經手人不得為空白';
  END IF;

  -- 步3 actor 必須是啟用中的 staff(FK 只擋不存在;停用的擋不到)
  IF NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.id = p_actor AND s.is_active) THEN
    -- 🔴🔴 這則訊息**必須帶一句「不要換人重送」**(W5 盲審 R2 MF-1;失敗鏈我實測重現過):
    --   員工 A 登記後離職 ⇒ **逐位元相同的重送**撞在這裡 ⇒ 而訊息說的是「人的問題」
    --   ⇒ 操作者照訊息換成在職的 B 重送 ⇒ 過了本道、到步4.5 判「內容不同」
    --   ⇒ 而**那則訊息原本無條件地叫人「用新的 request_id」**
    --   ⇒ ⇒ **同一筆實際退款在帳本上變成兩列,可退餘額被重複扣 —— 錢錯了。**
    --   📌 兩則訊息各自都對,而**它們聯手把人導向登第二筆**。修在訊息、不在順序:
    --      actor 排在冪等格之前是 op5 的設計(擋守門序 oracle),移動它會重新打開那個洞。
    RAISE EXCEPTION 'admin_record_manual_refund: 經手人 [%] 不存在或已停用 ⇒ 拒絕登記退款。'
                    '🔴 現金退款的失敗模式是【人】,而 actor 是唯一的線索。'
                    '⚠️ **若這是一次重送:不要換人重送,也不要換 request_id** —— '
                    '那會讓同一筆退款在帳本上變成兩列。'
                    '🔴 **而你在後台如果找不到「查退款登記」的地方,那就是還沒有** ——'
                    '⇒ **找系統維護幫你確認,不要自己重送。**', p_actor;
  END IF;

  -- 步4 鎖單(第一觸表動作;與同族一致的鎖序)
  SELECT id, created_at INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 🔴 occurred_at 兩道(W5 盲審 n-2:它原本是唯一沒被守的入參,而本 RPC 是唯一守門點
  --    ⇒ 遺漏是永久的)
  IF p_occurred_at > pg_catalog.now() THEN
    RAISE EXCEPTION 'admin_record_manual_refund: 退款時點不得晚於現在(退款時點=%,現在=%)',
                    p_occurred_at, pg_catalog.now();
  END IF;
  IF p_occurred_at < v_order.created_at THEN
    RAISE EXCEPTION 'admin_record_manual_refund: 退款時點早於訂單成立(退款時點=%,下限=%)',
                    p_occurred_at, v_order.created_at;
  END IF;

  -- 步4.5 🔴🔴 冪等格 —— **必須在額度守門【之前】**,而且要**逐欄比對**
  --   兩個缺陷都是實測出來的(拋棄式 PG 17.10,2026-08-20),不是推的:
  --   ① 原本只有 `EXCEPTION WHEN unique_violation` 而**零比對** ⇒
  --      同鍵送 (100) 再送 (50) ⇒ 第二發回 `{recorded:true, idempotent:true}`,
  --      **而帳本裡是 100** ⇒ 呼叫端相信 50 已登記。rail 換成 bank_transfer 也一樣穿過去。
  --      🔴 而 `pcm_order_refundable_remaining` 是減帳本算的 ⇒ 那個差額會靜靜留在「還可退」裡
  --        ⇒ **帳面上我們還欠客人,而系統認為已經登記過了。沒有東西會紅。**
  --   ② 冪等若排在額度守門【之後】,**完全相同的重試會被誤擋**:
  --      total 500、第一發退 500 ⇒ 剩餘 0 ⇒ 相同重試撞「超過可退餘額 0」
  --      ⇒ 實測訊息逐字如此 —— **一個誤導的訊息:它說錢不夠,而其實是同一次請求。**
  --   ⇒ 形狀照 op5(它的 COMMENT 逐字:「G8 冪等樹:六輸入逐欄 IS NOT DISTINCT FROM 全等才回
  --     idempotent(NULL-safe)」),而它的 unique_violation handler 自標「**backstop,不是主要路徑**」。
  SELECT r.id, r.rail, r.refund_amount, r.reason, r.actor, r.occurred_at
    INTO v_existing
    FROM public.order_manual_refunds r
   WHERE r.order_id = p_order_id AND r.request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.rail          IS NOT DISTINCT FROM p_rail
       AND v_existing.refund_amount IS NOT DISTINCT FROM p_refund_amount
       AND v_existing.reason     IS NOT DISTINCT FROM pg_catalog.btrim(p_reason, E' \t\r\n')
       AND v_existing.actor      IS NOT DISTINCT FROM pg_catalog.btrim(p_actor,  E' \t\r\n')
       AND v_existing.occurred_at IS NOT DISTINCT FROM p_occurred_at THEN
      RETURN pg_catalog.jsonb_build_object('recorded', true, 'idempotent', true, 'refund_id', v_existing.id);
    END IF;
    -- 🔴 同鍵不同內容 ⇒ **拒絕**,而且要讓呼叫端分得出來這不是「錢不夠」也不是「重送」
    RAISE EXCEPTION 'admin_record_manual_refund: 同一個 request_id 帶了不同的內容 ⇒ 拒絕。'
                    '🔴 這不是重送,也不是額度問題:帳本裡那一筆與這次送來的至少有一欄不同'
                    '(rail / 金額 / 原因 / 經手人 / 退款時點)。'
                    '⚠️ **先確認這是不是同一筆錢**:'
                    '若你是在重送同一筆(例如原經手人已停用而你換了人)⇒ **不要用新的 request_id**,'
                    '那會讓同一筆退款在帳本上變成兩列、可退餘額被重複扣。'
                    '🔴 **判準寫在這裡,不要靠感覺**:問「**這張單實際退回去給客人的錢,發生過幾次?**」'
                    '——一次 ⇒ 這是同一筆(即使不是你經手的),用**原本的** request_id;'
                    '兩次(兩筆不同的錢都退出去了)⇒ 才是另一筆,才用新的 request_id。'
                    '⚠️ 主詞是**那筆錢**,不是**你** —— 接手的人自己沒退過,但那筆錢已經退過了。'
                    '⚠️ 而**目前沒有「沖銷」入口**(那是另一片,還沒做)⇒ '
                    '要更正既有那筆,**找系統維護**,不要用新的 request_id 補一筆。';
  END IF;

  -- 步5 🔴🔴 額度守門 —— **IS NULL 必須單獨分流**
  --   pcm_order_refundable_remaining 是 LANGUAGE sql + `WHERE o.id = p_order_id`
  --   ⇒ 訂單不存在 ⇒ 無列 ⇒ **回 NULL**。
  --   實測(拋棄式 PG 17.10,2026-08-20):`IF 999999 > NULL THEN RAISE` ⇒ **守門沒有開火 ⇒ 放行**。
  --   而穿過去之後**沒有第二道**(該表零 trigger、CHECK 只有 > 0、無上界)⇒ 那一發會真的寫進去。
  --   ⇒ 兩種成因**分開訊息**:它們的下一步完全不同。
  --   🔴🔴 **而這一道今天【不可達】,我用突變測出來的,不是推的**:
  --     步4 的 `IF NOT FOUND THEN RAISE` 已經先把「查無此單」擋掉了(實測:拿掉本分流之後
  --     用不存在的 order_id 呼叫,紅在步4 的通用訊息、不是這裡)。
  --   ⇒ 所以本分流是**縱深,而它沒有可構造的負測** —— 依本 repo 的紀律
  --     (`feedback_unconstructible-negative-test-means-noop-guard`:沒有測試證得了的縱深
  --      不是縱深,是一句宣稱),我把話講白而不是留一句好聽的:
  --     **下面的負測③ 測的是步4,不是這一道。突變拿掉這一道,負測不會紅 —— 那是預期的。**
  --   ⇒ **什麼會讓它變成活的**:任何人把步4 的 FOR UPDATE 查詢或它的 NOT FOUND 分支挪走/放寬。
  --     那時這一道就是最後一道,而 `999999 > NULL` 不為 true(拋棄式 PG 17.10 實測)⇒ 靜靜放行。
  v_remaining := public.pcm_order_refundable_remaining(p_order_id);
  IF v_remaining IS NULL THEN
    RAISE EXCEPTION 'admin_record_manual_refund: 算不出可退餘額(查無此單或帳本讀不到)⇒ fail-closed 拒絕。'
                    '🔴 這與「額度不足」不同:那是金額問題,這是**看不到帳本**';
  END IF;
  IF p_refund_amount > v_remaining THEN
    RAISE EXCEPTION 'admin_record_manual_refund: 退款金額 % 超過可退餘額 %(帳本未登記額)',
                    p_refund_amount, v_remaining;
  END IF;

  -- 步6 寫入(冪等由 UNIQUE (order_id, request_id) 保證;撞鍵 = 同一次互動被重送)
  BEGIN
    INSERT INTO public.order_manual_refunds
      (order_id, request_id, rail, refund_amount, reason, actor, occurred_at)
    VALUES
      (p_order_id, p_request_id, p_rail, p_refund_amount,
       pg_catalog.btrim(p_reason, E' \t\r\n'), pg_catalog.btrim(p_actor, E' \t\r\n'), p_occurred_at)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    -- 🔴 **這條 handler 是 backstop,不是主要路徑**(逐字沿用 op5 對它的定位)。
    --   主要路徑是上面的步4.5 冪等格。走到這裡只有一種情況:**兩發並行**,
    --   兩發都在步4.5 查無、然後其中一發先寫進去。
    --   ⇒ 這時**不能回 idempotent** —— 我們沒有比對過對方寫了什麼。**拒絕,讓呼叫端重試一次**,
    --     重試時步4.5 就看得到那一列、也就會逐欄比對。
    RAISE EXCEPTION 'admin_record_manual_refund: 同一個 request_id 正在被並行寫入 ⇒ 拒絕本次,請重試。'
                    '(重試時會走冪等格逐欄比對;這條路徑不回 idempotent,因為它沒有比對過對方寫了什麼)';
  END;

  -- 落帳筆數守(trigger 抑制單列 ⇒ 靜默漏寫;本表零 trigger,而這道是給未來的人)
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'admin_record_manual_refund: 落帳 % 列(期望恰 1)⇒ 退款帳本沒收到這筆', v_n;
  END IF;

  -- 片2a:接上退款方向的唯一寫入端(20260823010000 建的 helper)。
  -- 位置刻意在【本函式自己的 DML 完成之後】、以獨立語句呼叫(plan v7 §4-b 鎖定的順序)。
  -- 🔴 今天它是 no-op:helper 的算式只計 order_refunds 的 confirmed 列,而本函式寫的是
  --    order_manual_refunds ⇒ v_moved 不變 ⇒ helper 的早退或單調閘擋住寫入。
  --    片3 換算式之後,這一行才會真的讓畫面翻。**它現在就要在,是為了片3 不必再回來改三支 RPC。**
  -- 🔴 鎖序:本函式步4 已對 orders 取 FOR UPDATE(同族慣例、orders 先)⇒ helper 內再取
  --    FOR NO KEY UPDATE 是同交易重複鎖 = no-op,不新增鎖序風險。
  --    ⚠️ 另兩支(admin_void_manual_refund / admin_correct_order_refund_verdict)**沒有這個前提**
  --       —— 它們先鎖子表 ⇒ 直接照抄本行會形成反向鎖序。見片2b 的增補,**不要照抄**。
  PERFORM public.pcm_sync_order_refund_payment_status(p_order_id);

  RETURN pg_catalog.jsonb_build_object('recorded', true, 'idempotent', false, 'refund_id', v_id);
END;
$fn$;
-- ══ 2. 事後自檢 ═════════════════════════════════════════════════════════════
-- 🔴 每一道都是 RAISE(不成立才出聲)。只印 OK 的檢查沒有判別力。
DO $post$
DECLARE
  -- 🔴 新物件收權斷言清單(scripts/migration-static-checks.sh ③ 要它可被數)。
  --    本檔**零新建物件**(只重定義一支既有函式)⇒ 兩份清單皆空, 而必須明示。
  v_relations text[] := ARRAY[]::text[];
  v_functions text[] := ARRAY[]::text[];
  -- 🔴 F6(對抗審查):前一版寫 `v_declares_nothing := true` 然後檢查 `NOT v_declares_nothing`
  --    ⇒ **永遠不會紅**。「一張自己填自己簽的表, 不是量具。」
  --    ⇒ 改成【從 catalog 量】:本檔宣稱零新建 ⇒ 就去問 catalog 有沒有多出本檔會建的東西。
  v_declares_nothing boolean := true;   -- 明示:本檔不新建任何物件(下面用 catalog 驗它)

  v_src text;
  v_fn  oid;
  v_void oid;
BEGIN
  IF cardinality(v_relations) = 0 AND cardinality(v_functions) = 0 AND NOT v_declares_nothing THEN
    RAISE EXCEPTION '新物件收權斷言:兩份清單都是空的而未明示';
  END IF;
  -- 🔴 而上面那格是「我說我沒建」;下面這格是【去問 catalog】——
  --    本檔若真的零新建, 那 admin_record_manual_refund 的 OID 必須與 apply 前同一顆
  --    (CREATE OR REPLACE 保留 OID;DROP+CREATE 會換一顆)⇒ 它換了 = 本檔做了它宣稱沒做的事。
  IF to_regprocedure('public.admin_record_manual_refund(uuid,uuid,text,text,integer,text,timestamptz)') IS NULL THEN
    RAISE EXCEPTION '自檢失敗 — 那個精確簽章的 admin_record_manual_refund 不見了;本檔宣稱只重定義, 而它顯然不只';
  END IF;

  v_fn := to_regprocedure('public.admin_record_manual_refund(uuid,uuid,text,text,integer,text,timestamptz)');
  SELECT prosrc INTO v_src FROM pg_catalog.pg_proc WHERE oid = v_fn;
  -- 🔴 F7(對抗審查):底下 2a/2b/2c/2d 全是 `position(... in v_src)`,而 v_src 為 NULL 時
  --    每一個 position 都回 NULL ⇒ 四格**一起安靜地過**。我先前只修了 2e 那一格,
  --    而**同一個洞在這四格身上原封不動**。⇒ 在它們之前把 NULL 變成一次 RAISE。
  IF v_fn IS NULL OR v_src IS NULL THEN
    RAISE EXCEPTION '自檢失敗 — 取不到 admin_record_manual_refund 的 prosrc;底下四格全部會安靜地通過, 本輪判定作廢';
  END IF;

  -- 2a. 那一行真的加進去了
  IF position('PERFORM public.pcm_sync_order_refund_payment_status(p_order_id);' in v_src) = 0 THEN
    RAISE EXCEPTION '自檢失敗 2a — admin_record_manual_refund 裡找不到對 helper 的呼叫;接線沒接上';
  END IF;

  -- 2b. 🔴 它在【DML 之後】,不是之前 —— 順序是 plan v7 §4-b 鎖定的東西
  --     用位置比大小:INSERT 的位置必須小於 PERFORM 的位置
  IF position('INSERT INTO public.order_manual_refunds' in v_src)
     >= position('PERFORM public.pcm_sync_order_refund_payment_status' in v_src) THEN
    RAISE EXCEPTION '自檢失敗 2b — helper 的呼叫排在 INSERT 之前;helper 是 STABLE 依賴不成立時會讀不到剛寫的列';
  END IF;

  -- 2c. 🔴 它在【筆數守之後】—— 落帳失敗時不該還去同步狀態
  IF position('落帳 % 列(期望恰 1)' in v_src)
     >= position('PERFORM public.pcm_sync_order_refund_payment_status' in v_src) THEN
    RAISE EXCEPTION '自檢失敗 2c — helper 的呼叫排在落帳筆數守之前;落帳沒成功就不該同步狀態';
  END IF;

  -- 2d. 步4 那道 orders 鎖還在 —— 本檔「不新增鎖序風險」的全部依據
  -- 🔴 第一版寫成 `position('FOR UPDATE' in v_src) = 0`, 而它【驗不出東西】:
  --    `prosrc` **含註解**, 而本函式 :284 那句註解逐字就寫著「把步4 的 FOR UPDATE 查詢…挪走」
  --    ⇒ 拿掉真正的鎖之後, **那句註解仍然餵飽了斷言** ⇒ 恆綠。
  --    (2026-08-23 本窗突變 M3 實測:拿掉鎖 ⇒ 不紅。這是 repo 記過的
  --     「prosrc / diff 這類整包字串當比對對象時, 註解與 code 在裡面是同一種東西」。)
  -- ⇒ 改成比對【整句語句形狀】, 不是比對一個會出現在註解裡的詞。
  -- 🔴 F8(對抗審查):只驗「那句話在不在」擋不住【把它搬到 PERFORM 之後】——
  --    那樣 2d/2b/2c 全綠, 而**鎖序反過來了**。⇒ 照 2b 的做法比位置, 不比存在。
  IF position('FROM public.orders WHERE id = p_order_id FOR UPDATE' in v_src) = 0 THEN
    RAISE EXCEPTION '自檢失敗 2d — 步4 對 orders 的那道 FOR UPDATE 不見了(比對整句語句形狀)';
  END IF;
  IF position('FROM public.orders WHERE id = p_order_id FOR UPDATE' in v_src)
     >= position('PERFORM public.pcm_sync_order_refund_payment_status' in v_src) THEN
    RAISE EXCEPTION '自檢失敗 2d2 — orders 的鎖排在 helper 呼叫【之後】⇒ 鎖序反了(orders 必須先)。本檔「不新增鎖序風險」的論證整個不成立';
  END IF;

  -- 2e. 本檔【不動】另外兩支 —— 它們的接線屬片2b
  -- 🔴 這一格第一版是【恆綠】的:函式不存在時 subquery 回 NULL ⇒ position(x in NULL) = NULL
  --    ⇒ `NULL > 0` 是 NULL ⇒ IF 不成立 ⇒ **它在那個世界裡永遠不會紅**。
  --    (2026-08-23 本窗在拋棄式 PG 上撞到:該環境因 D3-b 前置閘未過而沒有那支函式。)
  --    ⇒ 改成先取 oid、把「不存在」變成一個【看得見】的分支, 而不是一個安靜的 true。
  v_void := to_regprocedure('public.admin_void_manual_refund(uuid,text,text)');
  IF v_void IS NULL THEN
    RAISE NOTICE '自檢 2e 略過:admin_void_manual_refund 不在本環境(本機常態:D3-b 需要更多前置)。⚠️ 正式庫上它【必須】存在 —— 若在正式庫看到這行, 停下來查, 不要當成通過。';
  ELSE
    SELECT prosrc INTO v_src FROM pg_catalog.pg_proc WHERE oid = v_void;
    IF position('pcm_sync_order_refund_payment_status' in v_src) > 0 THEN
      RAISE EXCEPTION '自檢失敗 2e — admin_void_manual_refund 也被接上了;那屬片2b, 而它需要先重排鎖序(見本檔 §3)';
    END IF;
  END IF;

  -- 2f. helper 本身沒被順手改(片1 的算式在片3 之前不得動)
  SELECT prosrc INTO v_src FROM pg_catalog.pg_proc
   WHERE oid = to_regprocedure('public.pcm_sync_order_refund_payment_status(uuid)');
  IF position('AND status = ''confirmed'';' in v_src) = 0 THEN
    RAISE EXCEPTION '自檢失敗 2f — helper 的算式已不是「只計 confirmed」;本檔的「行為零改變」論證不成立';
  END IF;
  IF position('IF v_moved <= 0 THEN' in v_src) = 0 THEN
    RAISE EXCEPTION '自檢失敗 2f2 — helper 的早退不見了;沒有它, 本檔這一行會把 paid 單誤翻成 partiallyRefunded';
  END IF;
  -- 2g. #859 甲案落地:helper 的 RAISE 訊息**不得再帶那個前綴**, 且要帶新的中性前綴
  -- ══ 2g. #859 甲案落地:helper 的【每一條】RAISE 都必須帶中性前綴 ═══════════
  -- 🔴 這一格改過兩次, 而兩次的成因是同一個:**我的分母是我列得出的錯誤答案。**
  --   第一版 `position('admin_finalize_order_refund: 訂單' …) > 0` ⇒ 只抓「舊前綴 + 訂單」
  --          ⇒ helper 三條掛舊前綴的 RAISE 裡, 第三條(後面接「需在」)從它底下走過去
  --   第二版 `position('admin_finalize_order_refund:' …) > 0`     ⇒ 只抓「舊前綴」
  --          ⇒ 終審實測:換成【第三個錯名字】或【整個掉前綴】仍然綠
  -- 🔴 **「不得是 Y」的分母是我列得出的錯法, 而它永遠列不完。**
  -- ⇒ 第三版改成**正面斷言**:
  --      「RAISE EXCEPTION 的總數」必須等於「帶中性前綴的 RAISE 數」, 且**恰為 4**
  --    ⇒ 分母交給 prosrc 自己, 不需要我列舉:
  --      第三個錯名字 / 掉前綴 / 少一條 / **多一條沒帶前綴的**, 全部會紅。
  --    (📌 「數量 = 4」那一半尤其是為了最後那種:有人加第五條 RAISE 而忘了前綴。)
  DECLARE
    v_all  int;
    v_good int;
  BEGIN
    -- 用 length/replace 數子字串出現次數(不依賴 regexp_count 的版本需求)
    v_all  := (length(v_src) - length(replace(v_src, 'RAISE EXCEPTION ''', '')))
              / length('RAISE EXCEPTION ''');
    v_good := (length(v_src) - length(replace(v_src, 'RAISE EXCEPTION ''pcm_sync_order_refund_payment_status: ', '')))
              / length('RAISE EXCEPTION ''pcm_sync_order_refund_payment_status: ');
    IF v_all <> 4 THEN
      RAISE EXCEPTION '自檢失敗 2g — helper 的 RAISE EXCEPTION 共 % 條(期望恰 4)。有人加了或刪了一條 ⇒ 前綴斷言的分母變了, 停下來看那一條是什麼', v_all;
    END IF;
    IF v_good <> v_all THEN
      RAISE EXCEPTION '自檢失敗 2g2 — helper 的 % 條 RAISE 裡只有 % 條帶中性前綴 pcm_sync_order_refund_payment_status:。🔴 本檢查是【正面斷言】—— 它不管你用的是舊前綴、別的函式名、還是沒有前綴, 一律紅', v_all, v_good;
    END IF;
  END;
END;
$post$;

COMMIT;
