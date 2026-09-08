#!/bin/sh
# ============================================================
# is-migration-applied.sh — 「這支 migration 到底貼了沒」的【問法產生器】
# ============================================================
# 線 -db 2026-09-03 建。成因 = 同一夜三次「帳本 0 而正式庫有」:
#   20260902120000(取消信白名單)· 20260828060000(第 6 支排程心跳)⇒ 兩支都【已貼】
#   20260903040000(未付款取消信)                                  ⇒ 這支是【真的沒貼】
#   🔴 三支在 `supabase/APPLIED.tsv` 上【印同一個 0】。
#
# 🛑🛑 **本支【不連 DB】,而那是它的設計不是它的缺陷** ——
#    施工窗沒有正式庫存取, 而需要這個答案的人就是施工窗。
#    ⇒ 它產出一段【唯讀 SQL】, 交給有 access 的人跑。
#
# 🔴🔴 **它真正解的那件事:大部分 migration 的「東西在不在」【零判別力】。**
#    · `CREATE OR REPLACE FUNCTION` ⇒ 舊版新版**都在** ⇒ 問「函式在不在」兩個世界同一個答案
#    · `ADD CONSTRAINT x_v2 … RENAME x_v2 TO x` ⇒ 貼完之後**名字跟貼之前一樣**
#    ⇒ 📌 **一個問錯的查詢會回一個看起來很合理的答案, 而沒有東西會說它問錯了。**
#    ⇒ 所以本支對每一個抽出來的物件, 都標【判別力】: 有 / 無 / 未知。
#
# 🛑 **它答不出什麼**(先講, 不要拿它當它不是的東西):
#    · 它讀的是 SQL 的**字面**, 不執行它 ⇒ 動態產生的 DDL(`EXECUTE format(...)`)它看不到
#    · 「新值」是**猜的**(見下面那條啟發式)⇒ 猜錯時它會印出依據, 讓你自己推翻
#    · 產出的 SQL 回什麼, 本支不知道 ⇒ **判讀在跑的人手上, 而每一格都附兩個世界的期望值**
#    · 它不查帳本 —— 三本帳的分岔看 `scripts/migration-ledger-divergence.sh`(那是另一件事:
#      那支問「有沒有人記」, 本支問「東西在不在」)
#
# 用法  bash scripts/is-migration-applied.sh <migration 檔名或路徑>
#       bash scripts/is-migration-applied.sh --selftest
# ============================================================
set -u
# 🔴 檔頭標記的 parser 收攏在一支(⟦0e-DDLINTOVC-MARK⟧;Fable R3 F4 實錘:四份手寫 parser
#    有兩種文法, 同一個檔頭兩把尺說是、兩把尺說不是, 而畫面上沒有東西說兩邊不同)。
#    🛑 讀不到它 ⇒ **擋下**, 不要靜默退回本地判斷 —— 那會把「沒有 parser」變成「沒有標記」。
_MARKLIB="$(cd "$(dirname "$0")" && pwd)/lib-migration-header-marks.sh"
if [ -f "$_MARKLIB" ]; then . "$_MARKLIB"; else
  printf '🔴 找不到 %s ⇒ 檔頭標記無法判讀, 擋下(不放行)\n' "$_MARKLIB" >&2; exit 2
fi

REPO=$(cd "$(dirname "$0")/.." && pwd)
MIGDIR="$REPO/supabase/migrations"

die() { printf '🔴 %s\n' "$1" >&2; exit 2; }

# ── selftest ──────────────────────────────────────────────
# 🔴 2026-09-03:本支的檔頭【逐字寫著】`--selftest`, 而在此之前
#    `SELFTEST` 這個變數被設好之後**再也沒有被讀過一次** ⇒ 那個旗標是死的,
#    而單獨跑 `--selftest` 會 rc=2 ⇒ 📌 **一個【單獨跑會失敗】的 selftest 等於沒有 selftest**,
#    而下一個人跑到 rc=2, 會讀成「這支工具壞了」—— 與【工具真的壞了】印同一個非零 rc。
ST_PASS=0
ST_FAIL=0
OUTSQL=""
chk() {  # chk <描述> <有|無> <字面>
  if grep -qF "$3" "$OUTSQL" 2>/dev/null; then HIT=1; else HIT=0; fi
  if [ "$2" = "有" ]; then
    if [ "$HIT" = "1" ]; then ST_PASS=$((ST_PASS+1)); printf '  ✅ %s\n' "$1"
    else ST_FAIL=$((ST_FAIL+1)); printf '  🔴 FAIL %s ⇒ 產出裡【找不到】: %s\n' "$1" "$3"; fi
  else
    if [ "$HIT" = "1" ]; then ST_FAIL=$((ST_FAIL+1)); printf '  🔴 FAIL %s ⇒ 產出裡【不該有】卻有: %s\n' "$1" "$3"
    else ST_PASS=$((ST_PASS+1)); printf '  ✅ %s\n' "$1"; fi
  fi
}

# 🔴 既有的 `chk` 比對的是【產出的 SQL】。而補版控型標記改的是【stdout 的判別力那句話】
#    ⇒ 用同一個 `chk` 去驗它會永遠綠(那個字面本來就不在 SQL 裡)⇒ 另開一個看 stdout 的。
CHKLOG=""
chk_out() {  # chk_out <描述> <有|無> <字面>
  if grep -qF "$3" "$CHKLOG" 2>/dev/null; then HIT=1; else HIT=0; fi
  if [ "$2" = "有" ]; then
    if [ "$HIT" = "1" ]; then ST_PASS=$((ST_PASS+1)); printf '  ✅ %s\n' "$1"
    else ST_FAIL=$((ST_FAIL+1)); printf '  🔴 FAIL %s ⇒ 畫面上【找不到】: %s\n' "$1" "$3"; fi
  else
    if [ "$HIT" = "1" ]; then ST_FAIL=$((ST_FAIL+1)); printf '  🔴 FAIL %s ⇒ 畫面上【不該有】卻有: %s\n' "$1" "$3"
    else ST_PASS=$((ST_PASS+1)); printf '  ✅ %s\n' "$1"; fi
  fi
}

