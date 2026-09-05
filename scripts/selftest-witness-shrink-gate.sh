#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# ⟦b9-GATESELFEDIT⟧ 第三道:**守門的證人變少了 ⇒ 叫**
#   板列 docs/launch-todo.md ⟦b9-GATESELFEDIT⟧ · 派工 主視窗 `-f8` 2026-09-06
#
# ■ 它在補哪一個縫
#   一支守門腳本裡, **規則與測它的 selftest 住在同一支檔**。
#   ⇒ 📌 同一顆 commit 把規則砍掉、把守它的那一格 selftest 一起砍掉,
#     **既有的兩道機制都不會叫**:①`.husky` 那道只看檔在不在 ②lint-staged 只跑 `--selftest`,
#     而**證人也被砍了 ⇒ 它照樣全過**。
#   ⇒ ✅ 本閘問的是第三個問題:**這支檔的 selftest, 今天講的話比昨天【少】了嗎?**
#
# ■ 🔴 為什麼是「比它自己的上一版」而不是「比一個基準數字」
#   既有前例 `acl-drift-gate-selftest-floor.sh` 把地板數字釘在另一支檔 —— 那是對的, 而它
#   **要為每一支檔各調一次**(那支的 FLOOR=91 是人工量的)。
#   🔬 2026-09-06 實測:想找一把【通用】的尺失敗了 ——
#      同一個「數輸出裡的 ✅/🔴」的尺, 跨檔量到 `board-row-by-anchor.sh` = **0**、
#      `md-table-overflow.py` = **10**、`greenlight.sh` = **10**。
#      ⇒ 🛑 那支印 0 的並不是沒有守門(它有 20 格), 是**它的輸出風格不同**
#      ⇒ **跨檔比較的尺, 會給一支健康的檔一個 0 地板 = 零保護, 而畫面上看不出來。**
#   ⇒ ✅ **改成拿一支檔比【它自己的上一版】** —— 風格差異兩邊相同, 直接消掉,
#     而且**不需要任何人去維護一個數字**。
#
# ■ 🔬 誤擋率是量到的, 不是估的(2026-09-06, 最近 60 顆 commit)
#     粗版「gate 腳本有刪行就擋」      ⇒ 8 顆裡擋 5 顆 = **62%**
#       🛑 那個版本會在一天之內訓練人略過它(`cite-check.sh:32-34` 記過同一個病)。
#     本版「同一支檔, selftest 輸出變短」⇒ 有刪行的 4 次裡擋 **0** 次 = **0%**
#   ⚠️ **而那個 0% 的分母只有 4** —— 它是「今天沒看到誤擋」, 不是「不會誤擋」。
#
# ■ 🛑 它擋不住什麼(與它擋得住什麼一樣要顯眼)
#   · **輸出行數是【代理】不是【證人本身】** ⇒ 砍一格再補一行印字, 數字就回來了 ⇒ 不會叫。
#   · **本檔自己也改得掉** —— 同一顆 commit 裡把它弄壞, 沒有東西會叫。
#     🔴 真正的鎖在【repo 之外】(codex 逐字:server-side protected branch / ruleset,
#     作者不可自行 bypass);**那一格不在本檔的射程裡, 也不是本檔宣稱做到的事。**
#   · 它只看**總長度**, 不看**是哪一格** ⇒ 砍一格、加一格無關的, 長度不變 ⇒ 不會叫。
#   ⇒ 📌 **本閘把「靜靜砍掉一格守門」變成「一個數字在畫面上往下掉」—— 那是訊號, 不是鎖。**
#
# ■ 離場碼:0 過 / 1 證人變少(擋下)/ 2 工具層壞了(fail-closed)
# ═══════════════════════════════════════════════════════════════════════════
set -u

# ═══ --selftest ═══════════════════════════════════════════════════════════
# 🔴 **第一件事是剝掉繼承來的 git 環境變數** —— 本支要在拋棄式 repo 裡建世界,
#    而 `GIT_DIR` / `GIT_INDEX_FILE` 那幾個會讓 `git` 打到【呼叫者的】庫去
#    (`git -C` 擋不住它們)。⇒ 那正是 `.husky/selftest-git-isolation-gate.sh` 在守的東西。
if [ "${1:-}" = "--selftest" ]; then
  unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE GIT_OBJECT_DIRECTORY \
        GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_COMMON_DIR GIT_NAMESPACE
  SELF=$(cd "$(dirname "$0")" && pwd)/$(basename "$0")
  W=$(mktemp -d "${TMPDIR:-/tmp}/pcm-witness-selftest.XXXXXX") || exit 2
  trap 'rm -rf "$W"' EXIT
  PASS=0; FAIL=0
  ck() { # $1=名稱 $2=期望rc $3=實際rc
    if [ "$2" = "$3" ]; then PASS=$((PASS+1)); printf '  PASS  %s(rc=%s)\n' "$1" "$3"
    else FAIL=$((FAIL+1)); printf '  🔴 FAIL %s(期望 rc=%s, 得 %s)\n' "$1" "$2" "$3"; fi
  }
  ( cd "$W" && git init -q . && git config user.email t@t && git config user.name t ) || exit 2
  mkdir -p "$W/scripts"

  # 一支有 --selftest 的假守門, 印 3 行
  cat > "$W/scripts/fake-gate.sh" <<'EOF'
