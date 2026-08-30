#!/usr/bin/env python3
"""md-table-overflow — 找出 Markdown 表格裡【會在渲染時被丟掉】的內容。

🔴 存在的理由(2026-08-30 線【出貨】量到,不是假想):
   `docs/launch-todo.md` 有 **48 列**的內容落在表頭欄數之外 ⇒ GFM 規格逐字「多出來的格被忽略」
   ⇒ **62,636 字在渲染時看不到**,而其中 **14 列**被丟掉的是【更正 / 撤回 / Sean 的拍板 / 態變更】
   —— 也就是最不能丟的那一種。
   📌 而檔案裡那些字**一個都沒少** ⇒ `grep` / `cat` 讀得到 ⇒ **這個病對純文字讀法完全隱形。**

exit code(三態分得開,不共用):
  0 = 沒有溢出
  1 = 有溢出(逐列印出來,含【被丟掉的是哪一段】)
  2 = 用法錯(沒給檔 / 檔不存在)
  3 = --selftest 失敗(這把尺自己壞了)⇒ 🔴 這時候的 0 不算數

🔴 **它印【被丟掉的內容】不只是「這一列壞了」** —— 因為承重的正是那一段:
   一列只是「有問題」的話,沒有人會知道該不該急;而看到被丟掉的是一句拍板,判斷就變了。

🛑 **兩種形狀分開報,因為【修法不同】,合成一種會讓人改錯**:
   形狀A 追記寫在收尾 `|` 的【後面】  ⇒ 修法 = 把它搬到那根 `|` 【前面】
   形狀B 裸豎線長在【反引號裡面】     ⇒ 修法 = 寫成 `\\|` 或拆成兩個 code span
   ⚠️ **反引號【不保護】豎線** —— 這是 GFM 的表格規則,與行內程式碼的直覺相反。

⚠️ 它【不做】什麼(射程,印在輸出末尾,不躺在檔頭):
   · 不改任何檔(唯讀)
   · 只認「以 `|` 開頭」的行 —— 表格用其他寫法(縮排 / HTML table)它看不到
   · 不判內容重不重要 —— 它只把被丟掉的那段印出來,判斷是人的事
"""
import io
import re
import sys

PIPE = re.compile(r'(?<!\\)\|')
SEP = re.compile(r'^\|[\s:\-\|]+\|\s*$')


def cells(line: str) -> list[str]:
    """照 GFM 切格:未被 `\\` 跳脫的 `|` 才分格(反引號不保護)。"""
    parts = PIPE.split(line)
    if parts and parts[0].strip() == '':
        parts = parts[1:]
    if parts and parts[-1].strip() == '':
        parts = parts[:-1]
    return parts


def in_code_span(line: str, pos: int) -> bool:
    """那個位置在不在反引號裡 —— 用它前面的反引號數是不是奇數判。"""
    return line[:pos].count('`') % 2 == 1


def scan(path: str) -> list[dict]:
    """回傳每一列溢出的細節。"""
    try:
        lines = io.open(path, encoding='utf-8').read().split('\n')
    except OSError as e:
        # 🔴 用法錯要回 2,不可以與「有溢出」的 1 撞號 —— 撞了就分不出
        #    「這個檔沒問題」「這個檔有問題」「我根本沒讀到這個檔」三件事。
        print(f'md-table-overflow: 讀不到 {path}({e})', file=sys.stderr)
        sys.exit(2)
    heads = []
    for i, l in enumerate(lines[:-1]):
        if l.startswith('|') and SEP.match(lines[i + 1] or ''):
            heads.append((i, len(cells(l))))
    out = []
    for idx, (h, ncol) in enumerate(heads):
        end = heads[idx + 1][0] if idx + 1 < len(heads) else len(lines)
        for j in range(h + 2, end):
            l = lines[j]
            if not l.startswith('|') or SEP.match(l):
                continue
            c = cells(l)
            if len(c) <= ncol:
                continue  # 少格 ⇒ GFM 補空,內容不掉
            # 找出切出第 ncol+1 格的那根豎線在哪
            pos = None
            for n, m in enumerate(PIPE.finditer(l), start=1):
                if n == ncol + 1:
                    pos = m.start()
                    break
            shape = 'B' if (pos is not None and in_code_span(l, pos)) else 'A'
            lost = '|'.join(c[ncol:])
            out.append({
                'line': j + 1, 'header_line': h + 1, 'ncol': ncol,
                'got': len(c), 'shape': shape, 'lost': lost, 'lost_chars': len(lost),
            })
    return out


