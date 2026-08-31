#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""anchor-in-helper.py — 把 naked-cells.py 報的裸格【再分堆】, 不改那把尺。

🔴 為什麼是另一支而不是改 naked-cells.py(2026-09-01 主視窗裁):
   那把尺【沒有壞】—— 它答的是「這一格有沒有【就地】的正向錨」, 而那個問題有用途:
   就地的錨看得到, 抽成具名函式的錨要多開一支檔才看得到。
   ⇒ 它報的是「要多看一步」, 不是「這裡有缺陷」。
   ⇒ 而改共用量具會讓稽核前十二批的 1,284 / 195 換一個意思 ⇒ 不動它。

分堆(讀 naked-cells 的輸出, 逐格再分):
   ⓪ 負向語意的具名函式 —— 命中【不得】算錨(expectNotSent / expectNoWrite / expectMoneyUntouched …)
   ⓤ 🔴 具名函式【極性看不出來】(體內斷言不在 naked-cells 的字集內, 例:`rejects.toThrow`)
      ⇒ 必須開檔核。**它不是 ⓪** —— 「看不出來」與「是負向的」是兩個宣稱,
      而本工具 v1 把兩者併成一堆, 於是把 `expectRedirect`(它釘住一個【具體的】轉址字串,
      是真正的正向錨)標成「這不是錨」⇒ 標籤本身會把人推向錯的結論。
   ① 錨可能在具名 expect* 函式內 ⇒ 需開檔核(命中率預期低)
   ② 格內有 pos 斷言但仍被報裸(通常在迴圈內)⇒ 需開檔核
   ③ 真的一個錨都沒有 ⇒ 優先看

🛑 它擋不住什麼(引用前先讀這一節):
   1. **名字只是第一道篩, 不是判準。** 極性是讀【函式體內的斷言方向】算的, 而
      函式體的邊界是【近似】切的(切到下一個頂格非空白行)⇒ 多行 helper 可能被切短
      ⇒ 極性可能算錯 ⇒ 🔴 **每一格仍要開檔核, 本工具不下判斷、只分堆。**
   2. 只看【同一支檔內】定義的 helper。跨檔 import 進來的 expect* 看不到 ⇒ 會落到 ②/③。
   3. 極性「混合」或「看不出來」一律**不當成錨**, 歸 ⓤ 要人開檔 —— 保守方向:
      🔴 寧可把它留在「要看」那一堆, 也不要把一格可能真裸的算成有錨(假綠比假紅貴一個量級)。
   4. 它**不**回答「這一格好不好」。它只回答「我該先看哪一堆」。
