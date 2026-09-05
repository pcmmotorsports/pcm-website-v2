#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
`scripts/md5-pins-stale.py` —— **跨檔 md5 釘子:哪幾顆已經過期了**

🎯 板列 `⟦02-CROSSFILEMD5PINS⟧`:很多 migration 用「別支函式的 `md5(prosrc)`」當前置閘,
   而**沒有任何東西在看那些值有沒有過期**。過期的後果:那支 migration 貼下去**當場紅**,
   而紅的理由(「有人改過它」)在那個當下是**假的** —— 改過它的是**後來的別支 migration**。

🔴🔴 **三個分母, 不要混**(2026-09-06 實測, 而板上原本只寫一個數):
   · **30** = 含 md5 字面的**檔數**(板上那個數, 而它不是釘子數)
   · **73** = md5 字面的**顆數**
   · **48** = 其中在【碼】裡的(會執行);**25** 在註解裡(是紀錄, 不是閘)
   📌 **「30 顆釘子」這句話把檔數說成了顆數。**

🛑🛑 **而最重要的那一格:過期【不一定是問題】。**
   一支**已經 apply 過**的 migration, 它的前置閘**永遠不會再跑** ⇒ 那顆釘子過期是**歷史**。
   真正要人看的是 **未 apply 的片上的過期釘子** —— 那些貼下去會當場紅。
   ⇒ 所以本支輸出**照 `supabase/APPLIED.tsv` 分兩層**, 而不是只印「相符 / 過期」。

🔴🔴 **一個我先做錯、量了才知道的判讀 —— 留在這裡**:
   釘子旁邊常有 `-- 20260624120008:80` 這種標記。我第一版把它讀成「**那支檔第 80 行的 md5**」,
   於是算出「8 顆全部過期、0 顆相符」。
   ⇒ 🛑 **一把 0/8 的尺沒有正對照** —— 而那正是它要我停下來的訊號。
   ⇒ 🔬 停下來查:那一行是 `CREATE OR REPLACE FUNCTION public.claim_stuck_unsettled_attempts(`
     ⇒ 📌 **那個 `:80` 是【函式定義從第幾行開始】的位置指標, 不是「第 80 行的雜湊」。**
   ⇒ 我再試「抽那支函式的 `$fn$` 本體算 md5」—— **三顆抽樣全部不中**。
   ⇒ ✅ **結論:repo 一顆都算不回來。** 那些值是 PostgreSQL 裡 `prosrc` 的 md5,
     而被釘的那幾代**早就被後來的 migration 換掉了** ⇒ repo 現在那份不是當時那份。
   ⇒ **所以本支沒有「repo 算得回來」那一堆** —— 有的話那是我在編一個看起來很合理的來源。

⚠️ **本支【算不回】任何釘子**, 這句寫在最前面:
   那些值是 `md5(prosrc)` —— **PostgreSQL 裡函式本體**的 md5, **不是 repo 檔案的**。
   ⇒ 要重算必須問正式庫(唯讀)。本支預設**只做 repo 這一半**(釘子指名 `版本:行號` 的那些),
     並把「要問正式庫才算得回」的那些**明白列成第三堆**, 不混進「相符」。
   ⇒ `--emit-sql` 會印出一段**唯讀 SQL**, 給有唯讀權限的人拿去跑
     (`bash scripts/readonly-prod-sql.sh <檔>`)。**本支自己不連任何資料庫。**
