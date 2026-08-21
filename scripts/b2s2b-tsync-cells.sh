#!/usr/bin/env bash
# ============================================================
# B2-S2b「真相式六塊同步守門」的 10 格 —— 單一來源,兩個呼叫端
# ============================================================
# 為什麼抽出來(2026-08-21 W5;#798 洞⑤ 的處置):
#   這 10 格(1 格零突變對照 + 9 發突變靶 T1-T9)原本埋在 `scripts/b2s2b-verify.sh`
#   —— 一支 3032 行、要自己起一座 Postgres cluster 的 harness。
#   而**這 10 格本身完全不碰 DB**:複製受守檔到暫存樹 → 改一個錨 → 比對紅點集合。
#   ⇒ 結果是「`scripts/b2s2b-truth-sync.py` 有很好的證人,而沒有人在 commit 時跑得動它」。
#   數法(當場可重跑):`awk 'NR<1988' scripts/b2s2b-verify.sh | grep -cE 'psql|createdb|PGHOST|initdb'` ⇒ 87
#
# 🔴 **抽出來而不是複製一份** —— 兩份會漂移。`b2s2b-verify.sh` source 這一支,
#    它自己也能獨立跑 ⇒ **同一份程式碼,兩個呼叫端。**
#
# 用法:
#   sh scripts/b2s2b-tsync-cells.sh --selftest     獨立跑那 10 格(不碰 DB)
#   . scripts/b2s2b-tsync-cells.sh ; b2s2b_tsync_cells    被 b2s2b-verify.sh source
#
# 被 source 時,呼叫端必須先備好:`ok` / `bad` / `log` 三個函式與 `CELL` / `WORK` / `MIG`。
#
# 🔴 【這一層沒有守門】(同 `scripts/migration-ledger-divergence.sh` 檔頭那條):
#    下面驗的是 `b2s2b-truth-sync.py`;而「這 10 格自己有沒有退化成恆真」沒有外層在看。
#    可行性盤點見 `~/pcm-mailbox/W5-070-帳本分岔守門-20260821.md` §16。
# ============================================================

