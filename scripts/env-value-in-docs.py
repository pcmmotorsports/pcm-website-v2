#!/usr/bin/env python3
"""env-value-in-docs.py — 掃「文件裡叫人把 `.env` 的【值】印出來」的指示。

⟦b4-ENVDOC1⟧ · 2026-09-02 線 `-5b`。

══ 🔴 病灶(它不是假設, 是別人踩到的)═══════════════════════════════════════════
  報價單線 2026-08-31 在自己 repo 的 `docs/DEBUGGING.md` **第一步**抓到:
      cat .env.local | grep -c "SUPABASE"
  兩個病疊在同一行:
    ① 違反「`.env` 值不進對話/log」—— 而它躺在**除錯手冊第一步**(人最慌、最不會質疑的時刻)
    ② `grep -c` 在「key 對」與「key 過期/貼錯專案」兩個世界**都印 ≥3**,
       而後者正是連線 timeout 最常見的成因 ⇒ **它印「沒問題」而問題就在它量的那個東西上**

══ 🛑🛑 它【擋不住】什麼 —— 先讀這一段, 它比它能做的重要 ═══════════════════════
  🔴 **這是一把【關鍵字】尺。一句沒有用這些字的違規, 它認不出來。**
     例:「打開 `.env.local`,把第三行貼給我」—— 沒有 `cat`/`head`/`printenv`,它撈不到。
  🔴 **而同一個限制讓它【誤報】**:一句在【描述規則】的話(「`cat .env` 不在對話跑」)
     長得與一句【叫人做】的話很像。本檔用 `--report` 把兩者都列出來讓人判,
     而 `--staged` 只擋【新增的行】—— 因為新增一行違規的成本應該落在寫它的人身上。
  🛑 **⇒ 所以本檔【不宣稱】「本 repo 沒有」。它只答「我這把尺在這些檔裡撈到什麼」。**
     板 `⟦b4-ENVDOC1⟧` 逐字:「照今晚的規矩, 我只能寫『我的檢查沒看到』, 不能寫『本 repo 沒有』。」

══ 用法 ═══════════════════════════════════════════════════════════════════════
  python3 scripts/env-value-in-docs.py --report        全掃 docs/, 列候選 + 為什麼留/為什麼濾掉
  python3 scripts/env-value-in-docs.py --staged        只看本次 staged 的檔【新增的行】(給 lint-staged)
  python3 scripts/env-value-in-docs.py --selftest      正對照 + 負對照 + 跨行 + 誤報那一格
  離場碼:0 乾淨 / 1 有命中 / 2 工具層壞了
"""
import re
import subprocess
import sys
import tempfile
from pathlib import Path

# 會把內容印出來的動作。🔴 `env` 與 `source` 也算 —— 它們一樣會讓值出現在畫面/log 上。
PRINTERS = r'(?:cat|bat|head|tail|less|more|printenv|nano|vim|xxd|od|echo)'
# 目標:.env 家族, 或明顯是密鑰的變數被印出來
ENV_TARGET = r'(?:\.env(?:\.[a-zA-Z0-9_.-]+)?|\$\{?[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|DSN|DATABASE_URL)\}?)'
# 🔴🔴 **第一版把動作詞寫成 `\b<verb>\b` ⇒ 它在【散文】裡也命中** ——
#    實測:1014 支掃出 105 行, 而「看起來像叫人做」那一堆 86 行【逐行讀下來幾乎全是誤報】:
#      「env 不入 git」/「未動 `.env*`」/「`.env` 全 key 不入 git」/「mv .env.local .env.local.bak」
#    ⇒ 📌 **一把太寬的尺產出的不是漏報, 是【假指控】—— 而假指控會動員一個人去改一段對的文字。**
# ✅ 收窄成【它必須長得像一個要被執行的命令】:動作詞在**命令位置**
#    = 行首 / 提示符後 / 管線後 / `&&` `;` 之後。**散文裡的同一個字不再命中。**
CMD_POS = r'(?:^|[$>]\s|\|\s*|&&\s*|;\s*|`)'
CMD = re.compile(rf'{CMD_POS}{PRINTERS}\b[^\n]{{0,80}}?{ENV_TARGET}', re.M)
ECHO_SECRET = re.compile(rf'{CMD_POS}echo\b[^\n]{{0,40}}\$\{{?[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|DSN|DATABASE_URL)\}}?', re.M)

# 🔵 這些是【在描述規則】而不是【叫人做】的訊號。它們讓一行被歸進「看起來是規則」那一堆。
#    🛑 而這是【啟發式】—— 它會漏(一句沒用這些字的規則)也會誤放(一句用了這些字的違規)。
RULE_HINTS = re.compile(r'禁|不要|不得|絕不|不在對話|never|禁止|違反|~~|⛔|不該|勿|避免|反例')

