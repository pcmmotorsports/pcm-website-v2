#!/usr/bin/env python3
"""suite-reproducibility.py — 「跑一發全套」到底是不是一個可重現的量具?

    python3 scripts/suite-reproducibility.py                 連跑 2 發全套並比對總數
    python3 scripts/suite-reproducibility.py --runs 3        跑 3 發
    python3 scripts/suite-reproducibility.py --project admin 只跑一個 project(快很多)
    python3 scripts/suite-reproducibility.py --selftest      七個世界各表演一次(不跑 vitest)

═══ 這支檔存在的理由 ═══════════════════════════════════════════════════════
2026-08-25,兩個窗各自量到同一件事:**在這棵樹上跑一發全套測試,不是可重現的。**

    06 樣式線(storefront):跑八發拿到五種結果,其中一發**「全綠」而少 22 格**
    b4(全套 admin+storefront+node):三發三個總數 —— 11152 / 11101 / 11169,沒有兩發一樣

06 的判別句(本檔就是要把它變成可執行的):
    **「在這台機器上,一發全套的【紅】可能是負載,【綠】可能是沒跑完。
      兩個方向都失效 ⇒ 它不是一個證據,是一個樣本。」**
    **「沒跑完的那一發,長得跟跑完的那一發一模一樣,只有【總數】不同。」**

🔴 **而在本檔出現之前,那些數字散在三則【會隨 session 消失】的訊息裡** ——
   任何人要重新確認它,得自己從頭想一遍量法。本檔把它變成一行指令。

═══ 🔴 它量的是什麼、不是什麼 ═════════════════════════════════════════════
量的是   **同一份工作樹、連續 N 發之間,檔數與測項總數是否相同。**
不量的是 · 哪一支測試紅了(那是 vitest 自己的輸出,本檔原樣留檔)
         · 為什麼不穩(負載?逾時?收集失敗?本檔**不推測成因**)
         · 「N 發都一樣」⇒ **不等於**穩定。它只說「這 N 發沒有抓到不穩」。
           🔴 **樣本數寫在結論旁邊,不要只寫結論。**

═══ 🔴🔴 兩個病要分開報(1e 2026-08-25 量到,而它們的訊號不同)═════════════
    病 A  某支檔的 beforeAll 逾時 ⇒ **檔紅而 0 格紅**
          ⇒ 比對 files_failed vs tests_failed 抓得到(單發就抓得到)
    病 B  某支檔**根本沒出現** ⇒ **沒有任何東西紅**
          ⇒ 只有【連跑兩發比總數】抓得到
⇒ 本檔兩道都跑。**它們不是同一件事的兩種說法。**

═══ ⚠️ 它自己會不會弄髒 repo ═══════════════════════════════════════════════
本檔**自己**只讀不寫。而它會 spawn `vitest`,**那個行程會不會寫東西不歸本檔管** ——
⇒ 所以它在跑前跑後各照一次 `git status --porcelain`,**把足跡當成一個量測結果印出來**,
   而不是宣稱「零寫入」。🔴 **「我沒有寫」與「跑完之後樹沒有變」是兩個宣稱。**

═══ 🔴 這支檔【自己】的已知盲區(nit,cc/codex 2026-08-25 判可接受但要寫下來)══════
· `--selftest` 餵的全部是**罐頭字串** ⇒ 它證明得了「判準對」,證明不了
  「認得【真的 vitest 輸出】」。正式執行時抓不到那兩行摘要會回 RC_BROKEN(fail-closed),
  不會靜靜地回 0 —— 但那是兜底,不是覆蓋。**沒有一發真的 vitest 輸出跑過這支的解析。**
· 🔴🔴 **本檔的自檢驗得了 parse 的判準,驗不了它【印出來的那句話】。**
  實錘 2026-08-25:折 must-fix 時把 `fails` 換成六元素指紋,而印它的那段沒跟 ——
  標籤印「檔紅 10」而真值是 1(那是 files_total)、「總數一致」那句在總數不一致時照樣印。
  **自檢 9 格全 PASS、三綠全綠。** 抓到它的是把場景實跑出來、逐行讀那幾句字。
  ⇒ 改動本檔的輸出文字之後,**跑一次構造場景並讀輸出**,不要只看自檢綠不綠。
· 🔴 `todo` 與 `skipped` 同族(宣告了而從沒執行,卻算進總數)。它是 2026-08-25
  餵**真實 admin 輸出**才看到的,九格罐頭裡沒有 —— 那一行同時有五種字彙:
  `2 failed | 4983 passed | 2 expected fail | 8 skipped | 1 todo (4996)`。
· 🔴🔴 **罐頭的字集 = 作者想得到的那些。** 2026-08-25 第一次拿真實輸出來餵,
  就拿到一個九格裡都沒有的形狀:`Tests 3632 passed | 1 expected fail (3633)`。
  當時行為是**對的**,而對的原因是 `failed` 與 `fail` 差一個字母 —— **湊巧對,不是設計對**。
  ⇒ 已補 ⑩⑪ 兩格把那個行為釘住。**而未來 vitest 新增的摘要字彙,這些罐頭一樣看不見它們。**
· 輸出裡若有多份 `Test Files/Tests` 摘要,`search()` 靜默取【第一份】。
  ⚠️ 現行 vitest 4.1.5 三個 project 是一次全域摘要 ⇒ 現在不會系統性少報。
  **這是未來的洞,不是現在的洞。** 哪天摘要變成每個 project 一份,這裡要改。

回傳碼:0 這 N 發總數一致 / 1 總數不一致(不可重現)/ 2 有病 A 的訊號 / 3 環境不足 / 4 它自己壞了
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys

RC_SAME, RC_DIFFER, RC_SHAPE_A, RC_ENV, RC_BROKEN = 0, 1, 2, 3, 4

# vitest 尾巴那兩行。刻意寬鬆:passed/failed/skipped 的組合會變,而我們只要那兩個總數。
FILES_RE = re.compile(r'^\s*Test Files\s+(?P<body>.+?)\((?P<total>\d+)\)\s*$', re.M)
TESTS_RE = re.compile(r'^\s*Tests\s+(?P<body>.+?)\((?P<total>\d+)\)\s*$', re.M)
FAILED_RE = re.compile(r'(\d+)\s+failed')
# 🔴 MF-2(cc/codex 2026-08-25):`90 passed | 10 skipped (100)` 與 `100 passed (100)`
#    的【兩個總數完全相同】⇒ 只比總數會把「10 格根本沒執行」報成 ✅。
#    skipped 不是「跑了而沒紅」,是【沒跑】—— 那正是本檔要防的病。
SKIPPED_RE = re.compile(r'(\d+)\s+skipped')
# 🔴 `todo` 與 skipped 同族:**宣告了而從來沒執行**,卻被算進總數。
#    2026-08-25 餵真實 admin 輸出才看到它 ——
#    `Tests 2 failed | 4983 passed | 2 expected fail | 8 skipped | 1 todo (4996)`
#    ⇒ 沒有它, 一發 `0 skipped + 5 todo` 與 `0 skipped + 0 todo` 的指紋【完全相同】。
TODO_RE = re.compile(r'(\d+)\s+todo')


def parse(out: str) -> dict | None:
    """從 vitest 輸出抓 (檔數, 檔紅數, 測項數, 測項紅數)。抓不到 ⇒ None(**不是 0**)。

    🔴 回 None 而不回零:「沒有紅」與「沒有量到」必須分得開 —— 那正是本檔在講的病。
    """
    f, t = FILES_RE.search(out), TESTS_RE.search(out)
    if f is None or t is None:
        return None
    fail_f = FAILED_RE.search(f.group('body'))
    fail_t = FAILED_RE.search(t.group('body'))
    skip_f = SKIPPED_RE.search(f.group('body'))
    skip_t = SKIPPED_RE.search(t.group('body'))
    todo_t = TODO_RE.search(t.group('body'))
    return {
        'files_total': int(f.group('total')),
        'files_failed': int(fail_f.group(1)) if fail_f else 0,
        'files_skipped': int(skip_f.group(1)) if skip_f else 0,
        'tests_total': int(t.group('total')),
        'tests_failed': int(fail_t.group(1)) if fail_t else 0,
        'tests_skipped': int(skip_t.group(1)) if skip_t else 0,
        'tests_todo': int(todo_t.group(1)) if todo_t else 0,
    }


def fingerprint(r: dict) -> tuple:
    """一發的結果指紋。**skipped 在裡面** —— 見 MF-2:總數相同而 skipped 不同 = 沒跑完。"""
    return (r['files_total'], r['files_failed'], r['files_skipped'],
            r['tests_total'], r['tests_failed'], r['tests_skipped'], r['tests_todo'])


def git_status() -> str:
    r = subprocess.run(['git', 'status', '--porcelain'], capture_output=True, text=True)
    return r.stdout


def one_run(project: str | None, keep: str | None, i: int) -> tuple[dict | None, str]:
    cmd = ['npx', 'vitest', 'run']
    if project:
        cmd += ['--project', project]
    r = subprocess.run(cmd, capture_output=True, text=True)
    out = r.stdout + r.stderr
    if keep:
        with open(f'{keep}/run-{i}.txt', 'w', encoding='utf-8') as fh:
            fh.write(out)
    return parse(out), out


def selftest() -> int:
    """七個世界 —— 該抓的要抓到、該放過的要放過,而**兩個病要回不同的碼**。"""
    stable = '  Test Files  254 passed (254)\n      Tests  3632 passed (3632)\n'
    short = '  Test Files  248 passed (248)\n      Tests  3537 passed (3537)\n'
    shape_a = '  Test Files  3 failed | 251 passed (254)\n      Tests  3632 passed (3632)\n'
    both_red = '  Test Files  1 failed | 253 passed (254)\n      Tests  2 failed | 3630 passed (3632)\n'
    junk = 'No test files found, exiting with code 1\n'

    w = []
    a = parse(stable)
    w.append(('① 正常輸出 ⇒ 六個數字都抓得到',
              a == {'files_total': 254, 'files_failed': 0, 'files_skipped': 0,
                    'tests_total': 3632, 'tests_failed': 0, 'tests_skipped': 0,
                    'tests_todo': 0}, a))

    b = parse(short)
    w.append(('② 少跑那一發 ⇒ 總數不同(而它自己【沒有紅】)',
              b is not None and b['tests_total'] != a['tests_total'] and b['tests_failed'] == 0, b))

    c = parse(shape_a)
    w.append(('③ 病A:檔紅而 0 格紅 ⇒ 兩個欄位不一致',
              c is not None and c['files_failed'] > 0 and c['tests_failed'] == 0, c))

    d = parse(both_red)
    w.append(('④ 負對照:真的有測試紅時,不可以被誤判成病A',
              d is not None and d['files_failed'] > 0 and d['tests_failed'] > 0, d))

    e = parse(junk)
    w.append(('⑤ 🔴 抓不到 ⇒ 回 None,不可以回 0(「沒有紅」與「沒有量到」要分得開)', e is None, e))

    w.append(('⑥ 🔴 病A 與 不可重現 要回【不同的碼】', RC_SHAPE_A != RC_DIFFER, f'{RC_SHAPE_A} vs {RC_DIFFER}'))

    # ⑦ 🔴 病C:總數一樣而紅格數不同 —— **本檔第一次實跑就撞到的那一種**
    same_totals_diff_fails = '  Test Files  3 failed | 271 passed (274)\n      Tests  2 failed | 4994 passed (4996)\n'
    g = parse(same_totals_diff_fails)
    ref = parse('  Test Files  3 failed | 271 passed (274)\n      Tests  4 failed | 4992 passed (4996)\n')
    w.append(('⑦ 🔴 總數相同而紅格數不同 ⇒ 要看得出來(舊版會報 ✅)',
              g is not None and ref is not None
              and (g['files_total'], g['tests_total']) == (ref['files_total'], ref['tests_total'])
              and (g['files_failed'], g['tests_failed']) != (ref['files_failed'], ref['tests_failed']),
              f"{(g or {}).get('tests_failed')} vs {(ref or {}).get('tests_failed')}"))

    # ⑧ 🔴 MF-2:skipped 讓【兩個總數都相同】⇒ 只比總數會報 ✅
    skipped_run = '  Test Files  10 passed (10)\n      Tests  90 passed | 10 skipped (100)\n'
    full_run = '  Test Files  10 passed (10)\n      Tests  100 passed (100)\n'
    h, k = parse(skipped_run), parse(full_run)
    w.append(('⑧ 🔴 90 passed|10 skipped 與 100 passed:總數相同而 skipped 要看得出來',
              h is not None and k is not None
              and (h['files_total'], h['tests_total']) == (k['files_total'], k['tests_total'])
              and h['tests_skipped'] == 10 and k['tests_skipped'] == 0
              and fingerprint(h) != fingerprint(k),
              f"skipped {h and h['tests_skipped']} vs {k and k['tests_skipped']}"))

    # ⑨ 負對照:兩發【都】skip 同樣格數 ⇒ 不可以被報成不一致
    w.append(('⑨ 負對照:兩發 skipped 相同 ⇒ 指紋必須相同(不可誤報)',
              fingerprint(parse(skipped_run)) == fingerprint(parse(skipped_run)),
              fingerprint(parse(skipped_run))))

    # ⑩⑪ 🔴 `expected fail` —— **真實 vitest 輸出第一發就印出來的形狀,而九格罐頭裡沒有它**
    #    真值逐字取自 2026-08-25 `npx vitest run --project storefront` 的實跑輸出。
    #    ⑩ 防的【具體改動】= 有人把 FAILED_RE 放寬到容許數字與 fail 之間夾字
    #       (例如 r'(\d+)[\s\w]*fail' 或 r'(\d+)\s+.*fail')⇒ 會把 0 紅讀成 1 紅 / 3632 紅。
    #    ⑪ 防的【具體改動】= 有人讓 expected fail 遮住【真的紅】(改成錨在 expected、或先比到它就停)。
    #    🔴 ⑪ **抓不到 ⑩ 那個放寬** —— 四種放寬在混合世界全部回 7(2026-08-25 實測)。
    #       兩格防的不是同一件事,不要以為有了 ⑪ 就涵蓋 ⑩。
    xfail_only = '  Test Files  254 passed (254)\n      Tests  3632 passed | 1 expected fail (3633)\n'
    xfail_red = ('  Test Files  2 failed | 252 passed (254)\n'
                 '      Tests  7 failed | 3625 passed | 1 expected fail (3633)\n')
    p_only, p_red = parse(xfail_only), parse(xfail_red)
    w.append(('⑩ 🔴 真實輸出 `N passed | 1 expected fail` ⇒ tests_failed 必須是 0(不是 1、不是 3632)',
              p_only is not None and p_only['tests_failed'] == 0 and p_only['tests_total'] == 3633,
              p_only and p_only['tests_failed']))
    w.append(('⑪ 🔴 真紅 + passed + expected fail 三者同時 ⇒ 必須抓到【真紅】那個數',
              p_red is not None and p_red['tests_failed'] == 7 and p_red['files_failed'] == 2,
              p_red and p_red['tests_failed']))

    # ⑫ 🔴 **這一格的字串是【真的】** —— 逐字取自 2026-08-25 `npx vitest run --project admin`。
    #    它一行裡同時有 failed / passed / expected fail / skipped / todo 五種字彙,
    #    而九格罐頭世界裡有三種是作者從來沒想到的。
    #    防的【具體改動】= 有人動 parse 的任一條正規式後,只跑罐頭就以為沒事。
    real_admin = ('  Test Files  3 failed | 270 passed | 1 skipped (274)\n'
                  '      Tests  2 failed | 4983 passed | 2 expected fail | 8 skipped | 1 todo (4996)\n')
    p_adm = parse(real_admin)
    w.append(('⑫ 🔴 真實 admin 輸出(五種字彙同行)⇒ 2 紅 / 4996 總 / 8 skipped / 1 todo',
              p_adm == {'files_total': 274, 'files_failed': 3, 'files_skipped': 1,
                        'tests_total': 4996, 'tests_failed': 2, 'tests_skipped': 8,
                        'tests_todo': 1}, p_adm))

    # ⑬ 🔴 **這一格是因為 ⑫ 抓不到才加的。** 突變「把 todo 從 fingerprint 拿掉」⇒ 12 格【全綠】
    #    ⇒ 那一段有一半是死碼:parse 讀到了 todo, 而比對兩發時沒有人用它。
    #    防的【具體改動】= 有人動 fingerprint() 的欄位清單(增刪/改順序)。
    #    📌 ⑫ 驗的是 parse, ⑬ 驗的是 fingerprint。**讀得到 ≠ 拿它來比。**
    todo_a = '  Test Files  10 passed (10)\n      Tests  95 passed | 5 todo (100)\n'
    todo_b = '  Test Files  10 passed (10)\n      Tests  100 passed (100)\n'
    fa, fb = fingerprint(parse(todo_a)), fingerprint(parse(todo_b))
    w.append(('⑬ 🔴 兩發只差 todo(總數都是 100)⇒ 指紋必須不同',
              fa != fb, f'{fa} vs {fb}'))
    w.append(('⑭ 負對照:兩發 todo 相同 ⇒ 指紋必須相同(不可誤報)',
              fingerprint(parse(todo_a)) == fingerprint(parse(todo_a)), fa))

    ok = True
    for label, passed, got in w:
        print(f"  {'PASS' if passed else 'FAIL'}  {label}   ({got})")
        ok = ok and passed
    print('selftest:', 'PASS' if ok else '🔴 FAIL')
    return 0 if ok else 1


def main() -> int:
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument('--runs', type=int, default=2)
    ap.add_argument('--project', default=None)
    ap.add_argument('--keep', default=None, help='把每一發的完整輸出寫進這個目錄(建議指定)')
    ap.add_argument('--selftest', action='store_true')
    # 🔴 MF-1(cc/codex 2026-08-25):lint-staged 會把 staged 的【檔名附加在命令後面】。
    #    沒有這一格 ⇒ argparse 回 `unrecognized arguments` rc=2 ⇒ **擋住任何人的 commit**。
    #    📌 這個缺陷在作者手上是隱形的:手動跑 --selftest 永遠 rc=0,
    #       它只在【被登記進 lint-staged 之後】才現形,而登記的是別人。
    #    行為與 scripts/traps-neighbours.py 相同(收下尾隨路徑);那支用 sys.argv 手篩,
    #    本檔有帶值旗標(--runs 3)⇒ 手篩會把 `3` 誤當路徑,故用 argparse 的 nargs 收。
    ap.add_argument('staged_paths', nargs='*',
                    help='lint-staged 附加的檔名。本檔不使用它們,收下即忽略。')
    args = ap.parse_args()

    if args.selftest:
        return selftest()
    if args.runs < 2:
        print('🔴 --runs 至少 2 —— 一發【量不到】重現性,那正是本檔要防的事。', file=sys.stderr)
        return RC_ENV

    before = git_status()
    rows: list[dict | None] = []
    for i in range(1, args.runs + 1):
        row, out = one_run(args.project, args.keep, i)
        rows.append(row)
        if row is None:
            print(f'  第 {i} 發:🔴 **抓不到那兩行總數** —— 輸出尾巴:', file=sys.stderr)
            print('    ' + '\n    '.join(out.strip().splitlines()[-3:]), file=sys.stderr)
        else:
            print(f"  第 {i} 發:檔 {row['files_total']}(紅 {row['files_failed']})"
                  f" / 測項 {row['tests_total']}(紅 {row['tests_failed']})")
    after = git_status()

    print()
    if before == after:
        print('✅ 足跡:跑前後 `git status --porcelain` 的【路徑與狀態字母】相同。')
        print('   🔴 這句刻意寫窄(MF-3):porcelain 印的是路徑+狀態字母,**不是內容**。')
        print('      一支【本來就是 M】的檔在兩發之間被改了內容 ⇒ 這兩個字串仍逐字相同。')
        print('      ⇒ 它答得出「有沒有多出/少掉檔案」,答不出「已髒的檔有沒有再被動」。')
    else:
        print('⚠️ 足跡:跑前後 `git status --porcelain` **不同** ⇒ 有東西被寫過。逐行差異:')
        b, a = set(before.splitlines()), set(after.splitlines())
        for line in sorted(a - b):
            print(f'    + {line}')
        for line in sorted(b - a):
            print(f'    - {line}')
        print('   🔴 而這【不證明是 vitest 寫的】—— 共用樹上同時有別的窗在動。只證明「樹變了」。')

    got = [r for r in rows if r is not None]
    if len(got) < args.runs:
        print(f'\n🔴 {args.runs - len(got)} 發抓不到總數 ⇒ **本次量測作廢**,不是「沒有問題」。')
        return RC_BROKEN

    totals = {(r['files_total'], r['tests_total']) for r in got}
    # 🔴🔴 **第三個病(2026-08-25 本檔第一次實跑就撞到)**:總數相同、而【紅的格數不同】。
    #    admin 兩發:檔 274 / 測項 4996 兩發一樣,而 tests_failed = 4 與 2。
    #    ⇒ 舊版會印「✅ 總數一致」而回 0,**把一個明顯不穩的套件報成一致**。
    #    📌 「總數一致」與「同一份結果」是兩個宣稱 —— 而我原本只量了前者。
    fails = {fingerprint(r) for r in got}   # 🔴 指紋含 skipped(MF-2)
    shape_a = [i + 1 for i, r in enumerate(got) if r['files_failed'] > 0 and r['tests_failed'] == 0]

    print()
    # 🔴 MF-4(cc/codex 2026-08-25):原本 `if len(totals) > 1: return` 排在病A 前面
    #    ⇒ 一發同時「少跑」+「beforeAll 逾時」時,病A 那半**靜音**,
    #    而檔頭逐字寫著「本檔兩道都跑。它們不是同一件事的兩種說法。」
    #    ⇒ 註解說兩道,code 是先中斷。現在先把兩個訊號【都印完】,最後才決定回傳碼。
    hit = []
    if shape_a:
        hit.append('A')
        print(f'🔴 **病A 訊號**:第 {shape_a} 發【檔紅而 0 格紅】 ⇒ 通常是 beforeAll 逾時。')
        print('   ⇒ 它與「不可重現」是兩個病:這個單發就抓得到,那個只有連跑才抓得到。')

    skipped_runs = [i + 1 for i, r in enumerate(got) if r['tests_skipped'] or r['tests_todo']]
    if skipped_runs:
        hit.append('S')
        print(f'🔴 **有格子沒有執行**:第 {skipped_runs} 發有 skipped / todo ⇒ 那些格【沒跑】。')
        for i, r in enumerate(got):
            if r['tests_skipped'] or r['tests_todo']:
                print(f"     第 {i+1} 發:skipped {r['tests_skipped']} / todo {r['tests_todo']}")
        print('   📌 `90 passed | 10 skipped (100)` 與 `100 passed (100)` 的【兩個總數都相同】。')

    if len(totals) > 1:
        hit.append('B')
        print(f'🔴 **這 {args.runs} 發的總數不一致 ⇒ 全套在這棵樹上不是一個可重現的量具。**')
        for t in sorted(totals):
            print(f'   檔 {t[0]} / 測項 {t[1]}')
        print('   ⇒ 處置:**不要拿一發全套當背書。** 要背書就用單檔/單 project 連跑兩發比總數。')
        print('   📌 沒跑完的那一發,長得跟跑完的那一發一模一樣,只有總數不同。')

    # 🔴 這一段【只在總數相同時】才成立 —— 它的整句話就是「總數一致,而…」。
    #    2026-08-25 我把 fails 換成 6 元素指紋時,忘了改這裡:總數不一致時它照樣印,
    #    而 x[0] 被當成「檔紅」印出來,實際是 files_total。**改了一個地方,旁邊那個沒跟。**
    if len(totals) == 1 and len(fails) > 1:
        if 'B' not in hit:
            hit.append('B')
        print(f'🔴 **總數一致,而【紅格數/skipped】這 {args.runs} 發不同 ⇒ 一樣是不可重現。**')
        for r in got:
            print(f"   檔紅 {r['files_failed']} / 測項紅 {r['tests_failed']}"
                  f" / skipped {r['tests_skipped']}")
        print('   ⇒ 這一種【不會少跑】,它是同一批測試跑出不同結果(負載 / 逾時 / 順序)。')
        print('   📌 「總數一致」與「同一份結果」是兩個宣稱。只量前者會把這一種報成 ✅。')

    if len(hit) > 1:
        print()
        print(f'🔴 **這一發命中了不只一個病:{hit}** —— A=病A訊號 / S=有格子沒執行 / B=不可重現。')
        print('   ⚠️ 回傳碼只有一個位子 ⇒ 它【表達不了多重命中】。以上面印的為準,不要只看 rc。')
    if 'B' in hit:
        return RC_DIFFER
    if 'S' in hit or 'A' in hit:
        return RC_SHAPE_A

    t = sorted(totals)[0]
    print(f'✅ 這 {args.runs} 發總數、紅格數與 skipped 都一致:檔 {t[0]} / 測項 {t[1]}。')
    print(f'   ⚠️ **樣本數 = {args.runs}。** 「這幾發沒有抓到不穩」**不等於**「它是穩的」——')
    print('      06 那一夜跑八發才拿到五種結果。要更強的話就加 --runs。')
    return RC_SAME


if __name__ == '__main__':
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        raise
    except Exception as e:  # noqa: BLE001
        print(f'🔴 它自己壞了 ⇒ **不是量測結果**:{type(e).__name__}: {e}', file=sys.stderr)
        sys.exit(RC_BROKEN)