b2s2b_tsync_cells() {
# 🔴 下面整段【逐字不縮排】—— 它含 heredoc,`PY` 終止符必須在第 0 欄。
log "6b/8 真相式六塊同步守門(S2b-3a 後段;plan §1.1 v3.1)"
# 🔴 守門本體在 `scripts/b2s2b-truth-sync.py`(抽取 + 判定,純文字、不碰 DB)。
#    本段負責:①對照組必須零紅 ②**九發突變逐發只紅指定的紅點集合**(`B-151-A`:兩半各至少一發)。
# 🔴 突變比對象 = **原檔**(plan §2.2 W5 ②:文件/腳本突變沒有 mut0,也不該剝掉受測 guard)。
# 🔴 **九發的分配與 plan §5 字面的對應關係(逐條寫,不用「嚴格強於」這種不可查證的講法)**:
#    plan 字面 = 「五發改本體(逐處一發)+ 一發把述詞改恆等式(**指定打第 5 處 = backfill**)」。
#    · T1-T5 = plan 的「五發改本體」,逐塊各一發(五個嵌入形區塊)。
#    · **T7 = plan 指定的那一發**(backfill 塊的述詞改恆等式)—— R1 抓到我上一版把它挪到 helper、
#      導致 plan 點名的那個縫沒被驗;現在 T6(helper)與 T7(backfill)兩發都在。
#    · T8 / T9 = plan 沒要求的兩發:位置集合被「刪一格+重複另一格」、標記被刪。
#      前者是 R1 實測可繞過守門的活洞,後者打的是塊數/配對那條(其餘七發都只打字面)。
# 🔴 **仍然沒有靶的**:`FROZEN`(凍結表自我一致性)與 `FILE:` 的讀檔失敗路徑。
#    前者在本片開發中**真的紅過一次**(helper 與 COMMON 碰巧共用一行,見 truth-sync 檔內註解),
#    但那不是提交在案的突變 ⇒ 不得算進覆蓋率。
TSYNC="scripts/b2s2b-truth-sync.py"
TMUT=0
CELL=$((CELL+1))
# 🔴 **必須同時看 rc**(R1 must-fix 2 實測):守門 crash(例如檔案含非 UTF-8 位元組)時
#    stdout 是空的、rc=1 —— 只看「stdout 空」會把 crash 讀成全綠,正是本檔自己列的 fail-closed 紀律④。
TS_CTL="$(python3 "$TSYNC" . 2>"$WORK/tsync-ctl.err")"; TS_RC=$?
if [ -z "$TS_CTL" ] && [ "$TS_RC" -eq 0 ]; then
  ok TRUTH-SYNC "🔴 同步守門對照組:六塊**整塊序列**逐字相符(含順序)+ 凍結表自我一致性(分半原則 5+1 / helper 整塊)+ 位置 key 集合 + 三個檔的 BEGIN/END 配對與塊數"
else
  bad "同步守門對照組不通過(rc=$TS_RC):紅點 [$(printf '%s' "$TS_CTL" | tr '\n' ' ')]
$(head -5 "$WORK/tsync-ctl.err")"
fi

run_tmut() {   # $1 = 靶名、$2 = 目標檔、$3 = 原字面、$4 = 新字面、$5 = 期望紅點集合、$6 = key
  local name="$1" f="$2" src="$3" dst="$4" want="$5" key="$6" root="$WORK/tsync-$6" got rc
  TMUT=$((TMUT+1))
  rm -rf "$root"; mkdir -p "$root/supabase/migrations" "$root/docs/runbooks" "$root/scripts"
  # 🔴 **受守檔清單必須跟著 truth-sync 的 SITES 走**(2026-08-21 W5 抽檔時實測抓到):
  #    `#452`(commit `c5c191ec`,2026-08-14)把 `20260813120000_…_452_procurement_void_schema.sql`
  #    加進了 `b2s2b-truth-sync.py` 的 SITES,而**這份複製清單沒跟著加**
  #    ⇒ 暫存樹裡缺那支檔 ⇒ 每一發突變都多出 `FILE:…` 與 `helper-452` 兩個紅點
  #    ⇒ **9/10 格從 2026-08-14 起就是紅的,而沒有人看到** —— 因為它埋在一支要起 DB 的腳本裡,沒人跑。
  #    ⇒ 這裡改成**從 truth-sync 自己抽出檔名**,不再手寫第二份清單(手寫的那份一定會再漂一次)。
  local site_migs
  site_migs=$(grep -oE '[0-9]{14}_[a-z0-9_]+\.sql' "$TSYNC" | sort -u)
  cp docs/runbooks/a4a-summary-rollback.md "$root/docs/runbooks/" \
    && cp scripts/a4a-verify.sh "$root/scripts/" && cp "$TSYNC" "$root/scripts/" \
    || { bad "$name:複製受守檔失敗"; rm -rf "$root"; return; }
  local m
  for m in $site_migs; do
    cp "supabase/migrations/$m" "$root/supabase/migrations/$m" \
      || { bad "$name:複製受守 migration 失敗($m)—— SITES 指到一支不存在的檔?"; rm -rf "$root"; return; }
  done
  SRC="$src" DST="$dst" F="$root/$f" python3 - <<'PY' || { bad "$name:突變產生失敗(錨命中次數不是 1?)"; rm -rf "$root"; return; }
import io, os
p = os.environ['F']; src = os.environ['SRC']; dst = os.environ['DST']
s = io.open(p, encoding='utf-8').read()
n = s.count(src)
if n != 1:
    raise SystemExit('突變錨命中 %d 次(必須恰 1 次):%r' % (n, src[:70]))
io.open(p, 'w', encoding='utf-8').write(s.replace(src, dst))
PY
  cmp -s "$f" "$root/$f"; rc=$?
  case "$rc" in
    1) : ;;
    0) bad "$name:突變檔與原檔**逐字相同** —— 沒改到東西,這一發等於沒跑"; rm -rf "$root"; return ;;
    *) bad "$name:cmp 讀不到檔(rc=$rc)—— 判紅,不當成「有差異」"; rm -rf "$root"; return ;;
  esac
  got="$(python3 "$root/$TSYNC" "$root" 2>"$WORK/tsync-$key.err" | tr '\n' ' ' | sed 's/ *$//')"
  rm -rf "$root"
  if [ "$got" = "$want" ]; then ok "$key" "$name ⇒ 紅點逐字相符:[$want]"
  else bad "$name:紅點集合不符
     實際 [$got]
     期望 [$want]
     診斷:$(head -3 "$WORK/tsync-$key.err" 2>/dev/null | tr '\n' ' ')"; fi
}

