#!/usr/bin/env bash
# migration-version-free.sh —— 取號【之前】問一句:這個版本號有沒有被別人用掉?
#
# 板列 ⟦db-VERSIONGATECROSSBRANCH⟧。關閉條件逐字:「那一發變成一支腳本, 而**它在【取號】那一刻跑**
# (不是 commit 之後)⇒ 要有**一發紅一發綠的證人**。」
#
# ══ 為什麼既有兩道閘都看不到(這一段是本檔存在的理由)═══════════════════════
#   scripts/migration-version-collision-gate.py   看【當下這個 index】(git diff --cached)
#   scripts/migration-version-dup-across-lines.sh 看【各個 ref】(git ls-tree)
#   ⇒ 🔴 而【取號那一刻】, 你的新檔還沒 add、也還沒 commit
#     ⇒ **兩道閘的分母裡都沒有它, 也沒有【別的窗手上那支同樣還沒 commit 的】。**
#   🎯 **兩個綠都是真的** —— 而「兩個獨立的閘都綠」正是最容易讓人停止懷疑的形狀。
#
# 🔬 **2026-09-09 又發作一次(這一次是真的撞上去了)**:副手 B 與 money 兩條線
#    同時取到 `20260909030000`, **兩支同號一起上了 dev** —— 而 merge 不跑 pre-commit,
#    所以 collision-gate 沒機會叫;dup-across-lines 的分母是【不同檔名】, 同號不同名它也看不到。
#
# ══ 所以本檔掃【三個地方】, 而第三個才是新的 ═══════════════════════════════
#   ① 全部 ref(refs/heads + refs/remotes)—— 已 commit 的
#   ② 每一棵 worktree 的 index —— 已 add 而還沒 commit 的
#   ③ 🔴 每一棵 worktree 的【工作目錄】—— **連 add 都還沒的**
#      ⇒ 📌 ③ 就是 B 那一次的所在, 而既有兩道閘都到不了那裡。
#
# ══ 🛑 它答不出什麼(先寫, 免得綠票被讀太寬)═══════════════════════════════
#   · 它只看得到**這台機器上**的 worktree。別人的筆電上那支它看不見。
#   · 它是【取號那一刻】的快照 —— 你拿到綠之後過十分鐘才建檔, 中間別人可能取走同一個號。
#     ⇒ 拿到綠就【當場建檔】, 不要放著。
#   · 它不驗那個號【合不合理】(例如日期對不對), 只驗**有沒有人用掉**。
#
# 用法:
#   bash scripts/migration-version-free.sh 20260909050000     # 問一個號, 沒人用 rc=0
#   bash scripts/migration-version-free.sh --selftest          # 一發紅一發綠的證人
set -uo pipefail
export LC_ALL=C LANG=C

REPO="$(cd "$(dirname "$0")/.." && pwd)"

scan() {   # $1 = 14 位版本號;印出每一處命中, 回傳命中數
  local ver="$1" hits=0 r w
  # ① 全部 ref
  while IFS= read -r r; do
    [ -z "$r" ] && continue
    if git -C "$REPO" ls-tree -r --name-only "$r" supabase/migrations/ 2>/dev/null \
         | grep -q "/${ver}_"; then
      echo "   🔴 ref  $r"
      hits=$((hits + 1))
    fi
  done < <(git -C "$REPO" for-each-ref --format='%(refname:short)' refs/heads refs/remotes 2>/dev/null)
  # ②③ 每一棵 worktree 的 index 與工作目錄
  while IFS= read -r w; do
    [ -z "$w" ] && continue
    if git -C "$w" ls-files --cached -- supabase/migrations/ 2>/dev/null | grep -q "/${ver}_"; then
      echo "   🔴 index  $(basename "$w")"
      hits=$((hits + 1))
    fi
    # 🔴 這一格是新的:連 add 都還沒的檔, 只有直接看目錄才看得到
    if ls "$w"/supabase/migrations/"${ver}"_*.sql >/dev/null 2>&1; then
      echo "   🔴 工作目錄  $(basename "$w")  $(basename "$(ls "$w"/supabase/migrations/"${ver}"_*.sql | head -1)")"
      hits=$((hits + 1))
    fi
  done < <(git -C "$REPO" worktree list --porcelain 2>/dev/null | awk '/^worktree /{print $2}')
  return "$hits"
}

