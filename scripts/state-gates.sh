#!/usr/bin/env bash
# state-gates.sh — 訂單狀態閘表產生器(backlog #481)
#
# 🔴 存在理由(2026-08-14):R 窗把一條 BLOCKER 呈給 Sean、他據此拍了板,
#    一小時後才發現那個場景**經由 RPC 根本走不到**(取消端只收未付款單、
#    付款端拒收有取消紀錄的單)。病根 = 查了「機制」沒查「可達性」,
#    而「哪支 RPC 在什麼條件下才允許」這件事**沒有任何地方查得到**。
#
# 🔴 為什麼不用 graphify(2026-08-14 主視窗實跑):
#    `graphify query "已付款的訂單還可以取消品項嗎"` → 4 nodes,全部來自
#    `docs/specs/*-prd.md`,允許條件零命中。graphify 答「誰跟誰有關係」,
#    不答「什麼條件下才允許」——而且它的答案來源是**文件**。
#    今天的病根正是「**文件寫的 ≠ 程式碼實際擋的**」。
#    ⇒ 本腳本**只認 supabase/migrations/*.sql 的程式碼逐字 + 行號**,不吃 docs/。
#    ⚠️ 2026-09-04 起再扣掉 never-apply 的那幾支(見下方掃描限度 1.)。
#
# 用法:  bash scripts/state-gates.sh          （寫到 docs/reference/order-state-gates.md）
#         bash scripts/state-gates.sh --stdout （只印,不寫檔）
#
# 🔴 掃描限度(表裡也會印一份,不要只寫在這裡):
#   1. 範圍 = `supabase/migrations/*.sql`,**扣掉檔頭前 20 行帶 `-- pcm:never-apply` 的那幾支**
#      (2026-09-04 加;⟦01-GENTABLEREADSREPO⟧ 乙)。**service_role 直接 UPDATE 繞得過本表**
#      （`20260611120000_m3_s2c_confirm_payment_rpc.sql:230` 自己就寫著這件事）
#      ⇒ 本表的強度是「**經由 RPC**」,不是「絕對」。
#   2. 閘的抽取是**字面比對**,不是 SQL 語意分析 ⇒ 它會漏掉「用變數繞一手」寫的閘。
#      表裡每一格都給行號,**判斷前請開檔看那一行**,不要只信本表。
#   3. 函式歸屬用「最近一個 CREATE FUNCTION 在我上面」推定,巢狀 DO block 內的字面可能被歸錯。

set -euo pipefail

cd "$(dirname "$0")/.."
MIG_DIR="supabase/migrations"
OUT="docs/reference/order-state-gates.md"
[ -d "$MIG_DIR" ] || { echo "找不到 $MIG_DIR(請在 repo 根執行)" >&2; exit 1; }