#!/bin/bash
if [ "${1:-}" = "--selftest" ]; then
  echo "格1 ok"; echo "格2 ok"; echo "格3 ok"; exit 0
fi
EOF
  ( cd "$W" && git add scripts/fake-gate.sh && git commit -qm base ) || exit 2

  # 世界①:一個字都沒動 ⇒ 放行
  ( cd "$W" && bash "$SELF" scripts/fake-gate.sh >/dev/null 2>&1 ); ck "世界① 沒動它 ⇒ 放行" 0 $?

  # 世界②:證人變少(3 行 ⇒ 2 行)⇒ 擋
  #   🔴 這就是本閘存在的理由:那支假守門【自己的 selftest 仍然 rc=0】。
  cat > "$W/scripts/fake-gate.sh" <<'EOF'
#!/bin/bash
if [ "${1:-}" = "--selftest" ]; then
  echo "格1 ok"; echo "格2 ok"; exit 0
fi
EOF
  ( cd "$W" && bash "$SELF" scripts/fake-gate.sh >/dev/null 2>&1 ); ck "世界② 證人變少 ⇒ 擋" 1 $?
  # 🟢 同一格的反向:那支檔自己不會叫 ⇒ 證明本閘補的是【它看不到的那一半】
  ( cd "$W" && bash scripts/fake-gate.sh --selftest >/dev/null 2>&1 ); ck "世界②b 舊機制對同一顆【不會叫】" 0 $?

  # 世界③:證人變多 ⇒ 放行(本閘只擋變少, 不擋變多)
  cat > "$W/scripts/fake-gate.sh" <<'EOF'
#!/bin/bash
if [ "${1:-}" = "--selftest" ]; then
  echo "格1 ok"; echo "格2 ok"; echo "格3 ok"; echo "格4 ok"; exit 0
fi
EOF
  ( cd "$W" && bash "$SELF" scripts/fake-gate.sh >/dev/null 2>&1 ); ck "世界③ 證人變多 ⇒ 放行" 0 $?

  # 世界④:全新的檔(HEAD 沒有它)⇒ 沒有可比的對象 ⇒ 跳過, 不是失敗
  cat > "$W/scripts/brand-new.sh" <<'EOF'
#!/bin/bash
[ "${1:-}" = "--selftest" ] && { echo "新的"; exit 0; }
EOF
  ( cd "$W" && bash "$SELF" scripts/brand-new.sh >/dev/null 2>&1 ); ck "世界④ 新檔沒有上一版 ⇒ 跳過" 0 $?

  # 世界⑤:沒有 --selftest 的腳本 ⇒ 不在射程裡
  echo '#!/bin/bash' > "$W/scripts/plain.sh"
  ( cd "$W" && git add scripts/plain.sh && git commit -qm plain )
  echo 'echo hi' >> "$W/scripts/plain.sh"
  ( cd "$W" && bash "$SELF" scripts/plain.sh >/dev/null 2>&1 ); ck "世界⑤ 沒有 --selftest ⇒ 不管" 0 $?

  # 世界⑥:只在【註解】裡提到 --selftest ⇒ 也不算(「提到」不是「有」)
  printf '#!/bin/bash
# 這支不吃 --selftest, 只是提到它
echo hi
' > "$W/scripts/mentions.sh"
  ( cd "$W" && git add scripts/mentions.sh && git commit -qm m )
  printf '#!/bin/bash
# 這支不吃 --selftest, 只是提到它
' > "$W/scripts/mentions.sh"
  ( cd "$W" && bash "$SELF" scripts/mentions.sh >/dev/null 2>&1 ); ck "世界⑥ 只在註解裡提到 ⇒ 不算" 0 $?

  # 世界⑦:黑名單那幾支【一次都不准被跑起來】—— 跑了就會寫到 repo 外
  cat > "$W/scripts/mailbox-snapshot.sh" <<'EOF'
#!/bin/bash
if [ "${1:-}" = "--selftest" ]; then echo "我不該被跑到" > "$WITNESS_FILE"; echo a; echo b; exit 0; fi
EOF
  ( cd "$W" && git add scripts/mailbox-snapshot.sh && git commit -qm ms )
  cat > "$W/scripts/mailbox-snapshot.sh" <<'EOF'
