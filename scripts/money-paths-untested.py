#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""money-paths-untested.py — 哪些【碰錢的入口】, 一個測試都執行不到。

🔴 為什麼要換這個問法(2026-09-01 主視窗裁):
   `naked-cells.py` 只看得到【已經存在的測試格】⇒ 一條**完全沒有測試**的錢路徑,
   它的裸格數是 **0** ⇒ **它在那把尺底下結構上是隱形的, 而那正是它會拿到滿分的地方。**
   (實測基底率:錢圈裸格核了 67 格 ⇒ 真缺口 0。那個 0 是「有寫測試的地方寫得不錯」的評語。)

分母三族(缺一族會系統性誤判, 所以三族分開數、分開印):
   A. server actions  —— 檔內有 'use server' 或檔名含 action, 且內容碰錢
   B. DB 函式         —— supabase/migrations 的 CREATE FUNCTION, 且名字碰錢
   C. route / cron    —— app/api 的 route.ts, 且內容碰錢

覆蓋判準(這是本工具最重要的一格):
   A / C:**解 import 鏈**。從每一支 *.test.ts(x) 出發, 遞移展開它 import 到的檔
          ⇒ 被走到 = 有測試執行得到它。🔴 **不是 grep 名字** —— 註解 / 字串 / 測試敘述都會命中。
   B:    SQL 沒有 import 鏈可解 ⇒ 只能看函式名有沒有出現在測試檔裡
          ⇒ 🔴 **這是【比較弱】的訊號, 本工具把 B 族單獨印, 不與 A/C 合併成一個數。**

🛑 它擋不住什麼:
   1. 動態 import / 字串拼出來的路徑 / barrel 檔轉出去的東西 —— 解析器看不到 ⇒ 會**少報覆蓋**
      ⇒ 方向是**偏向多報「沒測試」**(假指控), 不是漏報。已知, 且是刻意選的方向。
   2. 「被 import 到」不等於「那條分支被執行到」—— 一支檔被 import 進測試, 不代表它裡面
      每個 export 都被呼叫。⇒ 🔴 **本工具的「有測試」是【最寬鬆】的那一種, 而「零測試」是硬的。**
      ⇒ ⇒ 所以要看的是**零測試那一堆**, 而「有測試」那一堆**不構成任何保證**。
   3. 碰錢的判準是**字面關鍵字**(見 MONEY)—— 字集是人寫的, 漏一個詞就漏一族。
   4. B 族只掃 supabase/migrations;正式庫裡真正存在的函式**不在分母**(帳本 ≠ 正式庫)。
