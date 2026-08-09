#!/bin/bash
# ============================================================
# W7d-3 verify:`20260809020000` **五**條結構錨的判別力(A3 已刪,理由見 migration 內)
#
# 用法:scripts/w7d3-verify.sh   (自建拋棄式 cluster、跑完自動 teardown)
# 真權威:docs/specs/2026-08-08-e10-b2-w7d1-…-plan.md §6「W7d-3」+ B-215-A ②-②
#
# 🔴 **前綴重放**:PREFIX_TS = 被測物自己。只重放 TS <= 被測物 的前綴,被測物是尖端。
#
# 🔴 **本檔證的是「錨紅得起來」,不是「錨寫上去了」**。
#    存在性斷言(grep 得到 `strpos`)對「還在但失效」全盲 ——
#    所以每條錨配一個**只紅它那一條**的突變,而且突變是**改壞值、保留結構**,不是整段拿掉。
#
# 🔴 突變體從 `pg_get_functiondef` 的**當下**輸出生成,不是從檔案抄字面 ——
#    避免 `a8a2` 那種「縮排寫死在錨裡、被後續改動推移就全失效」的坑。
#
# 🔴 **A2 的負測要刻意繞開 A1**:A1 先檢查 `FOR NO KEY UPDATE` 是否存在,
#    若 A2 的突變直接把 NKU 換成 FOR UPDATE,會先被 A1 攔下 ⇒ A2 變成「被嚴格蘊含、
#    永遠構造不出只紅它的負測」= 疑似 no-op(memory
#    `feedback_unconstructible-negative-test-means-noop-guard`)。
#    ⇒ A2 的突變改成「保留 NKU,另外**多加**一處 FOR UPDATE」,那也是更真實的回歸情境。
#
# 🔴 格數全綠證的是「寫下的守門**在本檔測到的那些情境下**有判別力」——
#    證不了「該有的守門都想到了」,也證不了守門擋得住**有意規避**。
#    具體地說:LATER-REPLAY 今天 LATER=0、判別力尚未被行使;
#    五條文字錨對 inert-copy 只擋到剝註解那一層(見 HELPER-MD5-PIN 段的說明)。
# ============================================================
set -u
export LC_ALL=C LANG=C
REPO="$(cd "$(dirname "$0")/.." && pwd)"
D="${W7D3DB:-/tmp/w7d3db}"; SOCK="${W7D3SOCK:-/tmp/w7d3sk}"; P="${W7D3PORT:-54428}"
PASS=0; FAIL=0; KEYS=""
EXPECT_TOTAL=23   # 🔴 實跑量出來的(codex R2 後 21→23:+HELPER-MD5-PIN +TMUT-MD5-CATCHES)。全綠 PASS = 23 + 2 = 25。
ok()  { PASS=$((PASS+1)); KEYS="$KEYS $1"; printf '  PASS %-30s %s\n' "$1" "$2"; }
bad() { FAIL=$((FAIL+1)); KEYS="$KEYS $1"; printf '  FAIL %-30s %s\n' "$1" "$2"; }

# 🔴 路徑閘四道(W7 跟片掃掠的標準形狀,見 w7d1-verify.sh:35-45 的完整理由)
case "$D"    in /tmp/?*|/private/tmp/?*) : ;; *) echo "REFUSE: datadir 必須在 /tmp 或 /private/tmp 底下(現為 [$D])"; exit 1 ;; esac
case "$SOCK" in /tmp/?*|/private/tmp/?*) : ;; *) echo "REFUSE: socket 目錄必須在 /tmp 或 /private/tmp 底下(現為 [$SOCK])"; exit 1 ;; esac
case "$D"    in *..*) echo "REFUSE: W7D3DB 不得含 .. (現為 [$D])"; exit 1 ;; esac
case "$SOCK" in *..*) echo "REFUSE: W7D3SOCK 不得含 .. (現為 [$SOCK])"; exit 1 ;; esac
case "$D$SOCK" in *[!A-Za-z0-9/._-]*) echo "REFUSE: 路徑只允許 A-Za-z0-9/._- (pgrep -f 會把其餘字元當 regex ⇒ 殘留那道靜默失效)"; exit 1 ;; esac

teardown() {
  pg_ctl -D "$D" -w stop >/dev/null 2>&1
  LEFTOVER="$(pgrep -f "postgres.*$D" 2>/dev/null | wc -l | tr -d ' ')"
  if [ -f "$D/postmaster.pid" ] || [ "$LEFTOVER" != "0" ]; then
    echo "🔴 TEARDOWN_WARN:postmaster 沒停乾淨(殘留程序 $LEFTOVER 支)⇒ **保留 datadir 與 socket 目錄供診斷**:$D / $SOCK"
    return
  fi
  rm -rf "$D" "$SOCK"
  if [ -e "$D" ] || [ -e "$SOCK" ]; then
    echo "🔴 TEARDOWN_WARN:rm 之後仍看得到 資料目錄=$([ -e "$D" ] && echo 殘留 || echo 0) / socket 目錄=$([ -e "$SOCK" ] && echo 殘留 || echo 0)"
    return
  fi
  echo "  teardown:postmaster 已停、殘留程序 0、datadir 與 socket 目錄已收(-e 實測)"
}
trap teardown EXIT

