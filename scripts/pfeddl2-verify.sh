#!/usr/bin/env bash
# ⟦b4-PFEDDL2⟧ 的驗證 harness —— 拋棄式 PG,零 apply、不碰正式庫。
#
# 🔴 **它證什麼**:那支 migration 在【空庫】上重放出來的形狀, 與 2026-09-02 Sean 跑的正本一致,
#    而且**每一道事後閘都真的擋得住它宣稱擋的那件事**(每一格配一發突變)。
# 🛑 **它證不到什麼**(而這一段比上面那段重要):
#    ① **它不證正式庫今天長這樣** —— 正本是 2026-09-02 那一刻的快照, 而本 harness 跑的是我們寫的檔。
#       ⇒ 兩者相同, 只證明【我抄對了】, 不證明【它之後沒被改】。
#    ② ⛔ ~~ACL 那一節【沒有正本】⇒ 第⑨格證的是「我寫的那組 GRANT 跑對了」不是「與正式庫相同」~~
#       ✅ **2026-09-02 20:0x 正本回來了** ⇒ 四節**全部有正本, 同一天同一個人跑的**。
#       🔴 **而它救了一格**:我猜的那組**漏了 `pcm_readonly` 的 SELECT`(兩張表都有)——
#         而漏的方向正是當時那個判準預測的:「收太緊 ⇒ 有人跑不動 ⇒ 它會叫」。
#         ⇒ 📌 **不是「我猜錯了」, 是【我選的方向讓錯誤可見, 而正本在它出聲之前就到了】。**
#       🛑 **而第①條照舊成立** —— 有正本只證明【我抄對了】, 不證明正式庫明天還是這樣。
#    ②b **2026-09-02 21:0x sequence 那一層的正本也回來了** ⇒ **五節全部有正本。**
#       🔴 **而它【又】救了一格**:我漏了 `service_role` 的 `UPDATE`(少了它 `setval()` 會被拒)。
#       🎯 **⇒ 兩次猜, 兩次漏的都是【該有而沒給】**(表那層漏 `pcm_readonly` · 這層漏 `UPDATE`)
#         ⇒ 📌 **那不是「我不夠仔細」, 是「憑推理列角色」這個方法有一個【固定的失效方向】**
#         ⇒ ⇒ **而那個方向正是我選的那一邊:錯了會有人跑不動而叫。**
#    ③ 本機是 PG 17;`NULLS NOT DISTINCT` 在 PG15 以下建不起來 ⇒ 那是環境不是碼。
set -uo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)"
MIG=supabase/migrations/20260902210000_m4b_pfeddl2_staging_and_sync_log.sql
D=$(mktemp -d); trap 'pg_ctl -D "$D/pg" -m immediate stop >/dev/null 2>&1; rm -rf "$D"' EXIT
PASS=0; FAIL=0; EXPECT_TOTAL=34
# 🔵 34 = 25 + 6(codex R2 抓的)+ 3(sequence 正本回來 + codex R3 抓的)
#    🔴 而上一版這一行寫「32 = 25 + 6」而常數是 32 ⇒ **算式與結果自相矛盾**(codex R3 nit 抓)
#    ⇒ 📌 一個沒有人會去驗算的註解, 在它旁邊那個數字被改過之後就變成假的 —— 而它讀起來仍然像來源。
# 🛑 舊註記留著:(codex R2 抓的:閘④⑧⑨ 三格沒有任何突變在打 + CREATE ROLE 那條分支零覆蓋)
#    🔴 R2 那條逐字:「刪壞 status CHECK、schema USAGE 或 sequence ACL 斷言後, 25/25 仍可能全綠」
#    ⇒ 📌 **一格沒有突變在打的閘, 與一格不存在的閘, 在總分上印同一個數字。**(ACL 正本回來之後補的:pcm_readonly ×2 / anon 反向 ×1 / 拿掉那行 GRANT 的突變 ×1)
#    🔴🔴 **而我又算錯了一次** —— 我寫 23、實跑 24(3 格 ACL 我數成 3, 而它是 2+1 再加突變那格)。
#    ⇒ 📌 **今晚第三次被同一道閘抓** —— 而這次我還逐字寫了「這次是先算再跑」。
#      🎯 **⇒ 「我這次有小心」不是一個量測。而那句話寫在錯的數字正上方。**
# 🔴 這個 18 是**跑過一遍數出來的**, 不是心算的 —— 我第一版寫 13 而實際 16,
#    而**那 16 格全是綠的** ⇒ 只看顏色的話這一發會被判成通過。
#    📌 是這道格數閘自己抓到的:一個沒被造出來的世界不會紅, **它什麼都不印**。

