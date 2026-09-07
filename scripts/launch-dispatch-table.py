#!/usr/bin/env python3
r"""從板子【當場】印一張派工表:擋列 × 誰欄 × 態。

══ 為什麼是一支腳本, 不是一份 md ═══════════════════════════════════
2026-09-07 量到:`docs/launch-blocking-by-owner-20260906.md`(手寫的那份)
與板子**有 34 列對不上** —— 22 列「表上有而現在不擋」、12 列「現在擋而表上沒有」。
🛑 **而【漏掉的那 12 件】沒有任何東西會提醒你。**
📌 ⇒ **一份手寫的派工名單, 它的過期速度 = 板子的變動速度**(七個窗整夜在寫)。
   ⇒ 所以這裡不再產生第二份名單, **每次要看就當場從板子印**。

══ 它答什麼 / 不答什麼 ══════════════════════════════════════════
✅ 答:**現在**哪些列的 token 是 ⟨擋⟩, 各自的誰欄與態, 依誰欄分組。
🛑 **不答**:那一列做完了沒(要開檔)· 誰「應該」接(誰欄是人寫的, 可能沒更新)。
⚠️ **「態是 done 而 token 仍 ⟨擋⟩」的列會【單獨列出】** —— 它們不該算進「還在擋」。
"""
import io, os, re, sys, collections, subprocess, datetime

BOARD = os.environ.get('BOARD', 'docs/launch-todo.md')
SPLIT = re.compile(r'(?<!\\)\|')
STATES = ('open', 'doing', 'parked', 'done', 'standing')
# 誰欄裡認得出來的線(依出現順序取第一個命中)
LINES = ('mail', 'account', 'auth', 'front', 'ship', 'db', 'tidy', 'supply', 'f1', 'f3', 'mainB')


def rows(path):
    out = []
    for n, line in enumerate(io.open(path, encoding='utf-8'), 1):
        if not line.startswith('| '):
            continue
        f = SPLIT.split(line)
        if len(f) < 5 or f[1].strip() not in STATES:
            continue
        last = (f[-2] if line.rstrip().endswith('|') else f[-1]).lstrip()
        if not last.startswith('⟨擋'):
            continue
        m = re.search(r'⟦[^⟦⟧]+⟧|#\d+', f[2])
        who = f[4]
        # 🔴 只在誰欄找線名 —— 不掃整列。整列會撈到證據段裡提到的別條線。
        lm = next((x for x in LINES if x in who), None)
        out.append((n, f[1].strip(), m.group(0) if m else '(無錨)',
                    lm or '—無主—', f[3].strip()))
    return out


def main(path):
    rs = rows(path)
    live = [r for r in rs if r[1] != 'done']
    dead = [r for r in rs if r[1] == 'done']
    ts = datetime.datetime.now().strftime('%Y-%m-%d %H:%M')
    sha = subprocess.run(['git', 'rev-parse', '--short', 'HEAD'],
                         capture_output=True, text=True).stdout.strip() or '?'
    print(f'# 派工表(當場印 · {ts} · HEAD `{sha}`)')
    print()
    print(f'⟨擋⟩ 標記 **{len(rs)}** 列 · 其中態已 `done` **{len(dead)}** ⇒ 🔴 **還在擋 {len(live)}**')
    print()
    by = collections.Counter(r[3] for r in live)
    print('| 線 | 幾件 |')
    print('|---|---|')
    for k, v in sorted(by.items(), key=lambda x: (x[0] == '—無主—', -x[1])):
        print(f'| `{k}` | **{v}** |')
    print()
    for k, _ in sorted(by.items(), key=lambda x: (x[0] == '—無主—', -x[1])):
        print(f'## `{k}`({by[k]} 件)')
        print()
        print('| 行 | 態 | 錨 | 一句 |')
        print('|---|---|---|---|')
        for n, st, a, _w, t in live:
            if _w == k:
                print(f'| {n} | {st} | `{a}` | {t[:48].replace("|", "\\|")} |')
        print()
    if dead:
        print(f'## ⚠️ 態已 `done` 而 token 仍 ⟨擋⟩({len(dead)} 列)—— **不算進「還在擋」**')
        print()
        for n, st, a, w, t in dead:
            print(f'· `{a}`(:{n} · 誰 `{w}`)⇒ **該窗要判:token 該更新, 還是態該退回?**')
        print()
    print('---')
    print('🛑 **本表答的是「現在誰欄寫著誰」, 不是「誰應該接」** —— 誰欄是人寫的, 可能沒更新。')
    print('🛑 **也不答「那一列做完了沒」** —— 那要開檔(`python3 scripts/what-happened-to.py <錨>` 只是入口)。')
    return 0