"""
import io, os, re, sys, json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MONEY = ['order', 'payment', 'refund', 'wallet', 'coupon', 'pricing', 'price',
         'charge', 'settle', 'invoice', 'tappay', 'money', 'amount', 'balance']
MONEY_RE = re.compile('|'.join(MONEY), re.I)
IMP = re.compile(r"""(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]""")
EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts']

def rel(p): return os.path.relpath(p, ROOT)

def walk(base, pred):
    for d, dirs, fs in os.walk(os.path.join(ROOT, base)):
        dirs[:] = [x for x in dirs if x not in ('node_modules', '.next', 'dist', '.turbo')]
        for f in fs:
            p = os.path.join(d, f)
            if pred(p): yield p

def pkg_roots():
    out = {}
    for d in sorted(os.listdir(os.path.join(ROOT, 'packages'))):
        pj = os.path.join(ROOT, 'packages', d, 'package.json')
        if os.path.exists(pj):
            out[json.load(io.open(pj, encoding='utf-8'))['name']] = os.path.join(ROOT, 'packages', d, 'src')
    return out

PKGS = pkg_roots()

def resolve(spec, src):
    """把一個 import 字串解成磁碟上的檔;解不出來回 None(見限制 1)。"""
    cands = []
    if spec.startswith('.'):
        cands.append(os.path.normpath(os.path.join(os.path.dirname(src), spec)))
    elif spec.startswith('@/'):
        app = src
        while app != ROOT and os.path.basename(os.path.dirname(app)) not in ('apps',):
            app = os.path.dirname(app)
            if app == '/': return None
        cands.append(os.path.join(app, 'src', spec[2:]))
    else:
        for name, root in PKGS.items():
            if spec == name: cands.append(os.path.join(root, 'index.ts'))
            elif spec.startswith(name + '/'): cands.append(os.path.join(root, spec[len(name) + 1:]))
    for c in cands:
        for e in [''] + EXTS + ['/index' + x for x in EXTS]:
            if os.path.isfile(c + e): return c + e
    return None

def reachable_from_tests():
    tests = [p for p in walk('apps', lambda p: re.search(r'\.test\.(ts|tsx)$', p))] + \
            [p for p in walk('packages', lambda p: re.search(r'\.test\.(ts|tsx)$', p))]
    seen, stack = set(), list(tests)
    while stack:
        f = stack.pop()
        if f in seen: continue
        seen.add(f)
        try: src = io.open(f, encoding='utf-8').read()
        except Exception: continue
        for spec in IMP.findall(src):
            t = resolve(spec, f)
            if t and t not in seen: stack.append(t)
    return seen, len(tests)

def family_a():
    out = []
    for p in walk('apps', lambda p: p.endswith(('.ts', '.tsx')) and '.test.' not in p):
        s = io.open(p, encoding='utf-8', errors='ignore').read()
        if ("'use server'" in s or '"use server"' in s or 'action' in os.path.basename(p).lower()):
            if MONEY_RE.search(s): out.append(p)
    return sorted(out)

def family_b():
    out = []
    for p in walk('supabase/migrations', lambda p: p.endswith('.sql')):
        for m in re.finditer(r'create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?(\w+)',
                             io.open(p, encoding='utf-8', errors='ignore').read(), re.I):
            if MONEY_RE.search(m.group(1)): out.append(m.group(1))
    return sorted(set(out))

def family_c():
    out = []
    for p in walk('apps', lambda p: os.path.basename(p) in ('route.ts', 'route.tsx')):
        if MONEY_RE.search(io.open(p, encoding='utf-8', errors='ignore').read()): out.append(p)
    return sorted(out)

# ── 「有沒有人在走」:呼叫端偵測 ────────────────────────────────────────────
# 🔴 2026-09-01 加。成因是量到的:本檔原本【沒有】這一格, 而它被臨時用全字串比對代替
#    ⇒ 一小時內造成三次訂正(-2d 說「應用碼在呼叫」證據是註解 · -a0 說「零呼叫端」漏了 migrations)
#    實錘:`redeem_coupon` 在 apps+packages 剝註解之後 = 0, 而呼叫它的是【另一支 DB 函式】
#          (`20260901021000_…:540  v_coupon_calc := public.redeem_coupon(`)
# 🛑 本函式擋不住什麼:①剝註解是【字面】剝的, 字串裡的 `--` / `//` 會被誤剝 ⇒ 偏向少報呼叫端
#    ②動態組出來的函式名(字串拼接)看不到 ③只看本 repo, 別的 repo 的呼叫端不在分母
SKIP_DIRS = ('node_modules', '.next', 'dist', '.turbo', 'coverage', 'build', '.git')

def _strip_comments(text, sql):
    text = re.sub(r'/\*.*?\*/', ' ', text, flags=re.S)          # 兩種語言都有的區塊註解
    text = re.sub(r'^\s*--[^\n]*$', '', text, flags=re.M) if sql else \
           re.sub(r'(?<!:)//[^\n]*', '', text)
    if sql:
        text = re.sub(r'--[^\n]*', '', text)
    return text

def callers_of(name):
    """回傳 [(檔, 行號, 那一行)] —— 只認【呼叫形狀】, 不認單純提到名字。"""
    out = []
    pats = [re.compile(r'\b(?:public\.)?%s\s*\(' % re.escape(name)),   # SQL / TS 直接呼叫
            re.compile(r"""rpc\(\s*['"]%s['"]""" % re.escape(name), re.S)]  # rpc('name'), 允許跨行
    # 🔴 這些【不是呼叫】—— 少了它們, 每一支函式都會被它自己的定義算成「有人在走」
    #    (2026-09-01 首版就踩到:create_order 印 115 處, 而頭兩處是 CREATE 與 REVOKE)
    notcall = re.compile(
        r'\b(?:CREATE|DROP|ALTER|COMMENT\s+ON|REVOKE|GRANT|SECURITY\s+LABEL\s+ON)\b'
        r'|to_regprocedure|to_regproc\b|pg_get_functiondef', re.I)
    for base, exts, sql in (('apps', ('.ts', '.tsx', '.js', '.mjs'), False),
                            ('packages', ('.ts', '.tsx'), False),
                            ('scripts', ('.ts', '.js', '.mjs'), False),
                            ('supabase/migrations', ('.sql',), True)):
        root = os.path.join(ROOT, base)
        if not os.path.isdir(root): continue
        for d, dirs, fs in os.walk(root):
            dirs[:] = [x for x in dirs if x not in SKIP_DIRS]
            for f in fs:
                if not f.endswith(exts) or '.test.' in f: continue
                fp = os.path.join(d, f)
                try: raw = io.open(fp, encoding='utf-8', errors='ignore').read()
                except Exception: continue
                if name not in raw: continue
                clean = _strip_comments(raw, sql)
                # 🔴 `rpc(` 與函式名可能【跨行】—— 而逐行比對看不到它
                #    (2026-09-01 正對照抓到:SupabaseOrderAdapter.ts 的 .rpc( 換行才接 'create_order')
                for m in pats[1].finditer(clean):
                    ln = clean.count('\n', 0, m.start()) + 1
                    src = clean.split('\n')[ln-1].strip()[:90]
                    if not notcall.search(src):
                        out.append((rel(fp), ln, src or "rpc( 跨行"))
                for i, line in enumerate(clean.split('\n'), 1):
                    if notcall.search(line): continue
                    # 🔴 字串字面裡的函式簽章【不是呼叫】—— 它是資料
                    #    (2026-09-01 量到:'public.create_order(jsonb,…)'::regprocedure 這種
                    #     出現在驗收斷言與錯誤訊息裡, 而它們把每支函式都算成「有人在走」)
                    # 🔴 只對 .sql 剝字串字面。TS 那一側【不能剝】——
                    #    因為有一種呼叫就住在字串裡:`'SELECT public.name(…)'` 交給 query 執行
                    #    (2026-09-01 抽驗抓到:PaymentConfirmerAdapter.ts:159 record_pending_invoice)
                    probe = re.sub(r"'[^']*'", "''", line) if sql else line
                    if pats[0].search(probe):
                        out.append((rel(fp), i, line.strip()[:90]))
    return out