"""
import io, os, re, sys, importlib.util

_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location('nc', os.path.join(_HERE, 'naked-cells.py'))
nc = importlib.util.module_from_spec(_spec)
sys.argv_backup = sys.argv; sys.argv = ['naked-cells.py']   # 免得它的 __main__ 吃到我們的參數
_spec.loader.exec_module(nc)
sys.argv = sys.argv_backup

DEF_RE = re.compile(r'^[ \t]*(?:export\s+)?(?:async\s+)?(?:function|const|let)\s+(expect[A-Z]\w*)', re.M)

def helper_bodies(src):
    """回傳 {名稱: 近似函式體}。邊界=【縮排回到定義那一行的層級】為止(含收尾那一行)。

    🔴 v1 用的是「切到下一個頂格(第 0 欄)非空白行」, 而**大部分 helper 定義在 describe 裡面
       ⇒ 從頭到尾沒有第 0 欄 ⇒ 函式體一路吃到檔尾**, 於是極性算的是【整支檔】不是那支函式。
       實錘:`expectMoneyUntouched` 體內其實三條全是 `toHaveBeenCalledWith`(純 pos),
       v1 卻算成 mixed —— 而它【看起來是對的】, 因為 mixed 也會被歸進「要開檔核」那堆。
       ⇒ 📌 一個算錯的極性, 落在一個保守的分堆裡 ⇒ **錯了也不會有人發現。**
    """
    out, lines = {}, src.split('\n')
    ind = lambda l: len(l) - len(l.lstrip())
    for m in DEF_RE.finditer(src):
        start = src.count('\n', 0, m.start())
        base = ind(lines[start])
        buf = [lines[start]]
        for ln in lines[start + 1:]:
            if not ln.strip():
                buf.append(ln); continue
            buf.append(ln)
            if ind(ln) <= base: break
        out[m.group(1)] = '\n'.join(buf)
    return out

def polarity(body):
    ks = [nc.kind(s) for s in nc.statements(body)]
    p, n = ks.count('pos'), ks.count('neg')
    if p and not n: return 'pos'
    if n and not p: return 'neg'
    if p and n: return 'mixed'
    return 'unknown'        # 🔴 一個 pos 一個 neg 都沒有 = 【看不出來】, 不是【負向】

def classify(path):
    src = io.open(path, encoding='utf-8').read()
    naked, _ = nc.naked_cells(src)
    if not naked: return []
    helpers = {k: polarity(v) for k, v in helper_bodies(src).items()}
    m = nc.mask(src)
    line_of = lambda off: m.count('\n', 0, off) + 1
    seg_of = {line_of(a): (a, b) for a, b in nc.cells(m)}
    out = []
    for ln in naked:
        a, b = seg_of[ln]
        raw, body = src[a:b], nc.body_of(m[a:b])
        called = sorted(h for h in helpers if re.search(r'\b%s\s*\(' % re.escape(h), raw))
        if any(helpers[h] == 'neg' for h in called):
            pile, why = '0', '+'.join(h for h in called if helpers[h] == 'neg') + ' 負向語意'
        elif any(helpers[h] in ('mixed', 'unknown') for h in called):
            bad = [h for h in called if helpers[h] in ('mixed', 'unknown')]
            pile, why = 'u', '+'.join(bad) + ' 極性看不出來(' + '+'.join(helpers[h] for h in bad) + ')'
        elif called:
            pile, why = '1', '+'.join(called)
        elif 'pos' in [nc.kind(s) for s in nc.statements(body)]:
            pile, why = '2', '格內有 pos 但仍被報裸'
        else:
            pile, why = '3', '零錨'
        out.append((pile, path, ln, why))
    return out

def selftest():
    ok = True
    def chk(label, got, want):
        nonlocal ok
        good = got == want
        ok = ok and good
        print('  %-4s %s ⇒ 得 %s / 應 %s' % ('ok' if good else 'FAIL', label, got, want))
    root = os.path.dirname(_HERE)
    f1 = os.path.join(root, 'apps/admin/src/components/orders/orders-table.test.tsx')
    f2 = os.path.join(root, 'apps/admin/src/lib/payment/refund-actions.test.ts')
    h1 = {k: polarity(v) for k, v in helper_bodies(io.open(f1, encoding='utf-8').read()).items()}
    h2 = {k: polarity(v) for k, v in helper_bodies(io.open(f2, encoding='utf-8').read()).items()}
    print('=== 正對照:expectRowsRendered 體內是 toBeGreaterThan(0) ⇒ 必須 pos ===')
    chk('expectRowsRendered 極性', h1.get('expectRowsRendered'), 'pos')
    chk('它的格歸 ①', sorted({p for p, _, _, w in classify(f1) if 'expectRowsRendered' in w}), ['1'])
    print('=== 🔴 負對照:expectMoneyUntouched 守【錢】⇒ 絕不得歸 ① ===')
    # 🔴 它的【名字】說 untouched, 而它的【體】三條全是 toHaveBeenCalledWith ⇒ pos。
    #    名字與極性相反, 而這正是「名字只當第一道篩」那條規矩的實物證據。
    chk('expectMoneyUntouched 極性(體=三條 toHaveBeenCalledWith)', h2.get('expectMoneyUntouched'), 'pos')
    chk('它不出現在 ① 堆', [p for p, _, _, w in classify(f2) if 'expectMoneyUntouched' in w and p == '1'], [])
    print('=== 🔴 第三道:【看不出來】不得被當成【負向】(2026-09-01 本工具自己踩到) ===')
    f3 = os.path.join(root, 'apps/admin/src/lib/staff-actions.test.ts')
    h3 = {k: polarity(v) for k, v in helper_bodies(io.open(f3, encoding='utf-8').read()).items()}
    chk('expectRedirect 極性 = unknown 而非 neg', h3.get('expectRedirect'), 'unknown')
    chk('它的格歸 ⓤ 不歸 ⓪', sorted({p for p, _, _, w in classify(f3) if 'expectRedirect' in w}), ['u'])
    print('=== 負對照:現造一個不存在的名字 ⇒ 必須查無 ===')
    chk('expectZZZNotReal', h1.get('expectZZZNotReal'), None)
    print('=== 自檢 %s ===' % ('全過' if ok else '有 FAIL'))
    return 0 if ok else 1

if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if a != '--selftest']
    if '--selftest' in sys.argv[1:]: sys.exit(selftest())
    if not args:
        print('用法: python3 scripts/anchor-in-helper.py <測試檔...>   /   --selftest'); sys.exit(2)
    rows = [r for f in args for r in classify(f)]
    for p, lab in (('3', '③ 真的零錨 ⇒ 先看這堆'), ('2', '② 格內有 pos 但仍被報裸(多在迴圈內)'),
                   ('u', '🔴 ⓤ 具名函式【極性看不出來】⇒ 必須開檔核, 不得當成任何一邊'),
                   ('1', '① 錨可能在具名 expect* 函式內 ⇒ 命中率預期低'),
                   ('0', '⓪ 🔴 具名函式是【負向語意】⇒ 這不是錨, 不得當它有守')):
        sel = [r for r in rows if r[0] == p]
        print('\n%s  —— %d 格' % (lab, len(sel)))
        for _, path, ln, why in sel: print('   %s:%s  %s' % (path, ln, why))
    print('\n合計 %d 格 / %d 支檔。🛑 本工具只分堆、不下判斷 —— 每一格仍要開檔核(見檔頭限制)。' %
          (len(rows), len({r[1] for r in rows})))