#!/bin/bash
if [ "${1:-}" = "--selftest" ]; then echo "我不該被跑到" > "$WITNESS_FILE"; echo a; exit 0; fi
EOF
  rm -f "$W/ran"
  ( cd "$W" && WITNESS_FILE="$W/ran" bash "$SELF" scripts/mailbox-snapshot.sh >/dev/null 2>&1 )
  R=$?
  if [ -e "$W/ran" ]; then FAIL=$((FAIL+1)); printf '  🔴 FAIL 世界⑦ 黑名單那支【被跑起來了】\n'
  else PASS=$((PASS+1)); printf '  PASS  世界⑦ 黑名單那支沒有被跑起來(而它證人也變少了, rc=%s)\n' "$R"; fi

  printf '\n共 %s 格:PASS %s · FAIL %s\n' "$((PASS+FAIL))" "$PASS" "$FAIL"
  [ "$FAIL" = 0 ] || { printf "🔴 selftest FAIL\n" >&2; exit 1; }
  printf "✅ selftest 全過\n"
  exit 0
fi

TMPD=$(mktemp -d "${TMPDIR:-/tmp}/pcm-witness.XXXXXX") || exit 2
trap 'rm -rf "$TMPD"' EXIT
trap 'rm -rf "$TMPD"; exit 130' INT
trap 'rm -rf "$TMPD"; exit 143' TERM HUP

# 🛑 **不跑這幾支** —— 它們會寫到 repo 外 / 會推。這條是拿真實損害換來的:
#    板列 ⟦b9-NOCARRIER1⟧ 記著有人跑了 `mailbox-snapshot` ⇒ 建了快照並【永久刪掉最舊那份】。
#    ⚠️ 這是**黑名單**, 而黑名單會跟下一支會寫的腳本賽跑 ⇒ 新增會寫的工具時要記得加進來。
SKIP_RE='(mailbox-snapshot|push-and-announce|hand-to-sean)\.sh$'

RC=0
CHECKED=0
for f in "$@"; do
  case "$f" in
    scripts/*.sh|scripts/*.py) ;;
    *) continue ;;
  esac
  [ -f "$f" ] || continue
  printf '%s' "$f" | grep -qE "$SKIP_RE" && continue

  # ── 它自己實作了 --selftest 嗎(非註解行才算;「提到」不是「有」)──
  grep -vE '^[[:space:]]*#' "$f" 2>/dev/null | grep -q -- '--selftest' || continue

  # ── 上一版在不在(新檔沒有可比的對象 ⇒ 跳過, 那不是失敗)──
  if ! git show "HEAD:$f" > "$TMPD/old" 2>/dev/null; then continue; fi
  cp "$f" "$TMPD/new" || { printf '🔴 讀不到 %s ⇒ fail-closed\n' "$f" >&2; exit 2; }

  case "$f" in *.py) RUN=python3 ;; *) RUN=bash ;; esac
  command -v "$RUN" >/dev/null 2>&1 || { printf '🔴 沒有 %s ⇒ fail-closed\n' "$RUN" >&2; exit 2; }

  # 🔴 rc 不當判準 —— 兩版都可能是綠的, 而本閘要問的是【話變少了沒】。
  #    ⚠️ 而【跑不起來】與【輸出 0 行】要分得開:跑不起來走 fail-closed, 不當成「變短」。
  ( cd "$TMPD" && "$RUN" ./old --selftest ) > "$TMPD/old.out" 2>&1
  OLD_RAN=$?
  ( cd "$TMPD" && "$RUN" ./new --selftest ) > "$TMPD/new.out" 2>&1
  NEW_RAN=$?
  if [ ! -s "$TMPD/old.out" ] && [ "$OLD_RAN" -gt 1 ]; then
    printf '🔵 %s:上一版的 selftest 在這裡跑不起來(rc=%s, 零輸出)⇒ 沒有可比的基準, 跳過\n' "$f" "$OLD_RAN" >&2
    continue
  fi

  A=$(wc -l < "$TMPD/old.out" | tr -d ' ')
  B=$(wc -l < "$TMPD/new.out" | tr -d ' ')
  CHECKED=$((CHECKED + 1))

  if [ "$B" -lt "$A" ]; then
    RC=1
    printf '\n🔴🔴 %s 的 selftest 【講的話變少了】:%s 行 ⇒ %s 行\n' "$f" "$A" "$B" >&2
    printf '%s\n' '   ⇒ 這一顆 commit 可能把一條規則【與守著它的那一格】一起砍掉了 ——' >&2
    printf '%s\n' '     而那正是既有兩道機制都看不到的形狀(規則與測試住同一支檔)。' >&2
    printf '%s\n' '   ── 少了哪幾行(舊版有、新版沒有)──' >&2
    diff "$TMPD/old.out" "$TMPD/new.out" 2>/dev/null | grep '^<' | head -8 >&2
    printf '%s\n' '   ✅ 若那是【刻意的】(規則本來就該退場):' >&2
    printf '%s\n' '      在 commit body 寫清楚【哪一格退場、為什麼】, 然後把本閘這一支暫時拿掉那個檔名再跑。' >&2
    printf '%s\n' '      🛑 而不要把本檔改成不叫 —— 動驗證本身是 R4 的立即停止訊號, 要回報不是自己拍。' >&2
  fi
done

if [ "$RC" = 0 ] && [ "$CHECKED" -gt 0 ]; then
  printf '✅ selftest 證人數未減:比過 %s 支(拿每一支檔比【它自己的上一版】)\n' "$CHECKED"
fi
exit "$RC"