"""
import io, os, re, sys, glob, hashlib, tempfile, shutil

MIG = 'supabase/migrations'
LEDGER = 'supabase/APPLIED.tsv'
HEX = re.compile(r'\b([0-9a-f]{32})\b')
# 釘子旁邊指名來源的兩種形狀
SRC_VER_LINES = re.compile(r'(\d{14})\s*:\s*(\d+)(?:\s*-\s*(\d+))?')
# 從閘的上下文找它守的是哪支函式
FN_CTX = [
    re.compile(r"proname\s*=\s*'([a-z0-9_]+)'", re.I),
    re.compile(r"to_regprocedure\(\s*'([a-z0-9_.]+)\s*\(", re.I),
    re.compile(r"pg_get_functiondef\(\s*'([a-z0-9_.]+)", re.I),
]


def applied_versions(root):
    """🔴 **這份「已 apply」只讀【當下這棵樹】的 `supabase/APPLIED.tsv`** —— 通常是 dev 系。
    ⚠️ **射程(2026-09-06 主視窗 `-f8` 當場抓到我一個假陽性)**:
       帳本那一列**可能還在一支沒合進 dev 的分支上**。
       實例:`20260905280000` 的帳本列在 `agent/line-account-cardcancel`(611bf3c61)——
       Sean 當晚已經貼了, 而 dev 這棵樹讀不到那一列
       ⇒ 📌 **本支把它報成「未 apply 的片上有過期釘子」, 而那是【假陽性】。**
    ⇒ 🛑 **所以本支說的「未 apply」= 【dev 帳本上沒有】, 不是【正式庫沒有】。**
       看到紅之前先問一句:**那一列是不是在別人還沒合的分支上?**
       查法:`git for-each-ref refs/remotes` 逐支 `git show <ref>:supabase/APPLIED.tsv | grep <版本>`。
    """
    p = os.path.join(root, LEDGER)
    if not os.path.exists(p):
        return set()
    return {l.split('\t')[0] for l in io.open(p, encoding='utf-8') if l[:4] == '2026'}


def scan(root):
    """回傳每一顆釘子:(檔, 行號, md5, 是不是碼, 來源類型, 來源描述)"""
    out = []
    for f in sorted(glob.glob(os.path.join(root, MIG, '*.sql'))):
        lines = io.open(f, encoding='utf-8', errors='ignore').read().split('\n')
        for i, l in enumerate(lines, 1):
            # 🔴 **這把尺的分母**:一行要被看到, 要嘛含 `md5` 字樣, 要嘛旁邊有 `版本:行號` 來源標記。
            #    ⛔ ~~只認含 `md5` 的行~~ —— 2026-09-06 selftest 世界② 當場打穿:
            #      一顆叫 `c_pre_hash` 的釘子**整顆看不到**, 而本支會印一個乾淨的「沒有過期」。
            #    ⚠️ **而放寬之後仍有盲區**:一顆既不含 `md5`、旁邊也沒有來源標記的 32 位十六進位字面,
            #      這把尺**看不見它**。📌 那不是「沒有這種釘子」, 是「我沒有在看」。
            if 'md5' not in l.lower() and not SRC_VER_LINES.search(l):
                continue
            for m in HEX.finditer(l):
                is_code = not l.strip().startswith('--')
                # ① 同一行指名了「版本:行號」⇒ repo 算得回來
                # 🔴 `版本:行號` 是**位置指標**(函式定義從第幾行開始), **不是函式名**。
                #    ⛔ 我第一版把它當名字塞進 `proname IN (...)` ⇒ 查詢裡出現
                #      `'20260624120008:80'` 這種東西 ⇒ 那幾格永遠查無 ⇒ 靜靜地少報。
                #    ⇒ 記下它當**線索**, 而函式名照樣往上文找。
                sv = SRC_VER_LINES.search(l)
                hint = sv.group(0) if sv else None
                # ② 往上找 40 行, 看這個閘守的是哪支函式(⇒ 要問正式庫)
                fn = None
                for back in range(i - 1, max(0, i - 41), -1):
                    for pat in FN_CTX:
                        mm = pat.search(lines[back - 1])
                        if mm:
                            fn = mm.group(1); break
                    if fn: break
                label = fn or (('來源線索 ' + hint) if hint else '(找不到它守的是誰)')
                out.append((f, i, m.group(1), is_code, 'prod' if fn else 'unknown', label))
    return out


def repo_md5_of(root, version, a, b):
    """算 repo 裡 <version> 那支檔的第 a..b 行的 md5(含換行, 與原作者當時的算法對齊)。"""
    hits = glob.glob(os.path.join(root, MIG, version + '_*.sql'))
    if not hits:
        return None, 'repo 裡找不到 %s 那支檔' % version
    src = io.open(hits[0], encoding='utf-8', errors='ignore').read().split('\n')
    if b is None:
        b = a
    if a < 1 or b > len(src):
        return None, '行號 %s-%s 超出 %s 的 %d 行' % (a, b, os.path.basename(hits[0]), len(src))
    seg = '\n'.join(src[a - 1:b])
    return hashlib.md5(seg.encode()).hexdigest(), os.path.basename(hits[0])


def run(root, emit_sql=False, quiet=False):
    pins = scan(root)
    applied = applied_versions(root)
    n_all = len(pins)
    n_code = sum(1 for p in pins if p[3])
    files = {p[0] for p in pins}
    if not quiet:
        print('跨檔 md5 釘子:%d 支檔 · %d 顆字面 · 其中【碼裡】%d 顆(會執行)· 註解裡 %d 顆(紀錄)'
              % (len(files), n_all, n_code, n_all - n_code))
        print('🔴 這三個數是【三件事】—— 板上原本那個「30」是【檔數】不是顆數。')

    needprod, unknown, comment_only = [], [], []
    for f, i, h, is_code, kind, desc in pins:
        if not is_code:
            comment_only.append((os.path.basename(f), i, h, desc))
            continue                      # 註解裡的是紀錄, 不是閘 ⇒ 不判過期
        if kind in ('prod', 'repo'):
            # 🔴 `repo` 那一類**也要問正式庫** —— `版本:行號` 是【函式定義從第幾行開始】的
            #    位置指標, 不是「那幾行的雜湊」。詳見檔頭那段訂正。
            needprod.append((os.path.basename(f), i, h, desc))
        else:
            unknown.append((os.path.basename(f), i, h, desc))

    def ver(fn):
        return fn.split('_')[0]

    hot = [r for r in needprod if ver(r[0]) not in applied]
    if not quiet:
        print('\n【碼裡那 %d 顆的清冊】' % n_code)
        print('  · 解析得出它守著誰:%d 顆' % len(needprod))
        print('  · 🛑 解析不出來源:%d 顆 ⇒ **不算相符也不算過期** —— 這把尺的盲區' % len(unknown))
        print('  · 註解裡(紀錄, 不判):%d 顆' % len(comment_only))
        print('\n  🔴 **其中 %d 顆落在【dev 帳本上沒有】的片上** —— 那些片貼下去時那道閘會真的跑,'
              % len(hot))
        print('     而釘子若已過期 ⇒ **當場紅, 而紅的理由(「有人改過它」)在那個當下是假的**。')
        by_fn = {}
        for r in needprod:
            by_fn.setdefault(r[3], []).append(r)
        print('\n  依「守著誰」分組(🔴 = 有顆落在未 apply 的片上):')
        for fn, rs in sorted(by_fn.items()):
            n_hot = len([r for r in rs if ver(r[0]) not in applied])
            print('     %-46s %2d 顆%s' % (fn[:46], len(rs), ('  🔴 未 apply %d' % n_hot) if n_hot else ''))
        if unknown:
            print('\n  解析不出來源的那 %d 顆(要人開檔看):' % len(unknown))
            for r in unknown:
                print('     %s:%d' % (r[0][:52], r[1]))
        print('\n🛑 本支答不出什麼:')
        print('   · 🔴 **它一顆都沒有重算** —— repo 算不回來(見檔頭那段訂正)。')
        print('     它做的是【清冊 + 分類 + 產唯讀 SQL】, 不是【判定過期】。')
        print('     ⇒ 要真的判過期, 拿 `--emit-sql` 那段去跑, 再把結果餵回 `--compare`。')
        print('   · **過期不一定是問題** —— 已 apply 的片, 它的前置閘永遠不會再跑。')
        print('   · 它不修任何東西(板上那句「列出來給主人」)。')

    if emit_sql:
        print('\n-- ===== 唯讀 SQL(給有唯讀權限的人跑;本支自己不連資料庫)=====')
        print("\\echo '=== 釘子守的那幾支函式, 現在的 md5(prosrc) ==='")
        fns = sorted({r[3] for r in needprod if not r[3].startswith('(')})
        if not fns:
            print("-- (沒有解析得出來的函式名)")
        else:
            print("SELECT p.proname, pg_catalog.md5(p.prosrc) AS 現在的md5, pg_catalog.length(p.prosrc) AS 長度")
            print("FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace")
            print("WHERE n.nspname='public' AND p.proname IN (%s) ORDER BY 1;"
                  % ', '.join("'%s'" % x.split('.')[-1] for x in fns))
            print("\\echo '=== 正對照:public 函式總數(0 ⇒ 尺沒接上) ==='")
            print("SELECT count(*) AS 正對照必大於0 FROM pg_catalog.pg_proc p "
                  "JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public';")

    # 🔵 **清冊模式恆 0** —— 它沒有重算任何東西, 沒有資格判紅。
    #    📌 一支「印了一堆紅字而 rc=0」的工具是誠實的;一支「沒重算卻 rc=1」的不是。
    return 0


def compare(root, prod_file, quiet=False):
    """拿唯讀 SQL 的輸出(psql 的表格)回來比。這才是真的判過期。"""
    txt = io.open(prod_file, encoding='utf-8', errors='ignore').read()
    # 🔴🔴 **一個 proname 可能對到【多支 overload】** —— 2026-09-06 實測:
    #    `search_catalog_by_vehicle` 在正式庫有兩支, 而**對得上釘子的是被蓋掉的那一支**。
    #    ⛔ ~~`live[proname] = md5`~~ ⇒ 後面那筆蓋掉前面那筆 ⇒ 📌 **一顆相符的釘子被判成過期,
    #      而那個「過期」讀起來完全正常。**
    #    ⇒ 改成 proname → **一組** md5;釘子對到其中任何一支就算相符。
    #    ⚠️ 代價寫明:這樣**分不出「對到的是哪一支 overload」** —— 而要分得出必須帶完整簽章,
    #      那要改所有釘子的寫法(它們只寫了函式名)。⇒ **這是那些釘子本身的天花板, 不是本支的。**
    live = {}
    for l in txt.split('\n'):
        parts = [x.strip() for x in l.split('|')]
        if len(parts) >= 2 and re.fullmatch(r'[a-z0-9_]+', parts[0] or '') and HEX.fullmatch(parts[1] or ''):
            live.setdefault(parts[0], set()).add(parts[1])
    if not live:
        print('🔴 從 %s 讀到 0 筆 (函式名, md5) —— 這把尺沒有接上, 不要把它讀成「沒有過期」' % prod_file)
        return 2
    pins = scan(root)
    applied = applied_versions(root)
    same, stale, nolive = [], [], []
    for f, i, h, is_code, kind, desc in pins:
        if not is_code:
            continue
        if kind == 'unknown':
            # 🔴 **解析不出名字的也要走【靠值比對】那條路** ——
            #    ⛔ 我第一版在這裡 `continue` ⇒ 📌 **本支唯一的正對照被跳過了**,
            #      而它印出來的是一個乾淨的「相符 0 顆」。
            #      (實例:`close_released_attempt` 的現值就等於 20260812170000 的一顆釘子,
            #       而那顆的函式名在 DECLARE 區塊上方 40 行內找不到 ⇒ 落 unknown ⇒ 被跳過。)
            byval = [k for k, vs in live.items() if h in vs]
            if byval:
                same.append((os.path.basename(f), i, h, '(靠值比對)' + byval[0], h))
            continue
        fn = desc.split('.')[-1]
        if fn not in live:
            # 🔵 名字對不上時**還有一條路**:這顆釘子的【值】是不是等於某支活著的函式的 md5。
            #    📌 那是本支唯一的**正對照** —— 沒有它, 「相符 0 顆」分不出
            #      「真的全過期」與「我的名字解析壞了」。
            byval = [k for k, vs in live.items() if h in vs]
            if byval:
                same.append((os.path.basename(f), i, h, '(靠值比對)' + byval[0], h))
            else:
                nolive.append((os.path.basename(f), i, fn))
            continue
        (same if h in live[fn] else stale).append(
            (os.path.basename(f), i, h, fn, ' / '.join(sorted(live[fn]))))
    print('比對:正式庫回了 %d 支函式 · 釘子相符 %d 顆 · 過期 %d 顆 · 那支函式沒回來 %d 顆'
          % (len(live), len(same), len(stale), len(nolive)))
    # 🔵 **假陽性自己現形** —— 把「別的分支的帳本有沒有那一列」也查一次。
    #    📌 主視窗 2026-09-06 抓到我一個假陽性之後加的:與其在文件裡叫人「先問一句」,
    #      不如**讓工具自己去問**。⇒ 這一格把「要人記得」變成「機器會做」。
    #    ⚠️ 它答的仍是【某支分支的帳本說有】, 不是【正式庫真的有】—— 那是帳本的天花板。
    other = {}
    try:
        import subprocess
        # 🔴 **掃【所有】ref, 不只 refs/remotes** —— 2026-09-06 實測:
        #    `20260905280000` 的帳本列在 **本地** 分支 `refs/heads/agent/line-account-cardcancel`
        #    (那條線還沒 push)⇒ 只掃 remotes 的話**漏掉它**, 而漏掉的形狀是「一個紅」。
        #    📌 多窗共用一個 repo ⇒ 別人的分支就在本地, `refs/remotes` 不涵蓋它們。
        refs = subprocess.run(['git', 'for-each-ref', '--format=%(refname)'],
                              cwd=root, capture_output=True, text=True, timeout=120).stdout.split()
        vers = {r[0].split('_')[0] for r in stale}
        for ref in refs:
            out = subprocess.run(['git', 'show', '%s:supabase/APPLIED.tsv' % ref],
                                 cwd=root, capture_output=True, text=True, timeout=60).stdout
            have = {l.split('\t')[0] for l in out.split('\n') if l[:4] == '2026'}
            for v in vers & have:
                other.setdefault(v, []).append(ref)
    except Exception as e:                       # noqa: BLE001
        print('⚠️ 掃別的分支失敗(%s)⇒ 下面那個「未 apply」少了一層過濾, 不要當成定論' % e)

    hot = [r for r in stale if r[0].split('_')[0] not in applied and r[0].split('_')[0] not in other]
    fp = [r for r in stale if r[0].split('_')[0] not in applied and r[0].split('_')[0] in other]
    print('\n🔴 過期【且 dev 帳本上沒有那一列】= %d 顆:' % len(hot))
    print('   ⚠️ **先問一句:那一列是不是在別人還沒合的分支上?** —— 那會讓這裡變成假陽性。')
    for r in hot:
        print('   %s:%d  守 %s  釘 %s / 現在 %s' % (r[0][:46], r[1], r[3], r[2][:12], r[4][:12]))
    if fp:
        print('\n🔵 **dev 帳本沒有, 而【別的分支】的帳本有 = %d 顆** ⇒ 假陽性, 不擋人:' % len(fp))
        for r in fp:
            v = r[0].split('_')[0]
            print('   %s:%d  帳本列在 %s' % (r[0][:46], r[1], ', '.join(other[v])))
    print('\n🔵 過期而 dev 帳本上有那一列 = %d 顆 ⇒ 歷史, 不擋人'
          % (len(stale) - len(hot) - len(fp)))
    if len(same) == 0:
        print('\n🛑 **相符 0 顆** —— 停下來想一下這把尺有沒有接上, 不要直接讀成「全都過期了」。')
    return 1 if hot else 0

def selftest():
    """🔴 **這幾樁是【訂正後】的** —— 舊那五樁建立在「repo 算得回來」那個錯前提上,
    而它們**全部會過**(因為那個前提在 fixture 裡是自洽的)。
    📌 **一組在錯誤前提下全綠的 selftest, 與一組對的長得一模一樣。**
    ⇒ 現在驗的是這支真正做的事:**清冊分類正確 · 盲區有出口 · compare 那把尺會動。**
    """
    ok = True

    def world(name, files, ledger, want, fn=None, prod=None):
        nonlocal ok
        d = tempfile.mkdtemp(prefix='md5pin-')
        try:
            os.makedirs(os.path.join(d, MIG))
            for rel, body in files.items():
                io.open(os.path.join(d, MIG, rel), 'w', encoding='utf-8').write(body)
            io.open(os.path.join(d, LEDGER), 'w', encoding='utf-8').write(ledger)
            if prod is not None:
                pf = os.path.join(d, 'prod.txt')
                io.open(pf, 'w', encoding='utf-8').write(prod)
                got = compare(d, pf, quiet=True)
            else:
                got = (fn or run)(d, quiet=True)
            if got != want:
                ok = False
            print('  %s %-46s 期望 rc=%d 實得 rc=%d' % ('✅' if got == want else '🔴', name, want, got))
        finally:
            shutil.rmtree(d, ignore_errors=True)

    GATE = ("DO $$\nDECLARE v_md5 text;\nBEGIN\n"
            "  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.proname = 'zz_fn';\n"
            "  IF v_md5 <> '%s' THEN RAISE EXCEPTION 'x'; END IF;\nEND $$;\n")
    H_OLD = 'a' * 32
    H_NEW = 'b' * 32

    # ① 清冊模式【恆 0】—— 它沒有重算任何東西, 沒有資格判紅
    world('① 清冊模式恆 0(它沒重算, 沒資格判紅)',
          {'20260202000000_p.sql': GATE % H_OLD}, '', 0)

    # ② compare:釘子與正式庫相符 ⇒ 0
    world('② compare 相符 ⇒ 0',
          {'20260202000000_p.sql': GATE % H_OLD}, '', 0,
          prod=' zz_fn | %s | 10\n' % H_OLD)

    # ③ compare:過期 + 那支【未 apply】⇒ 1
    world('③ compare 過期 + 未 apply ⇒ 1',
          {'20260202000000_p.sql': GATE % H_OLD}, '', 1,
          prod=' zz_fn | %s | 10\n' % H_NEW)

    # ④ compare:過期 + 那支【已 apply】⇒ 0(歷史不擋人)
    world('④ compare 過期 + 已 apply ⇒ 0(歷史不擋人)',
          {'20260202000000_p.sql': GATE % H_OLD},
          '20260202000000\tx\t2026-01-01\tx\n', 0,
          prod=' zz_fn | %s | 10\n' % H_NEW)

    # ⑤ 🔴 compare 的尺沒接上 ⇒ **rc=2**, 不可以回 0
    #    📌 「讀到 0 筆」與「沒有過期」在一個只看 hot 的判斷裡印同一個東西。
    world('⑤ prod 檔讀到 0 筆 ⇒ 2(不可以讀成「沒有過期」)',
          {'20260202000000_p.sql': GATE % H_OLD}, '', 2, prod='(空)\n')

    # ⑥/⑥b 🔴 **這兩格是一對** —— 單看 ⑥ 的 rc=0 分不出「它正確地不判註解」與「它整個壞了」。
    #    ⇒ 同一個過期雜湊, 放註解裡 ⇒ 0;放碼裡 ⇒ 1。**兩格一起才有判別力。**
    world('⑥  同一個過期值放【註解】裡 ⇒ 0(它不是閘)',
          {'20260202000000_p.sql': "-- 舊值 md5 = %s\n" % H_OLD}, '', 0,
          prod=' zz_fn | %s | 10\n' % H_NEW)
    world('⑥b 同一個過期值放【碼】裡 ⇒ 1(配對格, 證明 ⑥ 不是恆 0)',
          {'20260202000000_p.sql': GATE % H_OLD}, '', 1,
          prod=' zz_fn | %s | 10\n' % H_NEW)

    print('\n%s selftest %s' % ('✅' if ok else '🔴', 'PASS' if ok else 'FAIL'))
    return 0 if ok else 1


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        sys.exit(selftest())
    if '--compare' in sys.argv:
        sys.exit(compare('.', sys.argv[sys.argv.index('--compare') + 1]))
    sys.exit(run('.', emit_sql='--emit-sql' in sys.argv))
