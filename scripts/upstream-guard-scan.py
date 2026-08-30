#!/usr/bin/env python3
"""板 `⟦b4-UPSTREAM1⟧`(`docs/launch-todo.md`)那把尺 —— **重寫版 + 補三種守門寫法**。

問的問題:**「守門釘在上游、而那一格讀下游」有幾格。**
形狀 = 讀檔 ⇒ 轉換(`replace`/`slice`/`match`/…)⇒ 用轉換後的東西掃字面, **而下游沒有任何斷言頂著**。

🔴 **為什麼這支檔在 repo 裡, 不在誰的 scratchpad**:線G `-52` 2026-08-29 寫過同一把尺, 交接檔
   `~/pcm-mailbox/線G-交件給下手窗-上游守門那一族的分母-20260829.md:18` 逐字寫著落點是
   `<scratchpad>/upstream-guard-scan.py` —— **而那個 session 沒了, 那支檔也沒了**
   ⇒ 2026-08-31 線【客人帳戶區】`-08` 照交接檔 `:14-18` 的量法字面**重寫一次**。
   📌 **一把工具【存在過】與【下一個人找得到它】是兩件事**(同 `scripts/tool-final-css.py` 那條)。

🔴 **本版補了線G 自己點名它漏掉的三種守門寫法**(交接檔逐字:「補上這三種, 147 會明顯下降」——
   而**線G 刻意沒補**, 因為那一列只要分母):
   ① `expect(X, '訊息').toMatch(…)`  —— 兩個參數 / 可跨行(舊尺的 regex 只認 `expect(X).toMatch`)
   ② `expect(X).not.toBe('')`        —— 「不得為空」是負向寫法的**正向**守門
   ③ `expect(X).toHaveLength(n)`     —— `n>0` 時它就是一道非空守門

⚠️ **`①` 收窄過兩次(自審抓的, 不是審查抓的)**:第一版讓 `toBe` 後面接任何東西 ⇒
   `expect(X, msg).toBe('')`(**斷言它是空的**)被算成守門 ⇒ 那是相反的東西。
   收窄前後:**81 ⇒ 97**(16 格是被那個鬆掉的 `toBe` 誤算成「有守門」)。
   📌 **⇒ 一把尺往「情況比較好」的方向錯時, 它產生的數字最不會被回頭查。**

🛑 **射程(照線G 的四條, 一條都沒解掉)**:helper 做的轉換 / 轉換在別支檔 / 多層轉換只判前兩層 /
   只認七個轉換方法名。**再加本版自己的一條**:守門寫法仍然是一份**黑名單**(七種)——
   📌 **一族缺陷用【它怎麼寫】當分母, 就會漏掉用別種寫法的同一族;而這把尺自己就是那個形狀。**

🛑 **本檔唯讀, 一個字都不寫進 repo。**
用法:`python3 scripts/upstream-guard-scan.py [輸出清單路徑]` · 自檢:`--selftest`
"""
import re, subprocess, io, sys

DERIVE = re.compile(r'^\s*(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*\.\s*'
                    r'(replace|slice|match|split|join|toLowerCase|toUpperCase|trim)\s*\(')

def uses(name):
    n = re.escape(name)
    return [re.compile(p % n) for p in (
        r'\b%s\s*\.\s*includes\s*\(', r'\b%s\s*\.\s*match\s*\(',
        r'\bexpect\s*\(\s*%s\b',      r'\b%s\s*\.\s*indexOf\s*\(')]

def guards_old(name):
    n = re.escape(name)
    return [re.compile(p % n) for p in (
        r'expect\s*\(\s*%s\s*\.\s*length',
        r'expect\s*\(\s*%s\s*\)\s*\.\s*toContain',
        r'expect\s*\(\s*%s\s*\)\s*\.\s*toMatch',
        r"expect\s*\(\s*%s\s*\)\s*\.\s*toBe\s*\(\s*['\"]")]

def guards_new(name):
    """線G 自己點名它漏掉的三種(交接檔:『補上這三種, 147 會明顯下降』)。"""
    n = re.escape(name)
    return [
        # ① expect(X, '訊息').toMatch(…) —— 兩個參數 / 可跨行
        # ⚠️ 收窄兩次(自審):①`toBe` 後面必須是【非空】字面 —— `expect(X, msg).toBe('')` 是
        #    「斷言它是空的」, 那不是守門, 是相反的東西 ②訊息參數限 200 字內、非貪婪, 免得跨到下一個 expect
        re.compile(r"expect\s*\(\s*%s\s*,[\s\S]{0,200}?\)\s*\.\s*(?:toMatch|toContain|"
                   r"not\s*\.\s*toBe\s*\(\s*['\"]{2}|toBe\s*\(\s*['\"][^'\"])" % n),
        # ② expect(X).not.toBe('') —— 「不得為空」是負向寫法的正向守門
        re.compile(r'expect\s*\(\s*%s\s*\)\s*\.\s*not\s*\.\s*toBe\s*\(\s*[\'"]{2}\s*\)' % n),
        # ③ expect(X).toHaveLength(n) —— n>0 時就是一道非空守門
        re.compile(r'expect\s*\(\s*%s\s*\)\s*\.\s*toHaveLength\s*\(\s*([1-9]\d*)\s*\)' % n),
    ]

