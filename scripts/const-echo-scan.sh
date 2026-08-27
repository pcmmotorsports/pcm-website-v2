#!/usr/bin/env bash
# const-echo-scan.sh — 掃「拿被測物自己的常數當期望值」(const-echo assert)。
#
# 病的形狀:期望值來自被測物自己 ⇒ 被測物怎麼變、期望值就怎麼變 ⇒ 那一格永遠綠。
# 出身:2026-08-17 T 線 X 掃描(61 命中、真恆綠 1 對=NOTE_MAX 族);模範解=字面 pin 格
# (SupabaseOrderAdapter.test.ts「ADMIN_ORDER_ID_IN_CAP 必須是字面 100」)或 SQL drift-check
# (shipping-rpc-drift.test.ts)。命中不等於缺陷 —— 要人工分堆(真恆綠/有錨/佈線契約/對照組)。
#
# 🔴 量具窄處(這把尺【看不到】的,零命中不代表這五種不存在):
#   1. 字面複製型 echo(期望值是複製貼上的字面,不經 import)
#   2. 非全大寫常數(camelCase 匯出)
#   3. 跨行 expect(常數在下一行)
#   4. objectContaining / 模板字串內插
#   5. 期望在左邊的寫法(expect(CONST).toBe(actual))
#   6. 單字母常數(如 X)—— 常數判定 regex 要求 ≥2 字元
#   7. 複合字面包住常數(toEqual([CONST + 1]) / toEqual({ n: CONST }))—— regex 要求
#      匹配子後緊跟常數名,( 後面是 [ 或 { 就對不上。🔴 具名實錘(族普查唯二真命中,
#      全是這形狀、本掃描器零報,人工讀出):refund-recovery-read.test.ts 的
#      toEqual([RECOVERY_SIBLINGS_LIMIT + 1]) 與 refund-read.test.ts 的
#      toEqual([ORDER_REFUNDS_LIMIT + 1])。
#
# rc 三檔(分不開就沒有判別力):
#   0 = 掃了、零命中     1 = 有命中     2 = 工具自壞(root 不存在 / 分母為 0 / 對照失敗 / python 掛)
#   🔴 分母為 0 算「自壞」不算「零命中」—— 「0 hits / 0 files」正是「什麼都沒有被讀成檢查過了」的形狀。
#
# 🔴 呼叫端注意:接了管線,$? 是右端的(bash x.sh | head ⇒ $? 是 head 的)。
#   要本腳本的 rc:別接管線,或在【呼叫的那個 shell】set -o pipefail(寫在本腳本裡管不到外層)。
#
# 用法: bash scripts/const-echo-scan.sh [--help|--selftest] [root ...]
#   預設 roots(相對 repo 根): apps/admin/src packages/domain/src packages/adapters/src packages/ports/src packages/ui/src
#   --selftest: 自己生已知命中/已知不命中/會讓工具失敗的輸入各餵一發,驗 rc 三檔都分得開。

set -u
SCRIPT="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,26p' "$SCRIPT"
  exit 0
fi

if [ "${1:-}" = "--selftest" ]; then
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT INT TERM HUP
  mkdir -p "$TMP/hit" "$TMP/miss"
  printf '%s\n' "import { SOME_LIMIT } from '@/lib/fake';" \
    "it('echo', () => { expect(f()).toBe(SOME_LIMIT); });" > "$TMP/hit/known-hit.test.ts"
  printf '%s\n' "it('plain', () => { expect(f()).toBe(3); });" > "$TMP/miss/known-miss.test.ts"

  fail=0
  bash "$SCRIPT" "$TMP/hit" > /dev/null; rc=$?
  if [ "$rc" -eq 1 ]; then echo "selftest 1/3 known-hit    => rc=1 OK" >&2; else echo "selftest 1/3 known-hit    => rc=$rc EXPECTED 1 — 這把尺抓不到已知命中" >&2; fail=1; fi
  bash "$SCRIPT" "$TMP/miss" > /dev/null; rc=$?
  if [ "$rc" -eq 0 ]; then echo "selftest 2/3 known-miss   => rc=0 OK" >&2; else echo "selftest 2/3 known-miss   => rc=$rc EXPECTED 0" >&2; fail=1; fi
  bash "$SCRIPT" "$TMP/does-not-exist" > /dev/null 2> /dev/null; rc=$?
  if [ "$rc" -eq 2 ]; then echo "selftest 3/3 tool-broken  => rc=2 OK(root 不存在被判自壞,不是安靜回 0)" >&2; else echo "selftest 3/3 tool-broken  => rc=$rc EXPECTED 2 — 工具壞掉卻不說,比沒有工具更糟" >&2; fail=1; fi
  if [ "$fail" -ne 0 ]; then exit 2; fi
  echo "selftest: 3/3 通過,rc 三檔分得開" >&2
  exit 0
