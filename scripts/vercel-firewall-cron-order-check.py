#!/usr/bin/env python3
"""vercel-firewall-cron-order-check —— live 這一側:有規則排在 bypass【上面】而它會擋到排程。

🔴 為什麼有這一支(2026-09-05 `-ship`,板列 ⟦f3-FWBYPASSORDER⟧ 甲-2):
   官方 `firewall-concepts` 逐字:「The bypass action allows specific traffic to skip any
   **subsequent** firewall rules.」⇒ 📌 **bypass 只跳過【它下面的】, 它救不了【它上面的】。**
   ⇒ 任何人加一條會匹配 `/api/cron/` 的擋人規則而**排在 bypass 之上** ⇒ 排程當場死,
     而**沒有人會被通知** —— 那是「擋掉」不是「壞掉」, 面板上一切正常。

🎯 **斷言形狀刻意選成「兩個世界都對」的那一個**:
   「**排在 bypass 之上, 沒有任何規則會匹配 `/api/cron/`**」
   ⇒ 🔵 **所以本支【不需要知道】`rules add` 把新規則放在哪一格**(官方文件沒寫, 我沒查到)——
     加在最前 ⇒ 它會叫;加在最後 ⇒ 它不叫, 而不叫是對的。
     📌 **add 的位置只決定它【多久叫一次】, 不決定它【對不對】。**

🛑🛑 **本支【看不到】repo 那一半 —— 這句話要跟它的綠一起被讀到。**
   `vercel.json` 的 `routes[].mitigate` 也能設 WAF 規則, 而**那條路上放不了 bypass**
   (官方逐字:「`log`, `bypass`, and `redirect` actions are **not supported** in
    `vercel.json` configuration.」)⇒ 它們**不在** `vercel firewall rules list` 裡。
   ⇒ **本支全綠 ≠ 排程安全。** repo 那一半是甲-1 `scripts/vercel-json-waf-cron-gate.py`。
   ⇒ 📌 兩支**壞掉的方式不同**:本支看得到的東西甲-1 看不見, 反過來也是。

🔴🔴 **它【沒有】掛進任何常態流程 —— 那是刻意的, 不是忘了。**
   跑一次 = **對 Vercel 發 1 次唯讀請求**(`rules list --json --expand`, 一發拿到全部)。
   ⇒ 「查一次現況」與「每次推 dev 都自動查」是**兩個不同射程的授權** ⇒ 後者要 Sean 點頭。
   ⇒ 在那之前它是**手動工具**:`python3 scripts/vercel-firewall-cron-order-check.py`

⚠️ **要在主樹跑** —— worktree 沒有 `.vercel` link, 在 worktree 跑回 `not_linked`;
   🔴 **那是【設定缺失】不是【服務故障】**, 而兩者的訊息很像 ⇒ 本支把它分開報。
"""
import io, json, os, re, subprocess, sys

CRON_PREFIX = '/api/cron/'
CRON_PATHS = ['/api/cron/', '/api/cron/reconcile', '/api/cron/shipped-email', '/api/cron/x/y']
BLOCKING = ('deny', 'challenge', 'rate_limit')   # 🔴 rate_limit 也會擋 —— 超過就 429


def path_conditions(rule):
    """回這條規則裡所有 path 條件 [(op, value)]。非 path 的條件本支不判(見天花板)。"""
    out = []
    for grp in rule.get('conditionGroup') or []:
        for c in grp.get('conditions') or []:
            if c.get('type') == 'path':
                out.append((c.get('op'), c.get('value')))
    return out


def matches_cron(op, value):
    """這個 path 條件會不會碰到排程?保守:判不出來就回 True(寧可誤報)。"""
    if not isinstance(value, str):
        return True
    if op == 'eq':
        return value in CRON_PATHS or value == CRON_PREFIX
    if op == 'pre':                     # starts with
        return CRON_PREFIX.startswith(value) or value.startswith(CRON_PREFIX)
    if op == 'suf':                     # ends with
        return any(p.endswith(value) for p in CRON_PATHS)
    if op == 'inc':                     # contains
        return any(value in p for p in CRON_PATHS)
    if op in ('re', 'nre'):
        try:
            rx = re.compile(value)
        except re.error:
            return True
        return any(rx.search(p) for p in CRON_PATHS)
    return True                          # 🔴 沒見過的 op ⇒ 保守當成會碰到


