#!/usr/bin/env python3
"""板 `⟦b4-B09c⟧`(33 項員工的一天)那個分母:**§1-A 的錨點裡, 有幾支自某個時點之後動過。**

🔴 **它存在的理由不是算出那個數, 是【把抽法寫下來】**(2026-08-31 主視窗指定):
   我 08-31 量到 **20 檔 / 14 格**, 而板上 `-9e` 08-27 量到 **20 檔 / 13 格**。
   **檔數相同、格數差 1** ⇒ 而我**分不出**那是「碼又動了」還是「兩把尺不一樣」——
   📌 **那個【對】的數字, 把那個【差 1】的解釋權搶走了**:人會說「檔數一樣所以是同一發,
      所以那 1 格是新的」。**而正確的讀法是「我不知道這兩發是不是同一種量測」。**
   ⇒ **所以本檔的產出是【方法】, 不是【數字】** —— 下一個人量到 15 的時候,
     他要分得出來那是碼動了還是尺不一樣。

**抽法(逐條寫死, 這就是那把尺)**:
  ① 資料列 = §1-A 範圍內(該檔 `:128` 到 `## 1. 驗收標準` 之前)符合 `^\\| <數字>[a-z]? \\|` 的行
     🛑 **不是整支檔** —— `:618` 起那張 `## 1.` 表是 **2026-08-06 的凍結快照**(`:128` 逐字「不要動它」),
        對它量會得到完全不同的數。
  ② 錨點 = 該列 `**錨點**` 之後、到第一個 `<br>` 或 `|` 之前, **反引號裡帶副檔名的路徑**
     (`.ts .tsx .sql .css .py .sh`)
  ③ 解析 = 原路徑存在就用它;否則依序試 `apps/admin/src/` `apps/storefront/src/` `packages/`;
     再不行用 `git ls-files` 找同檔名 —— **命中多支 ⇒ 標 AMBIG, 不猜**
  ④ 動過 = `git log --since=<時點> -- <解析後的路徑>` 非空
🛑 **本檔【不】處理**:同一格多個錨點的權重、錨點指到目錄、錨點寫在該格別的位置。

用法:`python3 scripts/spec-1a-anchor-drift.py [時點]`(預設 `2026-08-27`, 沿用板上那個 13 的時點)
自檢:`--selftest`
"""
import io, os, re, subprocess, sys, collections

SPEC = 'docs/specs/2026-07-25-admin-backend-rebuild-spec.md'
PATH = re.compile(r'`([A-Za-z0-9_./\[\]@-]*\.(?:tsx?|sql|css|py|sh))`')


def rows_1a():
    L = io.open(SPEC, encoding='utf-8').read().split('\n')
    start = next(i for i, l in enumerate(L) if l.startswith('## 1-A.'))
    end = next(i for i, l in enumerate(L) if i > start and l.startswith('## 1. '))
    return [(i + 1, l) for i, l in enumerate(L) if start < i < end and re.match(r'^\| \d+[a-z]? \|', l)]


def anchors():
    per = collections.OrderedDict()
    for _, l in rows_1a():
        num = re.match(r'^\| (\d+[a-z]?) \|', l).group(1)
        m = re.search(r'\*\*錨點\*\*(.*?)(?:<br>|\|)', l)
        per.setdefault(num, set()).update(PATH.findall(m.group(1)) if m else [])
    return per


def resolve(p):
    if os.path.exists(p):
        return p
    for pre in ('apps/admin/src/', 'apps/storefront/src/', 'packages/'):
        if os.path.exists(pre + p):
            return pre + p
    base = os.path.basename(p)
    hits = [x for x in subprocess.run(['git', 'ls-files', '*' + base], capture_output=True, text=True)
            .stdout.split('\n') if x.endswith('/' + base) or x == base]
    return hits[0] if len(hits) == 1 else ('AMBIG:%d' % len(hits) if hits else None)


def run(since):
    per = anchors()
    seen, moved_paths, moved_cells, unres = {}, set(), set(), []
    for num, ps in per.items():
        for p in ps:
            if p not in seen:
                seen[p] = resolve(p)
            rp = seen[p]
            if rp is None or str(rp).startswith('AMBIG'):
                unres.append((p, rp))
                continue
            if subprocess.run(['git', 'log', '--oneline', f'--since={since}', '--', rp],
                              capture_output=True, text=True).stdout.strip():
                moved_paths.add(rp)
                moved_cells.add(num)
    return per, seen, moved_paths, moved_cells, unres


def _selftest():
    ok = True
    per = anchors()
    checks = [
        ('§1-A 抓到的格數 > 20', len(per) > 20),
        ('至少有 20 格有錨點', sum(1 for v in per.values() if v) >= 20),
        # 🔴 正對照:一個【一定動過】的時點 ⇒ 必須有格命中
        ('正對照 since=2020-01-01 ⇒ 有格命中', bool(run('2020-01-01')[3])),
        # 🔴 負對照:一個【未來】時點 ⇒ 必須零格
        ('負對照 since=2099-01-01 ⇒ 零格', not run('2099-01-01')[3]),
        # 🛑 射程對照:對【凍結表】量會得到不同的東西 ⇒ 證明 ① 那條範圍是承重的
        ('凍結表不在分母裡(§1-A 起點在 ## 1-A.)',
         all(not l.startswith('## 1. ') for _, l in rows_1a())),
    ]
    for name, got in checks:
        ok = ok and got
        print(f"  {'✅' if got else '🔴'} {name}")
    print("🛑 而本自檢【不驗】的:我的抽法與 `-9e` 當時的抽法是不是同一把尺 —— "
          "那正是本檔存在的理由, 它答不出來。")
    return 0 if ok else 1


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        raise SystemExit(_selftest())
    since = next((a for a in sys.argv[1:] if not a.startswith('--')), '2026-08-27')
    per, seen, mp, mc, unres = run(since)
    print(f"時點 = {since}(沿用板上那個 13 的時點;換時點就換答案)")
    print(f"§1-A 資料格 {len(per)} · 有錨點 {sum(1 for v in per.values() if v)} · 錨點路徑去重 {len(seen)}")
    print(f"🔴 自 {since} 起動過的錨點 = {len(mp)} 支 ⇒ 涵蓋 {len(mc)} 格")
    print("   " + ' '.join('#' + k for k in sorted(mc, key=lambda x: int(re.sub(r'\D', '', x)))))
    print(f"解析不出來 {len(unres)} 支:{unres if unres else '無'}")
    print("🛑 對照板上 2026-08-27 的【20 檔 / 13 格】—— 檔數相同而格數差 1, "
          "而【那是碼動了還是尺不一樣, 本檔答不出來】。")
