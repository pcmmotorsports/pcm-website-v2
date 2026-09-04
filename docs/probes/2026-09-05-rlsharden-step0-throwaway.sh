#!/bin/bash
# ci-self-contained: no — ⛔ ~~yes~~ **2026-09-05 CI 實測改的**:它【確實】自己 initdb、不碰正式庫,
#   而 **runner 上 `pg_ctl` 起不來**(`c624bc557` 那發 CI:「pg_ctl 起不來, 看 …/pg.log」⇒ exit 1)。
#   🔴 **所以 `no` 在這裡不是「它不自給自足」, 是「CI 這台跑不動它」** —— 兩件事, 而這個標記只有一格。
#   ⇒ 📌 它的價值是**手動跑**(本機三輪 × 四發全綠、四發突變各自紅), 不是 CI 跑。
#   ⚠️ 代價要寫出來:**沒有任何 CI 會再跑它** ⇒ 它壞掉時零訊號, 只有下一個手動跑的人會發現。
# ⟦b9-RLSHARDEN⟧ 第 0 步的探針 —— **那四條 policy 真的讓寫入過得去嗎?**
#
# 🟢 **拋棄式 Postgres,完全不碰正式庫。** 起叢集 → 建三張表 → 建一個【沒有 BYPASSRLS】的
#    假 service_role → 套 migration 的那四條 policy → 用它寫一筆。
# 🎯 **為什麼要假的 service_role**:正式庫那個帶 `BYPASSRLS`
#    ⇒ 📌 **拿它來驗永遠會過, 而那個綠與「policy 有沒有用」無關。**
#    ⇒ 這支探針的全部價值,就在那個角色【沒有】BYPASSRLS。
#
# 🔴 **三格,而第二格才是重點**:
#    ① 沒有 policy      ⇒ 期望 **失敗(42501)**   ← 🔵 負對照:證明 RLS 真的在擋
#    ② 套上 policy      ⇒ 期望 **成功**          ← ✅ 這就是要證的
#    ③ 再把 policy 拿掉 ⇒ 期望 **又失敗**        ← 🟢 證明②的成功【是那條 policy 給的】,
#                                                  不是别的東西順手放行
#    🛑 少了 ③, 「policy 生效」與「這張表其實沒開 RLS」**印同一個成功**。
#
# 用法:bash docs/probes/2026-09-05-rlsharden-step0-throwaway.sh
#
# ⛔ **它答不出什麼**:
#    · 正式庫那三張表的**真實欄位與既有 policy** —— 本探針用的是【最小重建】,
#      欄位是我寫的, 不是抄來的 ⇒ **它驗的是「這種 policy 形狀有沒有用」, 不是「正式庫貼了會怎樣」。**
#    · 欄級 GRANT 那一層(`staff` 的 UPDATE 是欄級的)—— 本探針給表級, 不模擬欄級。
set -u
WIN="${1:-step0}"
PORT=$(( 54000 + RANDOM % 900 )); D="/tmp/pgthrow-rls-$WIN"
if [ -d "$D" ]; then echo "🛑 $D 已存在 ⇒ 停, 不動別人的東西"; exit 1; fi
if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then echo "🛑 埠 $PORT 被佔 ⇒ 停"; exit 1; fi
mkdir -p "$D"
# 🔴🔴 **[2026-09-05 折 R2 時自己撞到的第三個形狀]**:上面那些 `exit 1` 的早退路徑
#    **不會收攤** ⇒ 目錄留著 ⇒ **下一發啟動時撞「$D 已存在 ⇒ 停」而【停在一個與真正問題無關的訊息上】**。
#    🎯 我就是這樣把一發「突變有沒有被抓到」讀成了「目錄已存在」。
#    ✅ 用 trap:不論從哪一行離開, 叢集與目錄都收乾淨。
cleanup() { LC_ALL=C pg_ctl -D "$D/data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$D"; }
trap cleanup EXIT
initdb -U postgres -A trust --encoding=UTF8 --locale=C "$D/data" > "$D/initdb.log" 2>&1 || { echo "initdb 失敗"; exit 1; }
LC_ALL=C pg_ctl -D "$D/data" -o "-p $PORT -c listen_addresses=127.0.0.1" -l "$D/pg.log" start >/dev/null 2>&1 \
  || { echo "pg_ctl 起不來, 看 $D/pg.log"; exit 1; }
P() { psql -h 127.0.0.1 -p "$PORT" -U postgres -tA -v ON_ERROR_STOP=1 "$@"; }

