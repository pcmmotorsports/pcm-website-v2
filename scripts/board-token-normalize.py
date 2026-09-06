#!/usr/bin/env python3
r"""board-token-normalize.py —— 把板上「擋上線?」token 正規化到【最後一格的開頭】。

══ 為什麼有它(2026-09-06 tidy 立;成因是一次【零衝突】的 merge)════════════
`docs/launch-todo.md` 的擋上線 token 約定住在**最後一格的開頭**,
而 `scripts/launch-blocking-count.sh` 也只讀那個位置。
2026-09-06 merge 39e 之後讀數當場從 擋 102 掉到 94 —— 而**一個 token 都沒有消失**
(整檔帶 token 的列 505 ⇒ 507,反而變多)。
🔴 成因:**別的窗在【同一格的開頭】插了新內容,把 token 推到格子中間。**
📌 ⇒ 這不是「merge 把訂正還原」(那是 ⟦auth-BOARDMERGERETRACT⟧ 記的病),
   是**兩個人往同一格的同一端寫** —— 而在 diff 上它是**一次乾淨的合併、零衝突**。
另有 4 列出現**兩個一模一樣的 token**(兩邊各帶一份進 merge)。

══ 🔴 天花板(先讀,不要把它讀得比它大)══════════════════════════════════
 ① 它只管 token 的**位置與份數**,**不管判得對不對**。
 ② 🔴 切欄位**認 `\|` 跳脫** —— 板上 138 列這樣寫,而那是**正確**的寫法。
    不認跳脫的切法會算錯「最後一格」(2026-09-06 實測:82 列因此被放錯格)。
 ③ 同一列有**兩個不同**的 token ⇒ 它**不猜哪個對**,`--check` 報出來、`--fix` **不動它**。
    只有兩個**一模一樣**的才去重。
 ④ 它看不到「別窗把新內容插在前面」這件事本身 —— 只看得到結果。
    真正的修法是規矩:**新內容接在 token 後面,不要插在前面。**

用法:
  python3 scripts/board-token-normalize.py --check     違規列數 + 清單,有違規 rc=1
  python3 scripts/board-token-normalize.py --fix       搬正 + 去重,印逐列動作
  python3 scripts/board-token-normalize.py --selftest  兩個世界(含 `\|` 跳脫)
"""
import io, os, re, sys

BOARD = 'docs/launch-todo.md'
CLOSED = ('open', 'doing', 'parked', 'done', 'standing')
SPLIT = re.compile(r'(?<!\\)\|')
FIND = re.compile(r'⟨(?:擋|不擋|未判|—)[^⟩]*⟩')
HEADS = ('⟨擋', '⟨不擋', '⟨未判', '⟨—⟩')


def last_idx(line, fields):
    """最後一格的索引。行尾有沒有分隔符要分開處理(板上兩種形狀都有)。"""
    return len(fields) - 2 if re.search(r'\|\s*$', line) else len(fields) - 1


def scan(lines):
    """回 (misplaced, dup_same, dup_diff, done_blocking);每項是 (行號, 錨或欄2, 說明)。

    done_blocking = 態是 `done` 而 token 仍是 ⟨擋⟩ 的列。
    🔴 **只警告, 不影響 rc** —— 2026-09-07 主視窗裁「先量分母」:
       它可能是「做完了忘了更新 token」, 也可能是「態被誤標 done」,
       而**這兩件的修法相反** ⇒ 工具不猜, 印出來給人判。
    🛑 失效方向已量到:2026-09-07 那 4 列全部是【做完了而 token 停在擋】
       ⇒ 讀 token 的人會以為它還在擋 ⇒ 那是【派重了】的燃料。
    """
    misplaced, dup_same, dup_diff, done_blocking = [], [], [], []
    for n, line in enumerate(lines, 1):
        if not line.startswith('| '):
            continue
        f = SPLIT.split(line)
        if len(f) < 4 or f[1].strip() not in CLOSED:
            continue
        toks = FIND.findall(line)
        if not toks:
            continue
        m = re.search(r'⟦[^⟧]*⟧', f[2])
        key = m.group(0) if m else (f[2].strip() or f':{n}')
        if f[1].strip() == 'done' and toks[0].startswith('⟨擋'):
            done_blocking.append((n, key, toks[0][:24]))
        if len(toks) > 1:
            (dup_same if len(set(toks)) == 1 else dup_diff).append((n, key, f'{len(toks)} 個'))
            continue
        if not f[last_idx(line, f)].strip().startswith(HEADS):
            misplaced.append((n, key, toks[0][:24]))
    return misplaced, dup_same, dup_diff, done_blocking


