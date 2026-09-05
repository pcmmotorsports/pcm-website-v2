#!/usr/bin/env python3
"""vercel-json-waf-cron-gate —— repo 這一側:有人在 `vercel.json` 裡加了一條會擋到排程的 WAF 規則。

🔴 為什麼有這一支(2026-09-05 `-ship`,板列 ⟦f3-FWBYPASSORDER⟧):
   Vercel 的 WAF 規則有【兩條路】,而我們原本只知道一條。
   ① dashboard 的自訂規則 —— `vercel firewall rules list` 看得到
   ② 🔴 **`vercel.json` 的 `routes[].mitigate`** —— 官方 `custom-rules` 頁逐字:
        「`log`, **`bypass`**, and `redirect` actions are **not supported** in
         `vercel.json` configuration.」
      ⇒ 📌 **這條路上【放不了 bypass】** ⇒ 有人在這裡加一條 `deny`,
        而**沒有任何辦法在同一個地方放行 `/api/cron/`**。
   ⇒ ⇒ 🔴 **一次改碼就能殺掉排程**(對帳 / 出貨信),而排程死掉**不會有人通知你** ——
     那是「擋掉」不是「壞掉」,面板上一切正常。

🛑🛑 **本閘【看不到】live 那一半 —— 這句話要跟它的綠一起被讀到。**
   dashboard 上的自訂規則本閘**結構上看不見**(它們不在 repo 裡)。
   ⇒ **本閘全綠 ≠ 排程安全。** live 那一半是 `⟦f3-FWBYPASSORDER⟧` 甲-2,
     斷言形狀是「排在 bypass 之上沒有任何規則匹配 `/api/cron/`」,要本機 vercel 登入。
   ⇒ 📌 兩支**壞掉的方式不同**:本閘看得到的東西甲-2 看不見,反過來也是。

## 它怎麼判
不是「有 `mitigate` 就紅」—— 那太寬,合法的 deny 規則會被誤擋,而**閘死於誤報**。
✅ 判準是**機械的**:把 `src` 當 regex **真的拿去 match** 幾條代表性的排程路徑。
   匹配到 + action 是 `deny`/`challenge` ⇒ 紅。
   ⇒ 那不是啟發式,是**執行那個 regex**;它與 Vercel 用同一個字串做同一件事。
   ⚠️ **而射程要照實**:Vercel 的 `src` 是 **path-to-regexp 風格**,不保證與 Python `re` 逐字元同語意。
     ⇒ 本閘可能**多抓**(誤報,人看一眼就排除)也可能**少抓**(漏報)。
     ⇒ 🔴 **少抓那一側是它的天花板, 寫在這裡, 不藏。**
"""
import io, json, os, re, sys

# 代表性的排程路徑 —— 🔴 這是本閘的分母, 少一條就是一個看不見的洞
CRON_PATHS = [
    '/api/cron/',
    '/api/cron/reconcile',
    '/api/cron/shipped-email',
    '/api/cron/x/y',
]
BLOCKING = ('deny', 'challenge')


def find_vercel_json(root='.'):
    out = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in ('node_modules', '.git', '.next', '.turbo')]
        if 'vercel.json' in filenames:
            out.append(os.path.join(dirpath, 'vercel.json'))
    return sorted(out)


def scan_one(path, text=None):
    """回 (findings, note)。findings = [(src, action, 命中的路徑)]"""
    raw = text if text is not None else io.open(path, encoding='utf-8').read()
    try:
        doc = json.loads(raw)
    except Exception as e:
        return None, f'JSON 解析失敗:{type(e).__name__} {e}'
    routes = doc.get('routes')
    if not isinstance(routes, list):
        return [], None
    found = []
    for r in routes:
        if not isinstance(r, dict):
            continue
        mit = r.get('mitigate')
        if not isinstance(mit, dict):
            continue
        action = str(mit.get('action', '')).lower()
        if action not in BLOCKING:
            continue
        src = r.get('src')
        if not isinstance(src, str):
            found.append(('(src 不是字串)', action, '無法判定 ⇒ 保守當成命中'))
            continue
        try:
            rx = re.compile(src)
        except re.error as e:
            found.append((src, action, f'regex 編不起來({e})⇒ 保守當成命中'))
            continue
        hit = [p for p in CRON_PATHS if rx.search(p)]
        if hit:
            found.append((src, action, ', '.join(hit)))
    return found, None