# ── ⟦01-GENTABLEREADSREPO⟧ 乙(2026-09-04 `-front`)────────────────────────────
# 🔴 **本表讀 repo, 讀不到「這支貼了沒」** —— 而下一節那一欄先前叫「live 那代」,
#    貼 SQL 的人會把它讀成【線上跑的那一代】。實錘:那一欄依序指過
#    `20260904010000`(標 pcm:never-apply, **永遠不會貼**)⇒ 再指 `20260904030000`(當時還沒貼)
#    ⇒ 📌 **兩次都不是線上那一代。**
# 🔵 這裡治得掉的是後者的一半:標了 `pcm:never-apply` 的檔**不可能是任何一代 live**
#    ⇒ 從世代排名裡拿掉。
# 🛑 **而「排除」不留痕會製造一個新的盲區** —— 一支檔從表上消失, 與它不存在長得一樣
#    ⇒ 表尾把排除清單印出來。**排除與那份清單成對, 不可只取前半。**
# 🔴 **標記的定義照抄既有讀者, 不要自己發明一個**:`scripts/migration-ledger-divergence.sh:222-224`
#    逐字「限定前 20 行是刻意的 —— 一支檔中段的註解提到這個字面(例如在解釋這個機制)
#    不該把它自己變成 never-apply ⇒ 標記是【宣告】, 不是【提及】」。
#    ⚠️ **今天兩種算法都印 4**(四支的 marker 依 glob 序分別在第 4/4/5/1 行)⇒ 這個差異**現在無聲**,
#    而它會在有人寫一支「中段討論這個標記」的 migration 那天靜靜地多排除一支。
NEVER_APPLY=()
APPLICABLE=()
for _sgf in "$MIG_DIR"/*.sql; do
  # 🔴 **不用管線** —— `set -o pipefail` 下 `head -20 | grep -q` 在 head 撐爆 pipe buffer 時 rc=141
  #    ⇒ 該檔被【靜靜】歸成 APPLICABLE = fail-open, 而 fail-open 正是本片要修的那個病。
  #    ⇒ 照抄 `migration-ledger-divergence.sh:233-238` 的形狀(命令替換 + case), 結構上沒有管線。
  #    ⚠️ 今天不可達(全 repo 前 20 行最大 4,135 bytes), 而「不可達」不是「不會發生」。
  case "$(head -20 "$_sgf")" in
    *"-- pcm:never-apply"*)
      NEVER_APPLY+=("$_sgf") ;;
    *)
      APPLICABLE+=("$_sgf") ;;
  esac
done
# Nit(reviewer):bash 3.2 + `set -u` 下, 空陣列展開 "${A[@]}" 會 unbound。
# 只在「285 支全是 never-apply」時可達, 而 fail-open 比 fail-closed 糟 ⇒ 明講而不是靜靜過去。
[ ${#APPLICABLE[@]} -gt 0 ] || { echo "state-gates: 沒有任何一支可用的 migration(全被 never-apply 排除?)" >&2; exit 1; }

# 狀態寫入動作(= 這支函式會改什麼狀態)
WRITE_PAT='SET payment_status|SET cancelled_at|INSERT INTO public\.order_cancellation_items|INSERT INTO public\.order_cancellations|INSERT INTO public\.order_refunds|UPDATE public\.order_refunds'
# 允許集合(= 什麼條件下才准)
# 🔴 刻意不用括號與引號寫這條 —— awk 的 ERE 對 `\(` 的處理各版本不一致(第一版就炸在這)。
# ⚠️ **刻意不含 `RAISE EXCEPTION`**:第一版含它,結果把函式後面 DO block 裡的
#    二十幾行「結構斷言」也一起拉進來(它們也 RAISE)⇒ 訊噪比爛到看不出重點。
#    守門的**條件**(`payment_status <> …` / `cancelled_at IS …`)才是要看的東西,
#    RAISE 只是它的動作。條件在,就答得出「什麼情況下不准」。
GATE_PAT="payment_status <>|payment_status =|cancelled_at IS|order_cancellations|status <> .failed|NOT IN .+paid"

emit() {
  cat <<'HEADER'
# 訂單狀態閘表(自動產生 —— 不要手改)

> 產生指令:`bash scripts/state-gates.sh`。**改了 migration 就重跑**,不要手工維護。
> 用途 = 回答「**這條路走得到嗎**」。寫 finding、寫 plan、判 BLOCKER 之前先查這張表。
>
> 🔴 **強度 = 「經由 RPC」,不是「絕對」。** service_role 可以直接 UPDATE 繞過下面所有閘
> (`supabase/migrations/20260611120000_m3_s2c_confirm_payment_rpc.sql:230` 逐字寫著這件事)。
> 🔴 **閘是字面比對抽出來的,不是 SQL 語意分析** ⇒ 可能漏掉「用變數繞一手」寫的閘。
> **每一格都附行號:下判斷前開檔看那一行,不要只信本表。**
> 🔴 **`docs/` 一律不採信** —— 本表只讀 `supabase/migrations/*.sql`,
> ⛔ ~~而且是全部~~ **不是全部**:帶 `-- pcm:never-apply` 的檔被排除了 ——
> **若這次有排除到, §一 末尾會逐支列出;那裡沒有清單就代表這次一支都沒排除。**
> (刻意寫成兩個世界都成立的句子:上一版無條件指到一份有條件才印的清單, 空世界時它是懸空的。)
> 今天的病根就是「文件寫的 ≠ 程式碼實際擋的」;文件有述而 code 找不到的,本表標「**docs 有述、code 未見**」。
>
> 🔴 **2026-08-27 修過一個抽取 bug(給下一個撞到同族的人)**:當 migration 檔名自己含 `public.<字>`
>   (如 `..._page_public.sql` 內含子字串 `public.sql`),舊版 awk 用裸 `public.` match、又撞到 `grep -n`
>   加的檔名前綴,把兩個真函式抽成一個叫 `sql` 的假名。修法 = match 錨在 `FUNCTION public.`。
>   ⇒ 若日後表上又冒出看起來像真函式的怪名(例如 `orders`),**先看是不是又有檔名含 `public.<字>`** ——
>   那種碎片看起來完全正常,不會自己喊。

HEADER

  # ── 第一段:同名函式的世代(誰是 live)
  echo "## 一、同名函式被 CREATE OR REPLACE 過幾代(🔴 **最後一欄是 repo 裡最後一支, 不是線上**)"
  echo
  echo "| 函式 | 代數 | 各代 (檔:行) | 🔴 repo 裡最後一支(**不是線上**) |"
  echo "|---|---|---|---|"
  # 🔴 awk 的 match 錨在 `FUNCTION public.`(非裸 `public.`):grep -n 會加【檔名:行號:】前綴,
  #    若檔名含 public.<字>(如 ..._page_public.sql 內含 public.sql)會排在內容的 public.<fn> 前,
  #    裸 match 抽到檔名碎片(2026-08-27:search_catalog_by_vehicle / catalog_brand_counts 被抽成假名 sql)。
  grep -nE '^CREATE (OR REPLACE )?FUNCTION public\.[a-z_0-9]+' "${APPLICABLE[@]}" \
  | sed -E 's#^'"$MIG_DIR"'/##' \
  | awk -F: '{ match($0, /FUNCTION public\.[a-z_0-9]+/); fn=substr($0, RSTART+16, RLENGTH-16);
               key=fn; cnt[key]++; loc[key]=loc[key] (loc[key]==""?"":"<br>") $1 ":" $2; last[key]=$1 ":" $2 }
       END { for (k in cnt) if (cnt[k]>1) printf "| `%s` | **%d** | %s | `%s` |\n", k, cnt[k], loc[k], last[k] }' \
  | sort
  echo
  echo "> 只列 **>1 代**的。單代函式不會有「引用到過期世代」的風險,故省略。"
  echo
  echo "> 🔴 **最後一欄回答的是「repo 裡最後一支」,不是「正式庫現在跑的那一版」。**"
  echo "> ⚠️ 精確講, 它是 grep 串流的**最後一筆**(本腳本的 \`last[key]\`), 而不是「時間戳取 max」——"
  echo "> 兩者今天相等**只因為 grep 照參數序輸出、而參數是 glob 排序**。換一支行為不同的 grep 就不再相等。"
  echo "> 本腳本讀的是 \`supabase/migrations/*.sql\` —— 它看得到「檔案存在」(扣掉 never-apply 的那幾支),看不到「這支貼了沒」。"
  echo "> ✅ **要知道線上跑的是哪一代**:查 \`supabase/APPLIED.tsv\`,或用唯讀連線讀 \`pg_get_functiondef\`。"
  echo
  if [ ${#NEVER_APPLY[@]} -gt 0 ]; then
    echo "> 🔵 **本表(§一 與 §二 都是)已排除 ${#NEVER_APPLY[@]} 支標了 \`-- pcm:never-apply\` 的檔**(它們永遠不會貼 ⇒ 不可能是任何一代):"
    for _f in "${NEVER_APPLY[@]}"; do echo "> · \`$(basename "$_f")\`"; done
    echo "> ⚠️ **而排除治不了另一半**:一支「寫好了而還沒貼」的檔照樣會排在最後 ⇒ 照樣不是線上那一代。"
    echo
  fi
  echo

  # ── 第二段:每支函式改什麼狀態 + 它的允許集合
  echo "## 二、會改訂單狀態的函式 × 它的允許集合(逐字)"
  echo
  if [ ${#NEVER_APPLY[@]} -gt 0 ]; then
    echo "> 🔵 **本節與 §一 用同一份分母** —— 那 ${#NEVER_APPLY[@]} 支 \`-- pcm:never-apply\` 的檔也被排除了(清單在 §一 末尾)。"
    echo "> ⚠️ 意思是:**若那幾支檔裡有訂單狀態的閘, 它不會出現在下面**。今天它們對狀態寫入零命中, 所以這一句現在不產生任何差異。"
    echo
  fi

  # 🔵 §二 用同一份排除後的清單 —— never-apply 的檔裡的閘也不在正式庫裡。
  #    🔬 **今天實測是 no-op**:那 4 支對 WRITE_PAT 命中都是 0 ⇒ 本行【現在】不改變任何輸出,
  #    它擋的是「下一支 never-apply 的檔剛好會動訂單狀態」那個世界。
  for f in "${APPLICABLE[@]}"; do
    base="$(basename "$f")"
    grep -qE "$WRITE_PAT" "$f" || continue

    awk -v FN="$base" -v WP="$WRITE_PAT" -v GP="$GATE_PAT" '
      /^CREATE (OR REPLACE )?FUNCTION public\.[a-z_0-9]+/ {
        # 🔴 錨 FUNCTION public.(非裸 public.):這段逐檔讀、$0 不帶檔名前綴 ⇒ 今天無害,
        #    但錨它是為了不留「§一錨了、這裡沒錨」這種要解釋的差異(§一那個是真的會撞檔名)。
        match($0, /FUNCTION public\.[a-z_0-9]+/); cur = substr($0, RSTART+16, RLENGTH-16); curline = FNR
      }
      {
        line = $0
        gsub(/^[ \t]+/, "", line)
        gsub(/\|/, "\\|", line)
        # 🔴 **不要在這裡截字串。** 第一版寫 `substr(line,1,150)`,而 awk 的 substr 數的是
        #    **位元組不是字元** ⇒ 150 那一刀會把中文字剖成兩半 ⇒ 產出**無效 UTF-8**。
        #    症狀非常隱蔽:markdown 看起來正常、`sed` 印得出來,但 `grep` 對整個檔失效
        #    (`file` 會說 `Non-ISO extended-ASCII … NEL line terminators`)。
        #    ⇒ 一個「查得到東西」的表,變成 grep 查不動的表,而它看起來是好的。
      }
      $0 ~ WP && $0 !~ /^[ \t]*--/ {
        if (cur == "") cur = "(檔案層 DO block / 非函式內)"
        w[cur] = w[cur] (w[cur]==""?"":"<br>") "`:" FNR "` " line
        seen[cur] = 1
      }
      $0 ~ GP && $0 !~ /^[ \t]*--/ {
        if (cur != "") { g[cur] = g[cur] (g[cur]==""?"":"<br>") "`:" FNR "` " line; seen[cur] = 1 }
      }
      END {
        for (k in seen) {
          if (w[k] == "") continue
          printf "### `%s`  ·  `%s`\n\n", k, FN
          printf "**改什麼狀態**\n\n%s\n\n", w[k]
          if (g[k] == "") printf "**允許集合** — 🔴 **本函式體內零命中**(字面比對)⇒ 要嘛它沒有狀態閘、要嘛閘的寫法本腳本抓不到。**開檔確認,不要當成「沒有閘」。**\n\n"
          else printf "**允許集合(逐字)**\n\n%s\n\n", g[k]
        }
      }
    ' "$f"
  done

  echo "---"
  echo
  echo "## 三、自測:本表答得出「已付款的單能不能取消品項」嗎?"
  echo
  echo "把上面第二段裡 \`admin_cancel_order\` 與 \`admin_partial_cancel_order\` 的「允許集合」讀一次:"
  echo "若看得到 \`payment_status <> 'unpaid' … RAISE\`,答案就是**不能**。"
  echo "再讀 \`confirm_order_payment\` 的允許集合:若看得到 \`order_cancellations … RAISE\`,"
  echo "表示反向也封死(有取消紀錄的單不能再收款)⇒ **「已付款」與「有取消紀錄」經由 RPC 互斥。**"
  echo
  echo "🔴 **答不出來就是本腳本白做**,請當成 bug 回報,不要靠記憶補。"
}

if [ "${1:-}" = "--stdout" ]; then
  emit
else
  mkdir -p "$(dirname "$OUT")"
  emit > "$OUT.tmp"
  [ -s "$OUT.tmp" ] || { echo "產物是空的,拒絕覆蓋 $OUT" >&2; rm -f "$OUT.tmp"; exit 1; }

  # 🔴 守門①:產物必須是合法 UTF-8。
  #    起因 = 第一版用 awk `substr()` 截字串(數位元組不數字元)把中文剖半,
  #    產出的檔 markdown 看起來正常、sed 印得出來,**但 grep 對整個檔失效**
  #    ⇒ 一張「拿來查東西」的表變成查不動的表,而且看起來是好的。
  #    這道閘就是為了讓那種錯**當場紅**,而不是等到有人查不到才發現。
  #    ⚠️ **量具選擇有實測理由,不要換回 iconv**:第一版用
  #    `iconv -f UTF-8 -t UTF-8` 判定,結果**對合法檔也失敗**
  #    (macOS 回 `iconv(): Inappropriate ioctl for device`)⇒ 那是一道**恆紅**的閘。
  #    改用 `file(1)` —— 它就是當初真的把壞檔抓出來的那個量具
  #    (壞檔它說 `Non-ISO extended-ASCII text … NEL line terminators`,好檔說 `UTF-8 text`)。
  ENC="$(file -b "$OUT.tmp")"
  case "$ENC" in
    *UTF-8*|*ASCII*) : ;;
    *)
      echo "🔴 產物編碼異常(多半是某處截斷把多位元組字元剖半):$ENC" >&2
      mv "$OUT.tmp" "$OUT.bad"
      echo "壞檔留在 $OUT.bad 供診斷" >&2
      exit 1 ;;
  esac

  # 🔴 守門②:自測那三支關鍵函式在不在表裡。它們不在 = 掃描 pattern 又漏了,
  #    而本表的用途就是回答它們的問題 ⇒ 漏了就等於白做,必須當場紅。
  for must in confirm_order_payment admin_cancel_order admin_initiate_order_refund; do
    grep -q "$must" "$OUT.tmp" || {
      echo "🔴 自測失敗:表裡查無 \`$must\` ⇒ 掃描 pattern 漏了它,拒絕覆蓋 $OUT" >&2
      rm -f "$OUT.tmp"; exit 1; }
  done

  mv "$OUT.tmp" "$OUT"
  echo "已寫入 $OUT($(wc -l < "$OUT" | tr -d ' ') 行)"
fi