def fix_line(line):
    """搬正 / 去重。回 (新行, 動作) 或 (原行, None)。"""
    f = SPLIT.split(line)
    toks = FIND.findall(line)
    if len(set(toks)) > 1:
        return line, None                      # 兩個不同的 ⇒ 不猜
    tok = toks[0]
    j = last_idx(line, f)
    if len(toks) == 1 and f[j].strip().startswith(HEADS):
        return line, None
    base = line
    for _ in range(len(toks)):
        base = FIND.sub('', base, count=1)
    f2 = SPLIT.split(base)
    j2 = last_idx(base, f2)
    cell = f2[j2]
    lead = len(cell) - len(cell.lstrip())
    f2[j2] = cell[:lead] + tok + ' ' + cell[lead:].lstrip()
    new = '|'.join(f2)
    # 🔴 驗:去掉 token 後(收斂空白)必須與原行去掉全部 token 後相同, 且剩恰好 1 個
    if re.sub(r'\s+', ' ', FIND.sub('', new, count=1)).strip() != re.sub(r'\s+', ' ', base).strip():
        return line, None
    if len(FIND.findall(new)) != 1:
        return line, None
    return new, ('去重+搬正' if len(toks) > 1 else '搬正')


def run(path, mode):
    lines = io.open(path, encoding='utf-8').read().split('\n')
    mis, dsame, ddiff, dblock = scan(lines)
    if mode == '--check':
        print(f'── board-token-normalize --check:{path}')
        print(f'   token 不在最後一格開頭 {len(mis)} 列 · 重複(相同){len(dsame)} 列 · 重複(不同){len(ddiff)} 列')
        for group, label in ((mis, '位移'), (dsame, '重複相同'), (ddiff, '重複不同')):
            for n, k, why in group:
                print(f'   {label:6} :{n:5} {k}  {why}')
        if ddiff:
            print('   🔴 「重複(不同)」本工具【不修】—— 它不猜哪一個才是對的, 要人開檔判。')
        print(f'   ── 另外(只警告, 不影響 rc):態 done 而 token 仍 ⟨擋⟩ {len(dblock)} 列')
        for n, k, why in dblock:
            print(f'   done+擋 :{n:5} {k}  {why}')
        if dblock:
            print('   🟡 它可能是【做完了忘了更新 token】, 也可能是【態被誤標 done】——')
            print('      🔴 這兩件的修法【相反】 ⇒ 本工具不猜, 開檔判。')
            print('      🛑 已量到的失效方向:讀 token 的人以為它還在擋 ⇒ 那是【派重了】的燃料。')
        return 1 if (mis or dsame or ddiff) else 0
    changed = 0
    for i, line in enumerate(lines):
        if not line.startswith('| '):
            continue
        f = SPLIT.split(line)
        if len(f) < 4 or f[1].strip() not in CLOSED or not FIND.search(line):
            continue
        new, act = fix_line(line)
        if act:
            lines[i] = new
            changed += 1
            m = re.search(r'⟦[^⟧]*⟧', SPLIT.split(new)[2])
            print(f'   ✅ :{i+1:5} {act} {m.group(0) if m else ""}')
    io.open(path, 'w', encoding='utf-8').write('\n'.join(lines))
    print(f'── 動了 {changed} 列')
    return 0