ck(){ # ck <名> <實得> <期待>
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); printf '  ✅ %s\n' "$1"
  else FAIL=$((FAIL+1)); printf '  🔴 %s ⇒ 期待「%s」實得「%s」\n' "$1" "$3" "$2"; fi
}

# ── 起一顆拋棄式 PG(動態埠 —— 寫死會與別窗撞)──────────────────────
export LC_ALL=C
PORT=""
for p in $(seq 54600 54680); do
  if ! (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then PORT=$p; break; fi
done
[ -n "$PORT" ] || { echo "🔴 ENV-FAIL:54600-54680 之間找不到空埠(這是環境, 不是碼)"; exit 2; }
initdb -D "$D/pg" -U postgres --no-sync >/dev/null 2>&1 || { echo "🔴 ENV-FAIL:initdb 失敗"; exit 2; }
pg_ctl -D "$D/pg" -o "-p $PORT -k $D -c listen_addresses=" -l "$D/log" -w start >/dev/null 2>&1 \
  || { echo "🔴 ENV-FAIL:pg_ctl 起不來"; sed -n '1,20p' "$D/log"; exit 2; }
PSQL=(psql -h "$D" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt)

seed(){ # 建一個乾淨的 schema 底座
  "${PSQL[@]}" -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;' >/dev/null 2>&1
  "${PSQL[@]}" -c "CREATE TABLE public.products(id uuid PRIMARY KEY);" >/dev/null 2>&1
  # 🔴 `DROP SCHEMA public CASCADE` 會把 schema 上的 USAGE 一起帶走 ⇒ 重建後沒有人進得來。
  #    正式庫上這幾個角色是有 USAGE 的 ⇒ 這一行是【把底座補成正式庫的樣子】, 不是放寬。
  #    ⚠️ 而它是 codex 那條「只驗 table SELECT 不驗 schema USAGE」補上閘⑧之後才顯形的
  #    ⇒ 📌 **一道新的閘第一次叫, 常常叫的是【我的量測底座】不是被量的東西 —— 而那也是它有判別力的證據。**
  "${PSQL[@]}" -c "GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, pcm_readonly;" >/dev/null 2>&1
}
"${PSQL[@]}" -c "DO \$\$BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
  -- 🔴 正本上 pcm_readonly 對這兩張表有 SELECT ⇒ 本 harness 必須有這個角色, 否則 migration 會照設計炸掉
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='pcm_readonly') THEN CREATE ROLE pcm_readonly; END IF;
END\$\$;" >/dev/null 2>&1

run(){ "${PSQL[@]}" -f "$1" > "$D/out" 2>&1; echo $?; }
has(){ grep -qF "$1" "$D/out" && echo yes || echo no; }

echo "── ① 正常世界:空庫重放 ⇒ 該綠 ──────────────────────────────"
seed; RC=$(run "$MIG")
ck "① rc=0" "$RC" "0"
ck "① 九格事後閘印出通過" "$(has '事後閘通過(九格, 每一格都比【定義字面】不是【存不存在】)')" "yes"

echo "── ② 正對照:那五條 CHECK 與唯一鍵【真的擋得住東西】 ───────────"
#    🔴 這一段量的是【行為】不是【定義在不在】—— 前者是後者唯一的第二把尺。
PID=$("${PSQL[@]}" -c "INSERT INTO public.products VALUES (gen_random_uuid()) RETURNING id;" 2>/dev/null)
bad(){ "${PSQL[@]}" -c "$1" >/dev/null 2>&1; [ $? -ne 0 ] && echo blocked || echo allowed; }
ck "② provenance:direct 而來源碼不同 ⇒ 擋" \
   "$(bad "INSERT INTO public.product_fitments_effective_staging(product_id,moto_brand,model_code,match_source,source_model_code,run_id) VALUES('$PID','BMW','A','direct','B',gen_random_uuid());")" "blocked"