# ── T1-T5:打**全等半**(五個嵌入形區塊各一發)────────────────────────────────
run_tmut "靶T1-runbook 對帳欄位塊改 JOIN 條件" docs/runbooks/a4a-summary-rollback.md \
'AS truth_cancelled,
-- SHIPPED-TRUTH-BEGIN
COALESCE((SELECT sum(si.shipped_quantity)
FROM public.shipment_items si
JOIN public.shipments sh ON sh.id = si.shipment_id' \
'AS truth_cancelled,
-- SHIPPED-TRUTH-BEGIN
COALESCE((SELECT sum(si.shipped_quantity)
FROM public.shipment_items si
JOIN public.shipments sh ON sh.id = si.id' \
  "rb-div-col" TMUT-1

run_tmut "靶T2-runbook 對帳 WHERE 塊把 deleted_at 反向" docs/runbooks/a4a-summary-rollback.md \
'WHERE si.order_item_id = u.order_item_id
AND sh.deleted_at IS NULL
AND sh.shipped_at IS NOT NULL), 0)
-- SHIPPED-TRUTH-END
      ;' \
'WHERE si.order_item_id = u.order_item_id
AND sh.deleted_at IS NOT NULL
AND sh.shipped_at IS NOT NULL), 0)
-- SHIPPED-TRUTH-END
      ;' \
  "rb-div-where" TMUT-2

run_tmut "靶T3-runbook 步驟⑤塊改加總的欄" docs/runbooks/a4a-summary-rollback.md \
'       OR s.shipped_quantity   IS DISTINCT FROM
-- SHIPPED-TRUTH-BEGIN
COALESCE((SELECT sum(si.shipped_quantity)' \
'       OR s.shipped_quantity   IS DISTINCT FROM
-- SHIPPED-TRUTH-BEGIN
COALESCE((SELECT sum(si.quantity_shipped)' \
  "rb-step5" TMUT-3

run_tmut "靶T4-a4a-verify 塊漏掉 shipped_at 那行" scripts/a4a-verify.sh \
'AND sh.deleted_at IS NULL
AND sh.shipped_at IS NOT NULL), 0)
-- SHIPPED-TRUTH-END' \
'AND sh.deleted_at IS NULL
AND sh.shipped_at IS NOT NULL), 0) -- 夾帶
-- SHIPPED-TRUTH-END' \
  "av-oracle" TMUT-4

run_tmut "靶T5-migration backfill 塊改 FROM 的表" "$MIG" \
'-- SHIPPED-TRUTH-BEGIN
COALESCE((SELECT sum(si.shipped_quantity)
FROM public.shipment_items si' \
'-- SHIPPED-TRUTH-BEGIN
COALESCE((SELECT sum(si.shipped_quantity)
FROM public.shipment_items_v2 si' \
  "backfill" TMUT-5

# ── T6:打 **per-site 半**(helper 塊整塊 per-site、不參與全等半)────────────────
# 🔴 這一發同時是 plan §5 指定的「述詞改恆等式」形狀:`si.order_item_id = si.order_item_id`
#    = 加總**全店**出貨。它滿足「存在一條等式」⇒ 只驗「有等式」的寫法對它全盲(plan §1.1 自承的恆真族)。
run_tmut "靶T6-helper 塊述詞改恆等式(per-site 半)" "$MIG" \
'   WHERE si.order_item_id = p_order_item_id' \
'   WHERE si.order_item_id = si.order_item_id' \
  "helper" TMUT-6

# ── T7:plan §5 **指定打第 5 處**(backfill oracle)的述詞恆等式 ─────────────────
# 🔴 R1 must-fix 4:我上一版只把恆等式打在 helper,而 plan 逐字指定的是**第 5 處**
#    (理由:它是「唯一開工才定值的一列」,打已有具體凍結值的處驗不到那個縫)⇒ 補這一發。
#    T6 與 T7 不重複:一個打 helper 塊、一個打 backfill 塊,是 per-site 半的兩個代表。
run_tmut "靶T7-backfill 塊述詞改恆等式(plan 指定的第 5 處)" "$MIG" \
'WHERE si.order_item_id = s.order_item_id
AND sh.deleted_at IS NULL
AND sh.shipped_at IS NOT NULL), 0)
-- SHIPPED-TRUTH-END
         ;' \
'WHERE si.order_item_id = si.order_item_id
AND sh.deleted_at IS NULL
AND sh.shipped_at IS NOT NULL), 0)
-- SHIPPED-TRUTH-END
         ;' \
  "backfill" TMUT-7

