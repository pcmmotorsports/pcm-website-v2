#!/usr/bin/env python3
"""reachable-ci-scripts —— 「CI 跑一次會執行到哪些 scripts/*.sh 與 .husky/*」的可重跑清單。

天花板/範圍: 只涵蓋【兩個管道】——
  (V) 測試 spawn 管道:`pnpm test`(vitest)裡會 spawn/copy+執行 shell 的測試檔所觸及的腳本。
      這一段【不是本工具當場靜態推導的】——它 frozen 自 -ed 2026-08-27 在拋棄式 repo 端到端實跑後
      逐支開檔核過的結果(見下 FROZEN_TEST_CHANNEL 的 provenance)。本工具對它做的是【錨點防腐】:
      驗每一支的來源錨(檔:token)還在;錨爛了就紅、要人重新實跑推導——不是自己重推。
  (D) ci.yml 直跑管道:CI 的「Run self-contained SQL probes」步驟【直接 bash 跑】的腳本。
      這一段是【當場 live 算的】(同 CI 用的機制:掃 `# ci-self-contained: yes` 標記 + ci.yml 裡字面 bash)。
  不涵蓋:別的 CI job、runtime 才由「repo 外的資料」決定要跑什麼的、以及日後新增的管道。

天花板/量具: 🔴 管道 C(變數組出路徑呼叫,如 `bash "$CHECKS"`)對【任何字面尺】都是結構性盲區——
  migration-static-checks.sh 是被 `CHECKS="$HERE/migration-static-checks.sh"` 這樣叫的,grep 字面撈不到它。
  它在清單裡是 frozen 自 -ed 的實跑,**本工具沒有、也無法靜態推導出它**。
  🔴 而「被測試檔提到」≠「被執行」:.husky/pre-commit 被三支測試 readFileSync(只讀內容做斷言)、
  一次都沒被跑 ⇒ 它【不在】可達集。一把「grep 測試檔字面路徑」的尺會把它誤收——這正是 -ed 那份
  原始 10 支犯的病(它把「被提到」與「被執行」混在一起,含 3 筆假陽性)。本工具用【負對照】把這件事釘住。
  ⚠️ 而同一條病套在【本工具自己】身上:錨點防腐只驗「token 還在錨檔裡」,【不】驗「它還在執行路徑上」——
  錨在 = 沒退化到更糟,≠ 仍可達。真的要重推可達性,得像 -ed 那樣把 e2e 測試端到端跑一遍、逐支開檔判執行。

用法:  python3 scripts/reachable-ci-scripts.py            列全部可達腳本(分管道 + 怎麼到的)
        python3 scripts/reachable-ci-scripts.py --self-check   跑正負對照 + 錨點防腐
退出碼: 0=乾淨  1=錨爛了/自測失敗(要人重新推導)  2=工具自己壞了(用法錯)
"""
import subprocess, sys, os

ROOT = subprocess.run(['git', 'rev-parse', '--show-toplevel'],
                      capture_output=True, text=True).stdout.strip()