ck "② year_state:只有 year_end 沒有 year_start ⇒ 擋" \
   "$(bad "INSERT INTO public.product_fitments_effective_staging(product_id,moto_brand,model_code,year_end,match_source,source_model_code,run_id) VALUES('$PID','BMW','A',2020,'direct','A',gen_random_uuid());")" "blocked"
ck "② nonblank:空白品牌 ⇒ 擋" \
   "$(bad "INSERT INTO public.product_fitments_effective_staging(product_id,moto_brand,model_code,match_source,source_model_code,run_id) VALUES('$PID','  ','A','direct','A',gen_random_uuid());")" "blocked"
# 🔴 這一發是 NULLS NOT DISTINCT 的正對照:兩列 year 全 NULL 而其餘相同。
#    🛑 **而它的 rc 必須自己成為一格**(codex 抓)—— 舊版把它丟掉了:
#    若 provenance 壞成「所有 direct 都拒絕」, 這一發會失敗、表裡沒有那一列,
#    ⇒ 下面那格「重複列被擋」照樣印 blocked(擋它的是 CHECK 不是唯一鍵)
#    ⇒ 📌 **一個沒有播種成功的世界, 與一個唯一鍵真的擋住重複的世界, 印同一個 blocked。**
ck "② 播種:一列合法的 direct 要【進得去】(它是下一格的前提)" \
   "$(bad "INSERT INTO public.product_fitments_effective_staging(product_id,moto_brand,model_code,match_source,source_model_code,run_id) VALUES('$PID','BMW','A','direct','A',gen_random_uuid());")" "allowed"
ck "② NULLS NOT DISTINCT:year 全 NULL 的重複列 ⇒ 擋(少了那個語法它會【放行】)" \
   "$(bad "INSERT INTO public.product_fitments_effective_staging(product_id,moto_brand,model_code,match_source,source_model_code,run_id) VALUES('$PID','BMW','A','direct','A',gen_random_uuid());")" "blocked"
ck "② 🔵 負對照:一列合法的 inherited ⇒ 放行(證明上面那些 blocked 不是恆擋)" \
   "$(bad "INSERT INTO public.product_fitments_effective_staging(product_id,moto_brand,model_code,match_source,source_model_code,run_id) VALUES('$PID','BMW','A','inherited','Z',gen_random_uuid());")" "allowed"

echo "── ②a ACL:對正本逐個角色量(不是量我寫了什麼, 是量跑完之後是什麼)──"
# 🔴 正本(2026-09-02 20:0x Sean 跑):service_role 七種 · pcm_readonly SELECT · anon/authenticated 零。
# 🔴 codex:`has_table_privilege` 量的是【有效權限】—— 它把角色繼承、PUBLIC、
#    甚至「其實沒有直接 GRANT」的情況都算成 true ⇒ **它答不出「ACL 上寫了什麼」**。
#    而本節要證的正好是後者(跟正本逐字比)⇒ 改成直接讀 `relacl`。
#    ⚠️ `aclexplode` 對 PUBLIC 給 grantee=0 而 `pg_roles` 沒有 0 ⇒ 必須 LEFT JOIN(已知坑)。
acl(){ "${PSQL[@]}" -c "SELECT coalesce(string_agg(pv,'+' ORDER BY pv),'(無)') FROM (
  SELECT a.privilege_type pv FROM pg_class c, aclexplode(c.relacl) a
  LEFT JOIN pg_roles r ON r.oid=a.grantee
  WHERE c.oid='public.$2'::regclass AND coalesce(r.rolname,'PUBLIC')='$1') q;" 2>/dev/null; }
