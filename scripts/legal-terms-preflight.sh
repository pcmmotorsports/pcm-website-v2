#!/usr/bin/env bash
# legal-terms-preflight.sh —— 把 legal_terms migration 遞給 Sean 之前的【閘】,不是叮嚀。
#
# 用法(repo 根):
#   bash scripts/legal-terms-preflight.sh <版本鍵> <hash> <migration 檔路徑>
# 退出碼: 0=可以遞 / 1=不要遞 / 2=用法錯
# 🔴 **最後一行會印 `PREFLIGHT_RESULT=PASS` 或 `=FAIL`** ——
#   ⚠️ **「一定」那兩個字被拿掉了**(codex R3):印它的 `finish()` 在輸出前還要跑清理,
#     而清理裡有 `shasum` / `cp` / `rm`。那些指令自己壞掉(工具不在、磁碟滿、權限)時,
#     契約行就不會出現。⇒ 已把清理每一步都改成不致命(`|| true`),但**那不是零風險**。
#   ⇒ 🔴 **收訊端的正確判準是「末行【逐字等於】PREFLIGHT_RESULT=PASS 才算過」** ——
#     不是「末行不是 FAIL 就算過」。**契約行【沒出現】要當成 FAIL 處理,不是當成沒事。**
#   理由:呼叫端一接管線(`| tee`、`| head`),退出碼就變成**右端那個指令的**,
#   而「腳本自己的 pipefail 管不到包住它的那一個」。⇒ 判準由**本腳本印出來**,不交給呼叫端的管線決定。
#   ⇒ 收工判準請用:`bash …preflight.sh … | tail -1` 必須逐字等於 `PREFLIGHT_RESULT=PASS`。
#
# ⚠️ **前置**:先把 migration 檔頭記載的對外文字改動套進 legal-content.ts(套用腳本在該檔 §「⑤」)。
#   本腳本只動【常數】兩行;文字沒套 ⇒ 守門①會紅,**而那個紅正是我們要的訊號**。
#
# 🔴 **它擋不住什麼(已知限定,寫在這裡免得被讀成全能)**:
#   它證明的是【跑的那一刻】一致。「通過 → 人工把 SQL 貼進 Supabase」之間若有人改了
#   legal-content.ts,DB 仍會寫進舊 hash,而本腳本已經回 PASS 了。
#   ⇒ **這不是本腳本補得起來的** —— apply 在人手上、檔在共用樹上,兩者無法原子綁定。
#   ⇒ 缺的那一道檢查叫「**apply 後的複驗**」,它寫在 migration 檔頭「對照查詢」那一節。
set -euo pipefail

# 🔴 判準行【由 EXIT trap 印】,不由各條出口自己記得印。
#   理由(2026-08-21 我自己踩到的):第一版把它寫在各條 return 路徑上,
#   而【閘 0 那兩條失敗路徑走的是 `python … || exit 1`】⇒ 那兩格根本沒印,
#   末行變成一句中文說明 —— 而我的檔頭當時已經宣告「末行必為 PREFLIGHT_RESULT=…」。
#   ⇒ **一個只在部分世界成立的輸出契約,比沒有契約更糟**:它讀起來像在所有世界都成立。
#   ⇒ 修法不是「每條出口都記得加一行」(那是紀律),是**讓它結構上不可能漏**。
RESULT=FAIL
SNAP=""
MUT_SHA=""
finish() {
  if [ -n "$SNAP" ]; then
    if [ -n "$MUT_SHA" ] && [ "$(shasum -a 256 < "$TV" 2>/dev/null | cut -d' ' -f1 || true)" != "$MUT_SHA" ]; then
      echo "⚠️ 還原前發現 $TV 又被改過(不是我改的那一版)⇒ **不還原**,免得蓋掉別人。" >&2
      echo "   我跑之前的那一份存在:$SNAP/tv  ← 🔴 用完請自己刪,本腳本刻意不刪它。" >&2
    else
      cp "$SNAP/tv" "$TV" 2>/dev/null || true
      rm -rf "$SNAP" 2>/dev/null || true   # codex R2 nit:正常路徑要收掉,不留殘骸
    fi
  fi
  echo "PREFLIGHT_RESULT=$RESULT"
}
# 🔴 `finish()` 裡每一步都不致命 —— 清理失敗不該吃掉判準行(codex R3)。
trap finish EXIT INT TERM
fail() { echo "$@" >&2; exit 1; }

VER="${1:-}"; HASH="${2:-}"; MIG="${3:-}"
if [ -z "$VER" ] || [ -z "$HASH" ] || [ -z "$MIG" ]; then
  echo "用法: bash scripts/legal-terms-preflight.sh <版本鍵 YYYY-MM-DD> <64 位 hash> <migration 檔路徑>" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# 🔴 $TV 要在 trap 之前就有值 —— finish() 會用到它。
TV="apps/storefront/src/lib/legal/terms-version.ts"
LC="apps/storefront/src/data/legal-content.ts"

[ -f "$MIG" ] || fail "🔴 找不到 migration 檔:$MIG"

