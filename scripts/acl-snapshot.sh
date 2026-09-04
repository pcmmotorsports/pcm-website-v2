#!/bin/bash
# `public` 底下的權限矩陣快照 —— **讓 dashboard / SQL Editor 的手改【被看見】。**
#
# ══ 🛑 它【不擋】人手改, 只讓手改被看見 ══════════════════════════════════════
#   板列 `:469` 逐字:「ACL 漂移守門裝上了, 而【路⑤ dashboard / SQL Editor 手動改權限】
#   仍然完全沒有人守」。那條路走的是 Supabase 的網頁介面 —— **repo 裡不會留下任何一個字**
#   ⇒ 既有的字面守門結構上看不到它。
#   ✅ 本支的做法:**把正式庫當下的權限矩陣落成一份基線**, 下次跑時比對。
#      🔴 **它不阻止任何人改** —— 它只讓「改過了」這件事**有一個會叫的地方**。
#      📌 而那正是這一列缺的東西:今天手改之後, **沒有任何一刻會有人發現。**
#
# ══ 🔴 它證不到什麼(讀輸出的人要知道)═══════════════════════════════════════
#   ① **它只在有人跑它的時候會叫** —— 沒掛任何 hook(矩陣要連正式庫, 掛 hook 等於每次 commit 連線)
#      ⇒ 它是「盤點工具」不是「守門」。⚠️ 那是刻意的, 不是漏掉。
#   ② 它比的是【兩次快照之間】的差 ⇒ **改了又改回來, 它看不到。**
#   ③ 它只看 `public` 這個 schema, 只看那四個角色 ⇒ **別的 schema / 別的角色不在分母裡。**
#      ⚠️ 而 `POL` 那一族是【全部角色】(policy 的 roles 原樣印)—— 那一族不受「四個角色」限制。
#   ⑤ `POL` 記到 `USING` / `WITH CHECK` 的**內容雜湊**(2026-09-05 補)——
#      ⇒ 內容變了會顯形。⚠️ **而 diff 只說「變了」不說「變成什麼」** —— 那要去查 `pg_get_expr`。
#      🔴 而它仍看不到:policy 的**順序**(PG 不保證)· 同名 policy 在不同 schema · 欄級授權。
#   ⑥ `FNCFG` 族記每支函式的 `SECURITY DEFINER/INVOKER` 與 `search_path=` 那一項(2026-09-05 加)
#   ⑦ `VIEWOPT` 族記每支 view 的 `security_invoker` 與 owner(2026-09-05 加)——
#      🔴 `(未設)` **等於 false**;前六族在 invoker=true/false 兩個世界印【逐字相同】的東西。
#      ⇒ `ALTER FUNCTION … SET search_path` 這種手改會顯形。
#      🔴 而它**只記 `search_path`** —— `proconfig` 的別項(`lock_timeout` 等)不記, 那是刻意的。
#   ④ `has_*_privilege` 對【欄級授權】少報(那個坑本 repo 記過)⇒ 欄級的改動這裡看不到。
#
# 用法:bash scripts/acl-snapshot.sh            比對(有差 rc=1)
#       bash scripts/acl-snapshot.sh --write    重寫基線(= 你在宣告那些差是【被批准的】)
#       bash scripts/acl-snapshot.sh --selftest
# 出口:0 沒差 / 1 有差 / 2 ENV-FAIL(這【不是】「沒差」)
set -uo pipefail
export LC_ALL=C LANG=C

REPO="$(cd "$(dirname "$0")/.." && pwd)"
BASE="$REPO/supabase/acl-snapshot.tsv"
# 🔴 主樹(`.env.local` 住的地方)—— 與 0905查證/run.sh 同一條路, 而**絕不印連線字串**。
ENVROOT="/Users/sean_1/pcm-website-v2"