def action_of(rule):
    return str(((rule.get('action') or {}).get('mitigate') or {}).get('action', '')).lower()


def analyse(rules):
    """回 (bypass 的 index 或 None, 問題清單)。index 從 0 起。"""
    bypass_i = None
    for i, r in enumerate(rules):
        if action_of(r) == 'bypass' and any(matches_cron(op, v) for op, v in path_conditions(r)):
            bypass_i = i
            break
    problems = []
    upper = rules if bypass_i is None else rules[:bypass_i]
    for i, r in enumerate(upper):
        act = action_of(r)
        if act not in BLOCKING:
            continue
        conds = path_conditions(r)
        if not conds:
            continue
        hit = [f'{op} {v}' for op, v in conds if matches_cron(op, v)]
        if hit:
            problems.append((i + 1, r.get('name'), act, '; '.join(hit)))
    return bypass_i, problems


def fetch(scope='pcm-motorsports'):
    """1 次唯讀請求。回 (rules, err)。"""
    p = subprocess.run(['vercel', 'firewall', 'rules', 'list', '--json', '--expand',
                        '--scope', scope], capture_output=True, text=True)
    out = p.stdout
    if 'not_linked' in out:
        return None, ('not_linked', '這棵樹沒有 .vercel link ⇒ 要在【主樹】跑。'
                                    '🔴 這是設定缺失, 不是 Vercel 掛掉。')
    s = min([x for x in (out.find('{'), out.find('[')) if x >= 0] or [-1])
    if s < 0:
        return None, ('no_json', f'rc={p.returncode};輸出裡找不到 JSON ⇒ 可能未登入或命令變了。')
    try:
        d = json.loads(out[s:])
    except Exception as e:
        return None, ('bad_json', f'{type(e).__name__} {e}')
    return (d.get('rules') if isinstance(d, dict) else d) or [], None


def report(rules):
    bypass_i, problems = analyse(rules)
    for i, r in enumerate(rules, 1):
        mark = '  ← Bypass' if (bypass_i is not None and i - 1 == bypass_i) else ''
        print(f'  #{i} {str(r.get("name"))[:34]:36} {action_of(r):12}{mark}')
    print(f'\n分母:{len(rules)} 條規則 · 代表性排程路徑 {len(CRON_PATHS)} 條')
    if bypass_i is None:
        print('🔴 找不到任何【匹配 /api/cron/ 的 bypass 規則】 ⇒ 排程沒有放行規則保護。')
        print('   ⚠️ 而這也可能是規則被改名或條件被改了 ⇒ 去開面板看, 不要直接加一條。')
        return 1
    print(f'🔵 bypass 在第 {bypass_i + 1} 條;它【上面】有 {bypass_i} 條規則要檢查。')
    if bypass_i == len(rules) - 1:
        print('🟡 而它是【最後一條】 ⇒ 它下面沒有東西 ⇒ **它今天保護不了任何東西**。')
        print('   排程今天安全, 是因為上面那幾條剛好沒有匹配到它 —— 不是因為 bypass 在擋。')
    if problems:
        print('\n🔴 有規則排在 bypass 之上而會擋到排程:')
        for pos, name, act, hit in problems:
            print(f'   #{pos} {name}  action={act}  ⇒ {hit}')
        print('\n   出路:把它排到 bypass【下面】, 或把條件收窄到不會碰 /api/cron/。')
        print('   ⛔ 不要把 bypass 移到最上面 —— 2026-09-02 codex 與 -0a 都裁定不要')
        print('      (移了會讓 /api/cron/ 跳過【所有現在與未來的】自訂規則)。')
    else:
        print('✅ bypass 之上沒有任何規則會擋到排程。')
    print('\n🛑 本支【看不到】vercel.json 的 routes[].mitigate ⇒ 全綠 ≠ 排程安全。')
    print('   repo 那一半:python3 scripts/vercel-json-waf-cron-gate.py')
    return 1 if problems else 0


# ── fixtures:selftest 只吃這些, 【零對外】 ────────────────────────────────
def R(name, action, op, value):
    return {'name': name, 'action': {'mitigate': {'action': action}},
            'conditionGroup': [{'conditions': [{'type': 'path', 'op': op, 'value': value}]}]}


BYPASS = R('bypass-machine-traffic', 'bypass', 'pre', '/api/cron/')