def selftest():
    # 🔴 剝掉繼承來的 git 環境(自檢清單;git -C 擋不住它)
    for v in ('GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'GIT_OBJECT_DIRECTORY',
              'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_NAMESPACE'):
        os.environ.pop(v, None)
    import tempfile
    d = tempfile.mkdtemp()
    bad = os.path.join(d, 'bad.md')
    good = os.path.join(d, 'good.md')
    rows_bad = [
        '| 態 | # | 事 | 誰 | 卡什麼 |',
        '|---|---|---|---|---|',
        '| open | ⟦x-A⟧ | 甲 | 誰 | ⟨擋(t)⟩ 正常:token 在格首 |',
        '| open | ⟦x-B⟧ | 乙 | 誰 | 別窗插的新內容 ⟨擋(t)⟩ 被推走的 |',
        '| open | ⟦x-C⟧ | 丙 | 誰 | ⟨不擋(t)⟩ 內文含 `a\\|b\\|c` 而 token 在格首 |',
        '| open | ⟦x-D⟧ | 丁 | 誰 | 內文含 `a\\|b\\|c` 而 ⟨不擋(t)⟩ 被推走 |',
        '| open | ⟦x-E⟧ | 戊 | 誰 | ⟨擋(t)⟩ 重複相同 ⟨擋(t)⟩ |',
        '| open | ⟦x-F⟧ | 己 | 誰 | ⟨擋(t)⟩ 重複不同 ⟨不擋(t)⟩ |',
        # 🔴 done+⟨擋⟩ 那條規則的【兩個世界】(2026-09-07 加)
        '| done | ⟦x-G⟧ | 庚 | 誰 | ⟨擋(t)⟩ 正對照:做完了而 token 停在擋 ⇒ 必須叫 |',
        '| done | ⟦x-H⟧ | 辛 | 誰 | ⟨不擋(t)⟩ 負對照:同樣是 done 而 token 不是擋 ⇒ 必須【不】叫 |',
        '| open | ⟦x-I⟧ | 壬 | 誰 | ⟨擋(t)⟩ 負對照:同樣是擋而態不是 done ⇒ 必須【不】叫 |',
    ]
    io.open(bad, 'w', encoding='utf-8').write('\n'.join(rows_bad) + '\n')
    io.open(good, 'w', encoding='utf-8').write('\n'.join(
        [rows_bad[0], rows_bad[1], rows_bad[2], rows_bad[4]]) + '\n')
    fails = []

    def ck(name, got, want):
        ok = got == want
        print(f'  {"✅" if ok else "🔴"} {name}:{got}(期望 {want})')
        if not ok:
            fails.append(name)

    mis, ds, dd, db = scan(io.open(bad, encoding='utf-8').read().split('\n'))
    ck('世界 A(壞)位移列', len(mis), 2)          # x-B, x-D(含跳脫那列)
    ck('世界 A(壞)重複相同', len(ds), 1)          # x-E
    ck('世界 A(壞)重複不同', len(dd), 1)          # x-F
    ck('done+擋 命中(正對照 x-G)', len(db), 1)
    ck('done+擋 命中的是 x-G(不是 x-H/x-I)', db[0][1] if db else '無', '⟦x-G⟧')
    mis2, ds2, dd2, db2 = scan(io.open(good, encoding='utf-8').read().split('\n'))
    ck('世界 B(乾淨)位移列', len(mis2), 0)
    ck('世界 B(乾淨)重複', len(ds2) + len(dd2), 0)
    ck('世界 B(乾淨)done+擋', len(db2), 0)
    ck('世界 A rc', run(bad, '--check'), 1)
    ck('世界 B rc', run(good, '--check'), 0)
    print('  ── --fix 之後 ──')
    run(bad, '--fix')
    mis3, ds3, dd3, _db3 = scan(io.open(bad, encoding='utf-8').read().split('\n'))
    ck('修後 位移', len(mis3), 0)
    ck('修後 重複相同', len(ds3), 0)
    ck('修後 重複不同(刻意不修)', len(dd3), 1)
    txt = io.open(bad, encoding='utf-8').read()
    ck('跳脫那列的 `a\\|b\\|c` 還在', txt.count('`a\\|b\\|c`'), 2)
    print('SELFTEST ' + ('PASS' if not fails else 'FAIL:' + ','.join(fails)))
    return 0 if not fails else 1


if __name__ == '__main__':
    a = sys.argv[1] if len(sys.argv) > 1 else ''
    if a == '--selftest':
        sys.exit(selftest())
    if a in ('--check', '--fix'):
        t = sys.argv[2] if len(sys.argv) > 2 else BOARD
        if not os.path.isfile(t):
            print(f'🔴 查無:{t} ⇒ 量具缺席', file=sys.stderr)
            sys.exit(2)
        sys.exit(run(t, a))
    print(__doc__)
    sys.exit(2)