def report(files):
    bad = 0
    for f in files:
        found, note = scan_one(f)
        if note is not None:
            print(f'🔴 {f} —— {note}')
            bad += 1
            continue
        if found:
            bad += 1
            print(f'🔴 {f}')
            for src, action, hit in found:
                print(f'     src={src}  action={action}  ⇒ 會匹配 {hit}')
        else:
            print(f'✅ {f} —— 沒有會擋到排程的 mitigate 規則')
    print(f'\n分母:掃了 {len(files)} 支 vercel.json · 代表性排程路徑 {len(CRON_PATHS)} 條')
    print('🛑 本閘【看不到】dashboard 上的自訂規則 —— 全綠 ≠ 排程安全。live 那半見 ⟦f3-FWBYPASSORDER⟧ 甲-2。')
    if bad:
        print('\n🔴 紅的那幾支要怎麼處理:')
        print('   `vercel.json` 這條路【放不了 bypass】(官方逐字)⇒ 你【不能】在同一支檔裡把排程放行。')
        print('   出路二選一:①把那條規則的 `src` 收窄到不會碰 `/api/cron/`')
        print('               ②改到 dashboard 的自訂規則去做, 並把它排在 bypass 【下面】')
        print('   ⛔ 不要用「把本閘的 CRON_PATHS 刪一條」讓它變綠 —— 那是把會叫的錯換成不會叫的錯。')
    return 1 if bad else 0


def selftest():
    # 🔴 碰 git 的 selftest 要先剝繼承來的 git 環境。本支不碰 git, 仍照鐵則剝掉 ——
    #    因為「今天不碰」不是「以後不碰」, 而那個改動不會有人記得回來加這一段。
    for v in ('GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'GIT_OBJECT_DIRECTORY',
              'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_NAMESPACE'):
        os.environ.pop(v, None)

    cells, fails = 0, 0

    def check(name, got, want):
        nonlocal cells, fails
        cells += 1
        ok = got == want
        if not ok:
            fails += 1
        print(f'{"✅" if ok else "🔴"} {name}  got={got!r} want={want!r}')

    S = json.dumps
    # ① 正對照:一條真的會擋到排程的 deny ⇒ 必須抓到
    f, _ = scan_one('<mem>', S({'routes': [{'src': '/api/(.*)', 'mitigate': {'action': 'deny'}}]}))
    check('正① /api/(.*) + deny ⇒ 命中', len(f), 1)

    # ② 正對照:換 challenge 也要抓
    f, _ = scan_one('<mem>', S({'routes': [{'src': '^/api/cron/', 'mitigate': {'action': 'challenge'}}]}))
    check('正② ^/api/cron/ + challenge ⇒ 命中', len(f), 1)

    # ③ 🔴 負對照:碰不到排程的 deny ⇒ 【不可以】紅(閘死於誤報)
    f, _ = scan_one('<mem>', S({'routes': [{'src': '/admin/(.*)', 'mitigate': {'action': 'deny'}}]}))
    check('負③ /admin/(.*) + deny ⇒ 不命中', len(f), 0)

    # ④ 🔴 負對照:會碰到排程【而 action 不是擋人的】⇒ 不可以紅
    #    (log 在 vercel.json 不支援, 但別人寫錯時本閘不該替它發明一個問題)
    f, _ = scan_one('<mem>', S({'routes': [{'src': '/api/cron/(.*)', 'mitigate': {'action': 'log'}}]}))
    check('負④ 命中路徑而 action=log ⇒ 不命中', len(f), 0)

    # ⑤ 負對照:根本沒有 routes ⇒ 不紅(那是今天兩支檔的樣子)
    f, _ = scan_one('<mem>', S({'framework': 'nextjs'}))
    check('負⑤ 沒有 routes ⇒ 不命中', len(f), 0)

    # ⑥ 負對照:有 routes 而沒有 mitigate ⇒ 不紅
    f, _ = scan_one('<mem>', S({'routes': [{'src': '/api/cron/(.*)', 'dest': '/x'}]}))
    check('負⑥ 有 routes 無 mitigate ⇒ 不命中', len(f), 0)

    # ⑦ 壞 JSON ⇒ 要回 note 而不是靜靜地放行
    f, note = scan_one('<mem>', '{ 這不是 JSON')
    check('⑦ 壞 JSON ⇒ 回 note 不是 None', note is not None, True)
    check('⑦ 壞 JSON ⇒ findings 是 None(不當成乾淨)', f is None, True)

    # ⑧ 🔴 尺自己的分母:CRON_PATHS 少一條就是一個洞 ⇒ 釘住
    check('⑧ CRON_PATHS 條數', len(CRON_PATHS), 4)

    # ⑨ 🔴 突變:把 BLOCKING 換成空 ⇒ 正對照①必須當場失效
    global BLOCKING
    keep = BLOCKING
    BLOCKING = ()
    f, _ = scan_one('<mem>', S({'routes': [{'src': '/api/(.*)', 'mitigate': {'action': 'deny'}}]}))
    check('⑨ 突變 BLOCKING=() ⇒ 正①當場失效(證明那一格承重)', len(f), 0)
    BLOCKING = keep

    # ⑩ 真的掃一次這棵樹 —— 今天必須是綠的(而它是【觀察】不是期望)
    files = find_vercel_json('.')
    check('⑩ 這棵樹找得到 vercel.json(尺有接上)', len(files) >= 1, True)

    print(f'\n分母:{cells} 格 · 紅 {fails} 格')
    return 1 if fails else 0


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        sys.exit(selftest())
    sys.exit(report(find_vercel_json('.')))