def selftest():
    import tempfile, shutil
    d = tempfile.mkdtemp()
    p = os.path.join(d, 'b.md')
    base = ['| 態 | 錨 | 事 | 誰 | x |', '|---|---|---|---|---|',
            '| open | ⟦t-A⟧ | 甲 | 線【信】`mail` | ⟨擋(t)⟩ x |',
            '| done | ⟦t-B⟧ | 乙 | `ship` | ⟨擋(t)⟩ x |',
            '| open | ⟦t-C⟧ | 丙 | 待派 | ⟨不擋(t)⟩ x |']
    fails = []

    def ck(name, got, want):
        ok = got == want
        print(f'  {"✅" if ok else "🔴"} {name}:{got}(期望 {want})')
        if not ok:
            fails.append(name)

    io.open(p, 'w', encoding='utf-8').write('\n'.join(base) + '\n')
    r = rows(p)
    ck('⟨擋⟩ 的列被撈到', len(r), 2)
    ck('⟨不擋⟩ 的列不進來', any(x[2] == '⟦t-C⟧' for x in r), False)
    ck('done 那列有撈到(要單獨列)', any(x[2] == '⟦t-B⟧' and x[1] == 'done' for x in r), True)
    ck('誰欄認得出線名', next(x[3] for x in r if x[2] == '⟦t-A⟧'), 'mail')
    # 🔴 正對照:現造一列擋 ⇒ 必須出現
    io.open(p, 'w', encoding='utf-8').write(
        '\n'.join(base + ['| open | ⟦t-NEW⟧ | 丁 | `auth` | ⟨擋(t)⟩ x |']) + '\n')
    ck('新增一列擋 ⇒ 出現', any(x[2] == '⟦t-NEW⟧' for x in rows(p)), True)
    # 🔴 負對照:同一列改成 ⟨不擋⟩ ⇒ 必須消失(而不是「改了檔就一定變」)
    io.open(p, 'w', encoding='utf-8').write(
        '\n'.join(base + ['| open | ⟦t-NEW⟧ | 丁 | `auth` | ⟨不擋(t)⟩ x |']) + '\n')
    ck('同一列改成不擋 ⇒ 消失', any(x[2] == '⟦t-NEW⟧' for x in rows(p)), False)
    # ⚠️ 誰欄只掃誰欄:證據段提到別條線不可以被算成那條線的
    io.open(p, 'w', encoding='utf-8').write(
        '\n'.join(base[:2] + ['| open | ⟦t-D⟧ | 戊 | 待派 | ⟨擋(t)⟩ 這段證據提到 `ship` 與 `db` |']) + '\n')
    ck('證據段提到別線 ⇒ 仍算無主', next(x[3] for x in rows(p) if x[2] == '⟦t-D⟧'), '—無主—')
    # ═══ 端到端:真的呼叫 `main()`(2026-09-07;`selftest-guards-what --ops` 逼出來的)═══
    #   🔴 上面七格【全部只測 `rows()`】—— 一格都沒碰過 `main()`。
    #      而 `main()` 裡有 5 個比較運算子, 突變它們 ⇒ **selftest 五發全綠**
    #      ⇒ 📌 **輸出那一段當時沒有任何東西守著**:live/dead 分堆、無主排最後、
    #         每一線底下只列自己那幾件 —— 這些壞掉了不會有人知道。
    io.open(p, 'w', encoding='utf-8').write('\n'.join(base) + '\n')
    import contextlib
    _buf = io.StringIO()
    with contextlib.redirect_stdout(_buf):
        _rc = main(p)
    _out = _buf.getvalue()
    ck('端到端 main() rc', _rc, 0)
    # live(非 done)才進各線清單;done 那列要被分出去
    ck('端到端 `⟦t-A⟧`(open)進線清單', '⟦t-A⟧' in _out, True)
    ck('端到端 `⟦t-C⟧`(不擋)不出現', '⟦t-C⟧' in _out, False)
    # 🔴 這一格守 `by` 那段的 `== '—無主—'` 排序鍵:無主要排最後
    io.open(p, 'w', encoding='utf-8').write(
        '\n'.join(base + ['| open | ⟦t-E⟧ | 己 | 待派 | ⟨擋(t)⟩ x |']) + '\n')
    _b2 = io.StringIO()
    with contextlib.redirect_stdout(_b2):
        main(p)
    _o2 = _b2.getvalue()
    _head = _o2[:_o2.index('## ')] if '## ' in _o2 else _o2
    # 🔴🔴 `:48` 的 `dead` 決定「**還在擋幾件**」那個數 —— 那是 Sean 讀的頭條數字,
    #    而 `--ops` 突變它(`== 'done'` ⇒ `!= 'done'`)**存活**。這一格守它。
    #    fixture 裡有 1 列 done+擋(⟦t-B⟧)、2 列非 done+擋 ⇒ 標記 3 · done 1 · 還在擋 2。
    io.open(p, 'w', encoding='utf-8').write(
        '\n'.join(base + ['| open | ⟦t-E⟧ | 己 | 待派 | ⟨擋(t)⟩ x |']) + '\n')
    _b3 = io.StringIO()
    with contextlib.redirect_stdout(_b3):
        main(p)
    _o3 = _b3.getvalue()
    ck('端到端 標記/done/還在擋 三個數都對',
       ('標記 **3**' in _o3, '`done` **1**' in _o3, '還在擋 2' in _o3), (True, True, True))
    # 🔵 而第二個活口 `:62` 是排序鍵, 上一格已經守住 ⇒ 兩個活口一起收。
    ck('端到端 無主那一列排在摘要最後',
       _head.rindex('—無主—') > _head.rindex('mail'), True)
    # 🔴 **同一個排序鍵在這支檔裡有【兩個】**(:59 摘要表 · :62 各線章節)——
    #    我第一版只斷言了摘要那半, 而 `--ops` 突變 `:62` **照樣存活**。
    #    ⇒ 📌 **一段複製貼上的邏輯, 只守其中一份 = 另一份沒有東西守著,
    #       而它們在 diff 上看起來是「同一件事已經測過了」。**
    _secs = [ln for ln in _o2.split('\n') if ln.startswith('## `')]
    ck('端到端 各線章節也是無主排最後(第二個排序鍵)',
       _secs and '—無主—' in _secs[-1], True)
    shutil.rmtree(d)
    print('SELFTEST PASS' if not fails else f'SELFTEST FAIL:{fails}')
    return 0 if not fails else 1


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        sys.exit(selftest())
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else BOARD))