def selftest():
    for v in ('GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'GIT_OBJECT_DIRECTORY',
              'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_NAMESPACE'):
        os.environ.pop(v, None)
    cells = fails = 0

    def check(name, got, want):
        nonlocal cells, fails
        cells += 1
        ok = got == want
        if not ok:
            fails += 1
        print(f'{"✅" if ok else "🔴"} {name}  got={got!r} want={want!r}')

    # 🟢 今天的真實形狀(bypass 最後)⇒ 不可以紅
    today = [R('facet', 'rate_limit', 'eq', '/api/catalog/facet-counts'),
             R('tappay log', 'log', 'pre', '/api/checkout/tappay-notify/'),
             R('login log', 'log', 'pre', '/login'),
             R('tappay ceiling', 'rate_limit', 'pre', '/api/checkout/tappay-notify/'),
             BYPASS]
    i, p = analyse(today)
    check('負① 今天的真實順序 ⇒ 零問題', (i, len(p)), (4, 0))

    # 🔴 正對照:一條 deny 排在 bypass 上面而匹配排程
    bad = [R('kill', 'deny', 'pre', '/api/'), BYPASS]
    i, p = analyse(bad)
    check('正② deny /api/ 在 bypass 上 ⇒ 1 個問題', (i, len(p)), (1, 1))

    # 🔴 正對照:rate_limit 也算擋人(超過就 429)
    i, p = analyse([R('rl', 'rate_limit', 'pre', '/api/cron/'), BYPASS])
    check('正③ rate_limit 也要抓', len(p), 1)

    # 🟢 負對照:同一條 deny 排在 bypass【下面】⇒ 不可以紅
    i, p = analyse([BYPASS, R('kill', 'deny', 'pre', '/api/')])
    check('負④ 同一條排到 bypass 下面 ⇒ 零問題', (i, len(p)), (0, 0))

    # 🟢 負對照:碰不到排程的 deny 排在上面 ⇒ 不可以紅(閘死於誤報)
    i, p = analyse([R('admin', 'deny', 'pre', '/admin/'), BYPASS])
    check('負⑤ /admin/ deny 在上面 ⇒ 零問題', len(p), 0)

    # 🟢 負對照:log 排在上面且匹配排程 ⇒ 不紅(log 不擋人)
    i, p = analyse([R('l', 'log', 'pre', '/api/cron/'), BYPASS])
    check('負⑥ log 匹配排程 ⇒ 零問題', len(p), 0)

    # 🔴 沒有 bypass ⇒ 要回 None(而不是安靜地當成沒問題)
    i, p = analyse([R('x', 'log', 'pre', '/login')])
    check('⑦ 沒有 bypass ⇒ index 是 None', i, None)

    # 🔴 保守:沒見過的 op ⇒ 當成會碰到(寧可誤報)
    check('⑧ 沒見過的 op ⇒ 保守回 True', matches_cron('???', '/whatever'), True)

    # 🔴 突變:把 BLOCKING 換空 ⇒ 正②當場失效
    global BLOCKING
    keep = BLOCKING
    BLOCKING = ()
    i, p = analyse(bad)
    check('⑨ 突變 BLOCKING=() ⇒ 正②失效(證明那格承重)', len(p), 0)
    BLOCKING = keep

    # 🔴 突變:把 bypass 之上的切法拿掉(改成掃全部)⇒ 負④ 當場失效
    i, _ = analyse([BYPASS, R('kill', 'deny', 'pre', '/api/')])
    allp = [r for r in [BYPASS, R('kill', 'deny', 'pre', '/api/')]
            if action_of(r) in BLOCKING and any(matches_cron(o, v) for o, v in path_conditions(r))]
    check('⑩ 突變 不切 bypass 之上 ⇒ 負④會變成 1(證明順序那一格承重)', len(allp), 1)

    check('⑪ CRON_PATHS 分母', len(CRON_PATHS), 4)
    print(f'\n分母:{cells} 格 · 紅 {fails} 格 · 🔵 本次 selftest 對外請求 = 0 次(全吃 fixture)')
    return 1 if fails else 0


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        sys.exit(selftest())
    rules, err = fetch()
    if err:
        kind, msg = err
        print(f'🔴 讀不到規則({kind}):{msg}')
        sys.exit(2)          # 🔴 2 = 讀不到, 與 1 = 有問題【分開】—— 兩者要人做的事不同
    sys.exit(report(rules))