# ── frozen:測試 spawn 管道(-ed 2026-08-27 拋棄式 repo 端到端實跑 + 逐支開檔核;非本工具靜態推導)
#    每支:(path, 管道, 錨檔, 錨 token, 怎麼到的)。錨 token = 錨檔裡【必須還在】的字面,不在=腐爛。
FROZEN_TEST_CHANNEL = [
    ('scripts/guarded-edit.sh', 'A', 'scripts/guarded-edit.test.ts',
     'scripts/guarded-edit.sh', ':13 GUARD const → :24 spawnSync(bash,[GUARD,…]) 直接跑'),
    ('.husky/migration-post-commit-gate.sh', 'A', 'scripts/migration-post-commit-gate.test.ts',
     '.husky/migration-post-commit-gate.sh', ':44 GATE_SRC → copyFileSync 進 scratch → 真 git commit'),
    ('scripts/migration-post-commit-guard.sh', 'A', 'scripts/migration-post-commit-gate.test.ts',
     'scripts/migration-post-commit-guard.sh', ':45 GUARD_SRC → copyFileSync'),
    ('.husky/commit-msg', 'A', 'scripts/migration-post-commit-gate.test.ts',
     '.husky/commit-msg', ':374 CM_SRC → copyFileSync → 真 git commit. 🔴 無 .sh 副檔名(只掃 *.sh 會漏);2026-08-27 CI 炸的就是它'),
    ('scripts/migration-new-file-static-checks.sh', 'B', 'package.json',
     'scripts/migration-new-file-static-checks.sh', "lint-staged 鍵 'supabase/migrations/*.sql' ⇐ migration-new-file-gate.test.ts:120 stage 新 migration → 跑 lint-staged"),
    ('scripts/b2s2b-truth-sync.py', 'B', 'package.json',
     'scripts/b2s2b-truth-sync.py', "lint-staged 鍵 '{supabase/migrations/*.sql,…}' ⇐ 同一個 staged sql 點燃"),
    ('scripts/check-syntax-nonts.ts', 'B', 'package.json',
     'scripts/check-syntax-nonts.ts', "lint-staged 鍵 '*.{sh,yaml,yml,sql,py}' ⇐ check-syntax-nonts.gate.test.ts stage bad.sql/bad.sh/bad.py…(.ts 不是 .sh,但在分母)"),
    ('scripts/migration-static-checks.sh', 'C', 'scripts/migration-new-file-static-checks.sh',
     'migration-static-checks.sh', ':27 CHECKS=\"$HERE/migration-static-checks.sh\" → :100 bash \"$CHECKS\". 🔴 變數呼叫、字面尺看不到;frozen 自 -ed 實跑'),
]
FROZEN_PROVENANCE = '-ed 2026-08-27 拋棄式 repo 端到端實跑 + 逐支開檔核(原始 10 支修正掉 3 筆假陽性後)'

# ── 負對照:這些【看起來會跑】但其實不在可達集,釘住「被提到 ≠ 被執行」
NEG_CONTROLS = [
    ('.husky/pre-commit', '被 3 支測試 readFileSync(只讀內容做斷言)、執行 0 次 ⇒ 不可達。被三處提到讀起來像會跑'),
    ('scripts/l4a1-verify.sh', '無 ci-self-contained 標記、無測試 spawn ⇒ CI 零觸發(還沒發作 ≠ 沒問題)'),
]

CI_YML = '.github/workflows/ci.yml'


def _lines(path):
    p = os.path.join(ROOT, path)
    try:
        with open(p, encoding='utf-8') as f:
            return f.read().split('\n')
    except OSError:
        return None


def ci_direct_channel():
    """管道 D:live 算。① 帶 `# ci-self-contained: yes` 標記的 .sh(CI 掃它跑它)
       ② ci.yml 的 run: 區塊裡字面 `bash|sh <path>.sh`(如 probe-marker-guard.sh)。"""
    out = []
    # ① 標記集(同 CI 的機制:掃前 5 行)
    files = subprocess.run(['git', '-C', ROOT, 'ls-files', '*.sh'],
                           capture_output=True, text=True).stdout.split('\n')
    for f in files:
        if not f:
            continue
        ls = _lines(f)
        if ls and any(l.startswith('# ci-self-contained: yes') for l in ls[:5]):
            out.append((f, 'D', CI_YML, 'ci-self-contained: yes',
                        '帶 ci-self-contained: yes 標記 ⇒ CI「Run self-contained SQL probes」步驟直接 bash 跑'))
    # ② ci.yml 字面 bash/sh <腳本>.sh(排除註解行)
    import re
    ys = _lines(CI_YML) or []
    pat = re.compile(r'(?:bash|sh)\s+((?:scripts|\.husky|docs/probes)/[A-Za-z0-9._/-]+\.sh)')
    for i, l in enumerate(ys, 1):
        if l.lstrip().startswith('#'):
            continue
        m = pat.search(l)
        if m:
            p = m.group(1)
            if p not in [o[0] for o in out]:
                out.append((p, 'D', CI_YML, p, f'ci.yml:{i} 字面 bash 直跑'))
    return out


