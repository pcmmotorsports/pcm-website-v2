#!/bin/bash
# 片1/片1a:產生突變並逐發檢查【紅在哪一格】 🛑 拋棄式 PG, 不碰正式庫
# 🔴 ~~原字面「產生 24 發突變」~~ 作廢(codex R4 nit, 2026-08-28)—— 現在是 47 發 + 1 負對照。
#    📌 **發數不寫死在檔頭**:它每加一發就過期一次, 而過期時零機械訊號。
#    ⇒ 要現值就看它自己印的那一行「產生器 N 發 = 目錄 N 支」——**那一行是量的, 這一行是抄的。**
# 🔴 這支存在的理由:上一版的跑法只活在 shell 歷史裡, 而產生器活在 /tmp ——
#    我收攤時把它 rm 掉了, 那一刻 repo 的狀態變成「34 格全綠, 而沒有東西證明它們紅得起來」。
#    📌 一組突變的價值不在它跑過, 在【下一個人跑得起來】。
# 🔴 而檢查的是「紅在哪一格」不是「有沒有紅」——
#    只記後者, 一發打錯支的突變與一發紅在語法錯的突變都會被算成通過。
set -u
cd "$(dirname "$0")/../.." || exit 1
OUT=${1:-/tmp}
# 🔴 目錄不存在時, 產生器整支寫不出檔而 `ls` 回 0 ——
#    今天(2026-08-28)靠上面那道「我餵幾條 vs 它跑幾支」擋下來、rc=1。
#    ⚠️ 而值得記的是**它擋下的形狀**:輸出全是 `No such file or directory`,
#       如果只看「有沒有紅」, 這一輪與「全部通過」都不會有 ERROR: 字樣。
mkdir -p "$OUT" || exit 1
# 🔴 SKIPGEN=1 ⇒ 不重新產生, 直接跑 $OUT 裡現有的那些
#    (少了這個開關, 沒辦法餵它一組【故意壞掉的】突變來驗它自己會不會紅)
if [ "${SKIPGEN:-0}" != "1" ]; then
  rm -f "$OUT"/mut-*.sql "$OUT"/oth-*.sql "$OUT"/tgt-*.txt
  python3 docs/specs/2026-08-25-saved-views-mutants.py "$OUT" > "$OUT/gen.log" 2>&1
  GENRC=$?
  EXPECTED=$(grep -oE 'EXPECTED=[0-9]+' "$OUT/gen.log" | cut -d= -f2)
  ACTUAL=$(ls "$OUT"/mut-*.sql 2>/dev/null | wc -l | tr -d ' ')
  # 🔴 比【我餵幾條】與【它跑幾支】—— 兩個不同的數, 而只印後者的話少八發也看不出來
  if [ "$GENRC" -ne 0 ] || [ "$EXPECTED" != "$ACTUAL" ]; then
    echo "🔴 產生器說 $EXPECTED 發, 目錄裡只有 $ACTUAL 支 ⇒ 這一輪【不算數】"
    grep "⚠️" "$OUT/gen.log"
    exit 1
  fi
  echo "產生器 $EXPECTED 發 = 目錄 $ACTUAL 支 ✅"
