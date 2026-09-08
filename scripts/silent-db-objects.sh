#!/usr/bin/env bash
# ============================================================
# silent-db-objects.sh — 找出【不需要被碼提到就會生效】的 DB 物件
# ============================================================
# 用法
#   bash scripts/silent-db-objects.sh <版本號|路徑> [...]   # 指定要看哪幾支
#   bash scripts/silent-db-objects.sh --ledger-pending      # 拿帳本差集當清單(⚠️ 見下)
#   bash scripts/silent-db-objects.sh --selftest
# 退出碼  0=沒有靜默物件  1=有(要人讀)  2=量具失效
#
# ── 為什麼有這一支(2026-09-08 實錘, 不是設想)────────────────────────────
# 那天要判「一批還沒貼的 migration 擋不擋得住顧客站上線」, 用的尺是
# **「顧客站的碼有沒有提到那個物件名」** ⇒ 掃全樹回 **0** ⇒ 差點結論成「都不是障礙」。
# 🛑 **而 trigger 從來不會被碼提到** —— 它掛在表上, 那張表被寫入時它自己會跑。
#    `policy` 同理:沒有人「呼叫」一條 policy, 它在每一次查詢上自己生效。
# ⇒ 📌 **那個 0 對這兩類【零判別力】** —— 它不是「掃過而乾淨」, 是「這把尺看不到它們」。
# 🔬 當天實例:`20260901021000` 與 `20260901030000` 各建
#    `trg_coupon_redeem_on_paid ON public.orders AFTER UPDATE OF payment_status`
#    ⇒ 那是**客人付款那一刻**, 而兩支的物件名在顧客站碼裡命中 0。
#
# ── 它答什麼 / 不答什麼 ────────────────────────────────────────────────
# ✅ 答:這幾支裡有哪些 trigger / policy、掛在哪張表、那張表在顧客站碼裡出現幾次
# ⛔ **不答**「所以會不會出事」—— 方向要人判:
#      · 沒貼 ⇒ 那個行為【今天不存在】(少一個行為, 不是壞一個行為)
#      · 貼了 ⇒ 它會在那張表被寫時自己跑
#    🔴 **而真正會咬人的是第三種**:應用層【因為預期 trigger 會接手】而拿掉了自己那半
#      ⇒ 那要讀那條線的碼, **本支答不出來, 也不要假裝答得出來**。
# ⛔ 不答相依:兩支建**同一個 trigger 名**時誰先誰後有差 —— 本支只印出來, 不排序。
#
# ⚠️ 天花板
#   · 只認**行首(允許縮排)**的 `CREATE [OR REPLACE] TRIGGER` / `CREATE POLICY`
#     ⇒ 包在 `EXECUTE '…'` / `EXECUTE format(…)` / `$polbody$…$polbody$` 裡的**抓不到**。
#     ⛔ ~~2026-09-08 未量有幾支~~ ⇒ ✅ **量了**(分母 `supabase/migrations/*.sql` = 394 支):
#       行首那把尺命中 **52** 支 · 任意位置那把寬尺命中 **57** 支 ⇒ **差 5 支**
#       ⚪ 兩把尺同法問一個合成關鍵字 ⇒ 各回 0 ⇒ 都不是恆真
#       🔬 那 5 支逐支開檔:**至少 3 支是真的 DDL**(不是註解)——
#         `20260810160000:221` `EXECUTE 'CREATE TRIGGER order_payments_immutable_bu …'`
#         `20260901170000:196` `EXECUTE $polbody$CREATE POLICY product_fitments_effective_select_public`
#         `20260904270000:345` `EXECUTE format('CREATE POLICY %I ON public.%I …')` ← 🔴 **名字是動態的**
#       其餘命中是註解或 `RAISE EXCEPTION` 的訊息字面。
#     ⇒ 🔴 **動態名字那一支本支【永遠】解不出來** —— 那不是實作沒寫好, 是那個名字執行期才存在。
#     ⇒ ✅ **所以本支改成【出聲】而不是【假裝掃過】**:同一支檔裡同時看到 `EXECUTE` 與
#       `CREATE TRIGGER/POLICY` ⇒ 印一行「這支檔裡可能還有我看不到的」。**它不擋, 它只是不安靜。**
#   · `--ledger-pending` 用 `supabase/APPLIED.tsv` 的差集, 而**帳本的 0 什麼都不代表**
#     (`APPLIED.tsv` 檔頭逐字)⇒ 那個清單是【下界】, 不是 pending 的真值
#   · 顧客站分母寫死 `apps/storefront`;`apps/admin` 不在裡面(刻意 —— 本支問的是顧客動線)
#   · 🔴 **那個「顧客站提到那張表的檔數」是【粗訊號】, 不是證據**:它用**裸表名**做全文比對
#     ⇒ `orders` 這種常見字會大量誤中(2026-09-08 實測回 **237** 支檔, 而其中絕大多數只是
#     變數名 / 型別名 / 路由字串裡剛好有那個字)。
#     ⇒ 📌 **它只回答「值不值得你去看」, 不回答「顧客站真的讀那張表」。**
#     ⚪ 對照:同一發 `orders_deleted_log` 回 **0** ⇒ 那個 0 才有意義(獨特名字, 沒人提)。
#     ⇒ ✅ 讀法:**大數字 = 去看;0 = 大概真的沒關係, 而仍要看它掛的是哪張表。**
# ============================================================
set -uo pipefail
export LC_ALL=C
cd "$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "🔴 找不到 repo 根 ⇒ fail-closed" >&2; exit 2; }