# ── 閘 0:把【要遞的那一支】綁定住 ─────────────────────────────────────────────
# 🔴 為什麼需要(codex R2):`legal-content-hash.test.ts` 只要求「**任一** migration 含該
#   version+hash」(它的 `expect(seeding).not.toHaveLength(0)`)⇒ 目錄裡另一支舊檔命中時,
#   **你要遞的那一支就算被改壞、甚至內容不對,測試仍然綠**。那是閘鏈第②環,比看起來鬆。
python3 - "$MIG" "$VER" "$HASH" "$ROOT/supabase/migrations" <<'PY' || exit 1
import io,os,re,sys
mig,ver,h,d=sys.argv[1],sys.argv[2],sys.argv[3],sys.argv[4]
strip=lambda s: re.sub(r'--[^\n]*',' ',re.sub(r'/\*[\s\S]*?\*/',' ',s))
pat=re.compile(r"INSERT\s+INTO\s+[\w.]*legal_terms_versions\s*\(([^)]*)\)\s*VALUES\s*\(([\s\S]*?)\)",re.I)
def seeds(path):
    body=strip(io.open(path,encoding='utf-8').read())
    for m in pat.finditer(body):
        cols=[c.strip().lower() for c in m.group(1).split(',')]
        vals=[v.strip() for v in m.group(2).split(',')]
        if 'version' in cols and 'content_hash' in cols:
            if vals[cols.index('version')]=="'%s'"%ver and vals[cols.index('content_hash')]=="'%s'"%h:
                return True
    return False
if not seeds(mig):
    print("🔴 %s 裡【沒有】剝掉註解後仍成立的 INSERT 帶著 version '%s' + 該 hash。"%(mig,ver),file=sys.stderr)
    print("   (註解裡提到不算數 —— 那正是這道閘要擋的東西。)",file=sys.stderr); sys.exit(1)
others=[f for f in sorted(os.listdir(d)) if f.endswith('.sql')
        and os.path.join(d,f)!=os.path.abspath(mig)
        and seeds(os.path.join(d,f))]
if others:
    print("🔴 除了 %s,還有 %d 支 migration 也 seed 同一個 version+hash:%s"%(mig,len(others),'、'.join(others)),file=sys.stderr)
    print("   ⇒ 重複 seed 會讓下游的『任一支命中就算數』守門對【遞錯檔】瞎掉。先處理掉。",file=sys.stderr); sys.exit(1)
print("閘 0 過:%s 是【唯一】seed 這組 version+hash 的 migration。"%mig)
print("  ⚠️ 這個『唯一』的範圍:僅限【目前 checkout】的 %s 這一個目錄下 %d 支 .sql,"
      %(d,len([f for f in os.listdir(d) if f.endswith('.sql')])))
print("     且僅限本腳本的 regex 認得出的 `INSERT INTO … legal_terms_versions (欄位) VALUES (…)`。")
print("     未收割分支上的檔、別的目錄、以及寫法不同的 INSERT **都不在這個分母裡**。")
PY

# ── 快照還原(不用 git checkout:本流程要求 $LC 是髒的,checkout 會殺掉它)──────────
# 還原邏輯在上面的 finish();這裡只負責建快照 —— $SNAP 一有值,finish() 就會處理它。
SNAP="$(mktemp -d)"
cp "$TV" "$SNAP/tv"

python3 - "$TV" "$VER" "$HASH" <<'PY' || exit 1
import io,re,sys
p,ver,h=sys.argv[1],sys.argv[2],sys.argv[3]
s=io.open(p,encoding='utf-8').read()
s2=re.sub(r"(export const CURRENT_TERMS_VERSION = ')[^']*(')",r"\g<1>"+ver+r"\g<2>",s,count=1)
s2=re.sub(r"(export const CURRENT_TERMS_CONTENT_HASH =\s*\n?\s*')[0-9a-f]{64}(')",r"\g<1>"+h+r"\g<2>",s2,count=1)
if s2==s:
    print("🔴 兩個常數一個都沒被改到 —— 檔案形狀變了,本腳本的正規表示式已過期。",file=sys.stderr); sys.exit(1)
io.open(p,'w',encoding='utf-8').write(s2)
PY
MUT_SHA="$(shasum -a 256 < "$TV" | cut -d' ' -f1)"

echo "── 閘 1:跑 legal-content-hash 守門(演部署後狀態)──"
if npx vitest run src/data/legal-content-hash; then
  echo
  echo "✅ 這組 version/hash 與【工作樹當下的對外文字】一致,且綁定到 $MIG。"
  echo "🔴 **通過之後【立刻】遞出去,中間不要做別的事。**"
  echo "   遞出的那一刻再跑一次本腳本 —— 那是我們控制得到的最後一個時點。"
  echo "   而 apply 之後仍要照 migration 檔頭那一節做【後查複驗】,那才是這條的真正補救。"
  RESULT=PASS
  exit 0
else
  echo
  echo "🔴 不要把 SQL 遞出去。" >&2
  echo "   ⚠️ **本腳本【沒有】判斷它為什麼紅** —— 上面那段 vitest 輸出才是依據,去讀它。" >&2
  echo "      (前一版這裡直接寫「最可能是有人改了檔案」並叫你換 hash;那是【沒量過就診斷】," >&2
  echo "       而測試基礎設施自己壞掉時,那句話會把你推去改一個本來是對的 hash。codex R3 打掉。)" >&2
  echo "   兩種要分開的情況:" >&2
  echo "     · 失敗訊息印出「實際 hash = <另一個值>」⇒ 對外文字真的變了" >&2
  echo "       ⇒ 抄那個新值,**改開一支新的 migration**,不要改本檔。" >&2
  echo "     · 失敗訊息是別的(讀不到檔 / 模組解析失敗 / 完全沒跑起來)⇒ **不是 hash 的問題**" >&2
  echo "       ⇒ 先把環境修好再跑一次。**不要在這種狀態下換 hash。**" >&2
  exit 1
fi
