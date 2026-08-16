#!/usr/bin/env python3
"""守門涵蓋圖:每一支 .ts/.tsx 被哪些守門看得到，以及【沒有任何守門看得到】的集合。

起因(2026-08-17):同一輪撞到三個獨立實例，全部落在守門邊界外 ——
  · `scripts/spikes/` 的舊簽名呼叫，`turbo typecheck` 抓不到
  · `turbo typecheck` 20/20 全綠，而 `build` 內的 tsc 抓到 3 個錯
  · 只動 `.test.tsx` 的片若被判輕量、可能兩邊都沒查到

🔴 本腳本的界線(先寫，免得結果被讀成比它強):
  · 它比對的是【設定檔宣告的涵蓋範圍】，不是【實際跑起來會不會報錯】。
    設定說涵蓋 ≠ 那條規則真的會對這個檔發出警告。
  · eslint 的 ignore(.eslintignore / flat config 的 ignores)未納入 ⇒ 本圖會【高估】lint 涵蓋。
  · 只看 .ts/.tsx。.sh/.sql/.yaml 走另一條(lint-staged 的 check-syntax-nonts)，不在本圖。
  · 產出的「零守門」集合是【上界的補集】⇒ 它是一份**要人去看**的清單，不是判決。
"""
import json, os, re, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
os.chdir(ROOT)

files = [
    Path(p) for p in subprocess.run(
        ['git', 'ls-files', '*.ts', '*.tsx'],
        capture_output=True, text=True, check=True).stdout.split('\n') if p
]

def under(p: Path, prefix: str) -> bool:
    return str(p).startswith(prefix)

# ── 守門 1:tsc（per-package tsconfig 的 include）────────────────────────────
# apps/{admin,storefront}: **/*.ts(x)  ／ packages/*: src/**/*
# 實查:apps/api 與 apps/sync-engine 【沒有 tsconfig.json】⇒ 不在任何 tsc 之下。
TSC_PKG = [
    ('apps/admin/', lambda p: True),
    ('apps/storefront/', lambda p: True),
] + [(f'packages/{name}/', lambda p: '/src/' in f'/{p}') for name in
     ('adapters', 'domain', 'ports', 'schemas', 'ui', 'use-cases')]

def in_tsc_pkg(p: Path) -> bool:
    for prefix, extra in TSC_PKG:
        if under(p, prefix) and extra(p):
            return True
    return False

# ── 守門 2:tsconfig.scripts.json ── include = ["scripts/*.ts"]（不遞迴）
def in_tsc_scripts(p: Path) -> bool:
    return p.parent == Path('scripts') and p.suffix == '.ts'

# ── 守門 3:vitest ── include {packages,apps,scripts}/**/*.{test,spec}.{ts,tsx}
def in_vitest(p: Path) -> bool:
    if not re.search(r'\.(test|spec)\.tsx?$', p.name):
        return False
    return str(p).split('/')[0] in ('packages', 'apps', 'scripts')

# ── 守門 4:eslint ── turbo run lint（各 package `eslint .`）+ root `eslint 'scripts/*.ts'`
def in_eslint(p: Path) -> bool:
    head = '/'.join(str(p).split('/')[:2])
    return head.startswith('apps/') or head.startswith('packages/') or in_tsc_scripts(p)

# ── 守門 5:next build 內的 tsc ── 只有兩個 next app
def in_build(p: Path) -> bool:
    return under(p, 'apps/admin/') or under(p, 'apps/storefront/')

GUARDS = [
    ('tsc(package)', in_tsc_pkg),
    ('tsc(scripts)', in_tsc_scripts),
    ('build tsc', in_build),
    ('vitest', in_vitest),
    ('eslint', in_eslint),
]

naked, by_guard = [], {name: 0 for name, _ in GUARDS}
for f in files:
    hits = [name for name, fn in GUARDS if fn(f)]
    for h in hits:
        by_guard[h] += 1
    if not hits:
        naked.append(f)

print(f'追蹤中的 .ts/.tsx 總數 = {len(files)}   ← 分母')
print()
print('每一支守門【宣告】涵蓋幾支:')
for name, _ in GUARDS:
    print(f'  {name:14s} {by_guard[name]:5d}')
print()
def report(title: str, items: list) -> None:
    print(f'{title} = {len(items)}')
    by_dir: dict = {}
    for f in items:
        by_dir.setdefault('/'.join(str(f).split('/')[:2]), []).append(f)
    for d in sorted(by_dir):
        print(f'  {d:34s} {len(by_dir[d]):4d} 支')
        for f in sorted(by_dir[d])[:4]:
            print(f'      {f}')
        if len(by_dir[d]) > 4:
            print(f'      …(其餘 {len(by_dir[d]) - 4} 支)')
    print()

report('🔴 A. 沒有任何守門涵蓋', naked)

# 🔴 B 比 A 更值得看:eslint 涵蓋很廣（它幾乎不會讓一個檔「完全沒人管」），
#    但 eslint【不做型別檢查】⇒ 「有 lint 沒有 tsc」= 型別錯誤不會被任何守門攔下。
no_types = [
    f for f in files
    if not in_tsc_pkg(f) and not in_tsc_scripts(f) and not in_build(f)
]
report('🔴 B. 沒有任何【型別】檢查涵蓋（lint 有沒有不算）', no_types)
