#!/usr/bin/env bash
# ============================================================================
# ts-denominator-guard.sh — 每一支 .ts/.tsx 都必須屬於某一個三綠分母,不屬於的就紅。
#
# 🔴🔴 本守門【目前未接進 CI/pre-commit ⇒ 不會自動跑 ⇒ 現在「沒有東西在守」】。
#    跟 probe-marker-guard.sh 同族:寫好但沒接線 = 裝上了而沒在守。要接由管 .github 的窗做。
#
# 為什麼要它(來源:2026-08-27 三綠分母缺口量測 ~/pcm-mailbox/線3-三綠分母缺口-20260827.md):
#   pnpm typecheck 的分母 = 各 tsconfig 的 include 聯集。一支 .ts 落在 include 之外
#   (docs/、scripts/ 子目錄、packages 的 src/ 外)⇒ 靜靜地不被檢查, 而三綠照樣全綠。
#   最危險的是:有人寫了一支【像守門/像測試】的 .ts、跑了三綠、看到綠 ⇒ 以為它在守。
#
# 🔴 分母 = 【工作樹上實際存在的】檔(find,不是 git ls-files)——
#    理由:未 commit 的洞正是最該抓的那種(新東西剛寫出來時最可能放錯地方)。
#
# 🔴 本守門是 .sh(不是 .ts)⇒ 不在自己掃的 .ts 宇宙裡, 不會漏抓自己;
#    而一支 .ts 版本會落在 scripts/*.ts(root)= 分母內(見下方三世界驗收的「scripts root ⇒ 綠」)。
#
# 用法:bash scripts/ts-denominator-guard.sh [ROOT]   (ROOT 預設 = repo 根)
# ============================================================================
set -u
ROOT="${1:-.}"
# 🔴 ROOT 不存在 ⇒ 立刻 exit 2,不能靜靜掃 0 支印綠 —— 那正是本檔要防的病(壞輸入看起來像「沒事」)。
[ -d "$ROOT" ] || { echo "🔴 ROOT 不存在:$ROOT(exit 2,與缺口的 exit 1 分得開)" >&2; exit 2; }

# ── 排除清單(不掃)+ 為什麼 ────────────────────────────────────────────────
#   node_modules  第三方碼, 不是我們的分母
#   .next / dist / build / coverage  建置產物
#   .git          版控內部
#   .claude/worktrees  別窗的 git worktree(不是這棵樹的檔;會重複計數)
PRUNE_RE='(^|/)(node_modules|\.next|dist|build|coverage|\.git|\.claude/worktrees)/'

# ── 明文豁免清單(每一條【必須】旁邊一句為什麼)──────────────────────────────
#   🔴 空的豁免清單比一個裝滿的好;偷偷擴充豁免比缺口更糟。
#   格式:每行 "相對路徑<TAB>理由"。每一條旁邊【必須】有一句為什麼。
#   🔴 只放【逐支查證過、且理由是「刻意不進分母」】的 —— 沒人管 / 只是還沒處理的【不放】,讓它紅著。
EXEMPT_LIST="scripts/fixtures/authz-bare-redirect.fixture.ts	authz-failure-visibility.sh 的正向對照測資(那支 .sh 掃它、期望恆為 1);刻意引用未定義符號=放進 typecheck 永遠紅;檔頭明文「不可放 apps/、完全不被 typecheck 覆蓋是刻意的」(2026-08-18 突變證+本輪 Q3 實跑紅 2 錯確認)"

# ── 分母規則(鏡射 2026-08-27 量到的三綠分母;新增有 tsconfig+typecheck 的 workspace 要同步這裡)──
#   apps/admin, apps/storefront   tsconfig include **/*.ts(x)   ⇒ 全收
#   packages/*/src/**             tsconfig include src/**/*      ⇒ 只收 src/
#   scripts/*.ts(root, 深度 1)   tsconfig.scripts.json          ⇒ 只收 root 層 .ts
in_denominator() {
  case "$1" in
    apps/admin/*|apps/storefront/*) return 0 ;;
    packages/*/src/*)               return 0 ;;
    scripts/*.ts)
      # 必須是 scripts/ 正下方(深度 1);scripts/子目錄/*.ts 不算
      case "${1#scripts/}" in */*) return 1 ;; *) return 0 ;; esac ;;
    *) return 1 ;;
  esac
}

is_exempt() {
  printf '%s\n' "$EXEMPT_LIST" | while IFS=$'\t' read -r path _reason; do
    [ -n "$path" ] || continue
    [ "$path" = "$1" ] && { echo HIT; break; }
  done | grep -q HIT
}

uncovered=""
total=0
while IFS= read -r f; do
  rel="${f#./}"
  total=$((total + 1))
  if ! in_denominator "$rel"; then
    is_exempt "$rel" || uncovered="${uncovered}${rel}"$'\n'
  fi
done < <(cd "$ROOT" 2>/dev/null && find . -type f \( -name '*.ts' -o -name '*.tsx' \) 2>/dev/null \
           | sed 's|^\./||' | grep -Ev "$PRUNE_RE" | sort)

echo "掃描:$ROOT(工作樹實際存在的 .ts/.tsx 共 $total 支)"

if [ -n "$uncovered" ]; then
  echo "🔴 FAIL — 下列 .ts/.tsx【不在任何三綠分母裡】,三綠掃不到它們而照樣全綠:"
  printf '%s' "$uncovered" | while IFS= read -r u; do [ -n "$u" ] && echo "  $u"; done
  echo "  ⇒ 每一支要嘛搬進分母(apps/{admin,storefront}/ · packages/*/src/ · scripts/*.ts root),"
  echo "     要嘛加進本檔 EXEMPT_LIST 並【寫一句為什麼】。"
  exit 1
fi
echo "✅ PASS — 全部 $total 支都在分母裡(或有落點的豁免)。"
exit 0
