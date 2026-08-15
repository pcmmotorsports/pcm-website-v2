-- 回退:20260815040000_m4b_e10_13_slice1_admin_update_order_item_amount.sql
--
-- 🔴 **同片交出,不是下一片**(規矩:回退腳本未完成不得排 apply)。
-- 命名照 house 前例 `scripts/20260815030000-down.sql`,不自創格式。
--
-- ══ 退之前先確認一件事 ═══════════════════════════════════════════════════════
-- 🔴 **先退應用層,再跑本檔。**
--    呼叫端(片 1b/1c)一旦改走 `.rpc('admin_update_order_item_amount', …)`,
--    先 DROP 會讓「改金額」變 42883(函式不存在),而不是回到「沒有這個功能」。
-- ✅ **但片 1a 交件當下應用層【尚未接線】** ⇒ **此刻本檔可單獨跑,零應用層依賴。**
--    ⚠️ 這句話會隨片 1b/1c 落地而失效 —— **跑之前先確認現在是哪個狀態**:
--        grep -rn "admin_update_order_item_amount" apps packages --include='*.ts' | grep -v node_modules
--        零命中 ⇒ 應用層還沒接，可直接跑本檔
--        有命中 ⇒ 先退那些 commit，再跑本檔
--
-- ══ 這支退掉什麼、不退什麼 ═══════════════════════════════════════════════════
-- 退:兩支 constraint trigger + 兩支 trigger 相關函式 + 改金額 RPC。
-- 🔴 **不退、也不需要退**:任何資料。本片**零 schema 變更**(不建表、不改欄、不加索引)
--    ⇒ 沒有資料遷移、沒有不可逆寫入。爆炸半徑僅限「這幾個物件存不存在」。
-- ⚠️ **但已經被 RPC 改過的訂單金額不會回滾** —— 那是資料,不是結構。
--    要回復那些單的原值,唯一來源是 `admin_audit_log` 的 `before`
--    (`action = 'order.item.amount.update'`),**而那是人工作業,不在本檔範圍**。
--
-- 🔴 **未確認(codex 關卡2,我無法在本機證):部署工具的 migration ledger 怎麼處置。**
--    本檔只用 raw SQL 退掉物件;`supabase/migrations` 的套用紀錄(以及 `supabase/APPLIED.tsv`)
--    **本檔一個字都沒動**。丟棄式 PG 上「退完再 apply 一次」會成功,
--    **但那證的是 SQL 可重跑,不是正式流程可重套。**
--    ⇒ 正式退版時要先確認 ledger 要不要一起改,**這件事沒有人驗過**。

-- ══ 🔴 硬 checkpoint:應用層先退(codex 關卡2 must-fix)════════════════════════
-- 上面那段字**只是說明**,擋不住任何人。這一段才會擋。
-- 🔴 為什麼要做成閘不是寫成字:memory `feedback_app-layer-must-not-ship-before-migration-apply`
--    的**反方向** —— 那次(2026-08-07 A9h)正式站壞約 8 小時,而當時也「寫在文件裡了」。
--
-- 跑法:先真的去查,查完再帶變數跑。
--   grep -rn "admin_update_order_item_amount" apps packages --include='*.ts' --include='*.tsx' | grep -v node_modules
--   零命中 ⇒ psql "$DB" -v pcm_app_layer_retracted=1 -f scripts/20260815040000-down.sql
--   有命中 ⇒ **先退那些 commit**,不要用變數硬闖。
-- ⚠️ 這道擋的是「順手直接跑」,不是擋所有可能 —— 帶了變數就代表你聲明查過了。
-- ⚠️ 兩層都要:`:{?var}` 只驗**存在**(`-v pcm_app_layer_retracted=0` 或空值照樣放行,
--    codex 關卡2 R2 finding 11)⇒ 再驗一次**值等於 1**。
\if :{?pcm_app_layer_retracted}
\if :pcm_app_layer_retracted
\else
\echo '🔴 拒絕執行:pcm_app_layer_retracted 有給但不是真值(要 1 或 true)。'
\quit
\endif
\else
\echo '🔴 拒絕執行:未聲明「應用層已退」。'
\echo '   先跑:grep -rn "admin_update_order_item_amount" apps packages --include=*.ts | grep -v node_modules'
\echo '   零命中後再帶 -v pcm_app_layer_retracted=1 重跑本檔。'
\quit
\endif

BEGIN;

-- ① 先退 trigger(它們依賴下面那支函式)
DROP TRIGGER IF EXISTS pcm_e13_items_subtotal_guard  ON public.order_items;
DROP TRIGGER IF EXISTS pcm_e13_orders_subtotal_guard ON public.orders;

-- ② 再退函式
DROP FUNCTION IF EXISTS public.pcm_e13_subtotal_guard();
DROP FUNCTION IF EXISTS public.pcm_e13_assert_order_subtotal_matches(uuid);

-- ③ 最後退 RPC(完整簽章 —— 少一個參數就會 DROP 不到,或 DROP 到別支)
DROP FUNCTION IF EXISTS public.admin_update_order_item_amount(
  uuid, uuid, integer, integer, text, text, text);

-- ④ 🔴 零留痕自驗:退完之後這四個物件都不該在
-- ⚠️ **必須限定 schema 與表**(codex 關卡2 must-fix):原版只按全域 `proname` / `tgname` 計數
--    ⇒ **別的 schema 有同名函式、或別的表有同名 trigger,就會誤判成「回退不完整」而整個交易回滾**
--    —— 而那個回滾會讓「down 跑不起來」看起來像「down 有問題」,實際上是計數器抓錯對象。
--    🔴 這是「量錯東西」的形狀:斷言本身沒錯,**但它量的範圍比它宣稱的範圍寬**。
DO $verify$
DECLARE
  v_fn  integer;
  v_tg  integer;
BEGIN
  SELECT count(*) INTO v_fn FROM pg_catalog.pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('admin_update_order_item_amount',
                       'pcm_e13_subtotal_guard',
                       'pcm_e13_assert_order_subtotal_matches');
  SELECT count(*) INTO v_tg FROM pg_catalog.pg_trigger t
   WHERE t.tgrelid IN ('public.order_items'::regclass, 'public.orders'::regclass)
     AND t.tgname IN ('pcm_e13_items_subtotal_guard', 'pcm_e13_orders_subtotal_guard');
  IF v_fn <> 0 OR v_tg <> 0 THEN
    RAISE EXCEPTION '#13 回退不完整:public schema 殘留函式 % 支、兩張目標表殘留 trigger % 支', v_fn, v_tg;
  END IF;
END;
$verify$;

COMMIT;