rm -rf "$D" "$SOCK"; mkdir -p "$SOCK"
initdb -D "$D" -U postgres --no-sync -A trust -E UTF8 --locale=C >/dev/null 2>"$SOCK/initdb.err" \
  || { echo INITDB_FAIL; cat "$SOCK/initdb.err" 2>/dev/null; exit 1; }
pg_ctl -D "$D" -o "-p $P -k $SOCK -c listen_addresses=" -l "$D/log" -w start >/dev/null 2>&1 \
  || { echo START_FAIL; cat "$D/log" 2>/dev/null; exit 1; }
die() { echo "$1"; exit 1; }

Q()  { psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA -c "$1" 2>&1 | tr -d '\n'; }
QRAW() { psql -X -h "$SOCK" -p $P -U postgres -d postgres -qtA -c "$1" 2>&1; }
FN="public.pcm_a4a_recompute_order_item_summary(uuid)"

PREFIX_TS="20260809020000"
W7D3MIG="${W7D3MIG:-$REPO/supabase/migrations/20260809020000_m4b_e10_b2_w7d3_recompute_structural_anchors.sql}"
[ -f "$W7D3MIG" ] || die "W7D3_MIG_MISSING: $W7D3MIG"

cd "$REPO" || die "CD_FAIL"
psql -X -h "$SOCK" -p $P -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f scripts/d1-supabase-shim.sql >/dev/null || die "SHIM_FAIL"
FIRST_FITMENTS="$(grep -l 'product_fitments_effective' supabase/migrations/*.sql | sort | head -1)"
for f in supabase/migrations/*.sql; do
  case "$f" in *20260723120000*) continue ;; esac
  case "$(basename "$f")" in [0-9]*) : ;; *) die "MIG_NAME_NOT_TS: $f" ;; esac
  TS="${f##*/}"; TS="${TS%%_*}"
  [ "$TS" \> "$PREFIX_TS" ] && continue          # 前綴外的片不套
  [ "$TS" = "$PREFIX_TS" ] && continue            # 被測物留到 DDL-SYNTAX 才套
  if [ "$f" = "$FIRST_FITMENTS" ]; then
    psql -X -h "$SOCK" -p $P -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f scripts/d1-fitments-bootstrap.sql >/dev/null || die "FITBOOT_FAIL"
  fi
  psql -X -h "$SOCK" -p $P -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null 2>"$D/err" || die "MIG_FAIL: $f :: $(cat "$D/err")"
done
[ "$(Q "SELECT (pg_catalog.to_regprocedure('$FN') IS NOT NULL)::text")" = "true" ] \
  || die "UPSTREAM_MISSING: helper 不存在,錨會打空"

# ── 基準定義快照(突變還原用;md5 供 RESTORE-CLEAN 比對)────────────────────
psql -X -h "$SOCK" -p $P -U postgres -qtA \
  -c "SELECT pg_catalog.pg_get_functiondef('$FN'::regprocedure)" > "$SOCK/base-def.sql" 2>/dev/null
[ -s "$SOCK/base-def.sql" ] || die "BASEDEF_EMPTY"
BASE_MD5="$(Q "SELECT md5(pg_catalog.pg_get_functiondef('$FN'::regprocedure))")"

restore_base() {
  psql -X -h "$SOCK" -p $P -U postgres -v ON_ERROR_STOP=1 -q -f "$SOCK/base-def.sql" >/dev/null 2>&1 \
    || { echo "🔴 RESTORE_FAIL"; return 1; }
}

