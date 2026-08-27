-- ci-self-contained: no — 手動貼 Supabase SQL Editor 對線上庫跑(讀 net._http_response / email_outbox 等實資料),非 CI 自給自足。
-- ============================================================================
-- 2026-08-26 · 「排程有在跑」與「信真的寄出去了」是兩個宣稱 —— 這一發問第二個
--
-- ══ 為什麼還要這一發 ═══════════════════════════════════════════════════════
-- 2026-08-26 03:19 UTC Sean 跑完 `cf-probe-cron-有沒有人在打-20260826.sql`:
--   6 支 pg_cron job 全部 active、全部有執行紀錄、最後一次全部 `succeeded`
--   (email-sweep 1908 筆, 最後 2026-08-26 03:15:00+00)
-- 🔴 **而 `succeeded` 只證明 http 呼叫【發出去了】, 不證明對面回 200。**
--   `20260819160000_m4a_e2b_email_sweep_pgcron.sql:155` 自己逐字寫著:
--   vault 的 `cron_secret` 若不等於 Vercel 的 `CRON_SECRET` ⇒ **每一輪都 401**,
--   而 `cron.job_run_details` 照樣記 `succeeded`。
--   ⇒ **「每一輪 401、一封信都沒寄」與「一切正常」在上一發裡印一模一樣的東西。**
--
-- ⇒ 本檔走【上一發沒有走的那條路】:那些 job 是用 `pg_net` 發出去的
--   (`20260819160000:137` 驗 wrapper body 必含 `net.http_get` 字面),
--   而 **pg_net 會把對面回的狀態碼存進 `net._http_response`。**
--   ⇒ 那張表就是答案, 而它一直都在。
--
-- 🔴 **本檔【不需要】先把 sweeper_heartbeat 接起來。** 心跳表(0 列, 接線 plan 未批)
--   要解的是「sweeper 完全沒跑」那個世界; 而現在量到的是「跑了」⇒ 剩下的問題是
--   「跑進去之後對面說什麼」, 那一格 `net._http_response` 現在就答得出來。
--
-- ══ 效度限制(先讀完再看數字)═══════════════════════════════════════════════
-- ⚠️ `net._http_response` **TTL 只有 6 小時**(`20260817070000:50` 記載)
--    ⇒ 本檔只看得到最近 6 小時。**6 小時前的狀態本檔答不出來, 不要外推。**
-- ⚠️ 同檔 `:50` 另記:**`anon` 對這張表有 TRUNCATE/DELETE**(`E686-1`)
--    ⇒ 零列有第三種可能:被清掉。區 0 的自檢會先把這一格分開。
-- ⚠️ `net._http_response` **不存 url** ⇒ 本檔**分不出哪一列是哪一支 job**。
--    ⇒ 它回答的是「這 6 支合起來, 對面回什麼」, 不是「email-sweep 回什麼」。
--    **要指名到單一 job 需要另一條路, 本檔沒有。**
-- ⚠️ 純 SELECT, 包在 BEGIN…ROLLBACK 裡。**不改任何東西。**
--
-- ══ 怎麼跑 ═════════════════════════════════════════════════════════════════
--   1. Supabase SQL Editor(🔴 **網站庫**, 不是報價單庫 —— 區 0 第 0 列會印庫名)
--   2. 整段複製貼上、執行
--   3. 整張結果表複製回傳
--   🔴 **先看區 0。任何一列判定不是 `✅ 尺會動` ⇒ 底下全部作廢。**
-- ============================================================================

BEGIN;

