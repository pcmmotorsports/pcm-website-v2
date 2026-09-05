#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
交易隔離級別【靜態】掃描閘 —— ⟦b4-NCPCRONRACE⟧ 的證人

【為什麼有這一支】
2026-09-05 -db 窗對 ⟦b4-NCPCRONRACE⟧ 做了兩連線實測, 結論寫在
`docs/plans/2026-09-05-ncp-cron-race-lock-plan.md`(判「不做」)。
那個結論的射程被我自己寫成一句話:

    「哪天有人把它改成 REPEATABLE READ, 這個結論就不成立 —— 而不會有東西叫。」

實測的形狀:READ COMMITTED 下每一條 statement 拿到新快照 ⇒ 後到的那條看得見先到的
那條寫進去的列 ⇒ 兩個 cron 同時跑不會重複開單。
改成 REPEATABLE READ 之後, 整個交易共用一個快照 ⇒ 後到的那條【看不見】⇒ 重複開單,
或拿到 `could not serialize access due to concurrent update`。
⇒ 那個實測的前提是「隔離級別是 read committed」, 而那是個【環境】, 不是碼裡寫死的東西。
⇒ 本閘就是把那個前提釘住:誰在 repo 裡寫下改隔離級別的碼, 這裡紅。

【本閘與既有 runtime 閘的關係 —— 互補, 不重複】
repo 裡已經有另一種閘, 形狀是(例 20260803130000_…a2b1…:117-119):
    IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
      RAISE EXCEPTION '…隔離閘:守門僅在 read committed 下健全…;拒收'
那是 **runtime 閘**:函式被呼叫【當下】級別不對就拒收。
🔴 而它守不到「新寫的一支函式忘了掛那道 IF」—— 沒掛的那支對它完全透明。
本閘是 **靜態閘**:守的是「有人在 repo 裡【寫下】改隔離級別的碼」, 掃的是原始碼不是執行期。
🛑 兩者各自對另一邊失明 ⇒ 兩個都要留, 不要因為「已經有一個了」把哪一個拿掉。

【剝什麼 —— 🔴 SQL 與 TS 【相反】, 不要只讀這一段】
· **SQL**:剝行註解 `--` · 區塊註解 `/* */` · **字串字面**。
· **TS**:剝區塊註解與【整行是註解】的行, **不剝字串**。
  理由與實錘寫在 `strip_noise()` 的 docstring 裡 —— TS 裡的 SQL 全部住在字串裡,
  剝了就等於不掃。(2026-09-05 code-reviewer R1 第 2/4 條 must-fix)
🛑 只讀本段而漏掉那一句 ⇒ 會推出「TS 字串裡的 SQL 掃不到」, 而那正是 R1 抓到的那個病。
理由:repo 裡談論這幾個級別的句子【全部】住在註解或 RAISE/COMMENT 的訊息字串裡
(2026-09-05 量到 4 條:20260812140000:227 / 20260820100000:390 /
 20260830210000:302 / 20260730140000:235)—— 那些是在【講】它, 不是在【設定】它。
不剝就是 4 個假指控, 而假指控比假綠更浪費人。
⚠️ 刻意【不】剝 dollar quote(`$$ … $$`):函式本體就住在那裡面,
   而本體裡的 `SET TRANSACTION ISOLATION LEVEL` 正是我們要抓的東西。