# 產突變體:$1 = 突變代號 → 寫 $SOCK/mutant.sql;不同構就 exit(不自行變通)
gen_mutant() {
  python3 - "$1" "$SOCK/base-def.sql" "$SOCK/mutant.sql" <<'PYEOF'
import sys
n, src_p, out_p = sys.argv[1], sys.argv[2], sys.argv[3]
src = open(src_p).read()

def sub(anchor, repl, s=None):
    s = src if s is None else s
    if s.count(anchor) != 1:
        sys.exit("anchor 非唯一(%d):%s" % (s.count(anchor), anchor[:70]))
    return s.replace(anchor, repl)

if n == 'a1missing':
    # A1-a:整個拿掉 parent 鎖(FOR NO KEY UPDATE 不見)
    out = sub('\n   FOR NO KEY UPDATE;', ';')
elif n == 'a1order':
    # A1-b:🔴 兩個字面**都還在**,只是順序反了 —— 專打順序比較那道,不打存在性那道。
    #      把 parent 鎖那句整段搬到 upsert 之後(語意當然壞掉,但本格只驗文字錨)。
    LOCK = """  SELECT oi.quantity INTO v_qty
    FROM public.order_items oi
   WHERE oi.id = p_order_item_id
   FOR NO KEY UPDATE;
"""
    if src.count(LOCK) != 1:
        sys.exit("a1order:鎖區塊字面非唯一(%d)" % src.count(LOCK))
    body = src.replace(LOCK, "  v_qty := 1;  -- MUTANT:鎖被搬走\n")
    body = sub('        shipped_quantity   = EXCLUDED.shipped_quantity;',
               '        shipped_quantity   = EXCLUDED.shipped_quantity;\n' + LOCK, body)
    out = body
elif n == 'a1cmtcopy':
    # 🔴 R1 M1 反例 A:**不動任何真鎖**,只在 upsert 之前插一行含 NKU 字面的**註解**。
    #    首版的 `strpos(v_def,'FOR NO KEY UPDATE')` 會指到這行註解 ⇒ 順序比較失去意義。
    #    修法後應紅在「出現次數必須恰 1」那道。
    out = sub('  -- 惰性建列 + 冪等 upsert',
              '  -- 上面那句用的是 FOR NO KEY UPDATE(MUTANT:註解裡抄一份字面)\n'
              '  -- 惰性建列 + 冪等 upsert')
elif n == 'a1otherlock':
    # 🔴 R1 M1 反例 B:函式開頭**多鎖一張別的表**(也用 NKU),真正的 parent 鎖搬到 upsert 之後。
    #    首版六條錨會**全綠而鎖序不變式已破** —— 這格就是那個繞法的回歸證。
    LOCK = """  SELECT oi.quantity INTO v_qty
    FROM public.order_items oi
   WHERE oi.id = p_order_item_id
   FOR NO KEY UPDATE;
"""
    if src.count(LOCK) != 1:
        sys.exit("a1otherlock:鎖區塊字面非唯一(%d)" % src.count(LOCK))
    body = src.replace(LOCK,
        "  PERFORM 1 FROM public.orders WHERE id = p_order_item_id FOR NO KEY UPDATE;  -- MUTANT:先鎖別張表\n"
        "  v_qty := 1;\n")
    body = sub('        shipped_quantity   = EXCLUDED.shipped_quantity;',
               '        shipped_quantity   = EXCLUDED.shipped_quantity;\n' + LOCK, body)
    out = body
elif n == 'a1inertblock':
    # 🔴 codex 關卡2 MF2 的回歸證:**把真鎖整段搬進 /* */ 註解**、函式直接進 upsert。
    #    這招同時騙過區塊錨(命中註解那份)與「NKU 恰一次」(只剩註解那份)⇒ 修法前 A1 全綠而函式無鎖。
    #    修法=錨之前先剝註解 ⇒ 剝完區塊錨命中 0 ⇒ 紅在「找不到鎖 order_items 的那一整句」。
    LOCK = """  SELECT oi.quantity INTO v_qty
    FROM public.order_items oi
   WHERE oi.id = p_order_item_id
   FOR NO KEY UPDATE;
"""
    if src.count(LOCK) != 1:
        sys.exit("a1inertblock:鎖區塊字面非唯一(%d)" % src.count(LOCK))
    out = src.replace(LOCK, "  /*\n" + LOCK + "  */\n  v_qty := 1;\n")
elif n == 'a1strconst':
    # 🔴 codex 關卡2 第二輪的攻擊:把完整鎖字面塞進**字串常數**(dollar-quoted),真鎖拿掉。
    #    剝註解救不了 —— 正規式不是 SQL lexer,認不出那是字串。
    #    ⇒ 五條錨會**全綠**(區塊命中字串裡那份、NKU 恰一次、位置在 upsert 前),
    #      本格證的就是「錨在這裡沒轍」以及「md5 那道接得住」。
    LOCK = """  SELECT oi.quantity INTO v_qty
    FROM public.order_items oi
   WHERE oi.id = p_order_item_id
   FOR NO KEY UPDATE;
"""
    if src.count(LOCK) != 1:
        sys.exit("a1strconst:鎖區塊字面非唯一(%d)" % src.count(LOCK))
    out = src.replace(LOCK,
        "  PERFORM 1 WHERE $inert$" + LOCK + "$inert$ IS NOT NULL;  -- MUTANT:字面塞進字串常數\n"
        "  v_qty := 1;\n")
elif n == 'a2forupdate':
    # A2:🔴 **保留 NKU**、另外多加一處 FOR UPDATE(繞開 A1 的存在性檢查,否則 A2 永遠測不到)
    out = sub('  -- 三軸真相直讀',
              '  PERFORM 1 FROM public.orders WHERE id = p_order_item_id FOR UPDATE;  -- MUTANT\n'
              '  -- 三軸真相直讀')
elif n == 'a4deleted':
    out = sub("\n     AND s.deleted_at IS NULL          -- Q3=A:作廢即退量", '')
elif n == 'a4shipped':
    # 🔴 不能只把最後一行刪掉:前一行結尾是 `-- …` 註解,分號會落進註解裡、語句永遠不結束
    #    ⇒ 突變體 syntax error、這一格變成「測不到」而不是「測過了」(首版真的中了)。
    #    ⇒ 整段兩行一起換,保留 deleted_at(讓 A4 的前半仍綠),只拔 shipped_at。
    out = sub("     AND s.deleted_at IS NULL          -- Q3=A:作廢即退量\n"
              "     AND s.shipped_at IS NOT NULL;     -- 未寄出的草稿箱不算",
              "     AND s.deleted_at IS NULL;         -- MUTANT:shipped_at 述詞被拔掉")
elif n == 'a5receipts':
    out = sub('FROM public.order_item_procurement_receipts r',
              'FROM public.order_item_procurement_receipts AS r')
elif n == 'a5cumcol':
    # A5-b:改吃累計欄 received_quantity(真實回歸情境)
    out = sub('COALESCE(sum(r.quantity), 0) INTO v_instock',
              'COALESCE(sum(p2.received_quantity), 0) INTO v_instock')
elif n == 'a6upsert':
    # 🔴 不可以用「改成具名 constraint 形」當突變:那個名字含 order_item_quantity_summary,
    #    會讓表名出現第二次、先撞 A1 的「表名恰一次」那道 ⇒ 本格就測不到 A6 了(實跑撞到過)。
    #    改用等價但字面不同的括號寫法,只動 A6 要守的那個字面。
    out = sub('ON CONFLICT (order_item_id) DO UPDATE',
              'ON CONFLICT ((order_item_id)) DO UPDATE')
else:
    sys.exit("未知突變代號:%s" % n)

open(out_p, 'w').write(out)
PYEOF
}