fi
# 🔴 不用 `declare -A` —— macOS 的 /bin/bash 是 **3.2**, 它沒有關聯陣列。
#    2026-08-28 我第一版用了它 ⇒ 腳本在第 13 行就死("m1: unbound variable")
#    ⇒ 🔴🔴 **而整支的離開碼是 0** —— 它完全沒跑, 而回報成功。
#    📌 一支「跑不起來而回報 rc=0」的驗收腳本, 比沒有那支更糟:
#       它會在每一次 CI / 每一次收工被當成一格綠。
#    ⇒ 改用 case(POSIX, 3.2 也吃)。
# 🔴🔴 **不要用 `printf '%.NNs'` 截斷含中文的訊息**(2026-08-28 線C 實測)——
#    bash 的 `%.64s` 數的是**位元組**, 一刀砍在多位元組字元中間 ⇒ 整個檔變成**不合法 UTF-8**
#    ⇒ 🔴 `grep` 從此對**整個檔**零命中:`grep -c 恆綠` 印 0、`grep -c 沒有登記期望值` 印 0,
#      而**那個 0 與「真的沒問題」印同一個字**。
#    ⚠️ 而最後那行總計是 ASCII, `tail` 看得到 ⇒ **人眼看起來一切正常, 只有 grep 是瞎的。**
#    📌 **截斷是為了讓輸出好讀, 而它讓輸出【不可被搜尋】—— 代價落在下一個來查的人身上。**
#    ⇒ 一律印完整行。要短就自己 `| cut -c`, 不要在產生證據的地方截。
# 🔴🔴 **want 從【格名】改成【錨在訊息開頭的完整前綴】**(R3 2026-08-28)
#    舊寫法拿 want 去掃**整行**。而 `expect_code` 的包裝訊息長這樣:
#      `FAIL T1 …: 期望回碼 […], 而它【丟了例外】: 斷言 字元集…`
#    ⇒ 一發實際紅在 **T1**, 而 runner 在同一行的後半找到 `斷言 字元集` 就記 ✅ ——
#      **前半印的是另一格的名字。**
#    📌 **一個包裝訊息會把它捕捉到的例外原文帶進同一行 ⇒ 掃全行等於把
#       【被抓到的東西】當成【誰抓到的】。**歸因是假的, 而紅是真的 ⇒ 最難發現的那種。
#    ⇒ 改成:剝掉 `ERROR: ` 前綴之後, want 必須從**第一個字元**開始匹配(每條自帶 `^`)。
# 🔴 同一次也解掉「兩發共用一個 want」(R3 格2):
#    MG6/MG7 都紅在 `斷言 seqACL` 而**分支不同**(有壞權限 vs relacl 是 NULL);
#    mg2/mg3 都紅在 `碼錨 NULL閘` 而**函式不同**。
#    ⇒ want 一併釘住分支/函式字面, 否則「它執行過 NULL 那條分支」是**宣稱不是量測**,
#      而產生器若打錯支, runner 照樣印 ✅。
# ⚠️ 不用全形冒號進字元集 —— 本檔沒有 export LC_ALL, 而 `[ :]` 在 C locale 下
#    對多位元組字元是**逐位元組**比對。訊息裡格名後面接的都是空白或半形冒號, 夠用。
want_of() {
  case "$1" in
    m1)  echo '^FAIL T2 ';;      m2)  echo '^FAIL T14b ';;
    m13) echo '^FAIL T14 ';;     m14) echo '^FAIL T20 ';;
    m15) echo '^FAIL T21 ';;     mn)  echo '^FAIL T7 ';;
    m7)  echo '^FAIL T6 ';;      m9)  echo '^FAIL T17 ';;
    m8)  echo '^FAIL T4 ';;      m16) echo '^FAIL T10 ';;
    m18) echo '^FAIL T12b ';;    m11) echo '^FAIL T13b ';;
    m12) echo '^FAIL T13d ';;    m20) echo '^FAIL T4 ';;
    mf2) echo '^FAIL T23b ';;    mf3) echo '^FAIL T22b ';;
    # 🔴 這三發的 failureMessage 在舊寫法下【完全相同】⇒ 三個缺陷共用一個偵測者。
    #    R3 逐發核過:m10(trigger 不在)與 m10b(trigger 用 now())在本 harness 裡是
    #    **同一個可觀測世界** —— 整份 tests.sql 是單一交易, `now()` 恆等於交易起點
    #    ⇒ 兩者印出完全相同的那一整份結果。m17 機制不同而落點相同。
    #    ⚠️ 這裡刻意【不寫格數】—— 它每補一格就過期一次(52⇒50⇒52 已經來回兩次)。
    #    ⇒ 📌 **三發合計證得【一件】事(T9-② 那條通路活著), 不是三件。**
    #    ⚠️ 而 m10b 的紅**依賴測試全部擠在一個交易裡** —— 哪天把 DO 拆成兩塊,
    #       它會**安靜地轉恆綠**。這一行是那件事唯一的記錄。
    m10) echo '^FAIL T9-② ';;    m10b) echo '^FAIL T9-② ';;
    m17) echo '^FAIL T9-② ';;
    m5)  echo '^碼錨 順序:public.admin_create_saved_order_view';;
    m21) echo '^碼錨 鎖列:public.admin_update_saved_order_view';;
    ma1) echo '^斷言 7c-1:';;    ma2) echo '^斷言 B:';;
    ma3) echo '^碼錨 唯一性:public.admin_create_saved_order_view';;
    ma4) echo '^斷言 C-2:';;     m19) echo '^斷言 7e-2:';;
    # 🔴 mf1/mf4 都被【斷言 7c-3】抓到, 比我原本預期的「撞名世界檢查」更前面
    #    ⇒ 期望值寫【真正抓到它的那一格】, 不是【我以為會抓到它的那一格】。
    mf1) echo '^斷言 7c-3:';;    mf4) echo '^斷言 7c-3:';;
    # 🔴 mf5 的落點在 2026-08-28 折 R5 之後**變了, 而且變好了**:
    #    ~~原本紅在 ⑤ 段的正對照那一行(訊息寫「這個世界沒造出來」—— 紅是對的而字面誤導)~~
    #    ⇒ 現在 ⑤ 段也套 $FIX 了 ⇒ **片1a 的斷言 E 在撞名世界裡先抓到它**,
    #      而且訊息直接點名**那顆真正掛在 id 上的 sequence**(`..._id_seq1`)。
    #    📌 **同一發突變, 換一個更早、更會講話的偵測者 ⇒ 歸因從「靠推的」變成「它自己說的」。**
    #    ⚠️ want 釘住 `_id_seq1` 這個名字 —— 它只在撞名世界存在
    #       ⇒ 順便證明**這一紅來自 ⑤ 段, 不是 ① 段**。
    mf5) echo '^斷言 seqACL:public.admin_saved_order_views_id_seq1 對 anon';;
    mg1) echo '^碼錨 稽核原值:public.admin_update_saved_order_view';;
    mg2) echo '^碼錨 NULL閘:public.admin_update_saved_order_view';;
    mg3) echo '^碼錨 NULL閘:public.admin_delete_saved_order_view';;
    mg4) echo '^碼錨 list無鎖:';;
    # 🔴 mg5 是本次改尺的起因:它紅在 T1(第一發 create 呼叫), 而字元集斷言
    #    住在函式體裡 ⇒ 訊息是「T1 丟了例外: 斷言 字元集」。兩件事一起釘。
    # 🔴 want 多釘一格 `v_ws 長 31`(R5 must-fix 之後):
    #    舊突變是【附加一個字元】⇒ 長度先紅 ⇒ md5 那半永遠輪不到, 而畫面上一樣是一個紅。
    #    ⇒ 現在要求訊息裡看得到「長度還是對的」—— 那才證明**紅的是 md5 那半**。
    #    📌 **釘住「哪一半在叫」, 不是只釘住「它有叫」。**
    mg5) echo '^FAIL T1 .*斷言 字元集.*v_ws 長 31';;
    mg6) echo '^斷言 seqACL:.*還有權限';;
    mg7) echo '^斷言 seqACL:.*relacl 是 NULL';;
    # ── MH 組(R3 MF1/MF2):apply 期的碼錨會在行為測試之前就殺掉突變
    #    ⇒ T16 / T24 / T25 / T26 那 13 格**在任何世界都沒有紅過**
    #      (MH 組補完之後其中 10 格紅過;**現存未紅的是 T25-0 與 T26c 兩格**)。
    #    📌 **一道裝在更前面的尺, 會讓後面那把尺【永遠沒有機會表演】** ——
    #       而它們仍然每次都印綠。
    #    ⇒ 下面每一發都【保留錨字面】(塞進死分支或改值), 讓 apply 過, 逼行為格自己紅。
    mh1) echo '^FAIL T24a ';;    mh2) echo '^FAIL T24b ';;
    mh3) echo '^FAIL T25a ';;    mh4) echo '^FAIL T25b ';;
    mh5) echo '^FAIL T25c ';;    mh6) echo '^FAIL T25d ';;
    mh7) echo '^FAIL T26a ';;    mh8) echo '^FAIL T26d ';;
    mh9) echo '^FAIL T26f ';;    mh10) echo '^FAIL T16 ';;
    # 🔴 這一發打的是【時間射程】:GRANT 塞在 COMMIT **之後** ⇒ 斷言 E 已經跑完
    #    ⇒ 只有 verify-all ② 段那三格 end-state 檢查抓得到它(R3 格3)。
    mh11) echo '^🔴 end-state seqACL:anon';;
    # ── MJ 組(R5 2026-08-28):三個【有守門、有測試, 而零突變】的面
    #    🔴 MJ2 的 want 是 `^FAIL T15:` —— 它是本檔唯一手寫 RAISE 的那一格,
    #       訊息裡格名後面接的是【冒號】不是空白, 錨要跟著。
    mj1) echo '^FAIL T18 ';;    mj2) echo '^FAIL T15:';;
    mj3) echo '^FAIL T27a ';;   mj4) echo '^FAIL T27b ';;
    # 🔴 這張表與 `mutants.py` 裡的 `want` 是【兩份各自維護的清單】——
    #    2026-08-28 我在產生器加了 MG1-MG5, 而忘了加這裡 ⇒ 五發全印
    #    「沒有登記期望值 ⇒ 這一發等於沒檢查」。**它有叫, 而它是唯一會叫的那一格。**
    #    📌 兩份必須一致的清單, 遲早會不一致;能救的只有「不一致時會出聲」。
    *) echo "";;
  esac
}
OK=0; BAD=0
for f in "$OUT"/mut-*.sql; do
  n=$(basename "$f" .sql | sed 's/^mut-//')
  # 🔴 突變可能打在片1 或片1a ⇒ 兩支都要餵, 而順序固定(片1 先)
  TGT=$(cat "$OUT/tgt-$n.txt" 2>/dev/null || echo base)
  if [ "$TGT" = "fix" ]; then
    VADRAFT="$OUT/oth-$n.sql" VAFIX="$f" bash docs/specs/2026-08-25-saved-views-verify-all.sh > "$OUT/one.out" 2>&1; RC=$?
  else
    VADRAFT="$f" VAFIX="$OUT/oth-$n.sql" bash docs/specs/2026-08-25-saved-views-verify-all.sh > "$OUT/one.out" 2>&1; RC=$?
  fi
  if [ "$n" = "負對照" ]; then
    [ $RC -eq 0 ] && { echo "負對照 ✅ 全綠"; OK=$((OK+1)); } || { echo "負對照 🔴 竟然紅了 ⇒ 這一輪全部不算數"; BAD=$((BAD+1)); }
    continue
  fi
  # 🔴 比對用【完整那一行】, 只有顯示才截斷 ——
  #    截斷會砍在多位元組字元中間, 讓 grep 對整行失效(2026-08-28 實際踩到, 三發被誤判成 ⚠️)
  # 🔴 不只抓 `ERROR:` —— 有些世界(撞名那一段)是用 say 印 🔴, 不是丟 SQL 例外。
  #    2026-08-28 實測:MF4 紅了而訊息是【空的】⇒ 判成「紅在別處」。
  #    📌 **一把只認得一種失敗長相的尺, 對另一種失敗的訊息是空白的 —— 而空白會被讀成「不對」。**
  # 🔴 抓「是哪一格紅」。而這一段我 2026-08-28 連改三次都錯, 三次的病都不同, 記下來:
  #    ① 只抓 `ERROR:` ⇒ 撞名那一段的失敗是用 say 印的 ⇒ 訊息【空白】⇒ 被判成「紅在別處」
  #    ② 改成也抓 🔴   ⇒ 含 🔴 的【標籤】(「🔴 負對照 …✅」)被當成失敗 ⇒ 20 發全部誤判
  #    ③ 加「結尾不是 ✅」⇒ 抓到【彙總行】(「行為測試 rc=3 · ok 32 🔴」)與【區塊標題】
  #    📌 **同一個字元同時當【嚴重性標記】與【結果】用, 那把尺就分不出它們。**
  #    ✅ 正解:先找 SQL 例外(那是最精確的);沒有才退而求其次找 🔴,
  #       而排除 區塊標題(`──` 開頭)· 彙總行(含 `rc=`)· 標籤(以 ✅ 結尾)。
  # 🔴 **先找有名字的那種失敗**(FAIL <格> / 斷言 <格> / 碼錨 <名>), 才退回一般 ERROR。
  #    2026-08-28 實測:MF4 其實紅在「斷言 7c-3」, 而它前面有一行 `relation … does not exist`
  #    的雜訊(交易回滾後的次生錯誤)⇒ 只抓第一個 ERROR 會挑到雜訊 ⇒ 判成「紅在別處」。
  #    📌 **一次失敗會產生一串錯誤, 而【最先印的那個】通常不是原因。**
  FULL=$(grep -m1 -E "ERROR:.*(FAIL |斷言 |碼錨 )" "$OUT/one.out" | sed 's/^ *//; s#^psql:[^ ]*: *##')
  if [ -z "$FULL" ]; then
    FULL=$(grep -m1 "ERROR:" "$OUT/one.out" | sed 's/^ *//; s#^psql:[^ ]*: *##')
  fi
  if [ -z "$FULL" ]; then
    FULL=$(grep "🔴" "$OUT/one.out" | grep -v "✅$" | grep -v "^──" | grep -v "rc=" | head -1 | sed 's/^ *//')
  fi
  W=$(want_of "$n")
  # 🔴 錨定用的是【剝掉 ERROR: 前綴之後的訊息本體】, 顯示用的仍是完整那一行。
  MSG=$(printf '%s' "$FULL" | sed 's/^ERROR: *//')
  if [ -z "$W" ]; then printf '%-6s ⚠️ 沒有登記期望值 ⇒ 這一發等於沒檢查\n' "$n"; BAD=$((BAD+1))
  elif [ $RC -eq 0 ]; then printf '%-6s 🔴🔴 恆綠, 零判別力\n' "$n"; BAD=$((BAD+1))
  elif printf '%s' "$FULL" | grep -q "syntax error"; then printf '%-6s 🔴 紅在語法錯 = 紅錯地方\n' "$n"; BAD=$((BAD+1))
  # 🔴 `grep -qF "T2"` 會被 `T20 / T21 / T22b / T23b` 命中;`7c` 會被 `7c-3` 命中
  #    ⇒ 一發打歪、紅在【鄰格】的突變會印 ✅(code-reviewer 2026-08-28)
  #    📌 **尺撈到的是別人。** ⇒ 錨成完整前綴:`FAIL <格>:` 或 `斷言 <格>:` 或 `碼錨 <名>:`
  # 🔴 `grep -qF "T2"` 會被 `T20/T22b` 命中(前綴相容)⇒ 打歪的突變會印 ✅。
  #    而我第一版的修法【收太緊】:錨成 `FAIL T2:` —— 而真實文字是 `FAIL T2 clerk 建共用:`
  #    ⇒ 27 發全部被判成「紅在別處」, 而它們其實都紅對了。
  #    📌 **一把收緊的尺與一把太鬆的尺, 都會給出錯的名單 —— 而收緊那把看起來比較嚴謹。**
  #    ✅ 正解:錨成「格名之後接【空白或冒號】」⇒ `T2 ` 命中而 `T20 ` 不命中。
  elif printf '%s' "$MSG" | grep -qE "$W"; then printf '%-6s ✅ %s\n' "$n" "$FULL"; OK=$((OK+1))
  else printf '%-6s ⚠️ 期望[%s] 而紅在別處 %s\n' "$n" "$W" "$FULL"; BAD=$((BAD+1))
  fi
done
# 🔴 結尾補一道總數比對(R5 nit, 2026-08-28)——
# `SKIPGEN=1` 整條路徑**跳過**上面那道「產生器說幾發 vs 目錄幾支」,
# 而這一行原本只印 OK 與 BAD、**從不比它們的和與 EXPECTED**
# ⇒ 📌 **少跑一支在那條路徑上零形狀** —— 它不會紅、不會少一行, 它只是數字小一點,
#    而沒有人記得上一次是幾。
TOTAL=$((OK+BAD))
NEXP=$(ls "$OUT"/mut-*.sql 2>/dev/null | wc -l | tr -d ' ')
if [ "$TOTAL" != "$NEXP" ]; then
  echo "🔴 目錄裡 $NEXP 支, 而只判了 $TOTAL 支 ⇒ 這一輪【不算數】"; BAD=$((BAD+1))
else
  echo "目錄 $NEXP 支 = 判了 $TOTAL 支 ✅"
fi
echo "--- 紅在指定那一格 $OK · 有問題 $BAD ---"
exit $BAD