STOREFRONT=apps/storefront
TRG_RE='^[[:space:]]*CREATE[[:space:]]+(OR[[:space:]]+REPLACE[[:space:]]+)?TRIGGER[[:space:]]+([A-Za-z0-9_]+)'
POL_RE='^[[:space:]]*CREATE[[:space:]]+POLICY[[:space:]]+([A-Za-z0-9_]+)'

resolve() { # 版本號 → 路徑;路徑原樣回
  case "$1" in
    */*) printf '%s\n' "$1" ;;
    *)   ls "supabase/migrations/$1"_*.sql 2>/dev/null | head -1 ;;
  esac
}

# $1=檔 → 印 `種類<TAB>物件名<TAB>掛在哪`
# 🔴 用 python 不用 awk:`match($0, re, arr)` 的第三參數是 **gawk 專屬**,
#    而這台的 awk 沒有它 ⇒ 第一版整支【安靜地抽不到任何東西】, 而 rc=0
#    ⇒ 📌 那與「這幾支裡真的沒有 trigger」印一模一樣。抓到它的是 selftest 第 ① 格。
_EXTRACT_PY='
import sys, re
src = open(sys.argv[1], encoding="utf-8", errors="replace").read().split("\n")
TRG = re.compile(r"^\s*CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+([A-Za-z0-9_]+)", re.I)
POL = re.compile(r"^\s*CREATE\s+POLICY\s+([A-Za-z0-9_]+)", re.I)
ON  = re.compile(r"\bON\s+([A-Za-z0-9_.]+)", re.I)
for i, ln in enumerate(src):
    m = TRG.match(ln)
    if m:
        on = "(找不到 ON)"
        for nx in src[i:i+4]:
            o = ON.search(nx)
            if o: on = o.group(1); break
        print("TRIGGER\t%s\t%s" % (m.group(1), on)); continue
    m = POL.match(ln)
    if m:
        on = "(找不到 ON)"
        for nx in src[i:i+3]:
            o = ON.search(nx)
            if o: on = o.group(1); break
        print("POLICY\t%s\t%s" % (m.group(1), on))
'
extract() { python3 -c "$_EXTRACT_PY" "$1" 2>/dev/null || printf '@@EXTRACT_FAIL@@\n'; }

report() { # $@ = 檔案清單
  local f kind name on bare hits n=0
  for f in "$@"; do
    [ -f "$f" ] || { echo "🔴 讀不到 $f ⇒ fail-closed(這不是「它沒有靜默物件」)" >&2; return 2; }
    while IFS=$'\t' read -r kind name on; do
      [ -n "$kind" ] || continue
      case "$kind" in *@@EXTRACT_FAIL@@*) echo "🔴 抽取器掛了 ⇒ fail-closed(這不是「沒有靜默物件」)" >&2; return 2 ;; esac
      n=$((n+1))
      bare="${on##*.}"
      hits=$(grep -rl -- "$bare" "$STOREFRONT" 2>/dev/null | wc -l | tr -d ' ')
      printf '🔵 %-7s %-34s 掛在 %-28s | 顧客站提到那張表的檔數 %s\n' "$kind" "$name" "$on" "$hits"
      printf '     來源 %s\n' "$(basename "$f")"
    done <<< "$(extract "$f")"
  done
  # 🔴 盲區出聲:同一支檔裡同時有 EXECUTE 與 CREATE TRIGGER/POLICY ⇒ 本支可能看不到全部
  local blind=0
  for f in "$@"; do
    grep -qE 'EXECUTE' "$f" 2>/dev/null || continue
    grep -qE 'CREATE[[:space:]]+(OR[[:space:]]+REPLACE[[:space:]]+)?(TRIGGER|POLICY)[[:space:]]' "$f" 2>/dev/null || continue
    grep -qE '^[[:space:]]*CREATE[[:space:]]+(OR[[:space:]]+REPLACE[[:space:]]+)?(TRIGGER|POLICY)[[:space:]]' "$f" 2>/dev/null && continue
    blind=$((blind+1))
    printf '⚠️  %s:有 EXECUTE 也有 CREATE TRIGGER/POLICY 的字樣, 而【行首一個都沒有】\n' "$(basename "$f")"
    printf '     ⇒ 那幾個很可能包在 EXECUTE 字串裡, 本支看不到 —— 請自己開檔。\n'
    printf '     🔴 而名字若是 format(…%%I…) 組出來的, 本支【永遠】解不出來(執行期才存在)。\n'
  done
  [ "$blind" -gt 0 ] && [ "$n" -eq 0 ] && {
    echo "🔴 本支在這幾支裡沒抓到行首的 trigger/policy, 而上面那幾支【有盲區警告】"
    echo "   ⇒ 這個「零」不是「掃過而乾淨」。"
    return 1
  }
  [ "$n" -gt 0 ] && {
    echo
    echo "🛑 上面每一個都【不需要被碼提到就會生效】⇒ 「顧客站碼裡命中 0」對它們零判別力。"
    echo "   方向要你自己判:沒貼 ⇒ 那個行為今天不存在;貼了 ⇒ 它會自己跑。"
    echo "   🔴 而最會咬人的第三種(應用層因為預期它接手而拿掉自己那半)本支答不出來。"
    return 1
  }
  echo "🔵 這幾支裡沒有行首的 CREATE TRIGGER / CREATE POLICY。"
  echo "   ⚠️ 而那【不等於沒有】—— 包在 DO/EXECUTE 或縮排在 IF 內的本支抓不到(檔頭天花板)。"
  return 0
}

case "${1:-}" in
  --selftest)
    T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT; P=0; F=0
    ok(){ P=$((P+1)); printf '  ok   %s\n' "$1"; }; bad(){ F=$((F+1)); printf '  FAIL %s\n' "$1"; }
    cat > "$T/a.sql" <<'X'
CREATE TRIGGER trg_zz_probe
  AFTER UPDATE OF payment_status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.zz();
X
    cat > "$T/b.sql" <<'X'
CREATE OR REPLACE FUNCTION public.zz() RETURNS trigger AS $$ BEGIN RETURN NEW; END $$ LANGUAGE plpgsql;
X
    cat > "$T/c.sql" <<'X'
CREATE POLICY zz_pol ON public.orders FOR SELECT TO anon USING (true);
X
    out="$(report "$T/a.sql" 2>&1)"; rc=$?
    [ "$rc" = 1 ] && printf '%s' "$out" | grep -q 'public.orders' && ok "①有 trigger ⇒ rc=1 且印出它掛的表" || bad "①沒抓到 trigger(rc=$rc)"
    out="$(report "$T/b.sql" 2>&1)"; rc=$?
    [ "$rc" = 0 ] && ok "②只有函式、沒有 trigger ⇒ rc=0(證明①不是無條件紅)" || bad "②誤報(rc=$rc)"
    out="$(report "$T/c.sql" 2>&1)"; rc=$?
    [ "$rc" = 1 ] && printf '%s' "$out" | grep -q 'POLICY' && ok "③policy 也抓得到" || bad "③policy 沒抓到(rc=$rc)"
    out="$(report "$T/nope.sql" 2>&1)"; rc=$?
    [ "$rc" = 2 ] && ok "④檔讀不到 ⇒ rc=2(量具失效, 不是「乾淨」)" || bad "④讀不到的檔回 rc=$rc, 期望 2"
    cat > "$T/d.sql" <<'X'
DO $$ BEGIN
  EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO service_role USING (true)', 'p1', 't1');
END $$;
X
    out="$(report "$T/d.sql" 2>&1)"; rc=$?
    [ "$rc" = 1 ] && printf '%s' "$out" | grep -q '盲區\|看不到' \
      && ok "⑥藏在 EXECUTE 裡的 DDL ⇒ 抓不到而【出聲】, 那個零不當成乾淨" \
      || bad "⑥盲區沒出聲(rc=$rc)⇒ 它會把「看不到」印成「沒有」"
    printf '%s' "$(report "$T/a.sql" 2>&1)" | grep -q '零判別力' \
      && ok "⑤紅的時候把【為什麼那個 0 不算數】印出來" || bad "⑤紅字沒說明"
    echo "── selftest:PASS=$P FAIL=$F ──"; [ "$F" -eq 0 ] || exit 1; exit 0 ;;
  --ledger-pending)
    echo "⚠️ 清單來自 supabase/APPLIED.tsv 的差集 —— 而【帳本的 0 什麼都不代表】(它檔頭自己寫的)"
    echo "   ⇒ 這個清單是【下界】。要真 pending 請自己給版本號。"
    FILES=()
    while IFS= read -r m; do
      v="$(basename "$m" | cut -d_ -f1)"
      grep -q "^$v" supabase/APPLIED.tsv 2>/dev/null || FILES+=("$m")
    done <<< "$(ls supabase/migrations/*.sql 2>/dev/null)"
    [ "${#FILES[@]}" -gt 0 ] || { echo "🔴 差集是空的 ⇒ fail-closed(分母不該是空的)" >&2; exit 2; }
    report "${FILES[@]}"; exit $? ;;
  '') echo "用法:bash scripts/silent-db-objects.sh <版本號|路徑> […] | --ledger-pending | --selftest" >&2; exit 2 ;;
esac

FILES=()
for a in "$@"; do
  r="$(resolve "$a")"
  [ -n "$r" ] || { echo "🔴 找不到 $a 對應的 migration ⇒ fail-closed" >&2; exit 2; }
  FILES+=("$r")
done
report "${FILES[@]}"
