-- verify-gender-view-applied.sql
-- 🔴 **貼完 `20260901010000` 之後、開旗標【之前】跑這一支。全部唯讀,不改任何東西。**
--
-- ══ 為什麼需要它 ═══════════════════════════════════════════════════════════
--   `Success. No rows returned` 在【貼了全部】與【只貼到一半的某個成功語句】都會出現。
--   ⇒ 那句話不是證據。這一支才是。
--   🔴 而它要在【開旗標之前】跑 —— 開了旗標而 view 沒那一欄 ⇒ 員工一點就整頁炸掉,
--      而畫面上那句「客戶列表載入失敗」與資料庫暫時斷線長得一樣。
--
-- ══ 怎麼跑 ═══════════════════════════════════════════════════════════════
--   Sean:整段貼進 Supabase SQL Editor(它只 SELECT)。
--   我們:`psql "$PCM_READONLY_DATABASE_URL" -f scripts/verify-gender-view-applied.sql`
--   🔵 唯讀帳號跑得動 —— 五格全是 SELECT,沒有 DDL、沒有寫入。
--
-- ══ 🛑 這支【證不到】什麼(先讀,免得把它讀成「上線就沒事了」)═════════════════
--   ① 它證「那一欄在 view 上」,不證「那一欄有值」——
--      今天 `customers` 全部是 NULL,而那是結構(只有 Email 註冊路徑會填)。
--   ② 它不驗前台/後台畫面 —— 開旗標之後仍要真的打開後台點一次。
--   ③ 它讀的是【現在】。跑完之後有人再改 view,它不會知道。

\echo '════ ① view 的完整欄位(必須恰好 12 個,最後三個是 birthday,birth_month,gender)'
SELECT string_agg(column_name, ',' ORDER BY ordinal_position) AS 欄位,
       count(*)                                              AS 欄數
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'admin_customer_list_v';

\echo '════ ② 三顆 filter 欄的型別(必須 3 列:date / smallint / text)'
\echo '      🔵 少一列 = 那一欄不在;型別不對 = 篩選會靜默失敗'
SELECT column_name AS 欄, data_type AS 型別
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'admin_customer_list_v'
   AND column_name IN ('birthday', 'birth_month', 'gender')
 ORDER BY 1;

\echo '════ ③ service_role 讀不讀得到(必須恰好 1 列, is_grantable = f)'
\echo '      🔴 0 列 = 後台客戶列表【整個讀不到】,而 ① ② 仍然會全過'
SELECT a.privilege_type AS 權限, a.is_grantable AS 可轉授
  FROM pg_class c, aclexplode(c.relacl) a
 WHERE c.oid = 'public.admin_customer_list_v'::regclass
   AND a.grantee <> 0
   AND pg_get_userbyid(a.grantee) = 'service_role';

\echo '════ ④ 舊的那 11 欄還在不在 + security_invoker 有沒有被弄掉'
\echo '      🔴 security_invoker 掉了 ⇒ view 改以 owner 身分求值 ⇒ 底表 RLS 被繞過'
SELECT (SELECT count(*) FROM information_schema.columns
         WHERE table_schema='public' AND table_name='admin_customer_list_v'
           AND column_name IN ('user_id','name','email','phone','tier','created_at',
                               'active_order_count','active_spend_total',
                               'last_active_ordered_at','birthday','birth_month'))
                                                        AS 舊欄還在幾個_要11,
       (SELECT reloptions FROM pg_class
         WHERE oid='public.admin_customer_list_v'::regclass)
                                                        AS reloptions_要含security_invoker_true;

\echo '════ ⑤ 那一欄真的來自 customers.gender 嗎(必須 = 1)'
\echo '      🔴 欄名叫 gender 而資料來自別欄(c.email AS gender)⇒ ①②③④ 全過而篩出來永遠零筆'
SELECT count(*) AS view有讀customers_gender_要1
  FROM pg_depend d
  JOIN pg_rewrite r  ON r.oid = d.objid
  JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
 WHERE r.ev_class = 'public.admin_customer_list_v'::regclass
   AND d.refobjid = 'public.customers'::regclass
   AND a.attname  = 'gender';

\echo '════ 🔵 負對照 —— 這一格必須印 0。印出別的數 = 上面那把尺量錯東西了'
SELECT count(*) AS 負對照_要0
  FROM pg_depend d
  JOIN pg_rewrite r  ON r.oid = d.objid
  JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
 WHERE r.ev_class = 'public.admin_customer_list_v'::regclass
   AND d.refobjid = 'public.customers'::regclass
   AND a.attname  = 'wallet_balance';

\echo ''
\echo '🔴 五格全對 ⇒ 才可以去 Vercel 把 ADMIN_CUSTOMER_GENDER_FILTER 設成 1'
\echo '🔴 任一格不對 ⇒ 旗標【不要開】,回報。開了就是員工一點就炸頁。'