P -q <<'SQL'
CREATE ROLE service_role NOLOGIN;   -- 🔴 刻意【不給】BYPASSRLS
CREATE TABLE public.admin_audit_log(id bigserial primary key, note text);
CREATE TABLE public.admin_sso_login_events(id bigserial primary key, note text);
CREATE TABLE public.staff(id bigserial primary key, label text, is_manager bool, is_active bool);
ALTER TABLE public.admin_audit_log        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_sso_login_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff                  ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.admin_audit_log, public.admin_sso_login_events, public.staff TO service_role;
GRANT UPDATE (label, is_manager, is_active) ON public.staff TO service_role;   -- 照正式庫:欄級
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
-- 🔴 **staff 要有 SELECT policy, 而這是 codex R1 must-fix ③ 逼出來的**:
--    RLS 之下 UPDATE 先要「看得到那一列」。沒有 SELECT policy ⇒ 看不到任何列
--    ⇒ UPDATE 影響 0 列而**回傳成功** ⇒ 📌 拿掉 staff_update_service_role 之後
--      第二格仍然 rc=0, 卻印「四發寫入都過」。⇒ 那一格原本【零判別力】。
CREATE POLICY staff_select_service_role ON public.staff
  FOR SELECT TO service_role USING (true);
SQL

# 🔴🔴 **`try()` 改寫 —— codex R1 抓到兩個【它會把假的成功印成成功】的洞**
#   ① must-fix `:49` 原版**只列印、不斷言** ⇒ 三格全錯也會跑到最後 exit 0
#      ⇒ 📌 而它已經標 `ci-self-contained: yes`(CI 會跑)⇒ **一支永遠不會紅的 CI 檢查。**
#   ② must-fix `:51` 原版把四句塞進一個 `psql -c` ⇒ **第一句 42501 就停**
#      ⇒ ①③ 只證明了 `admin_audit_log` 被擋, **另外三條 policy 一個都沒被測到。**
#   ✅ 修法:**逐句各跑一發**(四個獨立的 psql), 每一發各自比對期望, 不合就記一筆並讓 rc 非 0。
FAILED=0
one() { # $1=期望 pass|deny  $2=標籤  $3=SQL
  local out rc got
  out=$(P -c "SET ROLE service_role; $3" 2>&1); rc=$?
  if [ $rc -eq 0 ]; then got=pass; else
    case "$out" in *"row-level security"*|*42501*) got=deny;; *) got="其他錯";; esac
  fi
  if [ "$got" = "$1" ]; then printf '   ✅ %-34s 期望=%-4s 實際=%s\n' "$2" "$1" "$got"
  else printf '   🔴 %-34s 期望=%-4s 實際=%s  %s\n' "$2" "$1" "$got" "$(printf '%s' "$out" | head -1 | cut -c1-70)"
       FAILED=$((FAILED+1)); fi
}
try() { # $1=這一輪四發的期望(pass|deny)
  # 🔴🔴 **R2 must-fix `:74`:原版第①輪 staff 是空的、第②輪又把唯一的 `a` 改成 `b`**
  #    ⇒ 📌 第①③輪的 UPDATE **不論 policy 在不在都是改 0 列** ⇒ 那兩格【零判別力】。
  #    ✅ 每一輪開始前用 **postgres**(繞過 RLS)種一列 `label='a'`, 讓 UPDATE 永遠有東西可改。
  P -q -c "DELETE FROM public.staff; INSERT INTO public.staff(label,is_manager,is_active) VALUES ('a',false,true);"
  one "$1" "INSERT admin_audit_log"        "INSERT INTO public.admin_audit_log(note) VALUES ('x');"
  one "$1" "INSERT admin_sso_login_events" "INSERT INTO public.admin_sso_login_events(note) VALUES ('x');"
  one "$1" "INSERT staff"                  "INSERT INTO public.staff(label,is_manager,is_active) VALUES ('a',false,true);"
  # 🔴 UPDATE 那一發要**驗它真的改到列**, 不是「沒報錯」——
  #    RLS 之下「看不到列」也會回成功而影響 0 列(codex must-fix ③ 就是這個)。
  #    ⇒ 用 RETURNING + 要求恰好 1 列, 讓「改到 0 列」與「改到 1 列」印不同的東西。
  local out rc
  out=$(P -c "SET ROLE service_role; UPDATE public.staff SET label='b' WHERE label='a' RETURNING id;" 2>&1); rc=$?
  # 🔴🔴 **[2026-09-05 折 R2 時自己抓到的]**:原版 pass 那一支用 `grep -c .` 數列數,
  #    而 `psql -c "SET ROLE …; UPDATE …"` 的輸出**第一行是 `SET`** ⇒ 📌 **即使改到 0 列也會數到 1**
  #    ⇒ **pass 那一格【永遠不可能失敗】。** 實錘:把 migration 的 `USING (true)` 突變成 `(false)`
  #    ⇒ 它照樣印「改到 2 列」而全綠;而同一個突變在最小重現裡是 `UPDATE 0`。
  #    ✅ 兩支都改用 `grep -c '^[0-9]'`(只數 RETURNING 回來的 id 行)—— deny 那支本來就是對的,
  #      🎯 **而「兩支用不同的數法」正是它能活下來的原因:對的那半掩護了錯的那半。**
  local rows; rows=$(printf '%s' "$out" | grep -c '^[0-9]')
  if [ "$1" = pass ]; then
    if [ $rc -eq 0 ] && [ "$rows" -ge 1 ]; then printf '   ✅ %-34s 期望=pass 實際=改到 %s 列\n' "UPDATE staff" "$rows"
    else printf '   🔴 %-34s 期望=pass 實際=rc=%s 改到 %s 列(0 列也算失敗)\n' "UPDATE staff" "$rc" "$rows"; FAILED=$((FAILED+1)); fi
  else
    if [ $rc -ne 0 ] || [ "$rows" -eq 0 ]; then printf '   ✅ %-34s 期望=deny 實際=沒改到任何列\n' "UPDATE staff"
    else printf '   🔴 %-34s 期望=deny 實際=竟然改到了列\n' "UPDATE staff"; FAILED=$((FAILED+1)); fi
  fi
}