# 套突變 → 重跑 migration → 期望紅在指定字串;然後還原並確認基準復位
mut_cell() {  # $1=格名 $2=突變代號 $3=期望錯誤片段 $4=說明
  gen_mutant "$2" || { bad "$1" "突變產生失敗(錨不同構)"; return; }
  if ! psql -X -h "$SOCK" -p $P -U postgres -v ON_ERROR_STOP=1 -q -f "$SOCK/mutant.sql" >/dev/null 2>"$SOCK/mut.err"; then
    bad "$1" "突變體本身建不起來:$(head -1 "$SOCK/mut.err")"; restore_base; return
  fi
  MUTMD5="$(Q "SELECT md5(pg_catalog.pg_get_functiondef('$FN'::regprocedure))")"
  if [ "$MUTMD5" = "$BASE_MD5" ]; then
    bad "$1" "突變沒改到東西(md5 未變)= 這一格零判別力"; restore_base; return
  fi
  OUT="$(psql -X -h "$SOCK" -p $P -U postgres -v ON_ERROR_STOP=1 -qtA -f "$W7D3MIG" 2>&1)"
  case "$OUT" in
    *"$3"*) restore_base && [ "$(Q "SELECT md5(pg_catalog.pg_get_functiondef('$FN'::regprocedure))")" = "$BASE_MD5" ] \
              && ok "$1" "$4" || bad "$1" "紅對了但還原沒復位" ;;
    *) bad "$1" "沒紅在預期的錨上。實得:$(printf '%s' "$OUT" | tr '\n' ' ' | cut -c1-160)"; restore_base ;;
  esac
}

# 套突變 → 重跑 migration → 期望**通過**(正向對照:證某類改動確實影響不了錨)
pass_cell() {  # $1=格名 $2=突變代號 $3=說明
  gen_mutant "$2" || { bad "$1" "突變產生失敗(錨不同構)"; return; }
  if ! psql -X -h "$SOCK" -p $P -U postgres -v ON_ERROR_STOP=1 -q -f "$SOCK/mutant.sql" >/dev/null 2>"$SOCK/mut.err"; then
    bad "$1" "突變體本身建不起來:$(head -1 "$SOCK/mut.err")"; restore_base; return
  fi
  if [ "$(Q "SELECT md5(pg_catalog.pg_get_functiondef('$FN'::regprocedure))")" = "$BASE_MD5" ]; then
    bad "$1" "突變沒改到東西(md5 未變)= 這一格零判別力"; restore_base; return
  fi
  OUT="$(psql -X -h "$SOCK" -p $P -U postgres -v ON_ERROR_STOP=1 -qtA -f "$W7D3MIG" 2>&1)"
  case "$OUT" in
    *"五條結構錨全過"*) restore_base && ok "$1" "$3" || bad "$1" "通過了但還原沒復位" ;;
    *) bad "$1" "本該通過卻紅了:$(printf '%s' "$OUT" | tr '\n' ' ' | cut -c1-160)"; restore_base ;;
  esac
}