def files_at(rev=None):
    if rev:
        out = subprocess.run(['git','ls-tree','-r','--name-only',rev],capture_output=True,text=True).stdout
    else:
        out = subprocess.run(['git','ls-files'],capture_output=True,text=True).stdout
    return [f for f in out.split('\n') if f.endswith(('.test.ts','.test.tsx'))]

def read(f, rev=None):
    if rev:
        r = subprocess.run(['git','show',f'{rev}:{f}'],capture_output=True,text=True)
        return r.stdout if r.returncode==0 else None
    try: return io.open(f,encoding='utf-8').read()
    except Exception: return None

def scan(rev=None, only=None, fake=None):
    tests = files_at(rev)
    withread = 0; shapes = 0; unguarded_old = 0; unguarded_new = 0; rows=[]
    for f in tests:
        if only and f != only: continue
        src = read(f, rev)
        if src is None: continue
        if 'readFileSync' not in src: continue
        withread += 1
        lines = src.split('\n')
        for i,l in enumerate(lines):
            m = DERIVE.match(l)
            if not m: continue
            name = fake or m.group(1)
            body = '\n'.join(lines[i+1:])
            if not any(p.search(body) for p in uses(name)): continue
            shapes += 1
            go = any(p.search(body) for p in guards_old(name))
            gn = go or any(p.search(body) for p in guards_new(name))
            if not go: unguarded_old += 1
            if not gn: unguarded_new += 1; rows.append(f'{f}:{i+1}  {name}')
    return dict(tests=len(tests), withread=withread, shapes=shapes,
                old=unguarded_old, new=unguarded_new, rows=rows)



def _selftest() -> int:
    """兩個對照 + 一個內部差分。任一格不符 ⇒ rc=1。"""
    F = 'apps/admin/src/lib/shipping/shipment-candidates.test.ts'
    ok = True

    def check(label, got, want):
        nonlocal ok
        good = got == want
        ok = ok and good
        print(f"  {'✅' if good else '🔴'} {label}: 得 {got} / 期望 {want}")

    # 正對照:`ed8427ae` 就是修好那一格的 commit ⇒ 尺必須看得到修前修後的差別
    check('正對照 修之前 該支沒守門', scan(rev='ed8427ae^', only=F)['new'], 1)
    check('正對照 修之後 該支沒守門', scan(rev='ed8427ae', only=F)['new'], 0)
    # 負對照:把下游比對用的變數名換成現造的 ⇒ 一格都不該命中
    check('負對照 現造變數名 形狀命中', scan(fake='zzNeverAVar')['shapes'], 0)
    # 內部差分:補三種寫法必須讓數字【下降】—— 不降代表那三種 regex 一格都沒配到
    r = scan()
    print(f"  {'✅' if r['new'] < r['old'] else '🔴'} 內部差分: 舊尺 {r['old']} ⇒ 新尺 {r['new']}"
          f" (必須下降;不降 = 那三種寫法一格都沒配到)")
    ok = ok and r['new'] < r['old']
    print("🛑 而本自檢【不驗】的:那三種 regex 有沒有把【不是守門的東西】算成守門 ——"
          "\n   那要開檔逐格看, 本檔只能保證「它看得見一件真的被修好的事」。")
    return 0 if ok else 1


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        raise SystemExit(_selftest())
    r = scan()
    print(f"① 測試檔          {r['tests']}")
    print(f"② 含 readFileSync {r['withread']}")
    print(f"③ 形狀命中        {r['shapes']}")
    print(f"④ 舊尺說沒守門    {r['old']}   (線G 2026-08-29 報 147)")
    print(f"⑤ 補三種寫法後    {r['new']}   ⇒ 下降 {r['old'] - r['new']} 格")
    print("🔴 ⑤ 仍然是【上界】不是答案 —— 守門寫法是一份黑名單, 見檔頭射程。")
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if args:
        io.open(args[0], 'w', encoding='utf-8').write('\n'.join(r['rows']))
        print(f"清單已寫 {args[0]}({len(r['rows'])} 行)")
