#!/bin/bash
# ci-self-contained: yes — 自己 initdb 起拋棄式叢集、跑完自己收攤, 不碰正式庫。
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
SQL

# 🔴 每一發都印【它在成立與不成立兩個世界會不同的東西】= SQLSTATE, 不是「成功/失敗」四個字
try() { # $1=標籤
  local out rc
  out=$(P -c "SET ROLE service_role;
              INSERT INTO public.admin_audit_log(note) VALUES ('x');
              INSERT INTO public.admin_sso_login_events(note) VALUES ('x');
              INSERT INTO public.staff(label,is_manager,is_active) VALUES ('a',false,true);
              UPDATE public.staff SET label='b' WHERE label='a';" 2>&1); rc=$?
  if [ $rc -eq 0 ]; then printf '%-22s rc=0  ✅ 四發寫入都過\n' "$1"
  else printf '%-22s rc=%s 🔴 %s\n' "$1" "$rc" "$(printf '%s' "$out" | grep -oE '42501|SQLSTATE[^ ]*|錯誤:.*|ERROR:.*' | head -1)"; fi
}

echo "--- ① 還沒有 policy(期望:失敗 42501)---"; try "沒有 policy"

echo "--- ② 套上本次 migration 的那四條 policy(期望:成功)---"
P -q <<'SQL'
CREATE POLICY admin_audit_log_insert_service_role ON public.admin_audit_log
  FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY admin_sso_login_events_insert_service_role ON public.admin_sso_login_events
  FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY staff_insert_service_role ON public.staff
  FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY staff_update_service_role ON public.staff
  FOR UPDATE TO service_role USING (true) WITH CHECK (true);
SQL
try "有 policy"

echo "--- ③ 再把 policy 拿掉(期望:又失敗 ⇒ 證明②是那條 policy 給的)---"
P -q -c "DROP POLICY staff_update_service_role ON public.staff;
         DROP POLICY staff_insert_service_role ON public.staff;
         DROP POLICY admin_sso_login_events_insert_service_role ON public.admin_sso_login_events;
         DROP POLICY admin_audit_log_insert_service_role ON public.admin_audit_log;"
try "policy 拿掉之後"

echo "--- 🧹 收攤 ---"
LC_ALL=C pg_ctl -D "$D/data" stop -m fast >/dev/null 2>&1; echo "pg_ctl stop rc=$?"
pgrep -f "pgthrow-rls-$WIN" >/dev/null 2>&1 && echo "🛑 還有殘留程序" || echo "✅ 無殘留程序"
rm -rf "$D"; [ -d "$D" ] && echo "🛑 目錄還在" || echo "✅ 目錄已刪並驗"