SELFTEST = [
    # (名稱, 內容, 期望溢出列數, 期望形狀)
    ('乾淨的表(正對照:不得誤報)',
     '| a | b |\n|---|---|\n| 1 | 2 |\n', 0, None),
    ('形狀A:追記寫在收尾豎線後面',
     '| a | b |\n|---|---|\n| 1 | 2 | 這一段會被丟掉 |\n', 1, 'A'),
    ('形狀B:裸豎線長在反引號裡',
     '| a | b |\n|---|---|\n| 1 | `x|y` 後面這段會被丟掉 |\n', 1, 'B'),
    ('跳脫過的豎線(正對照:不得誤報)',
     '| a | b |\n|---|---|\n| 1 | x \\| y |\n', 0, None),
    ('少格(GFM 補空,內容不掉 ⇒ 不得報)',
     '| a | b | c |\n|---|---|---|\n| 1 | 2 |\n', 0, None),
]


def selftest() -> int:
    import tempfile, os
    bad = 0
    for name, body, want_n, want_shape in SELFTEST:
        fd, p = tempfile.mkstemp(suffix='.md')
        os.write(fd, body.encode('utf-8'))
        os.close(fd)
        try:
            got = scan(p)
        finally:
            os.unlink(p)
        ok = len(got) == want_n and (want_shape is None or (got and got[0]['shape'] == want_shape))
        print(f"  {'PASS' if ok else '🔴 FAIL'}  {name}"
              f"(期望 {want_n} 列{'/形狀' + want_shape if want_shape else ''},得 {len(got)} 列"
              f"{'/形狀' + got[0]['shape'] if got else ''})")
        if not ok:
            bad += 1
    if bad:
        print(f'\n🔴 selftest 失敗 {bad} 格 ⇒ **這把尺壞了,它現在印的 0 不算數**')
        return 3
    print('\nselftest 全過(含兩個正對照:乾淨的表與跳脫過的豎線都不得誤報)')
    return 0


def main(argv: list[str]) -> int:
    args = argv[1:]
    if not args:
        print(__doc__)
        print('用法: python3 scripts/md-table-overflow.py <file.md> [...]')
        print('      python3 scripts/md-table-overflow.py --selftest')
        return 2
    if args[0] == '--selftest':
        return selftest()
    total = 0
    for path in args:
        rows = scan(path)
        total += len(rows)
        if not rows:
            print(f'✅ {path}:沒有被丟掉的內容')
            continue
        lostc = sum(r['lost_chars'] for r in rows)
        a = sum(1 for r in rows if r['shape'] == 'A')
        b = sum(1 for r in rows if r['shape'] == 'B')
        print(f'🔴 {path}:{len(rows)} 列的內容會在渲染時被丟掉,共 {lostc} 字')
        print(f'   形狀A(追記寫在收尾豎線後面)= {a} 列 ⇒ 修法:把它搬到那根 `|` 前面')
        print(f'   形狀B(裸豎線長在反引號裡)  = {b} 列 ⇒ 修法:寫成 \\| 或拆成兩個 code span')
        for r in sorted(rows, key=lambda x: -x['lost_chars']):
            head = re.sub(r'\s+', ' ', r['lost']).strip()
            print(f"\n  第 {r['line']} 行(表頭在 :{r['header_line']},{r['ncol']} 欄;"
                  f"這一列 {r['got']} 格;形狀{r['shape']};丟 {r['lost_chars']} 字)")
            print(f"     被丟掉的:{head[:180]}")
    print('\n🛑 這一發【證不到】什麼:')
    print('   · 它只認以 `|` 開頭的行 —— 縮排表格 / HTML table 它看不到')
    print('   · 它不判內容重不重要 —— 上面印的那幾段要不要急,是人的判斷')
    print('   · 🔴 檔案裡那些字【一個都沒少】⇒ grep / cat 讀得到')
    print('     ⇒ 這個病只在【把它渲染成表格】的地方成立;沒有人那樣讀 ⇒ 今天損害為零')
    return 1 if total else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