selftest() {
  # 🔴 第一件事:剝掉【繼承來的】git 環境。`git -C` 擋不住這幾個。
  #    (本 repo `.husky/selftest-git-isolation-gate.sh` 要求;
  #     「在我自己樹上跑是綠的」是觸發條件, 不是通過條件。)
  unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE GIT_OBJECT_DIRECTORY \
        GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_COMMON_DIR GIT_NAMESPACE

  ST_DIR=$(mktemp -d "${TMPDIR:-/tmp}/ima-selftest-XXXXXX") || return 2
  ST_FIX="$ST_DIR/19700101000000_selftest_fixture.sql"
  # 🔵 版本號刻意用 1970 ⇒ 「比本檔早的 migration」是空集合 ⇒ 語料掃描不吃時間。
  cat > "$ST_FIX" <<'FIXEOF'
CREATE TABLE public.zz_sel_tbl (id uuid primary key); -- ADD COLUMN zz_from_comment text
-- 🔵 上面那個【行尾】註解是刻意的:註解要寫成【行尾】才測得到剝註解那一格。
--    寫成整行註解 ⇒ `^[[:space:]]*CREATE` 本來就不匹配 ⇒ 那個負向檢查【不可能紅】。
CREATE INDEX zz_sel_idx ON public.zz_sel_tbl (id);
CREATE POLICY zz_sel_policy ON public.zz_sel_tbl FOR SELECT USING (true);
ALTER TABLE public.zz_sel_tbl ADD COLUMN zz_new_col text;
FIXEOF

  printf '======== is-migration-applied --selftest ========\n'
  if ! bash "$0" "$ST_FIX" > "$ST_DIR/run.log" 2>&1; then
    printf '🔴 本體對 fixture 跑不起來 ⇒ %s\n' "$ST_DIR/run.log"; return 1
  fi
  OUTSQL="${TMPDIR:-/tmp}/is-applied-19700101000000.sql"
  [ -s "$OUTSQL" ] || { printf '🔴 產出是空的或不存在:%s\n' "$OUTSQL"; return 1; }

  # 🔴🔴 這一格是【本次事故的回歸守門】:抽取式的字元類曾經含一個空白,
  #    把 `CREATE POLICY <名> ON public.<表>` 整段吃成政策名 ⇒ 查詢在兩個世界都回 0。
  chk 'policy 名抽對了(不含 ON)'        有 "polname='zz_sel_policy'"
  chk '🔴 政策名【沒有】吃掉 ON public' 無 "polname='zz_sel_policy ON"
  chk 'policy 有 join 回它所在的表'      有 "c.relname='zz_sel_tbl'"
  chk 'policy 帶正對照(表存在且開 RLS)' 有 '正對照 public.zz_sel_tbl 存在且開 RLS'
  chk 'policy 帶負對照'                  有 '負對照 現造政策名'
  chk '表/view 這一型有查'               有 '表/view public.zz_sel_tbl 存在(1=已貼)'
  chk '索引這一型有查'                   有 '索引 zz_sel_idx 存在(1=已貼)'
  chk '索引帶正對照'                     有 '正對照 public 底下的索引數'
  chk '新欄這一型有查'                   有 '欄 zz_sel_tbl.zz_new_col 存在(1=已貼)'
  # 🔴 這一格原本寫成 `有 '正對照'` —— 那個字串【任何一段】的正對照都會命中
  #    ⇒ 它會在「新欄這一型根本沒有正對照」的世界裡照樣印綠 ⇒ 釘住完整字面。
  chk '新欄帶正對照(釘住完整字面)'       有 '正對照 zz_sel_tbl.id 存在(期望1)'
  # 🔵 負向:註解裡的 CREATE POLICY 不得被抽出來 —— 剝註解那一格的回歸守門。
  chk '🔵 註解裡的物件沒有被抽進來'      無 'zz_from_comment'
  # ══ 🟢 全域正對照(2026-09-07;auth 量到本支只有受測格 + 負對照)══════════════
  #   📌 負對照證的是「不會亂命中」, **它不證「接得上」** ——
  #     受測格回 1 有兩種世界:①真的已貼 ②尺沒接上而剛好也印 1。
  #   ⇒ 這兩格分辨的是【有沒有那一格】, 而不是它的值(值要跑才知道)。
  chk '🟢 產出的 SQL 有全域正對照'       有 '**全域正對照**'
  chk '🔵 產出的 SQL 有全域負對照'       有 '負對照 現造物件名(期望0)'
  # 🔴 `--positive` 那條路【本檔的 selftest 驗不到】—— 它要另起一個乾淨的 repo 才問得出來。
  #    ⇒ 不留一個「定義了而沒有人呼叫」的假檢查在這裡(那種東西看起來像有守, 而它恆真)。
  #    ✅ 改成在【交件時實跑一次】並把讀數寫進 commit body。

  # ══ 🔴🔴 補版控型標記 `pcm:ddl-into-vc`(⟦0e-DDLINTOVC-MARK⟧)兩個世界 ══════════
  #    🛑 這一組要【同一支 fixture 只差那一行】—— 換了 fixture 就不是在量那一行。
  ST_VC="$ST_DIR/19700102000000_selftest_ddlvc.sql"
  # 🔴 **codex 2026-09-06 R2**:第一版 fixture 只有 table + column ⇒ **函式與 constraint 那兩條路
  #    沒被任何一格走過** ⇒ 它們沒降級而全綠。⇒ fixture 補上裸 CREATE FUNCTION 與 OR REPLACE FUNCTION。
  _vc_body='CREATE TABLE public.zz_vc_tbl (id uuid primary key);
ALTER TABLE public.zz_vc_tbl ADD COLUMN zz_vc_col text;
CREATE FUNCTION public.zz_vc_bare() RETURNS int LANGUAGE sql AS $f$ SELECT 1 $f$;
CREATE OR REPLACE FUNCTION public.zz_vc_cor() RETURNS text LANGUAGE sql AS $g$ SELECT '"'"'zz_vc_token'"'"' $g$;'
  # 🔴 **codex R2**:產出檔名是【固定的】(`is-applied-<版本>.sql`)⇒ 子程序失敗時
  #    上一發的 SQL 還躺在那裡 ⇒ `chk` 會拿它當這一發的產物 ⇒ 📌 **一個假綠只需要一次失敗。**
  _vc_out="${TMPDIR:-/tmp}/is-applied-19700102000000.sql"
  _vc_run() { # $1=log 路徑 → 先清產物, 跑, 驗 rc
    rm -f "$_vc_out"
    bash "$0" "$ST_VC" > "$1" 2>&1
    if [ $? -ne 0 ]; then ST_FAIL=$((ST_FAIL+1)); printf '  🔴 FAIL 本體對 vc fixture 跑失敗 ⇒ %s\n' "$1"; return 1; fi
    ST_PASS=$((ST_PASS+1)); printf '  ✅ 本體跑成功且 rc=0(不是拿上一發的產物)\n'
  }

  # ── 世界一:帶標記 ⇒ 每一個物件的存在性判別力一律【零】
  printf -- '-- pcm:ddl-into-vc: public.zz_vc_tbl\n%s\n' "$_vc_body" > "$ST_VC"
  CHKLOG="$ST_DIR/vc1.log"; _vc_run "$CHKLOG"
  chk_out '🟠 帶標記 ⇒ 出聲說它是補版控型'        有 '本支是【補版控型】'
  chk_out '🔴 帶標記 ⇒ 新表【不再】印判別力有'    無 '這是新物件, 沒貼就不存在'
  chk_out '🔴 帶標記 ⇒ 新欄【不再】印判別力有'    無 '新欄位, 沒貼就不存在'
  chk_out '🔴 帶標記 ⇒ 印出【零判別力】與理由'    有 '判別力【零】—— 本支是補版控型'
  chk_out '🔵 帶標記 ⇒ 把物件名【原樣】帶出來'    有 'pcm:ddl-into-vc: public.zz_vc_tbl'
  # 🔴🔴 **codex 2026-09-06 R1 MF1**:上面五格驗的都是【畫面】, 而拿去跑的人讀的是
  #    【產出的 SQL】⇒ 第一版那份 SQL 裡逐字還寫著「1=已貼」, 而五格全綠。
  #    ⇒ 📌 **我驗了那個結論會出現的地方, 而不是它會被讀到的地方。**
  OUTSQL="${TMPDIR:-/tmp}/is-applied-19700102000000.sql"
  chk '🟠 產出的 SQL 檔頭也說它是補版控型'      有 '這支是【補版控型】'
  chk '🔴 產出的 SQL【不再】有「1=已貼」標籤'   無 '存在(1=已貼)'
  chk '🟠 產出的 SQL 標籤改成「回1是預期, 回0才是訊號」' 有 '存在(補版控型:回1是預期, 回0才是訊號)'
  chk '🟠 產出的 SQL 判別註解也降級'            有 '判別【零】(補版控型'
  chk '🔴 產出的 SQL 明說不要把 1 讀成已貼'      有 '不要把下面任何一個 1 讀成「已貼」'
  chk '🔴 F5:產出的 SQL 明說【看 0 不要看 1】'   有 '**看【0】不要看 1**'
  chk '🟠 產出的 SQL 說帳本列 ≠ 執行過'          有 '不是**「這支檔被執行過」'
  # 🔴 codex R2:函式與 body 兩條路第一版沒降級, 而沒有任何一格走過它們。
  chk '🟠 裸 CREATE FUNCTION 這條路也降級'       有 '函式 public.zz_vc_bare 存在(補版控型:回1是預期, 回0才是訊號)'
  chk '🔴 裸 CREATE FUNCTION 沒有留「1=已貼」'   無 '函式 public.zz_vc_bare 存在(1=已貼)'
  chk '🟠 函式 body 那條路也降級'                有 'body 含 zz_vc_token(補版控型:回1是預期, 回0才是訊號)'
  chk '🔴 body 那條路沒有留「1=已貼」'           無 'body 含 zz_vc_token(1=已貼)'

  # ── 世界二:同一支檔【只拿掉那一行】⇒ 必須回到原本的行為
  #    🛑 沒有這一格,「帶標記會印零」與「這支尺對誰都印零」印同一個東西。
  printf '%s\n' "$_vc_body" > "$ST_VC"
  CHKLOG="$ST_DIR/vc2.log"; _vc_run "$CHKLOG"
  chk_out '🟢 拿掉標記 ⇒ 新表回到判別力【有】'    有 '這是新物件, 沒貼就不存在'
  chk_out '🟢 拿掉標記 ⇒ 新欄回到判別力【有】'    有 '新欄位, 沒貼就不存在'
  chk_out '🟢 拿掉標記 ⇒ 補版控型那句話消失'      無 '本支是【補版控型】'
  # 🛑 沒有這三格,「帶標記的 SQL 會降級」與「這支尺產的 SQL 恆降級」印同一個東西。
  chk '🟢 拿掉標記 ⇒ SQL 標籤回到「1=已貼」'    有 '存在(1=已貼)'
  chk '🟢 拿掉標記 ⇒ SQL 裡沒有補版控型橫幅'    無 '這支是【補版控型】'
  chk '🟢 拿掉標記 ⇒ SQL 裡沒有降級註解'        無 '判別【零】(補版控型'
  chk '🟢 拿掉標記 ⇒ 裸函式那條路回到「1=已貼」'  有 '函式 public.zz_vc_bare 存在(1=已貼)'
  chk '🟢 拿掉標記 ⇒ body 那條路回到「1=已貼」'   有 'body 含 zz_vc_token(1=已貼)'

  # ── 邊界 a:冒號後面是空的 ⇒ 不算合法標記, 而且要出聲(照差集閘 :410 的先例)
  printf -- '-- pcm:ddl-into-vc:\n%s\n' "$_vc_body" > "$ST_VC"
  CHKLOG="$ST_DIR/vc3.log"; _vc_run "$CHKLOG"
  chk_out '🧬 冒號後空的 ⇒ 出聲說標記不完整'      有 '標記不完整'
  chk_out '🧬 冒號後空的 ⇒ 不算標記(照一般檔判)' 有 '這是新物件, 沒貼就不存在'

  # ── 邊界 b:標記在第 21 行 ⇒ 不算(只讀檔頭 20 行, 照 :247 的先例)
  #    🔵 一支檔【中段提到】這個字面不該把它自己變成補版控型。
  { i=1; while [ "$i" -le 21 ]; do printf -- '-- filler %s\n' "$i"; i=$((i+1)); done
    printf -- '-- pcm:ddl-into-vc: public.zz_vc_tbl\n%s\n' "$_vc_body"; } > "$ST_VC"
  CHKLOG="$ST_DIR/vc4.log"; _vc_run "$CHKLOG"
  chk_out '🧬 標記在第 22 行 ⇒ 不算補版控型'      無 '本支是【補版控型】'

  # ── 邊界 c:同時帶 never-apply 與 ddl-into-vc ⇒ **合法**(兩個軸, 不是矛盾)
  printf -- '-- pcm:never-apply\n-- pcm:ddl-into-vc: public.zz_vc_tbl\n%s\n' "$_vc_body" > "$ST_VC"
  CHKLOG="$ST_DIR/vc5.log"; _vc_run "$CHKLOG"
  chk_out '🔵 兩個標記並存 ⇒ 合法, 仍判補版控型'  有 '本支是【補版控型】'

  rm -rf "$ST_DIR"
  printf '\n通過 %s / 失敗 %s\n' "$ST_PASS" "$ST_FAIL"
  [ "$ST_FAIL" -eq 0 ]
}

