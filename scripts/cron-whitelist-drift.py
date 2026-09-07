#!/usr/bin/env python3
r"""後台「排程心跳」的**手寫白名單**, 與 `supabase/migrations/` 裡真的排了什麼, 對不對得上。

用法:
    python3 scripts/cron-whitelist-drift.py            # 對真 repo 跑
    python3 scripts/cron-whitelist-drift.py --selftest # 內建對照(尺活不活)

🔴 **它要防的那件事**(板列 `⟦f3-ALLOWLISTMANUAL1⟧` 逐字):
   後台首頁的「排程心跳」拿一份**手寫白名單**去對帳,
   而**真排程那張 `cron.job` 後台讀不到**(三道權限各自單獨就足以擋死)。
   ⇒ **第七支被排上去、或某支被改名, 儀表零變色。**
   📌 而那個「零變色」與「一切正常」**在畫面上是同一個東西**。

🛑 **它答不出什麼(先講, 免得被當成背書)**:
  · 它比的是**版控裡的 migration**, **不是正式庫**。有人在 dashboard 手動 `cron.schedule`
    ⇒ **本尺永遠看不到**(那是路⑤, 見 `⟦b9-ACLDRIFT5⟧`)。
  · 它不問那支排程**跑不跑得動**, 只問**名字對不對得上**。
  · `cron.schedule` 若不是字面字串(變數 / 串接)⇒ 抓不到。**那是已知缺口, 不是漏掉。**

🔴 **`.sql` 以外一律不算 —— 而這一條是我自己踩出來的**(2026-09-07 tidy):
   我第一版用 `grep -r supabase/migrations/`, 抓到 `pcm-search-log-purge`
   ⇒ 以為找到一支「排了而白名單沒有」的漂移。
   **開檔才發現它只出現在 `PENDING-search-log-flood-caps-R2-FAIL.sql.txt`** ——
   一支**還沒過審、副檔名是 `.txt`** 的東西。
   📌 **⇒ 一個目錄裡不是每個檔都是「已生效」;而【副檔名】是那個差別唯一的形狀。**
"""
import io
import os
import re
import sys

WL_FILE = 'packages/domain/src/ops/cron-jobs.ts'
MIG_DIR = 'supabase/migrations'
WL_RE = re.compile(r"jobName:\s*'([^']+)'")
SCHED_RE = re.compile(r"cron\.schedule\(\s*'([^']+)'")
UNSCHED_RE = re.compile(r"unschedule\(\s*'([^']+)'")
# 🔴 兩種動作用【同一個】pattern 掃, 才拿得到它們在檔內的先後
ORDERED_RE = re.compile(r"cron\.schedule\(\s*'(?P<s>[^']+)'|unschedule\(\s*'(?P<u>[^']+)'")
# 🔴 模板佔位字, 不是真名字(板上實測有一支寫 `cron.schedule('<名字>'`)
PLACEHOLDER = re.compile(r'^[<{\[]')


def whitelist(path):
    if not os.path.isfile(path):
        return None
    return sorted(set(WL_RE.findall(io.open(path, encoding='utf-8').read())))


def scheduled(mig_dir):
    """回 (live, 掃過幾支檔)。**只吃 `.sql`** —— 見檔頭那段。

    依檔名排序後重放:`schedule` 加入、`unschedule` 移除
    ⇒ 「排了又取消」不算 live。
    """
    if not os.path.isdir(mig_dir):
        return None, 0
    live, n = set(), 0
    for fn in sorted(os.listdir(mig_dir)):
        if not fn.endswith('.sql'):
            continue
        n += 1
        src = io.open(os.path.join(mig_dir, fn), encoding='utf-8').read()
        # 🔴 **必須照【原始碼順序】重放, 不可以先收 schedule 再收 unschedule** ——
        #    冪等寫法幾乎都是 `unschedule('x')` 然後 `schedule('x', …)` **在同一支檔裡**,
        #    分組處理會把剛排好的那支又刪掉。
        #    🔬 實測:分組版對真 repo 印「排了 **4** 支」, 照順序版印 **9** 支 —— 差 5 支,
        #       而**分組版的 selftest 全綠**(我的 fixture 把兩個動作放在不同檔)。
        #       📌 **fixture 沒落在邊界上, 是跑真 repo 才問出來的。**
        # 🔴🔴 **`--` 註解行要先剝掉** —— 這些檔的慣例是把回退指令**寫成註解**
        #    (`20260723120000_m3_s2_settle_sweep_pgcron.sql:203` 逐字
        #     `--   SELECT cron.unschedule('pcm-settle-sweep');`)。
        #    不剝 ⇒ 一支**還在跑**的排程被我判成「已取消」。
        #    🔬 實測:不剝 ⇒ live **6** 支、白名單有而沒排 3;剝掉 ⇒ live **9** 支、對得上。
        #    📌 **「註解被 grep 當成碼」** —— 而它往【壞的方向】錯:把活的說成死的。
        src = '\n'.join(re.sub(r'--.*$', '', ln) for ln in src.split('\n'))
        for mm in ORDERED_RE.finditer(src):
            name = mm.group('s') or mm.group('u')
            if mm.group('s'):
                if not PLACEHOLDER.match(name):
                    live.add(name)
            else:
                live.discard(name)
    return sorted(live), n


