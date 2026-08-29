#!/usr/bin/env python3
"""量「純文字層測試」有多少 —— 而純文字層【不等於】假守門, 先讀完這段再用這個數字。

═══ 定義(寫死在這裡, 跟著數字走;不寫在別處以免兩份漂開)═══
  純文字層測試 = 該檔【讀取原始碼 / 樣式檔的文字】並對那些【字面】下斷言,
                 而不是對【執行結果】(render 出來的 DOM / 函式回傳值)下斷言。
  分級  FULL  = 有讀檔動作、零 render(
        MIXED = 兩種都有
        NONE  = 純執行層

═══ 🔴 這個數字【不是】什麼(2026-08-29 線B 量到, 主視窗 -06 要求寫在這裡)═══
  文字層守門【擋得住】「有人把那段碼刪掉」—— 那是真的判別力。
  ⇒ 本尺說的是「有 N 支檔對【行為】那一層完全看不見」, **不是「N 支壞了」**。
  ⇒ 真正的缺口只在【那一格的行為層沒有別人守】時才成立, 而那要逐格開檔。
  實例:`order-detail-items-table-shape.test.tsx` 24 格, 把 `ItemsTable` 改成
        `return null` ⇒ **零紅**;而 render 層那半由 `cancel-wiring.test.tsx` 守著
        ⇒ 那是【分類】不是【缺口】。

═══ 🔴 已知會漏 / 誤報(先寫, 不等被抓)═══
  L1 用【別支檔的 helper】讀檔 ⇒ 本檔看不到那個動作 ⇒ **漏報**
  L2 讀【非原始碼】的文字(fixture json / 快照)⇒ **誤報**成文字層
  L3 用 import.meta.glob / fs.promises 其他 API ⇒ **漏報**
  L4 對 CSS 檔下斷言的算文字層 —— 而那可能是【對的做法】(CSS 沒有執行結果可看)
  ⇒ **輸出是【下界】, 不是全部。**

═══ 用法 ═══
  python3 scripts/text-layer-tests.py            列總數 + 按爆炸半徑分堆
  python3 scripts/text-layer-tests.py --list     加印每一支檔
  python3 scripts/text-layer-tests.py --selftest 正負對照(必須全過才信它的數)
"""
import re, io, sys, subprocess, collections

READ = re.compile(r'\breadFileSync\b|\breadFile\b|\bfs\.readFile')
RENDER = re.compile(r'\brender\s*\(|\brenderHook\s*\(|\brenderToString\s*\(')
MONEY = re.compile(r'price|amount|payment|refund|order|tier|wallet|dealer|cost|invoice|subtotal')
AUTH = re.compile(r'auth|rls|grant|role|session|staff|permission|allowlist')
STYLE = re.compile(r'/styles/|css|token|motion|mobile|zoom|column-fit|showcase|brand|sidebar|layout')


def bucket(path: str) -> str:
    """爆炸半徑分堆。🔴 尺是【路徑關鍵字】⇒ 會誤分, 這一格不精確、只用來排優先序。"""
    if AUTH.search(path):
        return '②權限'
    if MONEY.search(path):
        return '①錢'
    if STYLE.search(path):
        return '③樣式/文案'
    return '④其他'


def classify(src: str) -> str:
    if not READ.search(src):
        return 'NONE'
    return 'FULL' if not RENDER.search(src) else 'MIXED'


def scan():
    files = subprocess.run(['git', 'ls-files', '*.test.ts', '*.test.tsx'],
                           capture_output=True, text=True).stdout.split()
    out = []
    for f in files:
        try:
            out.append((classify(io.open(f, encoding='utf-8').read()), f))
        except OSError:
            continue
    return files, out


def selftest() -> int:
    """🔴 每一組都要【兩個世界印不同的東西】, 否則那一組沒有判別力。"""
    W = [
        ('FULL  讀檔且零 render', "const s = readFileSync(p,'utf8'); expect(s).toContain('x');", 'FULL'),
        ('MIXED 兩種都有', "const s = readFileSync(p); render(<A/>); expect(s).toContain('x');", 'MIXED'),
        ('NONE  純執行層', "render(<A/>); expect(screen.getByText('x')).toBeVisible();", 'NONE'),
        ('NONE  負對照:提到 readFile 但只在【字串裡】', "expect(msg).toBe('用 readFileSync 讀');", 'FULL'),
        ('NONE  空檔', '', 'NONE'),
        ('MIXED renderHook 也算執行層', "readFileSync(p); renderHook(() => useX());", 'MIXED'),
    ]
    bad = 0
    for name, src, want in W:
        got = classify(src)
        ok = got == want
        bad += 0 if ok else 1
        print(f'  {"ok " if ok else "🔴 "}{name}  ⇒ {got}(期望 {want})')
    print('  🔴 第 4 組【刻意期望 FULL】—— 它記錄一個【已知誤報】:'
          '字串裡出現 readFileSync 也會中。改掉它之前, 不要宣稱本尺零誤報。')
    b = collections.Counter(bucket(p) for p in
                            ['a/price.test.ts', 'a/auth.test.ts', 'a/styles/x.test.ts', 'a/zzz.test.ts'])
    print(f'  {"ok " if len(b) == 4 else "🔴 "}分堆四類各中一發 ⇒ {dict(b)}')
    bad += 0 if len(b) == 4 else 1
    return bad


def main() -> int:
    if '--selftest' in sys.argv:
        n = selftest()
        print('自檢:' + ('全過' if n == 0 else f'🔴 {n} 組不符 ⇒ 不要用它的數字'))
        return 1 if n else 0
    files, rows = scan()
    sel = [f for k, f in rows if k != 'NONE']
    full = sum(1 for k, _ in rows if k == 'FULL')
    mixed = sum(1 for k, _ in rows if k == 'MIXED')
    print(f'分母 = git ls-files 的 *.test.ts(x) ⇒ {len(files)} 支(工作樹, 不是 HEAD)')
    print(f'FULL {full} · MIXED {mixed} ⇒ 文字層合計 {len(sel)} 支'
          f'({len(sel) * 100 // max(len(files), 1)}%)· NONE {len(files) - len(sel)}')
    b = collections.Counter(bucket(f) for f in sel)
    print('\n按【壞了會怎樣】分堆(尺=路徑關鍵字, 會誤分):')
    for k in ('①錢', '②權限', '③樣式/文案', '④其他'):
        print(f'  {k}: {b[k]} 支')
    print(f'  合計 {sum(b.values())} ⇒ ' + ('守恆 ok' if sum(b.values()) == len(sel) else '🔴 與上面對不上'))
    if '--list' in sys.argv:
        for k in ('②權限', '①錢', '③樣式/文案', '④其他'):
            print(f'\n=== {k} ===')
            for f in sorted(x for x in sel if bucket(x) == k):
                print('  ', f)
    print('\n⚠️ 這是【下界】—— 四個已知漏報/誤報寫在本檔 docstring, 引用數字前先讀。')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