# 🔴 期待值是 `t`/`f` **不是** `true`/`false` —— psql 帶 `-A -t` 時印的是單字母。
#    我第一版寫 true/false ⇒ 三格全紅, 而**紅是對的、錯的是我的期待值**(今天第四次踩)。
#    📌 差別不在 psql, 在**旗標**:預設格式印 `true`, `-A -t` 印 `t`。
ck "②a staging 的 ACL 上 pcm_readonly 恰好只有 SELECT(我第一版漏了這個角色)" \
   "$(acl pcm_readonly product_fitments_effective_staging)" "SELECT"
ck "②a sync_log 的 ACL 上 pcm_readonly 恰好只有 SELECT" \
   "$(acl pcm_readonly product_fitments_effective_sync_log)" "SELECT"
ck "②a 🔵 反向:anon 在 staging 的 ACL 上【一格都沒有】⇒ 證明上面不是恆真" \
   "$(acl anon product_fitments_effective_staging)" "(無)"
# 🔴 sequence 那一層【獨立再讀一次】—— 閘⑨ 在 migration 裡面比, 這裡在外面比。
#    ⇒ 📌 兩個讀數同源(同一顆庫), 而它們**經過的程式碼不同** ⇒ 我寫錯 v_want 時這一格會不一樣。
#    正本(2026-09-02 21:0x)service_role ⇒ SELECT/UPDATE/USAGE。我第一版漏了 UPDATE。
# 🔴 codex R3:第一版只讀 staging 那一支 ⇒ **sync_log 那支錯了而閘⑨ 也同步寫錯時, 這格照樣綠**
#    ⇒ 📌 一個叫「獨立檢查」而只覆蓋一半的格子, 對另一半是零判別力。⇒ 兩支各一格。
seqacl(){ "${PSQL[@]}" -c "SELECT coalesce(string_agg(pv,'+' ORDER BY pv),'(無)') FROM (
   SELECT a.privilege_type pv FROM pg_class c, aclexplode(c.relacl) a
   LEFT JOIN pg_roles r ON r.oid=a.grantee
   WHERE c.oid = pg_get_serial_sequence('public.$1','id')::regclass
     AND coalesce(r.rolname,'PUBLIC')='service_role') q;" 2>/dev/null; }
ck "②a staging 的 sequence 上 service_role 恰好三格(第一版漏了 UPDATE)" \
   "$(seqacl product_fitments_effective_staging)" "SELECT+UPDATE+USAGE"
ck "②a sync_log 的 sequence 上 service_role 恰好三格" \
   "$(seqacl product_fitments_effective_sync_log)" "SELECT+UPDATE+USAGE"

echo "── ②b NULL 短路面:那條 provenance CHECK 靠【誰】擋住 NULL ───────"
# 🔴 這一段是 `scripts/null-shortcircuit-check-guard.test.ts` 逼出來的, 而它問對了問題:
#    `(ms='direct' AND smc = mc) OR (ms='inherited' AND smc <> mc)`
#    ⇒ `=` 與 `<>` 對 NULL 都求值成 **NULL** ⇒ 兩個分支都 NULL ⇒ **整條 CHECK 求值成 NULL**
#    ⇒ 🛑 **而 PG 的 CHECK【求值成 NULL 就放行】** ⇒ 這條 CHECK 對 NULL 是**開的**。
# 🎯 **⇒ 所以擋住它的不是這條 CHECK, 是那三個欄位的 `NOT NULL`。**
#    ⇒ 📌 **承重的是 `NOT NULL`** —— 哪天有人把 `source_model_code` 改成可空,
#      **這條 CHECK 會對 NULL 靜靜放行, 而它看起來完全沒變。**
# ✅ 下面兩格是【兩個世界實跑】(方法照 `auth_callback_events_outcome_reason_pair` 那條的先例),
#    不是推的:同一條 CHECK, 一張表帶 NOT NULL、一張不帶。
"${PSQL[@]}" -c "CREATE TABLE t_real(ms text NOT NULL, mc text NOT NULL, smc text NOT NULL,
  CHECK ((ms='direct' AND smc = mc) OR (ms='inherited' AND smc <> mc)));
CREATE TABLE t_weak(ms text NOT NULL, mc text NOT NULL, smc text,
  CHECK ((ms='direct' AND smc = mc) OR (ms='inherited' AND smc <> mc)));" >/dev/null 2>&1