def check_anchor(anchor_file, token):
    """錨點防腐:錨檔存在且還含 token ⇒ True。爛了 ⇒ False。"""
    ls = _lines(anchor_file)
    if ls is None:
        return False
    return any(token in l for l in ls)


def reachable():
    """全可達集 = frozen 測試管道 + live ci.yml 管道。回 (list, rot_list)。"""
    rot = []
    rows = []
    for path, ch, af, tok, how in FROZEN_TEST_CHANNEL:
        ok = check_anchor(af, tok)
        if not ok:
            rot.append((path, af, tok))
        rows.append((path, ch, f'{af} [{tok}]', how, ok))
    for path, ch, af, tok, how in ci_direct_channel():
        rows.append((path, ch, af, how, True))
    return rows, rot


def report():
    rows, rot = reachable()
    order = {'A': 0, 'B': 1, 'C': 2, 'D': 3}
    rows.sort(key=lambda r: (order.get(r[1], 9), r[0]))
    labels = {'A': 'A 測試直接 spawn/copy+執行', 'B': 'B e2e lint-staged 點燃',
              'C': 'C 變數呼叫(字面尺看不到)', 'D': 'D ci.yml 直跑(live 算)'}
    cur = None
    for path, ch, src, how, ok in rows:
        if ch != cur:
            cur = ch
            print(f'\n## 管道 {labels.get(ch, ch)}')
        rot_tag = '' if ok else '  🔴錨爛了⇒要重新推導'
        print(f'  {path}{rot_tag}')
        print(f'      ⇐ {how}')
    v = sum(1 for r in rows if r[1] in ('A', 'B', 'C'))
    d = sum(1 for r in rows if r[1] == 'D')
    print(f'\n可達合計 {len(rows)} 支 = 測試管道 {v}(frozen,{FROZEN_PROVENANCE})+ ci.yml 管道 {d}(live 算)')
    print('負對照(看起來會跑、其實不在集內):')
    for p, why in NEG_CONTROLS:
        print(f'  ⬜ {p} —— {why}')
    if rot:
        print(f'\n🔴 {len(rot)} 個錨爛了 ⇒ frozen 清單腐蝕,要人重新端到端實跑推導:')
        for p, af, tok in rot:
            print(f'   {p}: 錨 {af} 已無 `{tok}`')
        return 1
    return 0


def self_check():
    ok = True

    def chk(cond, msg):
        nonlocal ok
        print(('  ✅ ' if cond else '  ❌ ') + msg)
        if not cond:
            ok = False

    rows, rot = reachable()
    reach_paths = {r[0] for r in rows}
    # 正對照:commit-msg 在集內(無 .sh 副檔名的那支)
    chk('.husky/commit-msg' in reach_paths, '正對照:.husky/commit-msg 在可達集(無 .sh 副檔名也抓到)')
    # 正對照:CI canary probe 被 live 管道 D 抓到
    chk('docs/probes/order-goods-axis-parity-probe.sh' in reach_paths,
        '正對照:order-goods-axis-parity-probe.sh 被 live 管道 D 抓到(CI canary)')
    chk('scripts/probe-marker-guard.sh' in reach_paths,
        '正對照:probe-marker-guard.sh 被 ci.yml 字面 bash 抓到')
    # 負對照:pre-commit / l4a1 不在集內
    for p, _ in NEG_CONTROLS:
        chk(p not in reach_paths, f'負對照:{p} 不在可達集(被提到 ≠ 被執行)')
    # 錨點全解析(frozen 沒腐蝕)
    chk(not rot, f'錨點防腐:{len(FROZEN_TEST_CHANNEL)} 個錨全解析、frozen 未腐蝕')
    print('  ⇒ self-check ' + ('PASS' if ok else 'FAIL'))
    return 0 if ok else 1


if __name__ == '__main__':
    arg = sys.argv[1] if len(sys.argv) > 1 else ''
    if arg in ('--self-check', '--selftest'):
        sys.exit(self_check())
    elif arg in ('-h', '--help'):
        print(__doc__)
        sys.exit(0)
    else:
        sys.exit(report())
