-- ci-self-contained: no — 手動貼 Supabase SQL Editor 對線上庫跑(讀 net._http_response / email_outbox 等實資料),非 CI 自給自足。
-- ============================================================================
-- 2026-08-26 · 信到底有沒有【被丟進去】—— 而答案已經在上一發的輸出裡
--
-- ══ 為什麼這一發不需要新東西 ═══════════════════════════════════════════════
-- 上一發(`2026-08-26-cron-http-response-and-email-backlog.sql`)量到:
--   最近 6h 469 筆 / 2xx 468 筆 / 零逾時 ⇒ **門是開的**
--   而 `email_outbox` 整張表 **1 列**(sent, 2026-08-22 15:10)⇒ **管子裡沒有東西流過**
--
-- cf 追完寫入端(`~/pcm-mailbox/cf-email_outbox上游-誰丟信-20260826.md`):
--   全 repo **只有一個地方**寫進 email_outbox:`SupabaseEmailOutboxAdapter.ts:265 enqueue()`
--   呼叫它的只有 2 支 use-case, 而
--     · 出貨信 `enqueue-order-shipped-emails.ts` ⇒ **零個生產呼叫端**(只有定義/barrel/註解/測試)
--     · 建立信 `enqueue-order-created-emails.ts` ⇒ **有真入口**, `email-sweep/route.ts:288` 真的 await 它
--   🔴 而 `:283` 那個 `if (cutoffRead.kind === 'ok')` 被 env `B4_DEPLOY_CUTOFF` 擋著。
--
-- 🔴 **而 route 把 `enqueueStatus` 寫進【回應 body】**(`route.ts:304 :332 :336`),
--    而 `net._http_response.content` **存的就是回應 body**。
--    ⇒ **答案一直在我們上一發跑過的那張表裡, 只是沒有人去讀 body。**
--
-- ⚠️ 而這也是本檔【怎麼指名到單一 job】的方法:上一發做不到(那張表不存 url),
--    本檔靠 **body 裡有沒有 `enqueueStatus` 這個字面** 來認 —— 只有 email-sweep 回這個欄位。
--
-- ══ 四態各代表什麼(`route.ts:87-89 :272 :324-336` 逐字)════════════════════
--   skipped_no_cutoff   env **沒設**       ⇒ 整段不跑、回 200   ⇒ 閘關著, enqueue 從沒跑過
--   skipped_bad_cutoff  設了但格式/日期不合 ⇒ 整段不跑、🔴 回 **503**(填錯了要吵)
--   completed           閘開著、掃過了      ⇒ 看 counts 是不是 0
--   failed              enqueue 整段爆掉    ⇒ 回 503
-- 🔴 **上一發量到最近 6h 有【恰好 1 筆 503】(2026-08-25 22:00)。**
--    那一筆是不是這支 job 的 `skipped_bad_cutoff`, 本檔會直接回答。
--
-- ══ 效度限制 ═══════════════════════════════════════════════════════════════
-- ⚠️ `net._http_response` TTL 只有 6 小時 ⇒ **只看得到最近 6h, 更早的答不出來。**
-- ⚠️ 若 route 改過回應格式而 `enqueueStatus` 不在 body 裡 ⇒ 區 0 第 2 列會先紅。
-- ⚠️ 純 SELECT, 包在 BEGIN…ROLLBACK。不改任何東西。
--
-- ══ 怎麼跑 ═════════════════════════════════════════════════════════════════
--   Supabase SQL Editor(🔴 **網站庫**)⇒ 整段貼上執行 ⇒ 整張結果表複製回傳
--   🔴 **先看區 0。任何一列判定不是 `✅` ⇒ 底下全部作廢。**
-- ============================================================================

BEGIN;