ck "②b 帶 NOT NULL ⇒ (direct, NULL) 被擋" \
   "$(bad "INSERT INTO t_real VALUES('direct','A',NULL);")" "blocked"
ck "②b 🔬 拿掉 NOT NULL ⇒ 同一條 CHECK 【放行】了 ⇒ 承重的是 NOT NULL 不是 CHECK" \
   "$(bad "INSERT INTO t_weak VALUES('direct','A',NULL);")" "allowed"

echo "── ③ forward-only:同一顆庫再跑一次 ⇒ 該紅而且要出聲 ─────────────"
RC=$(run "$MIG")
ck "③ rc<>0" "$([ "$RC" != "0" ] && echo yes || echo no)" "yes"
ck "③ 錯誤是【前置閘①】不是 already exists" "$(has '前置閘①')" "yes"

echo "── ④ 突變:每一道事後閘各一發(它擋不住 ⇒ 那一格是裝飾)─────────"
mut(){ # mut <名> <舊字面> <新字面> <期待命中的閘>
  seed
  python3 - "$MIG" "$D/m.sql" "$2" "$3" <<'PY'
import io,sys
src,dst,a,b=sys.argv[1:5]
s=io.open(src,encoding='utf-8').read()
assert s.count(a)==1, ('突變錨命中 %d 次, 應為 1' % s.count(a))
io.open(dst,'w',encoding='utf-8').write(s.replace(a,b))
PY
  if [ $? -ne 0 ]; then FAIL=$((FAIL+1)); printf '  🔴 %s ⇒ 突變錨沒命中(改了 0 個字, 而 harness 會全綠)\n' "$1"; return; fi
  run "$D/m.sql" > /dev/null
  ck "🧬 $1" "$(has "$4")" "yes"
}
mut "拿掉 NULLS NOT DISTINCT ⇒ 閘⑤(索引全文)要叫" "  NULLS NOT DISTINCT;" ";" "事後閘⑤"
mut "provenance 的 <> 改成 = ⇒ 閘③(constraintdef 全文)要叫" "AND source_model_code <> model_code)" "AND source_model_code = model_code)" "事後閘③"
mut "staging.run_id 改成可空 ⇒ 閘① 要叫" "  run_id            uuid    NOT NULL," "  run_id            uuid," "事後閘①"
mut "FK 拿掉 ⇒ 閘③(FK 也在那份全文裡)要叫" " REFERENCES public.products(id) ON DELETE CASCADE" "" "事後閘③"
mut "sync_log 不開 RLS ⇒ 閘⑥ 要叫" "ALTER TABLE public.product_fitments_effective_sync_log ENABLE ROW LEVEL SECURITY;" "" "事後閘⑥"
mut "順手補一條 policy ⇒ 閘⑥(policy 數也在那格)要叫" "-- ── 3.5 權限" "CREATE POLICY p_x ON public.product_fitments_effective_staging FOR SELECT USING (true);
-- ── 3.5 權限" "事後閘⑥"
mut "刪掉 year_state 那條 CHECK ⇒ 閘③ 要叫" "  CONSTRAINT pfes_year_state_valid    CHECK (year_start IS NOT NULL OR year_end IS NULL),
" "" "事後閘③"
mut "sync_log 少一欄(note)⇒ 閘② 要叫" "  note        text,
" "" "事後閘②"
mut "拿掉 pcm_readonly 那兩行 GRANT ⇒ 閘⑦(ACL 逐 grantee)要叫" "GRANT SELECT ON TABLE public.product_fitments_effective_staging TO pcm_readonly;
" "" "事後閘⑦"
# 🔴 codex R3:突變只測過「整行 GRANT 消失」⇒ 【可轉授】那條路沒有任何一發在打。
#    ⚠️ 而 owner 被換 / owner 三格被撤那兩種, 本 harness **造不出來**(它一律以 postgres 重放)
#    ⇒ 閘⑨a/⑨b 目前**沒有突變在打**, 照實寫在這裡, 不要當它們被驗過。
mut "sequence 的 GRANT 加上 WITH GRANT OPTION ⇒ 閘⑨ 要叫" "ON SEQUENCE %s TO service_role', v_seq);" "ON SEQUENCE %s TO service_role WITH GRANT OPTION', v_seq);" "事後閘⑨"
mut "把 SELECT 開給 anon ⇒ 閘⑦ 要叫" "GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.product_fitments_effective_staging TO service_role;" "GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.product_fitments_effective_staging TO service_role;
GRANT SELECT ON TABLE public.product_fitments_effective_staging TO anon;" "事後閘⑦"