echo "--- ① 還沒有 policy(期望:四發全被擋)---"; try deny

echo "--- ② 套上本次 migration 的那四條 policy(期望:成功)---"
# 🔴🔴 **R2 must-fix `:92`:原版把四條 `CREATE POLICY` 【手抄一份】在這裡。**
#    ⇒ 📌 正式那支 migration 改成 `WITH CHECK (false)` 時, 探針裡的複本還是 `true`
#      ⇒ **探針全綠, 而它測的是我的手抄, 不是審查對象。**
#    ✅ 改成【從那支 migration 檔本身抽出來跑】—— 兩邊不可能再漂。
MIG="$(cd "$(dirname "$0")/../.." && pwd)/supabase/migrations/20260905090000_m4b_service_role_policies_before_rlsharden.sql"
if [ ! -f "$MIG" ]; then echo "🛑 找不到 migration:$MIG"; exit 1; fi
# 只取四條 CREATE POLICY(到分號為止), 不取 BEGIN/DO/COMMIT —— 那幾段要真的 schema 才跑得動
awk '/^CREATE POLICY/{c=1} c{print} /;[[:space:]]*$/{c=0}' "$MIG" > "$D/policies.sql"
NPOL=$(grep -c '^CREATE POLICY' "$D/policies.sql")
# 🟢 正對照:抽到 0 條而還往下跑, 會讓②變成「沒有 policy 也過」⇒ 那是假綠
if [ "$NPOL" -ne 4 ]; then echo "🛑 從 migration 只抽到 $NPOL 條 CREATE POLICY(期望 4)⇒ 抽取壞了, 停"; exit 1; fi
echo "   (從 $(basename "$MIG") 抽出 $NPOL 條, 不是手抄)"
P -q -f "$D/policies.sql"
try pass

echo "--- ③ 再把 policy 拿掉(期望:又失敗 ⇒ 證明②是那條 policy 給的)---"
P -q -c "DROP POLICY staff_update_service_role ON public.staff;
         DROP POLICY staff_insert_service_role ON public.staff;
         DROP POLICY admin_sso_login_events_insert_service_role ON public.admin_sso_login_events;
         DROP POLICY admin_audit_log_insert_service_role ON public.admin_audit_log;"
try deny

echo "--- 🧹 收攤 ---"
# 🔴 **R2 must-fix `:111`:原版收攤那三格【只印紅字、不計入 FAILED】**
#    ⇒ 停不掉 / 有殘留程序 / 目錄刪不掉, 最後照樣 exit 0 ⇒ 📌 一格永遠不會叫的清潔檢查。
LC_ALL=C pg_ctl -D "$D/data" stop -m fast >/dev/null 2>&1
SRC=$?; if [ $SRC -eq 0 ]; then echo "✅ pg_ctl stop rc=0"; else echo "🔴 pg_ctl stop rc=$SRC"; FAILED=$((FAILED+1)); fi
if pgrep -f "pgthrow-rls-$WIN" >/dev/null 2>&1; then echo "🔴 還有殘留程序"; FAILED=$((FAILED+1)); else echo "✅ 無殘留程序"; fi
rm -rf "$D"
if [ -d "$D" ]; then echo "🔴 目錄還在"; FAILED=$((FAILED+1)); else echo "✅ 目錄已刪並驗"; fi

# 🔴 **rc 要由結果決定** —— 這是 codex must-fix ① 的核心:
#    一支「印紅字而 exit 0」的檢查, 在 CI 裡與「全過」是同一個東西。
if [ "$FAILED" -ne 0 ]; then echo "🔴 有 $FAILED 格與期望不符 ⇒ rc=1"; exit 1; fi
echo "✅ 三輪 × 四發全部符合期望"; exit 0