# ── T8:攻擊守門**自己的位置集合**(R1 must-fix 1 的那一發)────────────────────
# 🔴 「刪一格 + 重複另一格」——只凍個數時它會全綠(R1 實測過),凍 key 集合才殺得掉。
#    這一發同時是 plan §1.1 要求的「把別的東西丟進集合 ⇒ 必須紅在集合本身」那個負測的等價形狀。
run_tmut "靶T8-守門的 SITES 刪一格+重複另一格" scripts/b2s2b-truth-sync.py \
"    ('rb-step5',      RB,  3, True)," \
"    ('rb-div-col',    RB,  1, True)," \
  "SITES" TMUT-8

# ── T9:刪掉一個標記 ⇒ 必須紅在「檔案塊數不符」與「取不到該塊」───────────────
# 🔴 這一發打的是 `extract_all` 與塊數自斷言那條(其餘八發都打字面比對)。
run_tmut "靶T9-刪掉 runbook 收尾段的 BEGIN 標記" docs/runbooks/a4a-summary-rollback.md \
'       OR s.shipped_quantity   IS DISTINCT FROM
-- SHIPPED-TRUTH-BEGIN
COALESCE((SELECT sum(si.shipped_quantity)' \
'       OR s.shipped_quantity   IS DISTINCT FROM
COALESCE((SELECT sum(si.shipped_quantity)' \
  "FILE:a4a-summary-rollback.md rb-step5" TMUT-9
}

# ── 獨立模式:自己備齊 ok/bad/log 與三個變數,然後跑那 10 格 ──────────────
if [ "${1:-}" = "--selftest" ]; then
  set -u
  export LC_ALL=C
  # 🔴 用 repo 根當基準,不用「本檔位置的上一層」(2026-08-21 W5 做雙向表演時撞到):
  #    把本檔複製到別處做突變測試時,後者會 cd 到那個複製品的上一層 ⇒ 受守檔全部找不到 ⇒ exit 2,
  #    而那個 2 看起來像「工具自壞」,其實是測試鐵架把它放錯地方。
  #    📌 我第一版寫成 `cd "$(git rev-parse --show-toplevel)/.."` —— 多了那個 `/..` ⇒ cd 到 repo 的**上一層**,
  #    下一個 git 呼叫就報 not a git repository。**改壞的那一版自己紅了,所以看得見。**
  _root="$(git rev-parse --show-toplevel 2>/dev/null)"
  [ -n "$_root" ] || _root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  cd "$_root" || exit 2
  WORK="$(mktemp -d)" || exit 2
  trap 'rm -rf "$WORK"' EXIT
  trap 'rm -rf "$WORK"; exit 1' INT TERM
  MIG="supabase/migrations/20260806180000_m4b_e10_b2_s2b_shipped_recompute_wire.sql"
  CELL=0; _pass=0; _fail=0
  log() { printf '%s\n' "$1"; }
  ok()  { _pass=$((_pass+1)); printf '  PASS %-12s %s\n' "$1" "$2"; }
  bad() { _fail=$((_fail+1)); printf '  🔴 FAIL %s\n' "$1"; }
  for f in "$MIG" docs/runbooks/a4a-summary-rollback.md scripts/a4a-verify.sh scripts/b2s2b-truth-sync.py; do
    [ -f "$f" ] || { printf '🔴 受守檔不在:%s ⇒ 本 harness 無法判斷,exit 2\n' "$f" >&2; exit 2; }
  done
  b2s2b_tsync_cells
  printf '  ── tsync cells: %s PASS / %s FAIL\n' "$_pass" "$_fail"
  # 🔴 格數釘死:比的是【跑過幾格】(pass+fail),不是【過了幾格】——
  #    讓某格正確翻紅時格數沒變,舊寫法會印「有格被刪掉」這種指錯方向的診斷。
  EXPECT=10
  if [ "$((_pass + _fail))" != "$EXPECT" ]; then
    printf '  🔴 【格數】不對:跑了 %s 格 ≠ %s ⇒ 有格被刪掉或沒跑到(這不是「有格失敗」)\n' "$((_pass+_fail))" "$EXPECT"
    exit 1
  fi
  [ "$_fail" = "0" ] || exit 1
  exit 0
fi