mut "sync_log 的 status 值改掉 ⇒ 閘④ 要叫" "CHECK (status IN ('success', 'abort'))" "CHECK (status IN ('success', 'aborted'))" "事後閘④"
mut "拿掉 sequence 的 GRANT ⇒ 閘⑨ 要叫" "    EXECUTE format('GRANT USAGE, SELECT, UPDATE ON SEQUENCE %s TO service_role', v_seq);
" "" "事後閘⑨"

echo "── ⑤ 兩個【底座】世界:它們不是改檔, 是把環境弄成別的樣子 ─────"
# 🔴 codex R2:上面每一發突變都在改【檔】, 而閘⑧(schema USAGE)與那條 CREATE ROLE 分支
#    **不是檔裡的形狀** ⇒ 沒有任何一發突變碰得到它們。⇒ 這兩格改成造世界。
seed
"${PSQL[@]}" -c "REVOKE USAGE ON SCHEMA public FROM service_role, pcm_readonly;" >/dev/null 2>&1
run "$MIG" > /dev/null
ck "⑤ 底座抽掉 schema USAGE ⇒ 閘⑧ 要叫" "$(has '事後閘⑧')" "yes"
"${PSQL[@]}" -c "GRANT USAGE ON SCHEMA public TO service_role, pcm_readonly;" >/dev/null 2>&1

# 🔴 harness 一直預先建好 pcm_readonly ⇒ migration 裡「沒有就建一個」那條分支**一次都沒走過**。
#    ⇒ 📌 **一條從來沒被執行過的修法, 與一條寫錯的修法, 在 25/25 全綠上長得一樣。**
seed
# 🔴 `DROP ROLE` 在角色還持有任何權限時會失敗 —— 而它失敗時**這裡完全沒有訊號**:
#    角色還在 ⇒ migration 走「已存在」那條 ⇒ 不印 NOTICE ⇒ 我第一版就是這樣紅的,
#    而我差點去查 migration。⇒ 📌 **一個沒清乾淨的底座, 看起來像被測的東西壞了。**
"${PSQL[@]}" -c "DROP OWNED BY pcm_readonly;" >/dev/null 2>&1
"${PSQL[@]}" -c "DROP ROLE IF EXISTS pcm_readonly;" >/dev/null 2>&1
ck "⑤ 前置:角色真的被清掉了(清不掉的話下面兩格量的是別的世界)" \
   "$("${PSQL[@]}" -c "SELECT count(*) FROM pg_roles WHERE rolname='pcm_readonly';" 2>/dev/null)" "0"
RC=$(run "$MIG")
ck "⑤ 角色不存在 ⇒ migration 自己建它 ⇒ 仍然該綠(replay-from-zero 走的就是這條)" "$RC" "0"
ck "⑤ 而它有出聲(不是安靜地略過那兩條 GRANT)" "$(has 'pcm_readonly 不存在')" "yes"

echo "──────────────────────────────────────────────────────────────"
TOTAL=$((PASS+FAIL))
if [ "$TOTAL" != "$EXPECT_TOTAL" ]; then
  # 🔴 這一格擋的是【格子自己消失】—— 一個沒跑到的世界不會紅, 它什麼都不印。
  echo "🔴 格數不符:跑了 $TOTAL 格, 應為 $EXPECT_TOTAL ⇒ 有世界沒被造出來(而它不會紅)"
  exit 1
fi
[ "$FAIL" = 0 ] && { echo "✅ $PASS/$EXPECT_TOTAL 全過"; exit 0; }
echo "🔴 $FAIL 格紅(共 $EXPECT_TOTAL)"; exit 1