SELECT * FROM (

  -- ── 區 0 · 尺自檢 ─────────────────────────────────────────────────────────
  SELECT '0 尺自檢' AS 區, 0 AS 序, '誰在跑這一發 / 哪個庫' AS 對象,
         current_user || ' / ' || session_user || ' / db=' || current_database() AS 值,
         '✅ 尺會動 — 🔴 db 名字要回傳。PCM 有兩個 Supabase, 跑錯庫的表長得一樣正常' AS 判定

  UNION ALL
  SELECT '0 尺自檢', 1, '正對照:pg_net 這個 extension 裝了嗎',
         (SELECT count(*)::text FROM pg_extension WHERE extname = 'pg_net'),
         CASE WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net')
              THEN '✅ 尺會動' ELSE '🔴🔴 pg_net 不在 ⇒ 本檔【全部作廢】—— 那些 job 不是走 pg_net' END

  UNION ALL
  SELECT '0 尺自檢', 2, '負對照:問一個不存在的 extension',
         (SELECT count(*)::text FROM pg_extension WHERE extname = 'zzz_no_such_ext_20260826'),
         CASE WHEN NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'zzz_no_such_ext_20260826')
              THEN '✅ 尺會動(它不會無中生有)' ELSE '🔴 尺壞了' END

  UNION ALL
  SELECT '0 尺自檢', 3, '🔴 正對照:net._http_response 整張表有東西嗎',
         (SELECT count(*)::text FROM net._http_response),
         CASE WHEN (SELECT count(*) FROM net._http_response) > 0
              THEN '✅ 尺會動 — 底下某個狀態碼的「零筆」才有意義'
              ELSE '🔴🔴 整張表零筆 ⇒ 三種可能分不開(沒發過 / 6h TTL 掃掉 / anon 清掉)'
                || ' ⇒ 區 1 區 2 全部作廢, 不得讀成「沒有在發」' END

  UNION ALL
  SELECT '0 尺自檢', 4, '正對照:email_outbox 這張表撈得到東西嗎',
         (SELECT count(*)::text FROM public.email_outbox) || ' 列',
         CASE WHEN (SELECT count(*) FROM public.email_outbox) > 0
              THEN '✅ 尺會動' ELSE '⚠️ 零列 ⇒ 區 3 的每一格都會是 0, 而那不代表「沒有問題」' END

  -- ── 區 1 · 對面到底回什麼(這是本檔的正題)──────────────────────────────
  UNION ALL
  SELECT '1 對面回什麼', 9, '(小計)',
         (SELECT count(*)::text FROM net._http_response WHERE created > now() - interval '6 hours')
         || ' 筆(最近 6h)/ 其中 2xx ' ||
         (SELECT count(*)::text FROM net._http_response
           WHERE created > now() - interval '6 hours' AND status_code BETWEEN 200 AND 299) || ' 筆',
         '🔴 2xx 筆數 = 0 而總筆數 > 0 ⇒ 【每一輪都被擋在門外】, 而上一發會印 succeeded'

  UNION ALL
  SELECT '1 對面回什麼', 10, coalesce(status_code::text, '(沒有狀態碼)') || '  ' ||
         CASE WHEN status_code BETWEEN 200 AND 299 THEN '正常'
              WHEN status_code = 401 THEN '🔴 401 = 鑰匙不對(vault cron_secret ≠ Vercel CRON_SECRET)'
              WHEN status_code = 404 THEN '🔴 404 = 網址對不上(vault cron_base_url 指錯地方)'
              WHEN status_code IS NULL THEN '🔴 沒有狀態碼 ⇒ 看 timed_out / error_msg 那兩欄'
              ELSE '🔴 非 2xx' END,
         count(*)::text || ' 筆 / 最後一次 ' || max(created)::text,
         CASE WHEN status_code BETWEEN 200 AND 299
              THEN '✅ 這一批對面收下了(⚠️ 收下 ≠ 信一定寄出去了, 那要看區 3)'
              ELSE '🔴 這一批【沒有進到程式裡】' END
    FROM net._http_response
   WHERE created > now() - interval '6 hours'
   GROUP BY status_code

  UNION ALL
  SELECT '1 對面回什麼', 11, '逾時 / 連不上的',
         (SELECT count(*)::text FROM net._http_response
           WHERE created > now() - interval '6 hours' AND (timed_out IS TRUE OR error_msg IS NOT NULL)),
         '🔴 非零 ⇒ 那幾輪連門都沒敲到, 而 cron 那側一樣記 succeeded'

  -- ── 區 2 · 最近 6h 的分佈, 用來看它是【一直壞】還是【剛壞】────────────────
  UNION ALL
  SELECT '2 什麼時候開始的', 19, '(小計)',
         coalesce((SELECT min(created)::text FROM net._http_response), '(零列)')
         || '  ~  ' || coalesce((SELECT max(created)::text FROM net._http_response), '(零列)'),
         '⚠️ 這個區間就是本檔的【全部視野】—— TTL 6h, 更早的事本檔答不出來'

  UNION ALL
  SELECT '2 什麼時候開始的', 20,
         to_char(created, 'YYYY-MM-DD HH24:00') || '  時',
         count(*)::text || ' 筆 / 2xx ' ||
         count(*) FILTER (WHERE status_code BETWEEN 200 AND 299)::text || ' 筆',
         CASE WHEN count(*) FILTER (WHERE status_code BETWEEN 200 AND 299) = 0
              THEN '🔴 這一小時零個 2xx' ELSE '✅ 這一小時有 2xx' END
    FROM net._http_response
   WHERE created > now() - interval '6 hours'
   GROUP BY to_char(created, 'YYYY-MM-DD HH24:00')

  -- ── 區 3 · 信有沒有【積在那裡】(這才是生意上的答案)─────────────────────
  UNION ALL
  SELECT '3 信積住了嗎', 29, '(小計)',
         (SELECT count(*)::text FROM public.email_outbox
           WHERE status IN ('pending', 'failed')) || ' 封卡在 pending/failed',
         '🔴 這個數字持續往上 = 信在積。而它與「今天沒有人下單」印不同的東西 —— 看區 3 的最舊那一封'

  UNION ALL
  SELECT '3 信積住了嗎', 30, status,
         count(*)::text || ' 封 / 最舊 ' || coalesce(min(created_at)::text, '-')
         || ' / 最新 ' || coalesce(max(created_at)::text, '-'),
         CASE WHEN status IN ('pending', 'failed')
              THEN '🔴 最舊那一封如果是【幾小時前】而 sweeper 每 5 分鐘跑一次 ⇒ 它沒有被處理'
              ELSE '⬜ 參考' END
    FROM public.email_outbox
   GROUP BY status

  UNION ALL
  SELECT '3 信積住了嗎', 31, '🔴 最舊那一封 pending/failed 放了多久',
         coalesce((SELECT (now() - min(created_at))::text FROM public.email_outbox
                    WHERE status IN ('pending', 'failed')), '(零封 ⇒ 沒有東西在等)'),
         '🔴 超過 10 分鐘就不對 —— email-sweep 是 */5。而「零封」也可能只是今天沒有信要寄'

  UNION ALL
  SELECT '3 信積住了嗎', 32, '最近 6h 有幾封【成功寄出】',
         (SELECT count(*)::text FROM public.email_outbox
           WHERE status = 'sent' AND created_at > now() - interval '6 hours'),
         '✅ 非零 ⇒ 這條路是通的, 上面那些非 2xx 是別支 job 的'
      || ' / 🔴 零 ⇒ 與區 1 一起看才分得出「沒信要寄」還是「寄不出去」'

) t ORDER BY 區, 序, 對象;

ROLLBACK;