# 🔴 **【寫入】不是【印出】** —— `echo "K=V" >> .env.local` 是在【建】那個檔, 不是把值印到畫面上。
#    實測 2026-09-02:`docs/specs/m-1-14-customer-schema.md:1016-1020` 五行全是這一種(值還是 `XXX` 佔位)。
#    ⇒ 📌 把它們混進「叫人印出值」那一堆 = **假指控**, 而假指控會讓人去改一段對的文件。
#    ⇒ 而它們也不是零風險(一份 setup 手冊叫人把真 secret 打進去)—— 所以【單獨一堆】, 不是丟掉。
WRITES_ENV = re.compile(r'>>?\s*\.?[\w./-]*\.env')

SKIP_DIRS = {'archive', 'node_modules', '.git'}


def candidates(text: str):
    """回 [(行號, 那一行, 是不是跨行接出來的)] —— 🔴 跨行:`\\` 續行會被接起來再判。"""
    lines = text.split('\n')
    out = []
    i = 0
    while i < len(lines):
        joined = lines[i]
        span = 1
        # 🔴 【跨行指令】那一格 —— 板 ⟦b4-ENVDOC1⟧ 點名的第二個缺口
        while joined.rstrip().endswith('\\') and i + span < len(lines) and span < 6:
            joined = joined.rstrip()[:-1] + ' ' + lines[i + span]
            span += 1
        if CMD.search(joined) or ECHO_SECRET.search(joined):
            out.append((i + 1, joined.strip(), span > 1))
        i += 1
    return out


def scan_paths(paths):
    hits = []
    for p in paths:
        try:
            text = Path(p).read_text(encoding='utf-8', errors='replace')
        except OSError:
            continue
        for lineno, line, multiline in candidates(text):
            hits.append((str(p), lineno, line, multiline,
                         bool(RULE_HINTS.search(line)), bool(WRITES_ENV.search(line))))
    return hits


def docs_files():
    root = Path('docs')
    if not root.is_dir():
        print('🔴 找不到 docs/ ⇒ 分母是空的, 拒繼續(exit 2)', file=sys.stderr)
        sys.exit(2)
    out = []
    for p in root.rglob('*'):
        if p.is_file() and p.suffix in {'.md', '.sh', '.py'}:
            if any(d in SKIP_DIRS for d in p.parts):
                continue
            out.append(p)
    return sorted(out)


def report():
    files = docs_files()
    hits = scan_paths(files)
    writes = [h for h in hits if h[5]]
    looks_rule = [h for h in hits if h[4] and not h[5]]
    looks_instr = [h for h in hits if not h[4] and not h[5]]
    print(f'分母:docs/ 底下 {len(files)} 支(.md/.sh/.py;排除 {"/".join(sorted(SKIP_DIRS))})')
    print(f'命中 {len(hits)} 行 —— 而它們【還沒有被判】, 下面兩堆是【訊號】不是結論\n')
    print(f'⚠️ 看起來像【叫人做】的({len(looks_instr)} 行)—— 這一堆要逐行開檔判:')
    for f, n, line, ml, _, _w in looks_instr:
        print(f'  {f}:{n}{"  〔跨行接出來的〕" if ml else ""}\n      {line[:160]}')
    print(f'\n🔵 看起來像【在描述規則】的({len(looks_rule)} 行)—— 而那個判斷是啟發式, 可能錯:')
    for f, n, line, ml, _, _w in looks_rule[:12]:
        print(f'  {f}:{n}  {line[:120]}')
    if len(looks_rule) > 12:
        print(f'  …另外 {len(looks_rule) - 12} 行')
    print(f'\n📝 而【寫入 .env】不是【印出 .env】, 單獨一堆({len(writes)} 行)——')
    print('   它們不會把值印到畫面上, 而一份叫人把真 secret 打進去的 setup 手冊仍有它自己的風險:')
    for f, n, line, ml, _r, _w in writes[:8]:
        print(f'  {f}:{n}  {line[:120]}')
    if len(writes) > 8:
        print(f'  …另外 {len(writes) - 8} 行')
    print('\n🛑 射程(每次都印):這把尺是【關鍵字】的 ⇒ 一句沒用這些字的違規它認不出來。')
    print('   ⇒ 所以「這一堆是 0」的意思是【我的檢查沒看到】, 不是【本 repo 沒有】。')
    return 1 if looks_instr else 0