fi

# 一律以 repo 根為基準(自訂相對 root 也是相對 repo 根;絕對路徑不受影響)。
cd "$REPO_ROOT" || exit 2
if [ "$#" -gt 0 ]; then
  ROOTS=("$@")
else
  ROOTS=(apps/admin/src packages/domain/src packages/adapters/src packages/ports/src packages/ui/src)
fi

# stderr 不丟、不進管線;python 的 exit code 原样帶出。
python3 - "${ROOTS[@]}" <<'PY'
import glob, os, re, sys

roots = sys.argv[1:]
IMPORT_RE = re.compile(r'import\s*\{([^}]+)\}\s*from\s*[\'"](@/|\.\.?/)')
CONST_RE = re.compile(r'^[A-Z][A-Z0-9_]+$')

def matcher(src):
    hits = []
    imported = set()
    for m in IMPORT_RE.finditer(src):
        for name in m.group(1).split(','):
            name = name.strip().split(' as ')[-1].strip()
            if name and CONST_RE.fullmatch(name):
                imported.add(name)
    if imported:
        for i, line in enumerate(src.splitlines(), 1):
            if 'expect(' not in line:
                continue
            for name in imported:
                if re.search(r'to(Be|Equal|StrictEqual|Contain|Match)\(\s*' + name + r'\b', line):
                    hits.append((i, name, line.strip()))
    return hits

# 內建 positive control:每次跑都先驗尺本身;抓不到已知命中 ⇒ rc=2,不繼續掃。
control = "import { SOME_LIMIT } from '@/lib/fake';\nexpect(f()).toBe(SOME_LIMIT);\n"
if len(matcher(control)) != 1:
    print('工具自壞:內建 positive control 沒命中,這把尺抓不到已知的 echo,結果不可信', file=sys.stderr)
    sys.exit(2)

for r in roots:
    if not os.path.isdir(r):
        print(f'工具自壞:root 不存在或不是目錄:{r}', file=sys.stderr)
        sys.exit(2)

files = []
for r in roots:
    for pat in ('**/*.test.ts', '**/*.test.tsx'):
        files += [f for f in glob.glob(os.path.join(r, pat), recursive=True) if 'node_modules' not in f]
files = sorted(set(files))
if not files:
    print(f'工具自壞:分母為 0(roots={roots} 下找不到任何 *.test.ts[x]),「0 命中 / 0 檔」不是零命中', file=sys.stderr)
    sys.exit(2)

total = 0
for f in files:
    try:
        src = open(f, encoding='utf-8').read()
    except (OSError, UnicodeDecodeError) as e:
        # UnicodeDecodeError 是 ValueError 子類、不是 OSError —— 漏接它 ⇒ traceback + rc=1,
        # 與「有命中」同碼(reviewer Critical 實測重現過)。
        print(f'工具自壞:讀不了 {f}:{e}', file=sys.stderr)
        sys.exit(2)
    for i, name, line in matcher(src):
        print(f'{f}:{i}: [{name}] {line[:150]}')
        total += 1

print(f'--- 分母 {len(files)} 個測試檔 / 命中 {total} 行(命中≠缺陷,分堆判準見 --help;零命中時五個窄處仍不可排除)', file=sys.stderr)
sys.exit(1 if total else 0)
PY
exit $?