# ── 解析參數 ───────────────────────────────────────────────
if [ "${1:-}" = "--selftest" ]; then selftest; exit $?; fi
[ $# -ge 1 ] || die "要給一個 migration 檔名。用法: bash scripts/is-migration-applied.sh <檔名>"

ARG=$1
if [ -f "$ARG" ]; then FILE=$ARG
elif [ -f "$MIGDIR/$ARG" ]; then FILE="$MIGDIR/$ARG"
else
  # 允許只給版本號前綴
  FILE=$(ls "$MIGDIR"/"$ARG"*.sql 2>/dev/null | head -1)
  [ -n "$FILE" ] && [ -f "$FILE" ] || die "找不到這支 migration: $ARG
   已試: 當成路徑 / 當成 $MIGDIR 底下的檔名 / 當成版本號前綴
   🔵 這是【報錯】不是印空 —— 一個查無若印空, 會被讀成「這支沒有任何物件」。"
fi

BASE=$(basename "$FILE")
VER=$(printf '%s' "$BASE" | sed 's/_.*//')
# 🟢 `--positive <schema.名>` —— 明寫全域正對照的物件(2026-09-07)
POSITIVE_OBJ=""
_i=1
for _a in "$@"; do
  if [ "$_a" = "--positive" ]; then
    POSITIVE_OBJ=$(eval printf '%s' "\${$((_i+1))}")
  fi
  _i=$((_i+1))
done

printf '======== is-migration-applied ========\n'
printf '檔  %s\n' "$BASE"
printf '版本 %s\n\n' "$VER"

# ── 🔴🔴 先剝掉註解, 而【所有抽取都必須讀剝過的那一份】───────────────────────
# 2026-09-03 實測:本支對正式庫產出了【兩個不存在的欄名】, 而兩個都來自 `--` 註解行:
#   20260901020000 ⇒ 抽到 `pid4`(:164 的註解「· ADD COLUMN pid4 uuid …」)
#                     而它真正加的是 `coupon_id`
#   20260901030000 ⇒ 抽到 `capture_state`(:1621 的註解, 在講【別支】migration)
#                     而它根本【沒有 ADD COLUMN】
# ⇒ 📌 產出的查詢問了一個不存在的欄 ⇒ 回 0 ⇒ **而那個 0 被讀成「這支沒貼」。**
#    一個問錯對象的查詢, 回的是一個【格式完全正確】的錯誤答案。
# 🛑 而這是同一個病的第二次:我先前只對「函式 body」那條路修過(那次是註解裡的 md5)
#    ⇒ **修一個被點名的實例, 不等於修那個類別。** 這次剝在源頭, 所有抽取共用。
NOCMT="${TMPDIR:-/tmp}/is-applied-nocmt-$VER.sql"
sed 's/--.*$//' "$FILE" > "$NOCMT"

# ── 🔴🔴 補版控型標記 `-- pcm:ddl-into-vc: <物件>`(⟦0e-DDLINTOVC-MARK⟧;-f8 2026-09-06 裁甲)──
#
# 🛑 **病灶**:一支「把【已經在正式庫上的】東西補進版控」的 migration, 它建的物件**本來就全在**
#    ⇒ 本支對新表/新 index/新欄位印的「🟢 判別力【有】—— 沒貼就不存在」**那句話是假的**。
#    📌 而 2026-09-01 抓到那個假陽性的唯一原因是「那一支剛好是稽核者自己寫的」⇒ **下一個人不認得別人的補版控型。**
#
# 🔵 **為什麼不沿用 `-- pcm:never-apply`**(-f8 2026-09-06 裁甲, 理由是量到的):
#    那是**另一個軸** ——「這支要不要貼」 vs 「物件在線上了嗎」。今天 4 支 never-apply 裡
#    **1 支不是補版控型**(`20260904010000:3` 逐字「本支【刻意不貼】」, 理由是保留一格會綠的測試),
#    而 **1 支補版控動機的檔不能 never-apply**(`20260905160000:78`, 空庫重播需要它)
#    ⇒ 🎯 **兩個方向都已經錯了, 不是未來可能會錯。**
#
# ⚠️ **只讀檔頭前 20 行**, 而那是刻意的(照 `migration-ledger-divergence.sh:247` 的先例):
#    一支檔【中段提到】這個字面(例如在解釋這個機制)不該把它自己變成補版控型。
# ⚠️ **要讀 `$FILE` 不是 `$NOCMT`** —— 標記本身就是註解, 剝過的那份裡它不存在。
DDLVC=0
_ddlvc_head=$(head20_of_file "$FILE")
DDLVC_OBJ=$(mark_value_or_warn "$_ddlvc_head" ddl-into-vc "$BASE")
[ -n "$DDLVC_OBJ" ] && DDLVC=1
if [ "$DDLVC" = "1" ]; then
  printf '🟠 **本支是【補版控型】**(檔頭 `-- pcm:ddl-into-vc: %s`)\n' "$DDLVC_OBJ"
  printf '   ⇒ 它建的物件在正式庫上是【這支檔被寫下來之前就有的】。\n'
  printf '   🛑 **所以下面每一個物件的「存在性」判別力一律是【零】** —— 問「東西在不在」\n'
  printf '      在「貼了」與「沒貼」兩個世界會回**同一個答案**。\n'
  printf '   🔴🔴 **而【回 0】才是這一型唯一有判別力的那一格**(Fable 2026-09-06 R3 F5)——\n'
  printf '      補版控型的物件本來就在 ⇒ 回 1 什麼都不證明;**回 0 是決定性的**:\n'
  printf '      要嘛這個標記是假的(它其實不是補版控型), 要嘛那個物件被砍了。\n'
  printf '      ⇒ 📌 **下面每一格都要看 0, 不是看 1。** 這是「標記 vs 現實」唯一便宜的一道對帳。\n'
  printf '   🟠 **本支若已在 `supabase/APPLIED.tsv` 上, 那一列的意思是**:\n'
  printf '      「**記錄了物件在正式庫上**」, **不是**「這支檔被執行過」。\n'
  printf '      (-f8 2026-09-06 裁乙;那些列的第四欄開頭固定寫著這句。)\n'
  printf '   ✅ 要問的其他事:①這支檔的 `down` 跑得起來嗎 ②檔內有沒有【只有這支會寫】的字面\n'
  printf '      ③或者直接問平台帳本(`scripts/migration-ledger-divergence.sh`)。\n\n'
fi

# $1=物件字面  $2=非補版控型時的理由
verdict_new() {
  if [ "$DDLVC" = "1" ]; then
    printf '  🔴 %s\n     判別力【零】—— 本支是補版控型(`pcm:ddl-into-vc: %s`)⇒ 物件在正式庫上\n     是它被寫下來之前就有的, 「東西在」證不了「這支貼了」。\n' "$1" "$DDLVC_OBJ"
  else
    printf '  🟢 %s\n     判別力【有】—— %s\n' "$1" "$2"
  fi
}


# ── 帳本那一格(只印, 不當判準)────────────────────────────
# 🔴 `grep -c` 命中 0 時【印 0 而 rc=1】⇒ 加 `|| echo 0` 會印出「0\n0」, 而它讀起來像兩列。
#    那正是本 repo 記過的「一個合法的零會截斷 &&」同一族 ⇒ 用 `; true` 吞 rc, 不要補印。
LEDGER=$(grep -c "^$VER" "$REPO/supabase/APPLIED.tsv" 2>/dev/null; true)
printf '帳本 supabase/APPLIED.tsv 命中 %s 列\n' "$LEDGER"
printf '🛑 **這個數字不是判準** —— 同一夜實測三支都印 0, 而其中兩支已貼。\n'
printf '   帳本答的是「有沒有人【記】」, 不是「東西在不在」。\n\n'

# ── ① 抽物件 ──────────────────────────────────────────────
printf '──── ① 這支建了什麼(逐項標判別力)────\n'
FOUND=0

emit() { FOUND=$((FOUND+1)); printf '%s\n' "$1"; }

# 🔴🔴 **codex 2026-09-06 R1 MF2**:抽取器只認 `CREATE OR REPLACE FUNCTION`,
#    而 `20260902200000` 那支是**裸 `CREATE FUNCTION` ×3、`OR REPLACE` ×0**
#    ⇒ 它三支函式一個都沒被抽到 ⇒ 📌 對一支【專門在講三支函式】的檔產出零個有效查詢,
#    而畫面上印「抽不出任何物件」—— 那句話是對的, 而它把原因說成了檔案的問題。
# ✅ 裸 `CREATE FUNCTION`(沒有 OR REPLACE)⇒ 重複建會失敗 ⇒ 存在性**有**判別力,
#    與 `CREATE OR REPLACE` 是相反的一格。
# 新表 / 新 index / 新 policy / 新 view / 新 type / 裸 CREATE FUNCTION —— 存在性【有】判別力
grep -oE '^[[:space:]]*CREATE (UNIQUE )?(TABLE|INDEX|POLICY|VIEW|TYPE|SCHEMA|FUNCTION)[[:space:]]+(IF NOT EXISTS[[:space:]]+)?[A-Za-z0-9_."]+' "$NOCMT" 2>/dev/null \
| sed 's/^[[:space:]]*//' | sort -u | while IFS= read -r L; do
  verdict_new "$L" "這是新物件, 沒貼就不存在。"
done
CNT_NEW=$(grep -cE '^[[:space:]]*CREATE (UNIQUE )?(TABLE|INDEX|POLICY|VIEW|TYPE|SCHEMA|FUNCTION)' "$NOCMT" 2>/dev/null; true)
[ "$CNT_NEW" -gt 0 ] && FOUND=$((FOUND+CNT_NEW))

# CREATE OR REPLACE FUNCTION —— 存在性【零】判別力
grep -oE '^[[:space:]]*CREATE OR REPLACE FUNCTION[[:space:]]+[A-Za-z0-9_."]+' "$NOCMT" 2>/dev/null \
| sed 's/^[[:space:]]*//' | sort -u | while IFS= read -r L; do
  printf '  🔴 %s\n     判別力【零】—— 舊版新版都在。要問的是 **body 裡有沒有新版才有的字面**。\n' "$L"
done
CNT_COR=$(grep -cE '^[[:space:]]*CREATE OR REPLACE FUNCTION' "$NOCMT" 2>/dev/null; true)
[ "$CNT_COR" -gt 0 ] && FOUND=$((FOUND+CNT_COR))

# ADD CONSTRAINT + RENAME 舞步 —— 名字【零】判別力
CNT_REN=$(grep -cE 'RENAME CONSTRAINT' "$NOCMT" 2>/dev/null; true)
CNT_ADD=$(grep -cE 'ADD CONSTRAINT' "$NOCMT" 2>/dev/null; true)
if [ "$CNT_ADD" -gt 0 ]; then
  FOUND=$((FOUND+CNT_ADD))
  grep -oE 'ADD CONSTRAINT[[:space:]]+[A-Za-z0-9_]+' "$NOCMT" | sort -u | while IFS= read -r L; do
    if [ "$CNT_REN" -gt 0 ]; then
      printf '  🔴 %s\n     判別力【零】—— 本檔有 RENAME CONSTRAINT ⇒ 貼完之後名字跟貼之前【一樣】。\n' "$L"
      printf '     要問的是 **約束定義裡有沒有新值**。\n'
    else
      verdict_new "$L" "沒有 RENAME ⇒ 這個名字是新的。"
    fi
  done
fi

# ADD COLUMN —— 有判別力
grep -oE 'ADD COLUMN[[:space:]]+(IF NOT EXISTS[[:space:]]+)?[A-Za-z0-9_]+' "$NOCMT" 2>/dev/null | sort -u | while IFS= read -r L; do
  verdict_new "$L" "新欄位, 沒貼就不存在。"
done
CNT_COL=$(grep -cE 'ADD COLUMN' "$NOCMT" 2>/dev/null; true)
[ "$CNT_COL" -gt 0 ] && FOUND=$((FOUND+CNT_COL))

if [ "$FOUND" -eq 0 ]; then
  NO_OBJECT=1
  printf '  ⚠️ **這支我抽不出任何物件** ⇒ 請人工開檔看。\n'
  printf '     (它可能是純 DO 區塊 / 動態 DDL / 只有 COMMENT / 只有資料異動)\n'
  printf '     🛑 本支【不猜】—— 一個猜出來的判別點比沒有判別點糟。\n\n'
fi
printf '\n'

# ── ② 新字面啟發式 ────────────────────────────────────────
printf '──── ② 新字面(啟發式, 依據印在旁邊)────\n'
printf '判法:本檔裡的單引號字面, 逐個去【比本檔早的所有 migration】裡找;\n'
printf '      一個都找不到的 ⇒ 它很可能就是這支新加的值。\n'
printf '🛑 這是【猜的】。它會漏(新值剛好在舊檔的註解裡出現過)也會多(無關的新字串)。\n'
printf '   ⇒ 底下每一個候選都要你自己開檔核, 而依據就是它們為什麼被選中。\n\n'
NOVEL=""
# 🔴 2026-09-03 改:原本【每個字面】都重掃一次全部 migration ⇒ O(字面 × 檔案)
#    ⇒ 實測 11 支跑不完 2 分鐘。✅ 改成先串成【一份語料】, 每個字面只查那一份。
CORPUS="${TMPDIR:-/tmp}/is-applied-corpus-$VER.txt"
: > "$CORPUS"
for OLD in "$MIGDIR"/*.sql; do
  OV=$(basename "$OLD" | sed 's/_.*//')
  [ "$OV" -lt "$VER" ] 2>/dev/null || continue
  cat "$OLD" >> "$CORPUS"
done
for LIT in $(grep -oE "'[a-z][a-z0-9_]{3,40}'" "$NOCMT" | sort -u | tr -d "'"); do
  if grep -q "'$LIT'" "$CORPUS" 2>/dev/null; then continue; fi
  printf '  🔵 候選新字面: %s\n' "$LIT"
  NOVEL="$NOVEL $LIT"
done
[ -n "$NOVEL" ] || printf '  ⚠️ 找不到任何「早於本檔的 migration 都沒出現過」的字面。\n     ⇒ 這支的新東西可能不是一個字串 ⇒ 請人工開檔看。\n'
printf '\n'

# ── ③ 產出唯讀 SQL ────────────────────────────────────────
OUT="${TMPDIR:-/tmp}/is-applied-$VER.sql"
{
printf -- '-- 「%s 貼了沒」唯讀查詢 —— 由 scripts/is-migration-applied.sh 產生\n' "$BASE"
printf -- '-- 🛑 零寫入, 可安全重跑。每一格都附【兩個世界的期望值】。\n'
printf -- '-- 🔴 回 0 之前先看正對照:正對照不對, 那個 0 是尺沒接上, 不是「沒貼」。\n\n'

# ══ 🟢 全域正對照(2026-09-07;auth 量到本支【只有受測格 + 負對照】)═══════════
#   病:負對照證的是「這把尺不會亂命中」, **它不證「這把尺接得上」**。
#   ⇒ 受測格回 1 的世界有兩種:①真的已貼 ②尺根本沒接上而它剛好也印 1(例如查錯 schema)。
#   📌 **一個 0 要帶兩個鄰居出門:一個證它會分辨(負對照), 一個證它接得上(正對照)。**
#   ✅ 取法:預設從 `supabase/APPLIED.tsv` 最後一支【已貼】的 migration 裡挑第一個新建物件;
#      也可以用 `--positive <schema.名>` 明寫。取不到 ⇒ **明說取不到**, 不靜默略過。
if [ -n "${POSITIVE_OBJ:-}" ]; then
  _POS="$POSITIVE_OBJ"; _POS_SRC="--positive 指定"
else
  _POS=""; _POS_SRC=""
  _LEDGER="supabase/APPLIED.tsv"
  if [ -f "$_LEDGER" ]; then
    _LASTV=$(awk 'NR>1 && $1 ~ /^[0-9]{14}$/ {v=$1} END{print v}' "$_LEDGER" 2>/dev/null)
    if [ -n "$_LASTV" ]; then
      _LASTF=$(ls -1 supabase/migrations/"$_LASTV"_*.sql 2>/dev/null | head -1)
      if [ -n "$_LASTF" ]; then
        _POS=$(grep -oE '^[[:space:]]*CREATE (FUNCTION|TABLE|VIEW)[[:space:]]+(IF NOT EXISTS[[:space:]]+)?[A-Za-z0-9_.]+' "$_LASTF" 2>/dev/null \
               | sed -E 's/.*(FUNCTION|TABLE|VIEW)[[:space:]]+//; s/^IF NOT EXISTS[[:space:]]+//' | head -1)
        # 🔵 用 `if` 而不是 `cmd && cmd` 收尾 —— 讀起來清楚, 而**它不是為了修什麼**。
        # 🔴🔴 **留一句訂正給下一個人**:我一度把 commit 當下三格 selftest 轉紅
        #    歸因成「本檔 `set -e` 把 `&&` 的 rc=1 當成失敗」——
        #    ⛔ **那個解釋是錯的**:本檔只有 `set -u`(`:30`), 沒有 `set -e`。
        #    🔬 A/B 實測(同一台、連續兩發):`&&` 版 46/46 綠 · `if` 版 46/46 綠
        #      ⇒ **兩個世界印一樣的東西 ⇒ 那不是成因。**
        #    ⇒ 當下真正發生的事:同一輪 lint-staged 裡另有腳本被 **SIGKILL**(閘自己印了),
        #      而那一輪的紅【沒有給出答案】。📌 **一個講得通的錯誤故事, 比「我不知道」更難被推翻。**
        if [ -n "$_POS" ]; then _POS_SRC="帳本最後一支已貼 $_LASTV 裡的第一個新建物件"; fi
      fi
    fi
  fi
fi
if [ -n "$_POS" ]; then
  _PSCH=$(printf '%s' "$_POS" | awk -F. 'NF>1{print $1} NF==1{print "public"}')
  _PNM=$(printf '%s' "$_POS" | awk -F. '{print $NF}')
  printf -- '-- 🟢 **全域正對照**(來源:%s)—— 它【必須】回 1。\n' "$_POS_SRC"
  printf -- '--    回 0 ⇒ 這把尺沒接上(schema 錯 / 連錯庫 / 權限)⇒ **下面每一格的 0 都不算數**。\n'
  printf -- "SELECT '正對照 %s 存在(期望1)' AS 格, count(*)::text AS 值\n" "$_POS"
  printf -- "  FROM (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace\n         WHERE n.nspname='%s' AND p.proname='%s'\n        UNION ALL\n        SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace\n         WHERE n.nspname='%s' AND c.relname='%s') t;\n\n" "$_PSCH" "$_PNM" "$_PSCH" "$_PNM"
  printf -- '-- 🔵 **全域負對照** —— 現造物件名, 必須回 0。回非 0 ⇒ 這把尺會亂命中。\n'
  printf -- "SELECT '負對照 現造物件名(期望0)' AS 格, count(*)::text AS 值\n"
  printf -- "  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace\n WHERE n.nspname='public' AND c.relname='zzz_no_such_object_xyz';\n\n"
else
  printf -- '-- 🔴🔴 **取不到全域正對照** —— 帳本讀不到最後一支已貼 migration, 或那支裡沒有新建物件。\n'
  printf -- '--    ⇒ 下面每一格的 0 **都缺一個「尺接得上」的證據**。\n'
  printf -- "--    ⇒ 自己補:`bash scripts/is-migration-applied.sh <版本號> --positive <schema.物件名>`\n\n"
fi
# 🔴🔴 **codex 2026-09-06 R1 MF1**:第一版只把【畫面上】的判別力改掉, 而**產出的 SQL 裡
#    逐字還寫著「1=已貼」**⇒ 📌 拿去跑的人看到的是那份 SQL, 不是我的畫面。
#    ⇒ 一個被降級的結論, 在它真正會被讀到的那個載體上完全沒有降級。
if [ "$DDLVC" = "1" ]; then
  printf -- '-- 🟠🟠 **這支是【補版控型】**(檔頭 -- pcm:ddl-into-vc: %s)\n' "$DDLVC_OBJ"
  printf -- '-- 🛑 **下面每一格「存在」查詢對「這支貼了沒」都是【零判別力】** ——\n'
  printf -- '--    它建的物件在正式庫上是【這支檔被寫下來之前】就有的 ⇒ 回 1 是【預期】,\n'
  printf -- '--    而回 1 **證不了任何事**。⛔ 不要把下面任何一個 1 讀成「已貼」。\n'
  printf -- '-- 🔴🔴 **看【0】不要看 1** —— 補版控型的物件本來就在 ⇒ 回 1 什麼都不證明;\n'
  printf -- '--    **回 0 是決定性的**:要嘛這個標記是假的(它其實不是補版控型),\n'
  printf -- '--    要嘛那個物件被砍了。⇒ 這是「標記 vs 現實」唯一便宜的一道對帳, 跑完請看它。\n'
  printf -- '-- 🟠 帳本上若有本支那一列, 它的意思是「記錄了物件在」, **不是**「這支檔被執行過」。\n'
  printf -- '-- ✅ 要問的其他事:①這支的 down 跑不跑得起來 ②檔內有沒有【只有這支會寫】的字面\n'
  printf -- '--    ③或直接問平台帳本(scripts/migration-ledger-divergence.sh)。\n\n'
fi
# 🔴 **結果標籤也要降級** —— `SELECT '… 存在(1=已貼)' AS 格` 裡那句話, 是跑的人在
#    結果表上**真正看到的字**。註解降級而標籤沒降 ⇒ 他看到的仍然是「1=已貼」。
if [ "$DDLVC" = "1" ]; then LBL='補版控型:回1是預期, 回0才是訊號'; else LBL='1=已貼'; fi

# $1 = 非補版控型時要印的判別註解
verdict_sql() {
  if [ "$DDLVC" = "1" ]; then
    printf -- '-- 🟠 判別【零】(補版控型 pcm:ddl-into-vc)—— 回 1 是預期, 證不了「已貼」。\n'
  else
    printf -- '%s' "$1"
  fi
}
grep -oE '^[[:space:]]*CREATE OR REPLACE FUNCTION[[:space:]]+[A-Za-z0-9_.]+' "$NOCMT" 2>/dev/null | sed 's/.*FUNCTION[[:space:]]*//' | sort -u | while IFS= read -r FN; do
  SCH=$(printf '%s' "$FN" | cut -d. -f1); NM=$(printf '%s' "$FN" | cut -d. -f2)
  printf -- '-- 🔵 正對照:函式在不在(期望 1)。回 0 ⇒ 尺沒接上。\n'
  printf -- "SELECT '正對照 %s 存在(期望1)' AS 格, count(*)::text AS 值\n" "$FN"
  printf -- "  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace\n WHERE n.nspname='%s' AND p.proname='%s';\n\n" "$SCH" "$NM"
  # 🔴🔴 **候選只能取自【函式 body 內】, 不是整個檔** —— 2026-09-03 實測:
  #    20260828060000 的檔案裡有一個 md5 `b5a7681b…`, 它住在**註解與 apply 斷言**裡、
  #    **不在 body**(`sed -n '189,282p' | grep -c` ⇒ 0)。
  #    ⇒ 拿它去問 `pg_get_functiondef` 會回 **0**, 而那個 0 是【它本來就不該在那裡】,
  #      不是「沒貼」⇒ 📌 **一格合理的 0, 會把讀的人推向相反的結論。**
  # ✅ 所以下面用 body 區間(CREATE OR REPLACE FUNCTION 那一行起, 到 `$` 收尾)裡的字面。
  BODY_LITS=$(sed -n "/^[[:space:]]*CREATE OR REPLACE FUNCTION[[:space:]]*$FN/,/^[[:space:]]*\\\$[a-z]*\\\$;/p" "$FILE" \
    | grep -oE "'[a-z][a-z0-9_-]{3,40}'" | tr -d "'" | sort -u)
  [ -n "$BODY_LITS" ] || printf -- '-- ⚠️ body 裡抽不到字面 ⇒ 這一支要人工挑判別點。\n\n'
  for LIT in $BODY_LITS; do
    # 🔴 **codex R2**:降級第一版沒套到 body 這條路 ⇒ 它仍硬寫「1=已貼」,
    #    而 selftest 只用 table+column ⇒ 同型的錯全綠。
    verdict_sql '-- 🔴 判別:body 含新版才有的字面(1=已貼 / 0=沒貼)
'
    printf -- "SELECT 'body 含 %s(%s)' AS 格, count(*)::text AS 值\n" "$LIT" "$LBL"
    printf -- "  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace\n WHERE n.nspname='%s' AND p.proname='%s'\n   AND pg_catalog.pg_get_functiondef(p.oid) LIKE '%%%s%%';\n\n" "$SCH" "$NM" "$LIT"
  done
  printf -- '-- 🔴🔴 **最終判準是這一格, 不是上面那些單一字面** ——\n'
  printf -- '--    上面每個字面都可能【舊版也有】(例 failed / unpaid)⇒ 回 1 不代表已貼。\n'
  printf -- '--    ⇒ 把下面這段定義, 拿去跟這支 migration 裡那段 CREATE OR REPLACE 逐字比。\n'
  printf -- "SELECT '函式定義全文(拿去跟 migration 逐字比)' AS 格,\n       pg_catalog.pg_get_functiondef(p.oid) AS 值\n  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace\n WHERE n.nspname='%s' AND p.proname='%s';\n\n" "$SCH" "$NM"
  printf -- '-- 🔵 負對照:同一把尺找一個現造字面(期望 0)。回非 0 ⇒ LIKE 寫壞了。\n'
  printf -- "SELECT '負對照 現造字面(期望0)' AS 格, count(*)::text AS 值\n"
  printf -- "  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace\n WHERE n.nspname='%s' AND p.proname='%s'\n   AND pg_catalog.pg_get_functiondef(p.oid) LIKE '%%zzq_not_a_real_token_9f%%';\n\n" "$SCH" "$NM"
done
# ── 🔴🔴 **codex 2026-09-06 R2**:MF2 我只把裸 `CREATE FUNCTION` 加進【畫面的清單】,
#    而**SQL 產生器仍只處理 `CREATE OR REPLACE`** ⇒ `20260902200000` 那支三函式的檔
#    產出的 SQL 裡 `^SELECT` **= 0 行**。⇒ 📌 **同一個病我修了它的第一層, 而它有兩層。**
#    (R1 說「產出 0 個有效查詢」, 我讀成了「清單抽不到」—— 而那是同一句話的兩種讀法。)
grep -oE '^[[:space:]]*CREATE FUNCTION[[:space:]]+[A-Za-z0-9_.]+' "$NOCMT" 2>/dev/null \
| sed 's/.*FUNCTION[[:space:]]*//' | sort -u | while IFS= read -r FN; do
  SCH=$(printf '%s' "$FN" | awk -F. 'NF>1{print $1} NF==1{print "public"}')
  NM=$(printf '%s' "$FN" | awk -F. '{print $NF}')
  verdict_sql '-- 🟢 判別:這支函式在不在(1=已貼 / 0=沒貼)。裸 CREATE(沒有 OR REPLACE)⇒ 重複建會失敗 ⇒ 存在性【有】判別力。
'
  printf -- "SELECT '函式 %s 存在(%s)' AS 格, count(*)::text AS 值\n  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace\n WHERE n.nspname='%s' AND p.proname='%s';\n\n" "$FN" "$LBL" "$SCH" "$NM"
  printf -- '-- 🔵 負對照:現造函式名(期望 0)。回非 0 ⇒ 這把尺沒接上。\n'
  printf -- "SELECT '負對照 現造函式名(期望0)' AS 格, count(*)::text AS 值\n  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace\n WHERE n.nspname='%s' AND p.proname='zzq_not_a_real_fn_9f';\n\n" "$SCH"
done
# ── 新物件(表 / view / index / policy / 新欄)—— 存在性【有】判別力, 一發查完 ──────
# 🔴 2026-09-03 補:本段原本【不存在】⇒ 對「新物件」型的 migration 產出的是一個【只有檔頭的空檔】,
#    而它照樣印「唯讀 SQL 已產出」⇒ 📌 一個空的產物, 長得跟成功一模一樣。
grep -oE '^[[:space:]]*CREATE (TABLE|VIEW|MATERIALIZED VIEW)[[:space:]]+(IF NOT EXISTS[[:space:]]+)?[A-Za-z0-9_.]+' "$NOCMT" 2>/dev/null \
| sed -E 's/.*(TABLE|VIEW)[[:space:]]+(IF NOT EXISTS[[:space:]]+)?//' | sort -u | while IFS= read -r T; do
  SCH=$(printf '%s' "$T" | awk -F. 'NF>1{print $1} NF==1{print "public"}')
  NM=$(printf '%s' "$T" | awk -F. '{print $NF}')
  verdict_sql '-- 🟢 判別:這張表/view 在不在(1=已貼 / 0=沒貼)。新物件 ⇒ 存在性【有】判別力。
'
  printf -- "SELECT '表/view %s 存在(%s)' AS 格, count(*)::text AS 值\n  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace\n WHERE n.nspname='%s' AND c.relname='%s';\n\n" "$T" "$LBL" "$SCH" "$NM"
  # 🔵 2026-09-03 註:這個正對照刻意用 `public.orders`(我們自己的表)而不是一個【任何 PG 都有】的物件。
  #   理由:它要答的是「這把尺指到【我們的庫】了嗎」——
  #   拿 `pg_class` 之類當正對照的話, 對著一個**空的陌生庫**也會過 ⇒ 那把尺就沒有判別力了。
  #   ⚠️ 代價:在**拋棄式 PG**上跑, 這一格會回 0 ⇒ 而那是【正確行為】(它在說:這不是那個庫)。
  printf -- '-- 🔵 正對照:同一把尺去找一張【一定在】的表(期望 1)。回 0 ⇒ 尺沒接上, 上面那個 0 不算數。\n'
  printf -- "SELECT '正對照 public.orders 存在(期望1)' AS 格, count(*)::text AS 值\n  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace\n WHERE n.nspname='public' AND c.relname='orders';\n\n"
  printf -- '-- 🔵 負對照:現造名(期望 0)。\n'
  printf -- "SELECT '負對照 現造表名(期望0)' AS 格, count(*)::text AS 值\n  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace\n WHERE n.nspname='public' AND c.relname='zzq_not_a_real_table_9f';\n\n"
done
grep -oE '^[[:space:]]*CREATE (UNIQUE )?INDEX[[:space:]]+(IF NOT EXISTS[[:space:]]+)?[A-Za-z0-9_]+' "$NOCMT" 2>/dev/null \
| sed -E 's/.*INDEX[[:space:]]+(IF NOT EXISTS[[:space:]]+)?//' | sort -u | while IFS= read -r IX; do
  verdict_sql '-- 🟢 判別:這個索引在不在(1=已貼 / 0=沒貼)。
'
  printf -- "SELECT '索引 %s 存在(%s)' AS 格, count(*)::text AS 值\n  FROM pg_catalog.pg_class WHERE relname='%s' AND relkind='i';\n\n" "$IX" "$LBL" "$IX"
  # 🔴 2026-09-03 補:本型原本【沒有正對照】⇒ 一個 0 分不出「沒貼」與「尺沒接上」。
  printf -- '-- 🔵 正對照:同一把尺去找一個【一定在】的索引(期望 >=1)。回 0 ⇒ 尺沒接上。\n'
  printf -- "SELECT '正對照 public 底下的索引數(期望>0)' AS 格, count(*)::text AS 值\n  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace\n WHERE c.relkind='i' AND n.nspname='public';\n\n"
done
# 🔴🔴 **POLICY 這一型 2026-09-03 之前是【壞的】, 而它往危險那一側單向壞掉。**
#   舊寫法 `"?[A-Za-z0-9_ ]+"?` 的字元類裡**有一個空白** ⇒ 它把
#   `CREATE POLICY <名> ON public.<表>` 抓成 `<名> ON public`
#   ⇒ `polname='<名> ON public'` ⇒ 🔴 **在【已貼】與【沒貼】兩個世界都回 0。**
#   ⇒ 📌 一把只會印「沒貼」的尺, 會讓人去【重貼一支已經貼過的東西】—— 而那是對正式庫的寫入。
#   ✅ 改法:名字與表分開抓, 並 join pg_class/pg_namespace 比對真正的 polname + 所在表。
grep -oE '^[[:space:]]*CREATE POLICY[[:space:]]+"?[A-Za-z0-9_]+"?[[:space:]]+ON[[:space:]]+[A-Za-z0-9_."]+' "$NOCMT" 2>/dev/null \
| sed -E 's/.*POLICY[[:space:]]+//; s/"//g' | sort -u | while IFS= read -r PAIR; do
  PO=$(printf '%s' "$PAIR" | awk '{print $1}')
  REL=$(printf '%s' "$PAIR" | awk '{print $3}')
  SCH=$(printf '%s' "$REL" | awk -F. 'NF>1{print $1} NF==1{print "public"}')
  TBL=$(printf '%s' "$REL" | awk -F. '{print $NF}')
  verdict_sql '-- 🟢 判別:這條 policy 在不在(1=已貼 / 0=沒貼)。新物件 ⇒ 存在性【有】判別力。
'
  printf -- "SELECT 'policy %s ON %s.%s 存在(%s)' AS 格, count(*)::text AS 值\n  FROM pg_catalog.pg_policy p\n  JOIN pg_catalog.pg_class c ON c.oid=p.polrelid\n  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace\n WHERE n.nspname='%s' AND c.relname='%s' AND p.polname='%s';\n\n" "$PO" "$SCH" "$TBL" "$LBL" "$SCH" "$TBL" "$PO"
  printf -- '-- 🔵 正對照:那張表存在且開了 RLS(期望 t)。不是 t ⇒ 上面那個 0 不算數。\n'
  printf -- "SELECT '正對照 %s.%s 存在且開 RLS(期望t)' AS 格, c.relrowsecurity::text AS 值\n  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace\n WHERE n.nspname='%s' AND c.relname='%s';\n\n" "$SCH" "$TBL" "$SCH" "$TBL"
  printf -- '-- 🔵 負對照:現造政策名(期望 0)。\n'
  printf -- "SELECT '負對照 現造政策名(期望0)' AS 格, count(*)::text AS 值\n  FROM pg_catalog.pg_policy WHERE polname='zzq_no_such_policy_9f';\n\n"
done
grep -oE 'ADD COLUMN[[:space:]]+(IF NOT EXISTS[[:space:]]+)?[A-Za-z0-9_]+' "$NOCMT" 2>/dev/null \
| sed -E 's/.*COLUMN[[:space:]]+(IF NOT EXISTS[[:space:]]+)?//' | sort -u | while IFS= read -r CO; do
  TBL=$(grep -B4 "ADD COLUMN[[:space:]]*\(IF NOT EXISTS[[:space:]]*\)\?$CO" "$NOCMT" | grep -oE 'ALTER TABLE[[:space:]]+[A-Za-z0-9_.]+' | tail -1 | sed 's/.*TABLE[[:space:]]*//;s/.*\.//')
  verdict_sql '-- 🟢 判別:這個新欄在不在(1=已貼 / 0=沒貼)。
'
  printf -- "SELECT '欄 %s.%s 存在(%s)' AS 格, count(*)::text AS 值\n  FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid\n WHERE c.relname='%s' AND a.attname='%s' AND a.attnum > 0 AND NOT a.attisdropped;\n\n" "${TBL:-?}" "$CO" "$LBL" "${TBL:-?}" "$CO"
  printf -- '-- 🔵 正對照:同一張表上一個【一定在】的欄(期望 1)。回 0 ⇒ 表名抽錯了。\n'
  printf -- "SELECT '正對照 %s.id 存在(期望1)' AS 格, count(*)::text AS 值\n  FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid\n WHERE c.relname='%s' AND a.attname='id' AND a.attnum > 0;\n\n" "${TBL:-?}" "${TBL:-?}"
done
grep -oE 'ADD CONSTRAINT[[:space:]]+[A-Za-z0-9_]+' "$NOCMT" 2>/dev/null | sed 's/.*CONSTRAINT[[:space:]]*//' | sort -u | while IFS= read -r CN; do
  REAL=$(printf '%s' "$CN" | sed 's/_v[0-9]*$//')
  printf -- '-- 🔵 正對照:約束在不在(期望 1)。\n'
  printf -- "-- 🛑 注意本檔有 RENAME ⇒ 貼完之後名字是 %s(不是 %s)⇒ 這一格【零判別力】, 只證尺接上了。\n" "$REAL" "$CN"
  printf -- "SELECT '正對照 約束 %s 存在(期望1)' AS 格, count(*)::text AS 值\n  FROM pg_catalog.pg_constraint WHERE conname='%s';\n\n" "$REAL" "$REAL"
  printf -- '-- 🔴 判別:約束定義的【全文】—— 自己看新值在不在(本支不替你判)\n'
  printf -- "SELECT '約束定義全文' AS 格, pg_catalog.pg_get_constraintdef(oid) AS 值\n  FROM pg_catalog.pg_constraint WHERE conname='%s';\n\n" "$REAL"
  # 🔴🔴 **CHECK 這一族【不用】上面那個新字面啟發式** —— 2026-09-03 實測它會漏, 而且安靜:
  #    20260902120000 加的是 'order_cancelled', 而那個字面早在
  #    20260810010000(完全不同的語境)出現過 ⇒ 啟發式把它濾掉 ⇒ **候選裡沒有正確答案**。
  #    ⇒ 📌 一個會漏而不出聲的判別點, 比沒有判別點糟。
  # ✅ 改法:把**這一條 CHECK 裡的每一個值**都問一遍, 不篩。多問幾格不花錢, 漏掉那一格會給錯答案。
  for LIT in $(grep -A3 "ADD CONSTRAINT[[:space:]]*$CN" "$NOCMT" | grep -oE "'[a-z][a-z0-9_]*'" | tr -d "'" | sort -u); do
    # 🔴 codex R2:constraint 這條路同樣沒降級。
    printf -- "SELECT '定義含 %s(該有=1;%s)' AS 格, count(*)::text AS 值\n  FROM pg_catalog.pg_constraint\n WHERE conname='%s' AND pg_catalog.pg_get_constraintdef(oid) LIKE '%%%s%%';\n\n" "$LIT" "$LBL" "$REAL" "$LIT"
  done
  printf -- '-- 🔴 判讀:上面那組值【全部都是 1】才是已貼。少任何一個 ⇒ 正式庫是舊版。\n'
  printf -- '-- 🛑 而【值是子字串】的陷阱:order_cancelled 是 order_unpaid_cancelled 的一部分\n'
  printf -- "--    ⇒ 新版貼了之後, 舊版那些值【也還是 1】。所以判準是【全部都 1】不是【某一個是 1】。\n"
  printf -- '--    ⇒ 而最終判準仍然是上面那一格【約束定義全文】—— 拿它跟這支 migration 的 CHECK 逐字比。\n\n'
  printf -- '-- 🔵 負對照(期望 0)\n'
  printf -- "SELECT '負對照 現造字面(期望0)' AS 格, count(*)::text AS 值\n  FROM pg_catalog.pg_constraint\n WHERE conname='%s' AND pg_catalog.pg_get_constraintdef(oid) LIKE '%%zzq_not_a_real_token_9f%%';\n\n" "$REAL"
done
} > "$OUT"

LINES=$(grep -c '' "$OUT")
WRITES=$(grep -ciE '^[[:space:]]*(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE)' "$OUT" 2>/dev/null; true)
# 🔴🔴 **[2026-09-08 線【信】`-mail`]** 抽不出物件時, 本支【不產生任何看起來像答案的東西】。
#    病史:原本仍照印「路徑 / 行數 / 查詢條數 2」而 rc=0 ——
#    而那個 2 是【全域正對照 + 全域負對照】, 不是對這一支的查詢。
#    ⇒ 📌 輸出與「真的驗過而通過」印同一個東西:正對照 1 · 負對照 0 · rc=0。
#    🛑 而檔內原有的守門 `if [ "$SELECTS" -eq 0 ]` **結構上不會叫** ——
#       全域對照本身就是兩個 SELECT ⇒ SELECTS 永遠 >= 2。
#       📌 這是本檔同一個病的第二次(第一次是 `LINES -le 3`, 見下方註解)。
#    🔬 實測:抽不出物件的 20260829180000 / 20260907230000 ⇒ 查詢條數皆 2;
#            抽得出物件的 20260908000000 ⇒ 5。⚪ 兩個世界印不同的數。
#    ✅ rc=4 = 【我答不出來】—— 與 0(答了)、2(die)都不同。
if [ "${NO_OBJECT:-0}" = "1" ]; then
  printf '🛑🛑 **本支【沒有回答】「貼了沒」** —— 抽不出可查的物件。\n'
  printf '   ⇒ 這【不是】「未貼」, 也【不是】「已貼」, 是【這把尺答不出來】。\n'
  printf '   ⇒ 產出的 SQL 只有【全域正負對照】(證明尺接得上), 對這一支【零判別力】——\n'
  printf '      🔴 跑它會得到 正對照 1 · 負對照 0 · rc=0, 而那與「驗過而通過」長得一樣。\n'
  printf '   ✅ 要答這一支, 得【開檔找它自己的判別點】(例:ALTER COLUMN 的 DEFAULT 表達式 / COMMENT)。\n'
  printf '   📎 路徑仍留著供參考:%s\n' "$OUT"
  exit 4
fi
printf '──── ③ 唯讀 SQL 已產出 ────\n'
printf '  路徑 %s\n' "$OUT"
printf '  行數 %s · 寫入類語句 %s(必須是 0)\n' "$LINES" "$WRITES"
# 🔴 2026-09-03 訂正:原本判 `$LINES -le 3` —— 而光檔頭就 4 行 ⇒ **那道警告結構上永遠不會叫**。
#    📌 一道不會叫的警告, 與沒有那道警告, 在輸出上長得一模一樣。
#    ✅ 改成數【真的查詢】:SELECT 的條數。
SELECTS=$(grep -ci '^SELECT' "$OUT" 2>/dev/null; true)
printf '  查詢條數 %s\n' "$SELECTS"
if [ "$SELECTS" -eq 0 ]; then
  printf '  ⚠️ **這支我產不出有意義的查詢** ⇒ 上面 ① 抽不到可查的物件形狀。\n'
  printf '     ⇒ 請人工開檔看。**本支寧可說做不到, 不產一段看起來像答案的 SQL。**\n'
fi
printf '\n🔵 交給有 access 的人跑, 而叫他回報【每一格的值】不是一句「有/沒有」——\n'
printf '   一句判斷在兩個世界可以是同一句話, 一組值不會。\n'