# ── 產出快照的 SQL(排序固定 —— 否則每次跑都會「有差」)──
snapshot_sql() {
  cat <<'SQL'
\pset pager off
\pset tuples_only on
\pset format unaligned
\pset fieldsep '\t'
-- 🔴🔴 `UNION` 的欄位型別由【第一個分支】決定 —— 而第一支的 `r.rolname` 是 `name`
--    ⇒ **整個 obj 欄被降成 `name` ⇒ 每一列在 63 字元被截斷**, 包含下面兩支明轉過 text 的。
--    🔬 2026-09-05 實測:`admin_add_shipment_items(...)` 完整長 90, 而快照裡第 2 欄長 63。
--    🎯 **我第一次改的是下面兩支(在它們自己那一層完全正確), 而型別不由它們決定。**
--    📌 一個在【它自己那一層是對的】修法, 可以完全不生效 —— 而它在 diff 上看起來就是修好了。
--    🛑 截斷的危險不是不好看:兩支長前綴相同的函式會**塌成同一列** ⇒ 改其中一支這份快照看不到。
SELECT 'ROLE' AS kind, r.rolname::text AS obj, '' AS priv,
       CASE WHEN r.rolbypassrls THEN 'BYPASSRLS' ELSE '-' END AS val
  FROM pg_catalog.pg_roles r
 WHERE r.rolname IN ('anon','authenticated','service_role','payment_confirmer')
UNION ALL
-- 🔴 `nspname` / `relname` 是 `name` 型別 ⇒ `name || name` 仍是 `name` ⇒ **在 63 字元被截斷**
--    (2026-09-05 實測:一支長函式名在快照裡斷成 `…p_shipm`)⇒ 每一段都明轉 text。
--    🛑 而截斷的危險不是「不好看」—— 兩支長前綴相同的函式會**塌成同一列**,
--       那時改其中一支, 這份快照【看不到】。今天量到重複 key = 0, 而那是運氣不是保證。
       SELECT 'REL', n.nspname::text||'.'||c.relname::text||'|'||c.relkind::text, g.rol,
       CASE WHEN pg_catalog.has_table_privilege(g.rol, c.oid, 'SELECT') THEN 'S' ELSE '-' END ||
       CASE WHEN pg_catalog.has_table_privilege(g.rol, c.oid, 'INSERT') THEN 'I' ELSE '-' END ||
       CASE WHEN pg_catalog.has_table_privilege(g.rol, c.oid, 'UPDATE') THEN 'U' ELSE '-' END ||
       CASE WHEN pg_catalog.has_table_privilege(g.rol, c.oid, 'DELETE') THEN 'D' ELSE '-' END ||
       CASE WHEN c.relrowsecurity THEN '|RLS' ELSE '|---' END
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN (VALUES ('anon'),('authenticated'),('service_role'),('payment_confirmer')) AS g(rol)
 WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m','p')
UNION ALL
SELECT 'FN', n.nspname::text||'.'||p.proname::text||'('||pg_catalog.pg_get_function_identity_arguments(p.oid)||')', g.rol,
       CASE WHEN pg_catalog.has_function_privilege(g.rol, p.oid, 'EXECUTE') THEN 'X' ELSE '-' END ||
       CASE WHEN p.prosecdef THEN '|DEF' ELSE '|INV' END
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN (VALUES ('anon'),('authenticated'),('service_role'),('payment_confirmer')) AS g(rol)
 WHERE n.nspname = 'public'
UNION ALL
-- 🔴 第六族:函式的 `proconfig`(2026-09-05 加)——
--    ⛔ 前五族**看不到** `ALTER FUNCTION … SET search_path` 這種手改:
--       它不動任何 GRANT、不動 policy ⇒ 前五族一格都不會變。
--    🔬 而那一格是真的重要:2026-09-05 普查到 **117 支 SECURITY DEFINER**,
--       其中 **39 支 `search_path` 沒鎖成空字串**(22 支 `service_role` 叫得動)。
--    🛑 而本族**只記 `search_path=` 那一項** —— `proconfig` 裡的別項(`lock_timeout` 等)不記。
--       ⚠️ 那是刻意的:別項變動今天沒有人在乎, 而**把它們也記進來會讓 diff 天天叫**。
--       📌 一道天天叫的閘會被關掉, 而關掉的閘比沒裝的更難回來。
SELECT 'FNCFG',
       n.nspname::text||'.'||p.proname::text||'('||pg_catalog.pg_get_function_identity_arguments(p.oid)||')',
       CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END,
       COALESCE((SELECT c FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'), '(未設)')
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
UNION ALL
-- 🔴🔴 第七族:view 的 security_invoker(2026-09-05 加)——
--    ⛔ 前六族**答不出這一題**:一支 view 授權給 service_role, 而 view 預設走 **owner** 的權限,
--       ⇒ 它會**繞過底下那些表的 RLS**, 而 REL 族只看得到「service_role 有 SELECT」——
--       那一行在 security_invoker=true 與 false 兩個世界【逐字相同】。
--    🛑 今天無所謂(service_role 自己就有 BYPASSRLS), 而**收掉 BYPASSRLS 那一刻**,
--       這一欄就是「哪幾支 view 仍然是側門」的唯一答案。⇒ ⟦b9-RLSHARDEN⟧ 收後必查。
--    📌 `(未設)` **等於 false** —— PG 的預設是 owner 權限。不要把「沒寫」讀成「安全」。
SELECT 'VIEWOPT',
       n.nspname::text||'.'||c.relname::text||'|'||CASE c.relkind WHEN 'm' THEN 'matview' ELSE 'view' END,
       COALESCE((SELECT o FROM unnest(c.reloptions) o WHERE o LIKE 'security_invoker=%'), 'security_invoker=(未設)'),
       pg_catalog.pg_get_userbyid(c.relowner)::text
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('v','m')
UNION ALL
-- 🔴🔴 第八族:`storage` schema 的表級授權(2026-09-05 加)——
--    ⛔ 前七族的 WHERE 全部是 `nspname = 'public'` ⇒ **`storage` 一列都沒有**
--       (2026-09-05 量:基線 1283 列裡含 `storage` 的 = **0**)。
--    🔬 而 2026-09-05 唯讀實測:`storage` 底下 8 張表 **RLS 全開而 policy 全 0**,
--       `anon` / `authenticated` 對 **`buckets` · `buckets_analytics` · `objects`** 是 **SIUDT**(含 `TRUNCATE`)。
--       ⛔ ~~只有 `objects` 與 `buckets_analytics`~~ —— 那是我用【名字】問權限時的錯讀(缺 USAGE ⇒ RAISE 被讀成權限較小)。
--    🛑 **而 `storage` 是【平台管的 schema】** —— Supabase 升級可能重新授權,
--       那條路**不經過我們任何一支 migration** ⇒ 📌 **只有這一族看得到它變了。**
--    🔴🔴 **codex R1 ⑤⑥(2026-09-05)**:只存【四個具名角色的有效結果】守不到兩種漂移 ——
--       ①具名 grant 換成 **PUBLIC** grant, 有效權限不變 ⇒ 32 列**完全無 diff**
--       ②平台改 **owner / `supabase_storage_admin` / default ACL** ⇒ 四角色矩陣原封不動
--       ⇒ ✅ 本族改成**連 `relacl` 原文、owner、以及 `storage` 的 default ACL 一起記**。
--    ⚠️ 它答不出的:bucket 是不是公開、bucket 裡放了什麼 —— 那要 `storage` 的 `USAGE`,
--       而 `pcm_readonly` 沒有(實測 `has_schema_privilege` = f)。**本族只看授權形狀。**
SELECT 'STORAGEACL',
       n.nspname::text||'.'||c.relname::text||'|'||c.relkind::text,
       g.rol,
       (CASE WHEN pg_catalog.has_table_privilege(g.rol, c.oid, 'SELECT')   THEN 'S' ELSE '-' END)||
       (CASE WHEN pg_catalog.has_table_privilege(g.rol, c.oid, 'INSERT')   THEN 'I' ELSE '-' END)||
       (CASE WHEN pg_catalog.has_table_privilege(g.rol, c.oid, 'UPDATE')   THEN 'U' ELSE '-' END)||
       (CASE WHEN pg_catalog.has_table_privilege(g.rol, c.oid, 'DELETE')   THEN 'D' ELSE '-' END)||
       (CASE WHEN pg_catalog.has_table_privilege(g.rol, c.oid, 'TRUNCATE') THEN 'T' ELSE '-' END)||
       '|'||CASE WHEN c.relrowsecurity THEN 'RLS' ELSE '---' END||
       '|pol='||(SELECT count(*)::text FROM pg_catalog.pg_policy p WHERE p.polrelid = c.oid)||
       -- 🔴 codex R1 ⑤:PUBLIC 的授權在有效結果上與具名授權一樣 ⇒ 記 relacl 的雜湊才分得出來
       '|aclmd5='||pg_catalog.md5(COALESCE(c.relacl::text,''))||
       -- 🔴 codex R1 ⑥:owner 換人 ⇒ default ACL 那條路整個換掉, 而四角色矩陣不動
       '|own='||pg_catalog.pg_get_userbyid(c.relowner)
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN (VALUES ('anon'),('authenticated'),('service_role'),('payment_confirmer')) AS g(rol)
 WHERE n.nspname = 'storage' AND c.relkind IN ('r','p','v','m')
UNION ALL
-- 🔴🔴 第九族:`storage` 的 **default privileges**(codex R1 ⑥, 2026-09-05 加)——
--    實測 `pg_default_acl` 有 3 條(表 `r` / 函式 `f` / 序列 `S`), 表那條給 `anon=arwdDxtm`
--    ⇒ 📌 **由該 owner 在 `storage` 新建的表, 出生就自帶 anon 寫入權。**
--    ⇒ 只看現有表的族**永遠看不到它** —— 它決定的是【下一張表】。
SELECT 'DEFACL',
       COALESCE(n.nspname,'(全域)')::text||'|'||d.defaclobjtype::text,
       pg_catalog.pg_get_userbyid(d.defaclrole)::text,
       d.defaclacl::text
  FROM pg_catalog.pg_default_acl d
  LEFT JOIN pg_catalog.pg_namespace n ON n.oid = d.defaclnamespace
 WHERE n.nspname IN ('storage','public') OR n.nspname IS NULL
UNION ALL
-- 🔴🔴 第五族:RLS policy(2026-09-05 加)——
--    ⛔ 第一版**沒有這一欄** ⇒ `20260904270000` 要建的那 40 條 policy 在快照上【零顯形】,
--       而那時「diff 只有 8 格」看起來就像「policy 沒建成」。
--    🛑 而它與 `service_role` 有沒有 `BYPASSRLS` **無關** —— 是【這一欄不存在】, 不是被繞過。
--    📌 一份權限快照少了 policy 那一半, 在 RLS 開著的庫裡等於只看了一半的門。
SELECT 'POL',
       n.nspname::text||'.'||c.relname::text||'|'||p.polname::text,
       -- 🔵 roles 排序固定 —— 不排的話 catalog 的順序變動會讓每次都「有差」
       COALESCE((SELECT string_agg(r2.rolname::text, ',' ORDER BY r2.rolname)
                   FROM pg_catalog.pg_roles r2 WHERE r2.oid = ANY(p.polroles)), 'PUBLIC'),
       -- 🔴 2026-09-05 補【內容雜湊】—— 第一版只記名字/角色/cmd/permissive
       --    ⇒ 有人把 `USING (true)` 改成 `USING (false)`, 那一列【逐字相同】⇒ 快照看不到。
       --    🛑 用 md5 不用原文:`USING` 子句可能很長(本庫最長的那條含子查詢),
       --       原文會讓基線膨脹而且 diff 難讀;而**雜湊要的只是「變了沒」**。
       --    ⚠️ 代價要明寫:**diff 只會說「那條 policy 的內容變了」, 不會說變成什麼** ——
       --       要看變成什麼, 去查 `pg_get_expr` 或那支 migration。
       p.polcmd::text||'|'||CASE WHEN p.polpermissive THEN 'PERM' ELSE 'REST' END
       ||'|'||COALESCE(md5(pg_catalog.pg_get_expr(p.polqual, p.polrelid)), '-')
       ||'|'||COALESCE(md5(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid)), '-')
  FROM pg_catalog.pg_policy p
  JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
ORDER BY 1, 2, 3;
SQL
}

fetch() { # $1 = 輸出檔
  local sqlf out
  sqlf="$(mktemp)" || return 2
  snapshot_sql > "$sqlf"
  # 🔴 走 0905查證/run.sh 同一條路的做法:載 .env.local 取唯讀連線, **絕不印連線字串**。
  # 🔴 `.env.local` 只在【主樹】—— 施工窗的 worktree 沒有它(2026-09-05 實測:
  #    /Users/sean_1/pcm-website-v2 有 · /Users/sean_1/pcm-wt-db 無)。
  #    ⇒ 走主樹那份, 與 `~/pcm-mailbox/0905查證/run.sh` 同一條路(它也是寫死主樹)。
  #    🛑 而**載不到就 exit 2**, 不得往下跑 —— 「沒有查」與「查無」不是同一件事。
  ( cd "$ENVROOT" || exit 2
    set -a; . ./.env.local > /dev/null 2>&1; set +a
    [ -n "${PCM_READONLY_DATABASE_URL:-}" ] || { echo "🔴 沒載到 PCM_READONLY_DATABASE_URL ⇒ 沒有查, 不是查無" >&2; exit 2; }
    /opt/homebrew/bin/psql "$PCM_READONLY_DATABASE_URL" -f "$sqlf" 2>&1 )  > "$1"
  out=$?
  rm -f "$sqlf"
  # 🔴 空的 / 只有錯誤 ⇒ ENV-FAIL, **不得當成「沒差」**
  # 🔴🔴 2026-09-05 實測:第一版這道守門【沒抓到一個真的失敗】——
  #    psql 把錯誤印成 `psql:/tmp/xxx:28: ERROR: …`(**有前綴**)⇒ `grep -q '^ERROR'` 零命中
  #    ⇒ 它印「基線已重寫」而檔裡只有 7 列(其中 3 列還是 `\pset` 的回音)。
  #    🎯 **抓到它的不是這道守門, 是我在上面印了【列數】** —— 而 7 遠小於我算過的近千。
  #    📌 **一個把分母印出來的動作, 比一道抓錯 pattern 的守門有用。**
  # ✅ 三件一起:錯誤不綁行首 · 過濾 psql 的 meta 回音 · 列數下限當硬閘。
  sed -i '' -e '/^Pager usage/d' -e '/^Output format/d' -e '/^Field separator/d' "$1" 2>/dev/null || true
  if [ "$out" -ne 0 ] || [ ! -s "$1" ] || grep -qE 'ERROR:|FATAL:' "$1"; then
    echo "🔴 ENV-FAIL:取不到快照(rc=$out)⇒ 這【不是】「沒差」" >&2
    grep -E 'ERROR:|FATAL:' "$1" 2>/dev/null | head -3 >&2 || head -3 "$1" >&2
    return 2
  fi
  # 🔴 列數下限:算過 71 表/view + 169 函式, 各 × 4 角色 + 4 個角色列 ⇒ 近千。
  #    設 200 是【寬鬆的下界】—— 它擋的是「幾乎沒抓到東西而印成功」那一種, 不是精確比對。
  if [ "$(grep -c . "$1")" -lt 200 ]; then
    echo "🔴 快照只有 $(grep -c . "$1") 列 ⇒ 遠低於預期(表/view+函式 各 ×4 角色 ⇒ 數百列)" >&2
    echo "   ⇒ 這【不是】「權限很少」, 是那一發沒抓到東西。不寫基線。" >&2
    head -3 "$1" >&2
    return 2
  fi
  return 0
}

if [ "${1:-}" = "--selftest" ]; then
  ok=0
  # 🔴 selftest 不連 DB —— 它驗的是【比對邏輯會不會叫】, 不是正式庫的內容。
  t="$(mktemp -d)"; trap 'rm -rf "$t"' EXIT
  printf 'REL\tpublic.a|r\tanon\tS---|RLS\nFN\tpublic.f()\tanon\t-|DEF\n' > "$t/base"
  cp "$t/base" "$t/same"
  diff -q "$t/base" "$t/same" >/dev/null \
    && echo "  ✅ 相同 ⇒ 判為沒差" || { echo "  🔴 相同卻判有差"; ok=1; }
  # 🔴 正對照:改【一行】基線 ⇒ 必須紅(主視窗指定的那一格)
  sed 's/S---|RLS/SIUD|---/' "$t/base" > "$t/drift"
  if diff -q "$t/base" "$t/drift" >/dev/null; then
    echo "  🔴 突變沒套上 ⇒ 這一格作廢"; ok=1
  else
    diff "$t/base" "$t/drift" >/dev/null 2>&1 \
      && { echo "  🔴 改了一行卻判沒差"; ok=1; } \
      || echo "  ✅ 正對照:改一行基線 ⇒ 判為有差(它會叫)"
  fi
  # 🔴 改一條 policy 的【名字】⇒ 必須有差(主視窗 2026-09-05 指定)
  #    那是最容易被靜靜換掉的一格:policy 改名之後, 表層 GRANT 一格都沒動
  #    ⇒ 沒有 POL 那一族的話, 這種改動在快照上【完全不顯形】。
  printf 'POL\tpublic.a|a_select_service_role\tservice_role\tr|PERM\n' > "$t/pol"
  sed 's/a_select_service_role/a_select_renamed/' "$t/pol" > "$t/pol2"
  if diff -q "$t/pol" "$t/pol2" >/dev/null; then
    echo "  🔴 policy 改名的突變沒套上 ⇒ 這一格作廢"; ok=1
  else
    diff -q "$t/pol" "$t/pol2" >/dev/null 2>&1 \
      && { echo "  🔴 policy 改名卻判沒差"; ok=1; } \
      || echo "  ✅ 正對照:改一條 policy 名 ⇒ 判為有差"
  fi
  # 🔴 同一族第二格:polcmd / permissive 被改(名字沒變)⇒ 也要有差
  sed 's/r|PERM/r|REST/' "$t/pol" > "$t/pol3"
  diff -q "$t/pol" "$t/pol3" >/dev/null \
    && { echo "  🔴 PERMISSIVE→RESTRICTIVE 卻判沒差"; ok=1; } \
    || echo "  ✅ 正對照:PERMISSIVE 改成 RESTRICTIVE ⇒ 判為有差(名字沒變也抓得到)"

  # 🔴 `USING (true)` → `USING (false)`:名字/角色/cmd/permissive **一格都沒變**,
  #    只有內容雜湊變 ⇒ 這一格證明第五族的【內容那半】真的接上了。
  #    🔬 真值:md5('true') = b326b5062b2f0e69046810717534cb09(基線裡 22 條是這個)
  #            md5('false') = 68934a3e9455fa72420237eb05902327
  printf 'POL\tpublic.a|a_sel\tservice_role\tr|PERM|b326b5062b2f0e69046810717534cb09|-\n' > "$t/q1"
  sed 's/b326b5062b2f0e69046810717534cb09/68934a3e9455fa72420237eb05902327/' "$t/q1" > "$t/q2"
  if diff -q "$t/q1" "$t/q2" >/dev/null; then
    echo "  🔴 USING 內容突變沒套上 ⇒ 這一格作廢"; ok=1
  else
    echo "  ✅ 正對照:USING (true)→(false)(前三欄一格未動)⇒ 判為有差"
  fi
  # 🔵 負對照:同一條 policy 完全沒動 ⇒ 不得判有差(它不是對什麼都紅)
  cp "$t/q1" "$t/q3"
  diff -q "$t/q1" "$t/q3" >/dev/null \
    && echo "  🔵 負對照:同一條 policy 沒動 ⇒ 判沒差" \
    || { echo "  🔴 沒動卻判有差"; ok=1; }

  # 🔴 `ALTER FUNCTION … SET search_path` 這種手改:GRANT 一格都沒動、policy 一格都沒動
  #    ⇒ 前五族【完全不顯形】。這一格證明第六族真的接上了。
  printf 'FNCFG\tpublic.f()\tDEFINER\tsearch_path=""\n' > "$t/c1"
  sed 's/search_path=""/search_path=public, pg_temp/' "$t/c1" > "$t/c2"
  if diff -q "$t/c1" "$t/c2" >/dev/null; then
    echo "  🔴 search_path 突變沒套上 ⇒ 這一格作廢"; ok=1
  else
    echo "  ✅ 正對照:search_path 從空字串改成 public,pg_temp ⇒ 判為有差"
  fi
  # 🔴 第二格:DEFINER → INVOKER(search_path 沒變)⇒ 也要有差
  sed 's/DEFINER/INVOKER/' "$t/c1" > "$t/c3"
  diff -q "$t/c1" "$t/c3" >/dev/null \
    && { echo "  🔴 DEFINER→INVOKER 卻判沒差"; ok=1; } \
    || echo "  ✅ 正對照:DEFINER 改成 INVOKER(search_path 沒變)⇒ 判為有差"

  # 🔴 第七族:security_invoker 翻面要叫 —— 這一格證明 VIEWOPT 真的接上了。
  #    翻面的方向刻意選 true→(未設), 因為【(未設) 等於 false】而它看起來像「沒改」。
  printf 'VIEWOPT\tpublic.v|view\tsecurity_invoker=true\tpostgres\n' > "$t/v1"
  sed 's/security_invoker=true/security_invoker=(未設)/' "$t/v1" > "$t/v2"
  diff -q "$t/v1" "$t/v2" >/dev/null \
    && { echo "  🔴 security_invoker true→(未設) 卻判沒差"; ok=1; } \
    || echo "  ✅ 正對照:security_invoker true 翻成 (未設) ⇒ 判為有差"
  sed 's/security_invoker=true/security_invoker=false/' "$t/v1" > "$t/v3"
  diff -q "$t/v1" "$t/v3" >/dev/null \
    && { echo "  🔴 security_invoker true→false 卻判沒差"; ok=1; } \
    || echo "  ✅ 正對照:security_invoker true 翻成 false ⇒ 判為有差"

  # 🔵 負對照:只有【順序】不同而內容相同 ⇒ 也要判有差
  #    (那是刻意的:排序固定是本支的前提, 順序變了代表 SQL 的 ORDER BY 被動過)
  tac "$t/base" > "$t/reorder" 2>/dev/null || tail -r "$t/base" > "$t/reorder"
  diff -q "$t/base" "$t/reorder" >/dev/null \
    && { echo "  🔴 順序不同卻判沒差 ⇒ 排序前提壞了而它不會叫"; ok=1; } \
    || echo "  🔵 負對照:順序不同 ⇒ 也判有差(排序是本支的前提)"
  [ "$ok" = "0" ] && echo "全部通過。" || echo "🔴 有格沒過。"
  exit "$ok"
fi

NEW="$(mktemp)"; trap 'rm -f "$NEW"' EXIT
fetch "$NEW" || exit 2
LINES=$(grep -c . "$NEW")
# 🔴 分母要印出來 —— 一份「0 差異」的報告, 若它只有 3 列, 那個 0 沒有意義。
echo "  🔵 快照 $LINES 列 = 表/view×4角色 + 函式×4角色 + 角色 BYPASSRLS + RLS policy + 函式的 DEFINER/search_path + view 的 security_invoker"

if [ "${1:-}" = "--write" ]; then
  cp "$NEW" "$BASE"
  echo "  ✅ 基線已重寫:$BASE"
  echo "  🛑 **你剛剛宣告了「現在這個樣子是對的」** —— 那是一個決定。"
  echo "     commit body 要寫下你比對過什麼、為什麼那些差是被批准的。"
  exit 0
fi

if [ ! -f "$BASE" ]; then
  echo "🔴 沒有基線($BASE)⇒ 先跑一次 --write。**這不是「沒差」。**" >&2
  exit 2
fi

if diff -q "$BASE" "$NEW" >/dev/null 2>&1; then
  echo "  ✅ 與基線相同 —— ⚠️ 而它只證【兩次快照之間沒差】, 不證沒有人改過(改了又改回來看不到)"
  exit 0
fi
echo "🔴 權限矩陣與基線不同 —— 有人改過, 而 repo 裡沒有那一筆:"
DIFFTMP="$(mktemp)"
diff "$BASE" "$NEW" | grep -E '^[<>]' > "$DIFFTMP" || true
# 🔴 先印【每族幾格】再印明細 —— 舊版直接 head -40, 而那個 40 剛好與這次的期望值同數,
#    ⇒ 一個被截斷的清單長得跟一個剛好 40 筆的清單一模一樣(2026-09-05 實測:漏印 REL 那 8 格)。
echo "   逐族格數(< 基線只有 / > 現在才有):"
awk '{sub(/^[<>] /,"&"); tag=substr($0,1,1); sub(/^[<>] /,""); split($0,a,"\t"); print tag" "a[1]}' "$DIFFTMP" \
  | sort | uniq -c | sed 's/^/     /'
echo "   明細(全部 $(grep -c . "$DIFFTMP") 行, 不截斷):"
cat "$DIFFTMP"
rm -f "$DIFFTMP"
echo '   ⇒ 左側 < 是基線、右側 > 是現在。逐格看:是不是有人在 dashboard / SQL Editor 動了權限?'
echo "   ⇒ 確認那些改動【是被批准的】之後, 才跑 --write 重寫基線。"
exit 1