echo "══ 0. 被測物本體 ═══════════════════════════════════════════"
OUT="$(psql -X -h "$SOCK" -p $P -U postgres -v ON_ERROR_STOP=1 -qtA -f "$W7D3MIG" 2>&1)"
case "$OUT" in
  *ERROR*|*FATAL*) bad DDL-SYNTAX "migration 套不上:$(printf '%s' "$OUT" | tr '\n' ' ' | cut -c1-200)" ;;
  *) ok DDL-SYNTAX "migration 實檔在真 PG 上實跑成功(前綴重放到 $PREFIX_TS)" ;;
esac
case "$OUT" in
  *"五條結構錨全過"*) ok BASE-NOTICE "基準綠:五條錨全過的 NOTICE 有印出來(不是靜默通過)" ;;
  *) bad BASE-NOTICE "沒看到五條錨全過的 NOTICE ⇒ DO block 可能沒跑到底" ;;
esac

echo "══ 1. 逐錨突變(每個突變只該紅它自己那一條)══════════════════"
mut_cell TMUT-A1-MISSING a1missing '找不到「鎖 order_items 的那一整句」' \
  "拿掉 parent 鎖 ⇒ A1 紅(區塊錨那半)"
mut_cell TMUT-A1-ORDER   a1order   '錨 A1:鎖序反了' \
  "🔴 兩個字面都留著、只把鎖搬到 upsert 之後 ⇒ A1 紅在**順序比較**那半(存在性那半照樣綠)"
pass_cell PCTL-A1-CMTINERT a1cmtcopy \
  "🔴 正向對照(R1 M1 反例 A 的下場):在註解裡抄一份 NKU 字面 ⇒ 剝註解後**根本不存在**、五條錨照樣全過。這格證的是註解內容對錨完全無效力 —— 與 TMUT-A1-INERTBLOCK 成對:註解**幫不了忙**(本格),也**藏不住東西**(那格)"
mut_cell TMUT-A1-OTHERLOCK a1otherlock '出現 2 次(必須恰 1)' \
  "🔴 R1 M1 反例 B 的回歸證:**先鎖別張表**、真 parent 鎖搬到 upsert 之後 ⇒ 次數那道紅。首版此例六條錨全綠而不變式已破"
mut_cell TMUT-A1-INERTBLOCK a1inertblock '找不到「鎖 order_items 的那一整句」' \
  "🔴 codex MF2 回歸證:**真鎖整段搬進 /* */ 註解**、函式無鎖 ⇒ 剝註解後區塊錨命中 0 而紅。修法前此例 A1 全綠"
mut_cell TMUT-A2-FORUPDATE a2forupdate '錨 A2:helper 出現 FOR UPDATE' \
  "🔴 保留 NKU、另加一處 FOR UPDATE(刻意繞開 A1)⇒ A2 紅 = A2 不是被 A1 嚴格蘊含的死格"
mut_cell TMUT-A4-DELETED a4deleted '作廢的箱子仍被算成出貨量' \
  "拔掉 s.deleted_at IS NULL ⇒ A4 紅(推翻 08-05 Q3=A)"
mut_cell TMUT-A4-SHIPPED a4shipped '未寄出的草稿箱被算成出貨量' \
  "拔掉 s.shipped_at IS NOT NULL ⇒ A4 紅"
mut_cell TMUT-A5-RECEIPTS a5receipts '錨 A5:instock 不再走 receipts 直讀' \
  "receipts 直讀的字面被換掉 ⇒ A5 紅"
mut_cell TMUT-A5-CUMCOL  a5cumcol  '錨 A5:helper 出現 received_quantity' \
  "instock 改吃累計欄 ⇒ A5 紅(該欄有 bug 摘要就跟著錯,正是原設計要避開的)"
mut_cell TMUT-A6-UPSERT  a6upsert  '錨 A6:oiqs 寫入的字面不再是 ON CONFLICT (order_item_id) DO UPDATE' \
  "upsert 改成具名 constraint 形 ⇒ A6 紅"

echo "== 1b. 未來片的持續守門(codex MF1 / R2 M1)=================="
# assert-only migration **只在自己 apply 那一次跑** ⇒ 未來 CREATE OR REPLACE helper 的片
# (TS > PREFIX)不會重新觸發它 ⇒ 對「最可能發生的那條路徑」,migration 本身零守門。
# 真正接住那條路的是本格:把**前綴外**的片也套上去,然後**再驗一次錨**。
# 而 w7-coverage 的釘值閘會在任何新 migration 落檔時逼本檔重跑 ⇒ 形成持續守門。
LATER=0; LATER_OK=1
for f in supabase/migrations/*.sql; do
  TS="${f##*/}"; TS="${TS%%_*}"
  [ "$TS" \> "$PREFIX_TS" ] || continue
  LATER=$((LATER+1))
  psql -X -h "$SOCK" -p $P -U postgres -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null 2>"$D/err" \
    || { bad LATER-REPLAY "前綴外的片套不上:$f :: $(head -1 "$D/err")"; LATER_OK=0; break; }