if [ "${1:-}" = "--selftest" ]; then
  # 🔴🔴 **剝掉繼承來的 git 環境**(CLAUDE.md 快速自檢清單那一格)——
  #    `git -C` 擋不住 GIT_DIR / GIT_INDEX_FILE 那幾顆, 而它們會讓 selftest 跑在【真的樹】上。
  unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE GIT_OBJECT_DIRECTORY \
        GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_COMMON_DIR GIT_NAMESPACE
  T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
  git -C "$T" init -q 2>/dev/null
  mkdir -p "$T/supabase/migrations"
  REPO="$T"
  echo "── selftest:一發紅一發綠 ──"
  # ⚪ 綠:誰都沒用過這個號
  scan 29990101000000 > /dev/null; g=$?
  echo "  ⚪ 沒人用過的號 ⇒ 命中 $g(期望 0)"
  # 🟢 紅:**只放在工作目錄, 不 add 不 commit** —— 那正是既有兩道閘看不到的那一格
  : > "$T/supabase/migrations/29990101000000_zzq_selftest.sql"
  scan 29990101000000 > /dev/null; b=$?
  echo "  🟢 只丟進工作目錄(不 add / 不 commit)⇒ 命中 $b(期望 ≥1)"
  rm -f "$T/supabase/migrations/29990101000000_zzq_selftest.sql"
  scan 29990101000000 > /dev/null; a=$?
  echo "  ⚪ 拿掉之後 ⇒ 命中 $a"
  # 🔴🔴 **ref 那一層要【單獨】證一次** —— 上面三格全部只碰工作目錄,
  #    ⇒ 一支【只掃工作目錄而完全沒掃 ref】的壞版本, 上面三格會全部通過。
  #    ✅ 造一個【只活在 ref 上、工作目錄與 index 都沒有】的號:commit 之後把檔案刪掉。
  : > "$T/supabase/migrations/29990102000000_zzq_refonly.sql"
  git -C "$T" add -A >/dev/null 2>&1
  git -C "$T" -c user.email=x@x -c user.name=x commit -qm zzq >/dev/null 2>&1
  rm -f "$T/supabase/migrations/29990102000000_zzq_refonly.sql"
  git -C "$T" rm --cached -q supabase/migrations/29990102000000_zzq_refonly.sql >/dev/null 2>&1
  scan 29990102000000 > /dev/null; rf=$?
  echo "  🟢 只活在 ref 上 ⇒ 命中 $rf"
  # ⚪ 下面這一格是 ref 那一層的對照 —— 少了它, 上面那個 rf 可能是【每一個號都紅】。
  scan 29990103000000 > /dev/null; nf=$?
  echo "  ⚪ ref 上也沒有的號 ⇒ 命中 $nf"
  # 🔵 判定只由下面那一行 PASS / FAIL 講 —— 逐格寫「期望 X」的話,
  #    那句話在【不符】的時候照樣印, 而它就印在讀數的正下方。
  echo "  判準:g=0 · b>=1 · a=0 · rf>=1 · nf=0   實得 g=$g b=$b a=$a rf=$rf nf=$nf"
  if [ "$g" = "0" ] && [ "$b" -ge 1 ] && [ "$a" = "0" ] && [ "$rf" -ge 1 ] && [ "$nf" = "0" ]; then
    echo "SELFTEST PASS"; exit 0
  fi
  echo "SELFTEST FAIL"; exit 1
fi

VER="${1:-}"
case "$VER" in
  [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]) ;;
  *) echo "用法:bash scripts/migration-version-free.sh <14 位版本號>" >&2
     echo "     bash scripts/migration-version-free.sh --selftest" >&2
     exit 2 ;;
esac

echo "── 問 $VER 有沒有被用掉(掃 ref + 每棵 worktree 的 index 與工作目錄)──"
scan "$VER"; N=$?
NREF=$(git -C "$REPO" for-each-ref --format='%(refname:short)' refs/heads refs/remotes 2>/dev/null | wc -l | tr -d ' ')
NWT=$(git -C "$REPO" worktree list --porcelain 2>/dev/null | grep -c '^worktree ')
# 🔵 分母要印出來 —— 「零命中」與「我一個地方都沒掃到」在畫面上是同一句話。
echo "   🔵 分母:$NREF 個 ref · $NWT 棵 worktree"
if [ "$N" -eq 0 ]; then
  echo "✅ $VER 沒有人用掉 ⇒ 可以用。🔴 而【當場建檔】, 不要放著 —— 別的窗隨時可能取同一個號。"
  exit 0
fi
echo "🔴 $VER 已經被用掉($N 處)⇒ 換一個號。"
echo "   🛑 而【不要只換一位數】—— 同一分鐘取號的人也會這樣換。往後跳一個明顯的間距。"
exit 1