def main():
    wl = whitelist(WL_FILE)
    live, nfiles = scheduled(MIG_DIR)
    # 🔴 **量具缺席要跟「零漂移」印不同的東西** —— 少了這道, 檔案被搬走之後
    #    本尺會安靜地印「一切對得上」。
    if wl is None or live is None:
        print(f'⏸️  量不到:白名單檔在不在={wl is not None} · '
              f'migrations 目錄在不在={live is not None} ⇒ **不是「沒有漂移」**')
        return 2
    blind = [j for j in live if j not in wl]
    stale = [j for j in wl if j not in live]
    print(f'白名單 {len(wl)} 支 · migrations({nfiles} 支 .sql)排了 {len(live)} 支')
    if blind:
        print(f'🔴 **排了而白名單沒有 {len(blind)} 支 ⇒ 後台儀表對它們零變色**')
        for j in blind:
            print(f'   🔴 {j}')
    if stale:
        print(f'🟡 白名單有而 migrations 沒排 {len(stale)} 支(可能是手動排的, 或白名單過期)')
        for j in stale:
            print(f'   🟡 {j}')
    if not blind and not stale:
        print('🟢 兩邊對得上')
    return 1 if blind else 0


def selftest():
    import shutil
    import tempfile
    d = tempfile.mkdtemp()
    fails = []

    def ck(name, got, want):
        ok = got == want
        print(f'  {"✅" if ok else "🔴"} {name}:{got}(期望 {want})')
        if not ok:
            fails.append(name)

    wf = os.path.join(d, 'wl.ts')
    io.open(wf, 'w', encoding='utf-8').write(
        "export const X = [{ jobName: 'a' }, { jobName: 'b' }];\n")
    ck('① 白名單讀得出來', whitelist(wf), ['a', 'b'])
    ck('② 🔵 檔不在 ⇒ None(不是空清單 —— 那兩個要分得開)',
       whitelist(os.path.join(d, 'nope.ts')), None)

    m = os.path.join(d, 'mig')
    os.makedirs(m)
    io.open(os.path.join(m, '001_x.sql'), 'w', encoding='utf-8').write(
        "select cron.schedule('a', '* * * * *', $$ select 1 $$);\n")
    io.open(os.path.join(m, '002_y.sql'), 'w', encoding='utf-8').write(
        "select cron.schedule('c', '* * * * *', $$ select 1 $$);\n")
    ck('③ 兩支 .sql 的排程都撈到', scheduled(m)[0], ['a', 'c'])
    # 🔴 這一格守的是我自己踩過的那個坑
    io.open(os.path.join(m, 'PENDING-z.sql.txt'), 'w', encoding='utf-8').write(
        "select cron.schedule('zzq_pending', '* * * * *', $$ select 1 $$);\n")
    ck('④ 🔴 `.sql.txt`(還沒過審)不算 —— 我第一版就是被它騙的',
       'zzq_pending' in scheduled(m)[0], False)
    ck('④b 🔵 而它確實【在那個目錄裡】(證明上一格不是因為檔沒建成)',
       os.path.isfile(os.path.join(m, 'PENDING-z.sql.txt')), True)
    io.open(os.path.join(m, '003_z.sql'), 'w', encoding='utf-8').write(
        "select cron.unschedule('c');\n")
    ck('⑤ 排了又取消 ⇒ 不算 live', scheduled(m)[0], ['a'])
    # 🔴🔴 **同一支檔裡先 unschedule 再 schedule(冪等慣用寫法)⇒ 它【是】live**
    #    這一格是跑真 repo 才逼出來的:分組處理版印「排了 4 支」, 真值 9 支,
    #    而**那一版的其他 12 格全綠** —— 因為上面那組 fixture 把兩個動作放在不同檔。
    io.open(os.path.join(m, '006_idem.sql'), 'w', encoding='utf-8').write(
        "select cron.unschedule('idem');\n"
        "select cron.schedule('idem', '* * * * *', $$ select 1 $$);\n")
    ck('⑤b 🔴 同檔先取消再排(冪等)⇒ 算 live', 'idem' in scheduled(m)[0], True)
    io.open(os.path.join(m, '007_off.sql'), 'w', encoding='utf-8').write(
        "select cron.schedule('gone', '* * * * *', $$ select 1 $$);\n"
        "select cron.unschedule('gone');\n")
    ck('⑤c 🔵 而反過來(先排再取消)⇒ 不算(證明順序真的有讀)',
       'gone' in scheduled(m)[0], False)
    # 🔴 註解掉的 unschedule 不算 —— 真 repo 的回退說明就是這樣寫的
    io.open(os.path.join(m, '008_cmt.sql'), 'w', encoding='utf-8').write(
        "select cron.schedule('cmt', '* * * * *', $$ select 1 $$);\n"
        "--   SELECT cron.unschedule('cmt');\n")
    ck('⑤d 🔴 註解掉的 unschedule 不算(它是回退【說明】不是執行)',
       'cmt' in scheduled(m)[0], True)
    io.open(os.path.join(m, '009_real.sql'), 'w', encoding='utf-8').write(
        "select cron.schedule('cmt2', '* * * * *', $$ select 1 $$);\n"
        "SELECT cron.unschedule('cmt2');\n")
    ck('⑤e 🔵 而【沒有註解】的同一句仍然算(證明不是恆略過 unschedule)',
       'cmt2' in scheduled(m)[0], False)
    io.open(os.path.join(m, '004_p.sql'), 'w', encoding='utf-8').write(
        "select cron.schedule('<名字>', '* * * * *', $$ select 1 $$);\n")
    # 🔵 期望值要跟著上面 ⑤b 加進來的 `idem` 走 —— **這兩格第一版是我的期望值紅的**,
    #    不是碼:我把新 fixture 插在它前面, 而它的前提變了。
    ck('⑥ 模板佔位字不算真名字', scheduled(m)[0], ['a', 'cmt', 'idem'])
    # 白名單也補上 `idem`, 讓下面的端到端仍在「沒有 blind」那個世界
    io.open(wf, 'w', encoding='utf-8').write(
        "export const X = [{ jobName: 'a' }, { jobName: 'b' }, { jobName: 'idem' }, { jobName: 'cmt' }];\n")
    # 🔵 端到端:走 main() 那條真的路, 不在這裡重算判準
    import contextlib
    global WL_FILE, MIG_DIR
    _w, _m = WL_FILE, MIG_DIR
    try:
        WL_FILE, MIG_DIR = wf, m
        b = io.StringIO()
        with contextlib.redirect_stdout(b):
            rc = main()
        ck('⑦端到端 白名單有 b 而沒排 ⇒ 印黃字', '🟡 b' in b.getvalue(), True)
        ck('⑦b端到端 沒有「排了而白名單沒有」⇒ rc=0', rc, 0)
        io.open(os.path.join(m, '005_new.sql'), 'w', encoding='utf-8').write(
            "select cron.schedule('newjob', '* * * * *', $$ select 1 $$);\n")
        b2 = io.StringIO()
        with contextlib.redirect_stdout(b2):
            rc2 = main()
        ck('⑧端到端 🔴 排了而白名單沒有 ⇒ 印紅字', '🔴 newjob' in b2.getvalue(), True)
        ck('⑧b端到端 而 rc 要變成 1(不是恆 0)', rc2, 1)
        WL_FILE = os.path.join(d, 'gone.ts')
        b3 = io.StringIO()
        with contextlib.redirect_stdout(b3):
            rc3 = main()
        ck('⑨ 量具缺席 ⇒ 印「量不到」而不是「對得上」', '量不到' in b3.getvalue(), True)
        ck('⑨b 而 rc=2(與 0 和 1 都不同形)', rc3, 2)
    finally:
        WL_FILE, MIG_DIR = _w, _m
        shutil.rmtree(d, ignore_errors=True)
    print('SELFTEST ' + ('PASS' if not fails else 'FAIL:' + ','.join(fails)))
    return 0 if not fails else 1


if __name__ == '__main__':
    sys.exit(selftest() if '--selftest' in sys.argv[1:] else main())