def staged():
    """只看 staged 檔【新增的行】—— 新增一行違規的成本落在寫它的人身上。"""
    try:
        diff = subprocess.run(['git', 'diff', '--cached', '-U0', '--', 'docs'],
                              capture_output=True, text=True, check=False)
    except OSError as e:
        print(f'🔴 跑不動 git ⇒ 本閘沒有跑(不是乾淨):{e}', file=sys.stderr)
        return 2
    if diff.returncode != 0:
        print(f'🔴 git diff 回 {diff.returncode} ⇒ 本閘沒有跑(不是乾淨)', file=sys.stderr)
        return 2
    cur = None
    bad = []
    for ln in diff.stdout.split('\n'):
        if ln.startswith('+++ b/'):
            cur = ln[6:]
        elif ln.startswith('+') and not ln.startswith('+++') and cur:
            body = ln[1:]
            if (CMD.search(body) or ECHO_SECRET.search(body)) and not RULE_HINTS.search(body):
                bad.append((cur, body.strip()))
    if bad:
        print('🔴 這幾行【新增的】看起來在叫人把 .env 的值印出來:')
        for f, b in bad:
            print(f'   {f}\n      {b[:160]}')
        print('\n   ⇒ 如果它真的是在【描述規則】而不是叫人做, 在同一行寫明(「禁」「不要」「不得」…)。')
        print('   ⚠️ 而那個判準是關鍵字 ⇒ 它會漏。這一道擋的是【最常見的那一種】, 不是全部。')
        return 1
    return 0


def selftest():
    rc = 0

    def chk(name, got, want):
        nonlocal rc
        ok = got == want
        print(f'  {"✅" if ok else "🔴"} {name}:得 {got} / 要 {want}')
        if not ok:
            rc = 1

    with tempfile.TemporaryDirectory() as d:
        # 🟢 正對照:一行【真的在叫人做】的違規 —— 尺必須撈到
        p1 = Path(d) / 'a.md'
        p1.write_text('先跑這個確認環境:\n\n```bash\ncat .env.local | grep -c "SUPABASE"\n```\n', encoding='utf-8')
        chk('正對照 叫人 cat .env.local', len(scan_paths([p1])), 1)

        # 🟢 正對照2:跨行指令(板 ⟦b4-ENVDOC1⟧ 點名的第二個缺口)
        p2 = Path(d) / 'b.md'
        p2.write_text('```bash\ncat \\\n  .env.production\n```\n', encoding='utf-8')
        h2 = scan_paths([p2])
        chk('正對照 跨行 cat \\ + .env', len(h2), 1)
        chk('  而它要被標成【跨行接出來的】', 1 if (h2 and h2[0][3]) else 0, 1)

        # 🟢 正對照3:echo 一個看起來是密鑰的變數
        p3 = Path(d) / 'c.md'
        p3.write_text('echo $SUPABASE_SERVICE_ROLE_KEY\n', encoding='utf-8')
        chk('正對照 echo $..._KEY', len(scan_paths([p3])), 1)

        # 🔵 負對照:現造字面 —— 尺不准亂命中
        p4 = Path(d) / 'd.md'
        p4.write_text('zzq_no_such_thing_20260902 這一行什麼都不是\ncat README.md\n', encoding='utf-8')
        chk('負對照 現造字面 + 無關的 cat', len(scan_paths([p4])), 0)

        # 🔵 【寫入 vs 印出】那一格 —— 它必須落在【寫入】那一堆, 不是「叫人印出值」那一堆
        p6 = Path(d) / 'f.md'
        p6.write_text('echo "LINE_CHANNEL_SECRET=XXX" >> .env.local\n', encoding='utf-8')
        h6 = scan_paths([p6])
        chk('寫入格 echo … >> .env.local 會被撈到', len(h6), 1)
        chk('  而它要被標成【寫入】不是【印出】', 1 if (h6 and h6[0][5]) else 0, 1)
        # 🔵 負對照:一個【印出】的不准被標成寫入 —— 否則上一格在「全部都標寫入」時也會過
        chk('  負對照 cat .env.local 不得被標成寫入',
            1 if (scan_paths([p1]) and not scan_paths([p1])[0][5]) else 0, 1)

        # 🔵 而【誤報那一格】要自己演一次:一句在描述規則的話會被撈到, 而它應該落在「規則」那一堆
        p5 = Path(d) / 'e.md'
        p5.write_text('🔴 `cat .env` 不在對話跑、Sean 在 Terminal 自驗。\n', encoding='utf-8')
        h5 = scan_paths([p5])
        chk('誤報格 一句規則會被撈到(這是尺的限制, 不是 bug)', len(h5), 1)
        chk('  而它要被歸進【看起來像規則】那一堆', 1 if (h5 and h5[0][4]) else 0, 1)

    print('\n⚠️ 射程:本 selftest 只演【關鍵字撈得到】的那些世界。')
    print('   🔴 一句用純散文寫的違規(「打開 .env.local 把第三行貼給我」)—— 本檔認不出來,')
    print('      而 selftest 也【演不出來】, 因為演它就等於承認尺撈不到它。⇒ 那是具名缺口, 不是待辦。')
    return rc


def main():
    args = sys.argv[1:]
    if '--selftest' in args:
        return selftest()
    if '--staged' in args:
        return staged()
    if '--report' in args or not args:
        return report()
    print(__doc__)
    return 2


if __name__ == '__main__':
    sys.exit(main())