"""
import io, os, re, sys, tempfile, shutil

PATTERN = re.compile(
    r'SET\s+TRANSACTION\s+ISOLATION\s+LEVEL'
    r'|BEGIN\s+ISOLATION\s+LEVEL'
    # 🔴 `default_transaction_isolation` 是 reviewer 2026-09-05 打出來的第 4 條 must-fix:
    #    `SET default_transaction_isolation TO 'repeatable read';` 的【值】住在字串裡,
    #    剝掉之後只剩鍵名 ⇒ 原本的 pattern 完全看不到它。`ALTER DATABASE/ROLE … SET` 同款。
    r'|default_transaction_isolation'
    # 🔴 字界:`type SerializableProps` 實測會被無字界的 SERIALIZABLE 誤殺(reviewer nit 6)。
    r'|\bREPEATABLE\s+READ\b'
    r'|\bSERIALIZABLE\b'
    r'|\bisolationLevel\b',
    re.I,
)

# 掃描射程(f8 2026-09-05 派工原句所指)
ROOTS = [
    ('supabase/migrations', ('.sql',)),
    ('apps/admin/src', ('.ts', '.tsx')),
    ('apps/storefront/src', ('.ts', '.tsx')),
    # 🔴 reviewer 第 5 條:生 SQL 的碼住在 packages/adapters —— 例
    #    `packages/adapters/src/payment/PgReleaseSiblingAdapter.ts:48` 的 `client.query(`
    #    是原生 pg 連線, 正是會寫 `BEGIN ISOLATION LEVEL` 的地方。原本 298 支 .ts 一支沒掃。
    #    (`apps/api/src` / `apps/sync-engine/src` 實查 0 支 .ts ⇒ 不是缺口, 不列。)
    ('packages', ('.ts', '.tsx')),
]
# ⚠️ 射程外(R2 2026-09-05 grep 過, 今天全部無隔離級別字面, 記在這裡讓下一個人不用重查):
#    `supabase/rollbacks/*.sql` + `supabase/after-checks/*.sql` 共 22 支不在分母。
#    而 `.js/.mjs/.cjs` 在 apps/*/src + packages 實查 0 支、`scripts/*.ts` 0 支
#    ⇒ 那兩個【不是缺口】, 是本來就沒有。

# ── 具名豁免 ─────────────────────────────────────────────
# 🔴 f8 2026-09-05 拍「甲」:具名豁免 + 把理由那三行引進閘, pin 0。
#    為什麼不是 pin=1:pin 成 1 的閘在【有人刪掉那一行】的時候也會紅,
#    而那是「好事」變成「紅燈」⇒ 閘會在錯的方向叫。
#    具名豁免的好處是它綁在【檔名】上:那支檔改了名或被刪, 豁免自然失效, 其他一切照舊紅。
EXEMPT = {
    'supabase/migrations/20260904210000_m4b_dbk_external_id_rename.sql':
        # 逐字引自該檔 :79-83 的理由(不是我重寫的摘要):
        '「REPEATABLE READ 讓我【看見】衝突, 而 FOR UPDATE 讓我【先佔住】」'
        ' —— dbk external_id 改名是一次性資料搬移, 要的正是「整個交易一個快照」;'
        ' 與 ⟦b4-NCPCRONRACE⟧ 講的那條【常駐 cron 路徑】不是同一件事。'
        '(2026-09-05 -f8 拍甲具名豁免)',
}

MSG_TAIL = (
    '\n  ⟦b4-NCPCRONRACE⟧ 的「不做」判決建立在【READ COMMITTED 每條 statement 拿新快照】'
    '這個前提上(2026-09-05 兩連線實測, docs/plans/2026-09-05-ncp-cron-race-lock-plan.md)。'
    '\n  改隔離級別 ⇒ 那個前提沒了 ⇒ 那個判決要重做, 不是把本閘關掉。'
    '\n  真的要改 ⇒ 把檔名加進本檔的 EXEMPT 並寫下理由, 讓下一個人讀得到你為什麼。'
)


def strip_noise(text, sql):
    """剝掉雜訊。🔴 SQL 與 TS 【不同規則】—— reviewer 2026-09-05 第 2 與第 4 條 must-fix。

    SQL:剝行註解 `--` · 區塊註解 · 引號字串。
      理由:repo 裡談論這幾個級別的句子全住在註解或 `RAISE`/`COMMENT` 的訊息字串裡
      (2026-09-05 量到的【字串字面】那個子集有 4 條:20260812140000:227 /
       20260820100000:390 / 20260830210000:302 / 20260730140000:235 —— 那 4 是子集不是總數,
       未剝之前的原始 grep 是 30 行)⇒ 不剝就是 4 個假指控。

    TS:**只剝註解, 不剝字串**。
      🔴 為什麼反過來:TS 裡的 SQL【全部】住在字串裡 ——
         `client.query('BEGIN ISOLATION LEVEL REPEATABLE READ')` 剝掉字串就等於把要抓的
         東西整個丟掉 ⇒ 靜默變綠。(reviewer 逐條實測, 三發全綠。)
      🔴 而且逐字元認 TS 字串本身就會壞:`apps/admin/src/lib/products/product-repository.ts:225`
         的正規式字面 `replace(/(["\\])/g, '\\$1')` 裡那個 `"` 被當成字串開頭 ⇒ 從此對不齊
         ⇒ 該檔 601 行裡 496 行插進真地雷【掃不到】。全樹實測 45 支 .ts/.tsx 全盲。
      ⚠️ 射程要明寫:TS 側只剝【整行是註解】的行與區塊註解。
         代價 = 行尾註解裡提到 `REPEATABLE READ` 會假紅。
         🟢 而假紅印得出檔案:行號, 人看一眼就分得出;假綠沒有任何形狀。**這個方向是選的, 不是漏的。**
    """
    if not sql:
        out, i, n = [], 0, len(text)
        while i < n:
            if text.startswith('/*', i):
                j = text.find('*/', i + 2)
                # 🔴 沒有收尾的 `/*` ⇒ 原本會把檔案【剩下全部】當註解吞掉 ⇒ 靜默變綠
                #    (R2 實測樣板字串版 want=1 got=0, 是那一輪唯一一發 f)。
                #    ⇒ 吞不到就【原文保留】, 讓它變假紅 —— 與本檔一貫的方向同向:
                #      假紅印得出檔案:行號, 假綠沒有任何形狀。今天實例 0, 這是潛伏防護。
                if j < 0:
                    out.append(text[i:])
                    i = n
                    continue
                out.append('\n' * text[i:j + 2].count('\n'))
                i = j + 2
            else:
                j = text.find('\n', i)
                j = n if j < 0 else j
                line = text[i:j]
                out.append('' if line.lstrip().startswith(('//', '*')) else line)
                out.append('\n')
                i = j + 1
        return ''.join(out)

    out, i, n = [], 0, len(text)
    while i < n:
        ch = text[i]
        if text.startswith('--', i):
            j = text.find('\n', i)
            i = n if j < 0 else j                    # 保留換行, 行號才對得上
        elif text.startswith('/*', i):
            j = text.find('*/', i + 2)
            seg = text[i:n if j < 0 else j + 2]
            out.append('\n' * seg.count('\n'))
            i = n if j < 0 else j + 2
        elif ch in ("'", '"'):
            # 🔴 `E'…'` 才吃反斜線跳脫(reviewer 第 4 條第三個實例:
            #    `SELECT E'it\'s'; SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;` 原本會 desync ⇒ 綠)
            esc = ch == "'" and i > 0 and text[i - 1] in 'Ee'
            q, j = ch, i + 1
            while j < n:
                if esc and text[j] == '\\':
                    j += 2; continue
                if text[j] == q:
                    if q == "'" and j + 1 < n and text[j + 1] == "'":
                        j += 2; continue             # SQL 的 '' = 一個引號
                    break
                j += 1
            out.append('\n' * text[i:j].count('\n'))
            i = j + 1
        else:
            out.append(ch)
            i += 1
    return ''.join(out)


def scan(root_dir):
    hits, exempted, denom = [], [], 0
    for rel, exts in ROOTS:
        base = os.path.join(root_dir, rel)
        if not os.path.isdir(base):
            continue
        for dp, dns, fns in os.walk(base):
            dns[:] = [d for d in dns if d not in ('node_modules', 'dist', '.next', 'coverage')]
            for fn in sorted(fns):
                if not fn.endswith(exts):
                    continue
                path = os.path.join(dp, fn)
                relpath = os.path.relpath(path, root_dir).replace(os.sep, '/')
                denom += 1
                src = io.open(path, encoding='utf-8', errors='ignore').read()
                clean = strip_noise(src, fn.endswith('.sql'))
                raw_lines = src.split('\n')
                # 🔴 全文 finditer 不逐行 —— reviewer nit 7:逐行掃會讓 pattern 裡的 `\s+`
                #    跨不了行, 而 `SET TRANSACTION\n  ISOLATION LEVEL …` 是合法 SQL。
                seen = set()
                for m in PATTERN.finditer(clean):
                    ln = clean.count('\n', 0, m.start()) + 1
                    if ln in seen:      # 同一行可能同時命中兩個 alternative, 只報一次
                        continue
                    seen.add(ln)
                    raw = raw_lines[ln - 1].strip() if ln <= len(raw_lines) else ''
                    (exempted if relpath in EXEMPT else hits).append((relpath, ln, raw))
    return hits, exempted, denom


def run(root_dir, quiet=False):
    hits, exempted, denom = scan(root_dir)
    # 🔴 reviewer 第 1 條 must-fix:分母 0 原本印「✅ 0 命中」rc=0。
    #    `cd /tmp && python3 <絕對路徑>/…py` 就是那個世界, 而 husky hook 繼承 cwd 與環境
    #    ⇒ 一個站錯地方的閘會印綠。**0 個分母不是「沒問題」, 是這把尺沒接上。**
    #    (同一條 finding 指出的 `ISO_GATE_ROOT` 後門已刪 —— selftest 直接傳 root 進 run()。)
    if denom == 0:
        print('🔴 分母 0 支 ⇒ 本閘沒有掃到任何檔(cwd 不對, 或射程目錄不存在)', file=sys.stderr)
        print('   本閘自己壞了, 不是「沒問題」⇒ exit 2', file=sys.stderr)
        return 2
    if not quiet:
        print('隔離級別靜態閘:分母 %d 支 · 命中 %d · 具名豁免 %d'
              % (denom, len(hits), len(exempted)))
        for relpath, ln, raw in exempted:
            print('  ⚪ 豁免 %s:%d  %s' % (relpath, ln, raw[:80]))
            print('       理由 %s' % EXEMPT[relpath])
    if hits:
        print('\n🔴 有人在 repo 裡改了交易隔離級別:')
        for relpath, ln, raw in hits:
            print('   %s:%d\n      %s' % (relpath, ln, raw[:120]))
        print(MSG_TAIL)
        return 1
    if not quiet:
        print('✅ 0 命中(豁免的那 %d 條不算命中)' % len(exempted))
    return 0


# ── 兩世界自證 ────────────────────────────────────────────
def selftest():
    """該綠的餵一發必須綠, 該紅的餵一發必須紅。十樁, 少一樁都不算證。"""
    ok = True

    def world(name, files, want):
        nonlocal ok
        d = tempfile.mkdtemp(prefix='isogate-')
        try:
            for rel, body in files.items():
                fp = os.path.join(d, rel)
                os.makedirs(os.path.dirname(fp), exist_ok=True)
                io.open(fp, 'w', encoding='utf-8').write(body)
            got = run(d, quiet=True)
            if got != want:
                ok = False
            print('  %s %-40s 期望 rc=%d 實得 rc=%d'
                  % ('✅' if got == want else '🔴', name, want, got))
        finally:
            shutil.rmtree(d, ignore_errors=True)

    M = 'supabase/migrations/'
    T = 'apps/admin/src/'
    CLEAN = {M + '20260101000000_clean.sql': 'BEGIN;\nSELECT 1;\nCOMMIT;\n'}

    world('① 乾淨樹 ⇒ 綠', CLEAN, 0)
    world('② SQL 真的改了級別 ⇒ 紅',
          {M + '20260101000000_bad.sql':
           'BEGIN;\nSET TRANSACTION ISOLATION LEVEL REPEATABLE READ;\nCOMMIT;\n'}, 1)
    world('③ SQL 只在註解/訊息裡提到 ⇒ 綠',
          {M + '20260101000000_talk.sql':
           "-- REPEATABLE READ 會讓計數看不到\n"
           "COMMENT ON TABLE t IS 'SERIALIZABLE 也擋';\n"
           "RAISE EXCEPTION 'isolationLevel 不對';\n"}, 0)
    world('④ 豁免只保護那一支, 別支照樣紅',
          {list(EXEMPT)[0]: 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;\n',
           M + '20260101000000_other.sql':
           'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;\n'}, 1)
    world('⑤ 只有豁免那一支 ⇒ 綠',
          {list(EXEMPT)[0]: 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;\n'}, 0)
    # ⑥⑦ = reviewer 第 2 與第 4 條 must-fix 的證人:TS 側原本 45 支全盲, selftest 表演不到。
    world('⑥ TS 字串裡的 SQL ⇒ 紅',
          dict(CLEAN, **{T + 'repo.ts':
               'const re = /(["\\\\])/g;\n'
               "await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');\n"}), 1)
    world('⑦ TS 正常碼 + 行首註解 ⇒ 綠',
          dict(CLEAN, **{T + 'ok.ts':
               '// REPEATABLE READ 在這裡只是被講到\n'
               'type SerializableProps = { a: string };\n'
               'export const u = "https://x/y";\n'}), 0)
    world('⑧ default_transaction_isolation ⇒ 紅',
          {M + '20260101000000_alter.sql':
           "ALTER DATABASE d SET default_transaction_isolation TO 'repeatable read';\n"}, 1)
    world('⑨ 分母 0(站錯地方)⇒ 閘自己壞了 rc=2', {}, 2)
    # ⑩ = R2 那一發唯一的 f 的證人。修之前 want=1 got=0(整個檔案剩餘被當註解吞掉)。
    world('⑩ TS 未收尾的 /* 不得吞掉後面的碼',
          dict(CLEAN, **{T + 'unterminated.ts':
               '/* 這個註解忘了收尾\n'
               "await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');\n"}), 1)

    print('\n%s selftest %s' % ('✅' if ok else '🔴', 'PASS' if ok else 'FAIL'))
    return 0 if ok else 1


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        sys.exit(selftest())
    sys.exit(run('.'))