done
if [ "$LATER_OK" = "1" ]; then
  OUT="$(psql -X -h "$SOCK" -p $P -U postgres -v ON_ERROR_STOP=1 -qtA -f "$W7D3MIG" 2>&1)"
  case "$OUT" in
    *"五條結構錨全過"*)
      ok LATER-REPLAY "套上前綴外的 $LATER 支之後,五條錨**再驗一次**仍全過 ⇒ 未來片改壞 helper 時本格會紅。誠實界:今天 LATER=$LATER,判別力要等真有後續片才被行使" ;;
    *) bad LATER-REPLAY "套完後續片再驗,錨紅了:$(printf '%s' "$OUT" | tr '\n' ' ' | cut -c1-160)" ;;
  esac
fi

# ── 🔴 文字騙不過的那一道:helper 本體 md5 釘值 ────────────────────────────
# codex 關卡2 第二輪打穿了「剝註解」:`PERFORM E'完整鎖字面'`、dollar-quoted 字串、
# 巢狀 /* /* */ */ 都能把字面塞回 v_def 而真碼已改壞;字串常數裡的 -- 還會被誤剝。
# 🔴 **正規式不是 SQL lexer,這條路補不完** —— 我停在這裡,不再往正規式上疊(軍備競賽)。
# 改成分工:**md5 說「有東西動了」,錨說「哪條契約破了」**。md5 對任何文字花招免疫。
# 代價=helper 合法改動時本格會紅,那正是要的:逼一個人回來看,而不是靜默通過。
# 🔴 釘值 4ac2989a… 與 `b2s2b-verify.sh:274` 的 `MD5_HELPER_4AXIS` **是同一個值**
#    (兩支獨立 harness 各自量到同一個 md5 = 交叉驗證,不是互抄)。
HELPER_MD5_PIN="4ac2989a58985beae91a491a816086f7"
HELPER_MD5_NOW="$(Q "SELECT md5(pg_catalog.pg_get_functiondef('$FN'::regprocedure))")"
[ "$HELPER_MD5_NOW" = "$HELPER_MD5_PIN" ] \
  && ok HELPER-MD5-PIN "helper 本體 md5 = 釘值 ⇒ 任何改動(含錨繞得過的 inert-copy)都會紅在這裡" \
  || bad HELPER-MD5-PIN "helper md5 漂了:實得 [$HELPER_MD5_NOW] 釘值 [$HELPER_MD5_PIN]。helper 若是合法改動,重釘本行**並**回頭確認五條錨仍成立"

# 🔴 成對示範:同一個突變讓**五條錨全綠**、卻被 md5 抓到。這格證的是分工真的成立,
#    不是我嘴上說說。它同時是「錨的天花板」的可執行文件。
gen_mutant a1strconst && psql -X -h "$SOCK" -p $P -U postgres -v ON_ERROR_STOP=1 -q -f "$SOCK/mutant.sql" >/dev/null 2>&1
MD5_MUT="$(Q "SELECT md5(pg_catalog.pg_get_functiondef('$FN'::regprocedure))")"
OUT="$(psql -X -h "$SOCK" -p $P -U postgres -v ON_ERROR_STOP=1 -qtA -f "$W7D3MIG" 2>&1)"
case "$OUT" in
  *"五條結構錨全過"*)
    if [ "$MD5_MUT" != "$HELPER_MD5_PIN" ]; then
      restore_base && ok TMUT-MD5-CATCHES "🔴 把鎖字面塞進 dollar-quoted 字串、真鎖拿掉 ⇒ **五條錨全綠**(錨的天花板,codex 打出來的)、**md5 釘值紅** ⇒ 分工成立:錨說哪條契約破、md5 說有東西動了"
    else
      bad TMUT-MD5-CATCHES "md5 沒變 ⇒ 突變沒生效"; restore_base
    fi ;;
  *) restore_base; bad TMUT-MD5-CATCHES "本格預期錨會被騙過(那是已知天花板),但實得錨紅了:$(printf '%s' "$OUT" | tr '\n' ' ' | cut -c1-140)" ;;
esac

echo "══ 2. 前置閘與收尾 ═════════════════════════════════════════"
# 前置閘:多一個 overload ⇒ 錨會打空,必須先擋下來
psql -X -h "$SOCK" -p $P -U postgres -v ON_ERROR_STOP=1 -q \
  -c "CREATE FUNCTION public.pcm_a4a_recompute_order_item_summary(p_x text) RETURNS void LANGUAGE sql AS \$m\$ SELECT \$m\$;" \
  >/dev/null 2>&1 || bad TMUT-PRECOND "多載突變建不起來"
