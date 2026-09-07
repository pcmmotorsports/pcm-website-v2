-- 回退貼板 78:拆掉 pcm_count_new_email_events。
-- 🔴 **什麼時候該跑這一支**:貼了 78 而【碼還沒上去】, 或 78 之後發現要改簽章。
-- 🛑 **而它不是無害的** —— 碼一旦上線就會呼叫這支函式:
--    函式不在 ⇒ adapter 會 throw(`42883`)⇒ 那一種信本輪不排 + 一行 log + 整輪 503。
--    ⇒ 📌 **回退之前先確認【碼還沒上去】, 或接受那個 503。**
-- 🔵 為什麼可以直接 DROP:它是**新物件**, 沒有任何既有物件相依(view / 觸發器 / 其他函式都沒引用它)。

BEGIN;

DO $gate$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'pcm_count_new_email_events'
  ) THEN
    RAISE EXCEPTION '前置閘:pcm_count_new_email_events 不存在 ⇒ 沒有東西可回退(78 沒貼, 或已回退過)';
  END IF;
END
$gate$;

DROP FUNCTION public.pcm_count_new_email_events(text, text[]);

DO $post$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'pcm_count_new_email_events'
  ) THEN
    RAISE EXCEPTION '斷言:DROP 跑完它還在 ⇒ 拒繼續(可能有同名不同簽章的第二支)';
  END IF;
END
$post$;

COMMIT;