def sql_name_in_tests(names):
    blob = ''
    for p in list(walk('apps', lambda p: re.search(r'\.test\.(ts|tsx)$', p))) + \
             list(walk('packages', lambda p: re.search(r'\.test\.(ts|tsx)$', p))):
        blob += io.open(p, encoding='utf-8', errors='ignore').read()
    return {n: (n in blob) for n in names}

def report():
    reach, ntests = reachable_from_tests()
    a, b, c = family_a(), family_b(), family_c()
    hits = sql_name_in_tests(b)
    print('分母(三族分開數, 不合併):A server actions %d · B DB 函式 %d · C route %d'
          % (len(a), len(b), len(c)))
    print('測試檔 %d 支 ⇒ import 鏈遞移走到 %d 個檔\n' % (ntests, len(reach)))
    for lab, items in (('A server actions', a), ('C route', c)):
        no = [p for p in items if p not in reach]
        print('== %s ==  零測試 %d / %d' % (lab, len(no), len(items)))
        for p in no: print('   ✗ ' + rel(p))
        print()
    no_b = [n for n, v in hits.items() if not v]
    print('== B DB 函式(訊號較弱:只看名字有沒有出現在測試裡)==  名字查無 %d / %d'
          % (len(no_b), len(b)))
    for n in no_b: print('   ✗ ' + n)
    print('\n🛑 「有測試」= 那支檔被 import 進某支測試, **不代表它每個 export 都被呼叫**'
          ' ⇒ 要看的是【零測試】那一堆(見檔頭限制 2)。')

def selftest():
    ok = True
    def chk(label, got, want):
        nonlocal ok
        g = got == want; ok = ok and g
        print('  %-4s %s ⇒ 得 %s / 應 %s' % ('ok' if g else 'FAIL', label, got, want))
    reach, _ = reachable_from_tests()
    print('=== 🟢 正對照:refund-form.ts 今晚親自核過有測試 ⇒ 必須走得到 ===')
    chk('refund-form.ts 在 reach 裡', os.path.join(ROOT, 'apps/admin/src/lib/payment/refund-form.ts') in reach, True)
    print('=== 🟢 正對照二:跨 workspace 套件也要解得開 ===')
    chk('@pcm/domain 的 refund.ts', os.path.join(ROOT, 'packages/domain/src/order/refund.ts') in reach, True)
    print('=== 🔵 負對照:現造一個不存在的檔 ⇒ 不得出現在任何一堆 ===')
    chk('不存在的檔', os.path.join(ROOT, 'apps/admin/src/lib/payment/zzz-not-real.ts') in reach, False)
    print('=== 🔵 負對照二:解析器不得把亂寫的 import 解出東西 ===')
    chk('resolve 亂字串', resolve('@zzz/not-real', os.path.join(ROOT, 'apps/admin/src/x.ts')), None)
    print('=== 🔴 呼叫端偵測(2026-09-01 加)—— 四道, 三正一負 ===')
    #    🟢 跨行的 rpc(:SupabaseOrderAdapter 的 .rpc( 換行才接 'create_order'
    chk('create_order 有呼叫端(跨行 rpc)', len(callers_of('create_order')) >= 1, True)
    #    🟢 呼叫端在【另一支 DB 函式】裡, 不在應用碼
    chk('redeem_coupon 有呼叫端(來自 migrations)', len(callers_of('redeem_coupon')) >= 1, True)
    #    🟢 同一行的 rpc('name')
    chk('admin_adjust_wallet 有呼叫端(同行 rpc)', len(callers_of('admin_adjust_wallet')) >= 1, True)
    #    🟢 第四種呼叫形狀:寫在 TS 的 SQL 字串裡交給 query 執行
    chk('record_pending_invoice 有呼叫端(TS 裡的 SQL 字串)', len(callers_of('record_pending_invoice')) >= 1, True)
    #    🔵 負對照
    chk('現造函式名 ⇒ 零呼叫端', callers_of('zzz_not_a_real_fn'), [])
    print('=== 🔴 第三道:MONEY 字集要真的在篩 —— 全 repo 不該每支檔都碰錢 ===')
    tot = len(list(walk('apps', lambda p: p.endswith('.ts') and '.test.' not in p)))
    chk('A 族 < 全部 .ts 的一半', len(family_a()) * 2 < tot, True)
    print('=== 自檢 %s ===' % ('全過' if ok else '有 FAIL'))
    return 0 if ok else 1

if __name__ == '__main__':
    sys.exit(selftest() if '--selftest' in sys.argv[1:] else (report() or 0))