OUT="$(psql -X -h "$SOCK" -p $P -U postgres -v ON_ERROR_STOP=1 -qtA -f "$W7D3MIG" 2>&1)"
case "$OUT" in
  *"前置閘:pcm_a4a_recompute_order_item_summary 的 overload 數不是 1"*)
    ok TMUT-PRECOND "多一個 overload ⇒ 前置閘紅(不讓後面五條錨打在不確定的目標上)" ;;
  *) bad TMUT-PRECOND "前置閘沒紅。實得:$(printf '%s' "$OUT" | tr '\n' ' ' | cut -c1-160)" ;;
esac
psql -X -h "$SOCK" -p $P -U postgres -v ON_ERROR_STOP=1 -q \
  -c "DROP FUNCTION public.pcm_a4a_recompute_order_item_summary(text);" >/dev/null 2>&1 \
  || bad TMUT-PRECOND-CLEANUP "多載清不掉"

[ "$(Q "SELECT md5(pg_catalog.pg_get_functiondef('$FN'::regprocedure))")" = "$BASE_MD5" ] \
  && ok RESTORE-CLEAN "十一次突變跑完,helper 定義 md5 與基準逐位元相同(突變沒有殘留)" \
  || bad RESTORE-CLEAN "helper 定義與基準不符 ⇒ 有突變沒還原乾淨"

# COMMENT 是本檔另一半產物(把「鎖序是對外契約」寫進 DB catalog,不只寫在檔案註解裡)
Q "SELECT obj_description('$FN'::regprocedure,'pg_proc')" | grep -q 'W7d-3 加註' \
  && ok COMMENT-CONTRACT "COMMENT 已進 pg_proc:鎖序被寫成對外契約(catalog 讀得到,不只在檔案裡)" \
  || bad COMMENT-CONTRACT "COMMENT 沒更新或字面不符"

# 🔴 R1 N3:首版的 ZERO-WRITE 在空庫上恆為 0 = 沒有判別力,而且它是 15 格裡唯一沒配突變的。
#    改成「檔案層零 DML」並配一個真突變。誠實界:`COMMENT ON` **不算 DML**,
#    它是本檔刻意的 DDL 產物(寫 pg_description),由 COMMENT-CONTRACT 那格證。
dml_free() {  # $1=migration 檔;印 BAD 表示有語句位置上的 DML/DDL
  # 🔴 這是**行首關鍵字掃描,不是 SQL parser**。誠實界寫在這裡,不寫在別處:
  #    ✅ 擋得到:行首的 CREATE/ALTER/DROP/GRANT/REVOKE/INSERT/UPDATE/DELETE/TRUNCATE
  #              /WITH(CTE-DML)/CALL/MERGE/COPY/EXPLAIN(ANALYZE 會真跑)
  #    ❌ 擋不到:`SELECT mutating_fn()`(寫入藏在被呼叫的函式裡)、續行上的 DML、
  #              `/*x*/ INSERT`(行首是註解)、**以及 `DO` block 內部的任何動態 SQL**。
  #    🔴 `DO` 刻意**不進** pattern:本檔的被測物**自己就是一個 `DO` block**(migration:60),
  #       把 DO 加進去等於自己打自己(實測當場紅)。而 pattern 分不出「合法的 assert block」
  #       與「藏了動態 SQL 的 block」—— 那個判別只有讀 block 內容做得到,已列為下方天花板。
  #    ⇒ 它是**便宜的絆線**,不是「本檔零寫入」的證明。真正的依據是這支 migration 篇幅小、
  #      逐行被 code-reviewer 與 codex 各兩輪讀過,加上 ZERO-ROW-RUNTIME 那道 runtime 觀察。
  #    (codex 關卡2 第二輪點名 MERGE / COPY / EXPLAIN ANALYZE INSERT / SELECT mutating_fn ——
  #     前三個已補進 pattern;第四個補不進來,那是 parser 才做得到的事,列為天花板不假裝擋得住。)
  grep -nE '^[[:space:]]*(CREATE|ALTER|DROP|GRANT|REVOKE|INSERT|UPDATE|DELETE|TRUNCATE|WITH|CALL|MERGE|COPY|EXPLAIN)[[:space:]]' "$1" \
    | grep -v '^[0-9]*:[[:space:]]*--' || true
}
[ -z "$(dml_free "$W7D3MIG")" ] \
  && ok ASSERT-ONLY-NO-DML "檔案層:語句位置上零 CREATE/ALTER/DROP/GRANT/REVOKE/INSERT/UPDATE/DELETE/TRUNCATE(COMMENT ON 是刻意例外)" \
  || bad ASSERT-ONLY-NO-DML "實得:$(dml_free "$W7D3MIG" | tr '\n' ' ')"