SELECT * FROM (

  -- ── 區 0 · 尺自檢 ─────────────────────────────────────────────────────────
  SELECT '0 尺自檢' AS 區, 0 AS 序, '誰在跑 / 哪個庫' AS 對象,
         current_user || ' / db=' || current_database() AS 值,
         '🔴 db 名字要回傳。PCM 有兩個 Supabase' AS 判定

  UNION ALL
  SELECT '0 尺自檢', 1, '正對照:net._http_response 最近 6h 有東西嗎',
         (SELECT count(*)::text FROM net._http_response WHERE created > now() - interval '6 hours'),
         CASE WHEN (SELECT count(*) FROM net._http_response
                     WHERE created > now() - interval '6 hours') > 0
              THEN '✅ 尺會動'
              ELSE '🔴🔴 零筆 ⇒ 本檔【全部作廢】(沒發過 / 6h TTL 掃掉 / 被清掉, 三者分不開)' END

  UNION ALL
  SELECT '0 尺自檢', 2, '🔴 正對照:body 裡撈得到 enqueueStatus 這個字面嗎',
         (SELECT count(*)::text FROM net._http_response
           WHERE created > now() - interval '6 hours'
             AND content LIKE '%enqueueStatus%'),
         CASE WHEN (SELECT count(*) FROM net._http_response
                     WHERE created > now() - interval '6 hours'
                       AND content LIKE '%enqueueStatus%') > 0
              THEN '✅ 尺會動 — 而這也是本檔認出 email-sweep 的方法(那張表不存 url)'
              ELSE '🔴🔴 零筆 ⇒ 兩種可能分不開:①這 6h 內 email-sweep 沒回應過'
                || ' ②route 改過格式而欄位換名 ⇒ 區 1 區 2 全部作廢' END

  UNION ALL
  SELECT '0 尺自檢', 3, '負對照:撈一個不存在的字面',
         (SELECT count(*)::text FROM net._http_response
           WHERE content LIKE '%zzz_no_such_field_20260826%'),
         CASE WHEN (SELECT count(*) FROM net._http_response
                     WHERE content LIKE '%zzz_no_such_field_20260826%') = 0
              THEN '✅ 尺會動(它不會無中生有)' ELSE '🔴 尺壞了' END

  -- ── 區 1 · 🔴 正題:那支 job 每一輪到底回哪一態 ───────────────────────────
  UNION ALL
  SELECT '1 閘開著嗎', 9, '(小計)',
         (SELECT count(*)::text FROM net._http_response
           WHERE created > now() - interval '6 hours' AND content LIKE '%enqueueStatus%')
         || ' 筆 email-sweep 回應(最近 6h)',
         '⬇️ 底下每一態各一列。**四態互斥**(route.ts:267 codex R3 must-fix 2)'

  UNION ALL
  SELECT '1 閘開著嗎', 10,
         CASE WHEN content LIKE '%skipped_no_cutoff%'  THEN 'skipped_no_cutoff'
              WHEN content LIKE '%skipped_bad_cutoff%' THEN 'skipped_bad_cutoff'
              WHEN content LIKE '%"enqueueStatus":"completed"%'
                OR content LIKE '%enqueueStatus": "completed"%' THEN 'completed'
              WHEN content LIKE '%"enqueueStatus":"failed"%'
                OR content LIKE '%enqueueStatus": "failed"%'    THEN 'failed'
              ELSE '(四態都對不上 ⇒ 格式變了)' END,
         count(*)::text || ' 筆 / 狀態碼 ' || string_agg(DISTINCT coalesce(status_code::text,'null'), ',')
         || ' / 最後一次 ' || max(created)::text,
         CASE WHEN content LIKE '%skipped_no_cutoff%'
              THEN '🔴 **乙 = 閘關著** —— B4_DEPLOY_CUTOFF 這個 env 沒設, enqueue 從沒跑過'
              WHEN content LIKE '%skipped_bad_cutoff%'
              THEN '🔴🔴 **乙 = 設定填錯了** —— 這是要修的東西, 而它就是那個 503'
              WHEN content LIKE '%completed%'
              THEN '✅ **閘開著、掃過了** ⇒ 看區 2 的 counts 是不是 0'
              WHEN content LIKE '%failed%'
              THEN '🔴🔴 **enqueue 整段爆掉** —— 真的壞了'
              ELSE '⚠️ 格式對不上 ⇒ 區 0 第 2 列雖然綠, 這一格仍要人看 body' END
    FROM net._http_response
   WHERE created > now() - interval '6 hours' AND content LIKE '%enqueueStatus%'
   GROUP BY CASE WHEN content LIKE '%skipped_no_cutoff%'  THEN 'skipped_no_cutoff'
                 WHEN content LIKE '%skipped_bad_cutoff%' THEN 'skipped_bad_cutoff'
                 WHEN content LIKE '%"enqueueStatus":"completed"%'
                   OR content LIKE '%enqueueStatus": "completed"%' THEN 'completed'
                 WHEN content LIKE '%"enqueueStatus":"failed"%'
                   OR content LIKE '%enqueueStatus": "failed"%'    THEN 'failed'
                 ELSE '(四態都對不上 ⇒ 格式變了)' END,
            content LIKE '%skipped_no_cutoff%', content LIKE '%skipped_bad_cutoff%',
            content LIKE '%completed%', content LIKE '%failed%'

  -- ── 區 2 · 最後一輪的 body 原文(counts 在裡面, 而它分得開丙)──────────────
  UNION ALL
  SELECT '2 最後一輪原文', 19, '最後一筆 email-sweep 回應的時間',
         coalesce((SELECT max(created)::text FROM net._http_response
                    WHERE created > now() - interval '6 hours'
                      AND content LIKE '%enqueueStatus%'), '(零筆)'),
         '⬇️ 底下是它的 body 全文'

  UNION ALL
  SELECT '2 最後一輪原文', 20, 'body 全文(截斷 800 字)',
         coalesce((SELECT left(content, 800) FROM net._http_response
                    WHERE created > now() - interval '6 hours'
                      AND content LIKE '%enqueueStatus%'
                    ORDER BY created DESC LIMIT 1), '(零筆)'),
         '🔴 **這一行就是答案。** counts 全是 0 而 enqueueStatus=completed'
      || ' ⇒ 丙 = 接上了、閘開著、而符合條件的訂單是 0(不是壞了)'

  -- ── 區 3 · 那個 503 是不是這支 ────────────────────────────────────────────
  UNION ALL
  SELECT '3 那個 503', 29, '最近 6h 的非 2xx, 是不是 email-sweep 的',
         coalesce((SELECT string_agg(status_code::text || ' @ ' || created::text || ' / '
                    || CASE WHEN content LIKE '%enqueueStatus%' THEN '🔴 是 email-sweep'
                            ELSE '不是 email-sweep(body 裡沒有 enqueueStatus)' END, '  |  ')
                   FROM net._http_response
                   WHERE created > now() - interval '6 hours'
                     AND (status_code IS NULL OR status_code NOT BETWEEN 200 AND 299)),
                  '(最近 6h 零筆非 2xx)'),
         '🔴 若它是 email-sweep ⇒ 那是 skipped_bad_cutoff 或 failed, 兩者都要修'


  -- ── 區 4 · enqScanned=0 到底是哪個世界(丙:探針自己分得開「沒訂單」與「全被濾掉」)──────
  --   🔴 enqScanned 只有一個 0,而它在【沒有符合的訂單】與【有訂單而全被 cutoff 濾掉】印同一個 0。
  --   這一區直接數 public.orders(= scanner 的篩子【減去 cutoff 那一半】,probe 不知道 cutoff 值),
  --   讓那個 0 從此有判別力 —— 不需要有人記得「第一張真實訂單進來後要重跑」。
  --   scanner 篩子權威:packages/adapters/src/email/SupabasePaidOrderScannerAdapter.ts:190-202。
  UNION ALL
  SELECT '4 訂單分母', 40, '總訂單數(所有列)',
         (SELECT count(*)::text FROM public.orders),
         '=0 ⇒ enqScanned=0 是【真的沒訂單】; >0 ⇒ 看序 42'

  UNION ALL
  SELECT '4 訂單分母', 41, '有效已付款(payment_status=paid 且 cancelled_at 為空)',
         (SELECT count(*)::text FROM public.orders
           WHERE payment_status = 'paid' AND cancelled_at IS NULL),
         '序 42 的上界;它 >0 而序 42 =0 ⇒ 那些單都已排過建立信'

  UNION ALL
  SELECT '4 訂單分母', 42,
         '🔴 已付款未取消【且沒排過 order_created】(= scanner 篩子減去 cutoff 那一半)',
         (SELECT count(*)::text FROM public.orders o
           WHERE o.payment_status = 'paid' AND o.cancelled_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM public.email_outbox e
                              WHERE e.order_id = o.id AND e.event_type = 'order_created')),
         '🔴 這一格 >0 而 body 的 enqScanned=0 ⇒ 它們【只差 cutoff 這一刀】⇒ 去對 B4_DEPLOY_CUTOFF'

  UNION ALL
  SELECT '4 訂單分母', 43, '🔴 判定:enqScanned=0 是哪個世界',
         (SELECT CASE
             WHEN (SELECT count(*) FROM public.orders) = 0
                  THEN '✅ 沒訂單 —— enqScanned=0 是預期(STATUS 前提:目前零真實訂單)'
             WHEN (SELECT count(*) FROM public.orders o
                    WHERE o.payment_status = 'paid' AND o.cancelled_at IS NULL
                      AND NOT EXISTS (SELECT 1 FROM public.email_outbox e
                                       WHERE e.order_id = o.id AND e.event_type = 'order_created')) > 0
                  THEN '🔴🔴 有【已付款未寄】的單而 enqScanned=0 ⇒ 被 cutoff 濾掉 ⇒ 不再是預期, 去對 cutoff'
             ELSE '✅ 有訂單但都沒付款/都排過信 —— enqScanned=0 仍是預期' END),
         '🔴 把「第一張真實訂單進來後 0 才有判別力」焊進探針 —— 兩個世界從此印不同的字'

) t ORDER BY 區, 序, 對象;

ROLLBACK;