cp "$W7D3MIG" "$SOCK/mig-dml.sql" && printf '\nINSERT INTO public.order_item_quantity_summary(order_item_id) VALUES (gen_random_uuid());\n' >> "$SOCK/mig-dml.sql"
[ -n "$(dml_free "$SOCK/mig-dml.sql")" ] \
  && ok TMUT-DMLFREE "🔴 在副本尾端塞一句 INSERT ⇒ 上面那道當場抓到 = 它不是恆真" \
  || bad TMUT-DMLFREE "副本被塞了 INSERT 卻沒抓到 ⇒ ASSERT-ONLY-NO-DML 恆真"
cp "$W7D3MIG" "$SOCK/mig-cte.sql" && printf '\nWITH d AS (DELETE FROM public.order_item_quantity_summary RETURNING *) SELECT count(*) FROM d;\n' >> "$SOCK/mig-cte.sql"
[ -n "$(dml_free "$SOCK/mig-cte.sql")" ] \
  && ok TMUT-DMLFREE-CTE "🔴 codex MF4 回歸證:改用 WITH d AS (DELETE …) 這種**不以 DML 關鍵字開頭**的寫法 ⇒ 補了 WITH 之後照樣抓到" \
  || bad TMUT-DMLFREE-CTE "CTE 形的 DML 沒抓到 ⇒ dml_free 只認語句開頭那個洞還在"
# runtime 那道保留,但誠實標明它的界:空庫上本來就是 0,它證的是「沒有意外寫入」不是判別力
[ "$(Q "SELECT count(*)::text FROM public.order_item_quantity_summary")" = "0" ] \
  && ok ZERO-ROW-RUNTIME "runtime:跑完 migration 後 oiqs 仍 0 列(前提檢查;空庫上判別力低,真判別力在上面兩格)" \
  || bad ZERO-ROW-RUNTIME "oiqs 有列 ⇒ 本檔寫了應用資料"

echo
TOT=$((PASS+FAIL))
if [ "$TOT" = "$EXPECT_TOTAL" ]; then
  printf '  PASS %-30s %s\n' "CELL-ACCOUNT" "格數 $TOT = 凍結值 $EXPECT_TOTAL(刪格/漏跑會紅在這裡)"; PASS=$((PASS+1))
else
  printf '  FAIL %-30s %s\n' "CELL-ACCOUNT" "格數 $TOT != 凍結值 $EXPECT_TOTAL ⇒ 有格被刪、被跳過、或新增未更新凍結值"; FAIL=$((FAIL+1))
fi
DUP="$(printf '%s' "$KEYS" | tr ' ' '\n' | grep -v '^$' | sort | uniq -d | tr '\n' ' ')"
[ -z "$DUP" ] || { printf '  FAIL %-30s %s\n' "CELL-DUP" "重複格名 [$DUP] ⇒ 覆蓋帳不可信"; FAIL=$((FAIL+1)); }
KEYS_NOW="$(printf '%s' "$KEYS" | tr ' ' '\n' | grep -v '^$' | sort | tr '\n' ' ' | sed 's/ *$//')"
KEYS_FROZEN="ASSERT-ONLY-NO-DML BASE-NOTICE COMMENT-CONTRACT DDL-SYNTAX HELPER-MD5-PIN LATER-REPLAY PCTL-A1-CMTINERT RESTORE-CLEAN TMUT-A1-INERTBLOCK TMUT-A1-MISSING TMUT-A1-ORDER TMUT-A1-OTHERLOCK TMUT-A2-FORUPDATE TMUT-A4-DELETED TMUT-A4-SHIPPED TMUT-A5-CUMCOL TMUT-A5-RECEIPTS TMUT-A6-UPSERT TMUT-DMLFREE TMUT-DMLFREE-CTE TMUT-MD5-CATCHES TMUT-PRECOND ZERO-ROW-RUNTIME"
if [ "$KEYS_NOW" = "$KEYS_FROZEN" ]; then
  printf '  PASS %-30s %s\n' "CELL-KEYSET" "格名集合逐字符合凍結清單(換格名/換格都紅得到)"; PASS=$((PASS+1))
else
  printf '  FAIL %-30s %s\n' "CELL-KEYSET" "格名集合漂了。多出:[$(comm -13 <(printf '%s' "$KEYS_FROZEN" | tr ' ' '\n' | sort) <(printf '%s' "$KEYS_NOW" | tr ' ' '\n' | sort) | tr '\n' ' ')] 少了:[$(comm -23 <(printf '%s' "$KEYS_FROZEN" | tr ' ' '\n' | sort) <(printf '%s' "$KEYS_NOW" | tr ' ' '\n' | sort) | tr '\n' ' ')]"; FAIL=$((FAIL+1))
fi

echo "════ PASS=$PASS FAIL=$FAIL ════  (殘留檢查見下一行 teardown 輸出)"
[ "$FAIL" -eq 0 ] || exit 1
