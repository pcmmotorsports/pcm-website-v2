#!/usr/bin/env python3
"""正式庫的 `public` function 對照版控(`supabase/migrations/`)—— 兩層比對。

🔴 **為什麼要兩層, 而不是只比 `md5(prosrc)`**(2026-09-07 線【資料】`-db` 實測出來的):
   PostgreSQL 把函式 body **逐字**存起來 —— **註解與空白都在裡面**。
   而我們**明文在做**「事後在已套用的 migration 上補一句訂正註解」這件事
   (`20260807160000` 就被 `20260809200000` 的落地補過一段「純註解更正,不改行為」)。
   ⇒ 原文 md5 會把那個動作讀成**漂移**。實測 **201 支裡 4 支假陽性 = 2%**,
     而每一發都長得像事故(一支 `SECURITY DEFINER` 報「庫上跟版控不一樣」⇒ 讀的人會立刻升級)。
   ⇒ 📌 **第一層(原文 md5)只當粗篩;第二層(剝掉註解與空白)才是判準。**

🟢 **唯讀**:這支**只**透過 `scripts/readonly-prod-sql.sh` 跑 `SELECT`,不 apply 任何東西、
   不寫任何檔到 repo,也**絕不印連線字串**(那支腳本自己守著這一條)。

🔴🔴 **四個桶, 不是三個 —— 而那是 code-reviewer R1 的 M5 逼出來的**
   「正式庫跑著**較舊一代**」= 正式庫**真的**跑著跟 repo 不同的邏輯。
   第一版把它算進「不是行為漂移」那一桶 ⇒ 📌 **「🔴 0」會被讀成「沒事」, 而它不是。**
   ⇒ 現在分開印:🟢 一致 · 🟡 **真的不同 / 判不準** · 🔵 只差註解空白 · 🔴 真漂移 / 未判。

🛑 **它答不出什麼(每次都印;一個量具的輸出沒帶射程,它就是下一件事故)**
   · 只涵蓋 **`public` schema 的 `prokind='f'`** ——
     **view / table / policy / GRANT / trigger / index 完全沒比**(權限那一面是板列 `⟦b9-ACLDRIFT5⟧`)。
   · repo 側的解析要求 `CREATE [OR REPLACE] FUNCTION public.<名>(` + dollar 引號 body。
     **別的寫法(名字換行、單引號 body、動態組出來的 DDL)會被讀成「repo 裡找不到」** ——
     ⇒ 所以本工具**每次都印「repo 裡連一代都找不到」那個數**:**那就是解析器的漏接率**,不藏在裡面。
   · **repo 側不解析簽章**(檔案文字裡的參數型別不等於 catalog 的簽章)⇒ 同名 overload 依名字聚合。
     🔴 而**同一個最新版本底下出現兩組 body 時, 本工具判不準** ⇒ 那種一律進 🟡, **不進 🟢**
     (R1 M2:`create_order` 在 `20260906500000` 底下就有兩組)。
   · 🟡 / 🔵 **都不等於「沒事」** —— 它們逐條印理由, 那幾條要人讀。

用法:
  python3 scripts/prod-vs-vc-functions.py                 # 打正式庫(唯讀)
  python3 scripts/prod-vs-vc-functions.py --prod-tsv F    # 用先前存下來的讀數重算, 不連線
  python3 scripts/prod-vs-vc-functions.py --selftest      # 正負對照, 不連線
"""
import re, io, os, sys, glob, hashlib, subprocess, tempfile, importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


# 🔵 **不自己再寫一支剝註解的 lexer** —— repo 裡已經有一支照 PG 規則寫的
#    (`scripts/sql-comment-strip-audit.py` 的 `lex_strip`)。
#    📌 兩支各寫各的剝法, 遲早會對同一段碼給出不同答案, 而那種分歧沒有訊號。
def _load_lex_strip():
    p = os.path.join(HERE, 'sql-comment-strip-audit.py')
    if not os.path.exists(p):
        sys.stderr.write('🔴 找不到 %s ⇒ 停(不自己代寫剝法)\n' % p)
        sys.exit(2)
    spec = importlib.util.spec_from_file_location('_sqlstrip', p)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.lex_strip


lex_strip = _load_lex_strip()

FN_DEF = re.compile(
    r'CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?("?[A-Za-z0-9_]+"?)\s*\(', re.I)
TAG = re.compile(r'(\$[A-Za-z_0-9]*\$)')

# 🔴 R1 M3:第一版的 `_LIT` 只認 `'…'` 與 `''` 轉義 ⇒ 撞到 `E'a\', b'` 會**提早收尾**,
#    之後「哪一段是字串、哪一段是碼」整個**奇偶反轉** ⇒ 錯位窗裡**真的字串字面**被當成碼、
#    標點旁的空白被壓掉 ⇒ 兩個**不同**的字串被判成相同 ⇒ **假陰性**(真的改了而我說沒改)。
#    實錘:`20260804120000:225` 逐字有 `position(E'USING ERRCODE = \'P8C01\'' in v_def)`。
#    同族的還有雙引號識別字(`"it's"` 一樣讓切分反轉)。⇒ 四種一起認, dollar tag 用反向參照配對。
_LIT = re.compile(
    r'\$([A-Za-z_0-9]*)\$[\s\S]*?\$\1\$'        # dollar-quoting(前後 tag 必須同名)
    r"|[EeNn]'(?:[^'\\]|\\.|'')*'"               # E'…' / N'…':反斜線轉義
    r"|'(?:[^']|'')*'"                           # 一般 '…':以 '' 轉義
    r'|"(?:[^"]|"")*"'                           # 雙引號識別字
)
_PUNCT = re.compile(r'\s*([(),;])\s*')


def _squeeze_outside_literals(s):
    """收斂空白 + 去掉標點旁的空白 —— 🛑 **不碰字串字面 / dollar 塊 / 引號識別字裡面**。
    `'a, b'` 與 `'a,b'` 是兩個**不同的值**, 壓成一樣會製造假陰性。"""
    out, last = [], 0
    for m in _LIT.finditer(s):
        out.append(_PUNCT.sub(r'\1', re.sub(r'\s+', ' ', s[last:m.start()])))
        out.append(m.group(0))
        last = m.end()
    out.append(_PUNCT.sub(r'\1', re.sub(r'\s+', ' ', s[last:])))
    return ''.join(out).strip()


def md5(s):
    return hashlib.md5(s.encode('utf-8')).hexdigest()


def raw_key(body):
    """第一層:原文(只剝 CR —— 正式庫那邊算的是 `md5(replace(prosrc, chr(13), ''))`)。"""
    return md5(body.replace('\r', ''))


def norm_key(body):
    """第二層:剝掉註解 ⇒ 收斂空白 ⇒ 去掉標點旁空白(字串內不動)—— 剩下的才是【碼】。"""
    return md5(_squeeze_outside_literals(lex_strip(body)))


def comment_mask(s):
    """把註解換成等量空白, **保留每個字元的位置** —— 用它去找定義, 而 body 從原文取。
    🔴 R1 nit:第一版直接對原文跑 `FN_DEF` ⇒ 實測 361 個命中裡 **7 個落在註解裡**
       ⇒ 被印出來當分母的 `points` 灌水, 而註解裡引用的舊 body 也會進索引。"""
    o = list(s); i = 0; n = len(s); depth = 0

    def blank(a, b):
        for k in range(a, min(b, n)):
            if o[k] != '\n':
                o[k] = ' '

    while i < n:
        if depth:
            if s.startswith('/*', i):
                depth += 1; blank(i, i + 2); i += 2; continue
            if s.startswith('*/', i):
                depth -= 1; blank(i, i + 2); i += 2; continue
            blank(i, i + 1); i += 1; continue
        if s.startswith('--', i):
            j = s.find('\n', i); j = n if j < 0 else j
            blank(i, j); i = j; continue
        if s.startswith('/*', i):
            depth = 1; blank(i, i + 2); i += 2; continue
        if s[i] == "'":
            j = i + 1
            while j < n:
                if s[j] == "'":
                    if j + 1 < n and s[j + 1] == "'":
                        j += 2; continue
                    j += 1; break
                j += 1
            i = j; continue
        if s[i] == '$':
            m = TAG.match(s, i)
            if m:
                t = m.group(1); j = s.find(t, m.end())
                i = n if j < 0 else j + len(t)
                continue
        i += 1
    return ''.join(o)


def scan_repo(migrations_dir):
    """回傳 raw_i / norm_i / newest / newest_bodies / points。"""
    raw_i, norm_i, newest, points = {}, {}, {}, 0
    per_ver = {}                      # (name, ver) -> set(raw md5)
    for path in sorted(glob.glob(os.path.join(migrations_dir, '*.sql'))):
        ver = os.path.basename(path)[:14]
        s = io.open(path, encoding='utf-8', errors='replace').read()
        masked = comment_mask(s)
        for m in FN_DEF.finditer(masked):
            name = m.group(1).strip('"').lower()
            t = TAG.search(masked[m.end():m.end() + 4000])
            if not t:
                continue
            st = m.end() + t.end()
            j = masked.find(t.group(1), st)
            if j < 0:
                continue
            body = s[st:j]            # 🔵 位置來自遮罩, 內容取自原文
            points += 1
            for idx, k in ((raw_i, raw_key(body)), (norm_i, norm_key(body))):
                key = (name, k)
                if ver > idx.get(key, ''):
                    idx[key] = ver
            per_ver.setdefault((name, ver), set()).add(raw_key(body))
            if ver > newest.get(name, ''):
                newest[name] = ver
    newest_bodies = {n: per_ver.get((n, v), set()) for n, v in newest.items()}
    return raw_i, norm_i, newest, newest_bodies, points



def _loose_find(migrations_dir, name, want_norm_md5):
    """寬鬆搜尋:掃**提到這個名字**的 migration 裡的**每一個 dollar 區塊**,
    看有沒有哪一段剝完註解空白之後等於正式庫那一版。

    🛑 **它只在【嚴格掃描已經判紅】的時候跑** —— 它比較貴(逐塊算 md5), 而且
      它答的是「我看不看得見」不是「對不對」。⇒ 命中 ⇒ 那個 🔴 是我的射程, 不是漂移。
    🔴 **而它自己也有射程**:用 `'CREATE OR ' || 'REPLACE …'` 拼字串組出來的 DDL, 兩把尺都看不到。
    """
    import glob as _g
    for path in sorted(_g.glob(os.path.join(migrations_dir, '*.sql'))):
        s = io.open(path, encoding='utf-8', errors='replace').read()
        if name not in s:
            continue
        for m in re.finditer(r'(\$[A-Za-z_0-9]*\$)', s):
            t = m.group(1)
            j = s.find(t, m.end())
            if j < 0:
                continue
            chunk = s[m.end():j]
            if name not in chunk:
                continue
            # 區塊裡再找一次函式定義, 取它自己的 body
            for mm in re.finditer(
                    r'CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?' + re.escape(name) + r'\s*\(', chunk):
                t2 = TAG.search(chunk[mm.end():mm.end() + 4000])
                if not t2:
                    continue
                st = mm.end() + t2.end()
                k = chunk.find(t2.group(1), st)
                if k < 0:
                    continue
                if norm_key(chunk[st:k]) == want_norm_md5:
                    return os.path.basename(path)[:14]
    return None


def _patch_style_migration(migrations_dir, name):
    """找「用字串取代產生 body」的那種 migration —— 它讓版控裡永遠沒有那一版的原文。

    判準(三個字面同時出現在**同一支檔**, 而且那支檔提到這個函式名):
      `pg_get_functiondef` · `replace(` · `EXECUTE`
    🛑 **這是一把窄尺** —— 只認這一種寫法;別種動態組法(字串相加、format())它看不到。
    """
    import glob as _g
    for path in sorted(_g.glob(os.path.join(migrations_dir, '*.sql')), reverse=True):
        s = io.open(path, encoding='utf-8', errors='replace').read()
        if name not in s:
            continue
        # 🔴🔴 **[2026-09-07 12:5x 訂正 —— 這把尺原本寬 37 倍]**
        #   原判準 = 三個字面【出現在同一支檔的任何地方】。我當場量了全庫:
        #     · 寬尺(三字面同檔)          ⇒ **37 / 376 支**
        #     · 窄尺(EXECUTE 與 replace( 在【同一句】)⇒ **1 / 376 支**
        #     · 負對照(把 replace 換成現造字串 zqx7742tmp)⇒ **0**
        #   🛑 **而寬尺的錯法是【往安全的反方向】** —— 那 37 支裡任何一支的函式將來
        #     真的漂移了, 本工具會判「🟡 設計上的」而不是「🔴 真漂移」⇒ **一次真事故被藏起來**。
        #     📌 一把尺寬 37 倍不是精度問題, 是它在**該叫的時候不叫**。
        #   ⇒ 改成窄尺:`EXECUTE` 與 `replace(` 必須在**同一句**(EXECUTE 到下一個分號)裡。
        #   ⚠️ 窄尺的已知盲區:先 `v_new := replace(...)` 再 `EXECUTE v_new;` 這種兩段式看不到。
        #     ⇒ 那一類會落回 🔴(真漂移)—— **往【多叫一次】的方向錯, 而那是對的方向。**
        for m in re.finditer(r'(?i)\bEXECUTE\b[^;]{0,400};', s):
            if re.search(r'(?i)\breplace\s*\(', m.group(0)):
                return os.path.basename(path)[:14]
    return None

def read_prod_tsv(path):
    """每行:proname <TAB> raw_md5 <TAB> 長度 <TAB> 簽章 —— 只收形狀對的列。"""
    rows, saw_control = [], False
    for line in io.open(path, encoding='utf-8', errors='replace'):
        c = line.rstrip('\n').split('\t')
        if len(c) < 2:
            continue
        if c[0] == '0-CONTROL':
            saw_control = True
            continue
        if len(c) == 4 and re.fullmatch(r'[0-9a-f]{32}', c[1]):
            rows.append((c[0], c[1], c[2], c[3]))
    return rows, saw_control


PROD_SQL = r"""\set ON_ERROR_STOP on
\pset format unaligned
\pset fieldsep '\t'
\pset tuples_only on
SELECT '0-CONTROL', md5('x'), '0', '0';
SELECT p.proname,
       md5(replace(p.prosrc, chr(13), '')),
       length(p.prosrc)::text,
       p.oid::regprocedure::text
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prokind = 'f'
ORDER BY p.proname, p.oid;
"""


def _run_readonly(sql_text, prefix):
    """唯讀:只走 readonly-prod-sql.sh。回傳 (輸出檔路徑, rc, 輸出文字)。"""
    d = tempfile.mkdtemp(prefix=prefix)
    q = os.path.join(d, 'q.sql')
    io.open(q, 'w', encoding='utf-8').write(sql_text)
    out = os.path.join(d, 'out.txt')
    with io.open(out, 'w', encoding='utf-8') as fh:
        rc = subprocess.call(['bash', os.path.join(HERE, 'readonly-prod-sql.sh'), q],
                             stdout=fh, stderr=subprocess.STDOUT, cwd=ROOT)
    return out, rc, io.open(out, encoding='utf-8', errors='replace').read()


def pull_prod():
    out, rc, txt = _run_readonly(PROD_SQL, 'prodvsvc.')
    # 🔴 那支腳本自己說過:`psql -f` 在【有 ERROR】與【全對】兩個世界 rc 都是 0
    #    (除非 .sql 自己 `\set ON_ERROR_STOP on` —— 上面那段有)。兩個都查。
    if rc != 0 or 'ERROR' in txt:
        sys.stderr.write('🔴 唯讀查詢沒有乾淨跑完(rc=%s · 輸出含 ERROR=%s)⇒ 停。\n'
                         % (rc, 'ERROR' in txt))
        sys.stderr.write('   讀數存在 %s(可帶 --prod-tsv 重算)\n' % out)
        sys.exit(1)
    return out


def fetch_bodies(sigs):
    """第二層:只對第一層對不上的那幾支撈 prosrc(唯讀)。

    🔴 R1 M1:**用【簽章】當 key, 不用 proname** —— `proname IN (…)` 每個 overload 回一列,
       依名字存會 last-wins ⇒ A overload 漂移而 B 乾淨時, A 拿到 B 的 body ⇒ 印「不是行為漂移」。
       而第一版那道完整性守門兩邊都數 distinct name ⇒ **對 overload 恆不觸發**。
       live 實例:`create_order` 現有兩支(金流 · `SECURITY DEFINER`)。"""
    if not sigs:
        return {}
    lst = ', '.join("'" + s.replace("'", "''") + "'" for s in sorted(sigs))
    sql = ("\\set ON_ERROR_STOP on\n\\pset format unaligned\n\\pset tuples_only on\n"
           "SELECT 'ZZSIG' || p.oid::regprocedure::text || 'ZZSEP' || p.prosrc || 'ZZEND'\n"
           "FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace\n"
           "WHERE n.nspname='public' AND p.prokind='f'\n"
           "  AND p.oid::regprocedure::text IN (%s);\n" % lst)
    out, rc, txt = _run_readonly(sql, 'prodvsvc-body.')
    if rc != 0 or 'ERROR' in txt:
        sys.stderr.write('🔴 第二層的唯讀查詢沒有乾淨跑完(rc=%s · 含 ERROR=%s)⇒ '
                         '撈不到的那幾支會標【未判】, 不會被算成沒事。輸出 %s\n'
                         % (rc, 'ERROR' in txt, out))
    bodies = {}
    for m in re.finditer(r'ZZSIG([\s\S]*?)ZZSEP([\s\S]*?)ZZEND', txt):
        bodies[m.group(1)] = m.group(2)
    absent = sorted(set(sigs) - set(bodies))
    if absent:
        sys.stderr.write('⚠️ 第二層有 %d/%d 支沒撈到 body ⇒ 它們標【未判】並算成 🔴:\n   %s\n'
                         % (len(absent), len(sigs), ' · '.join(absent[:5])))
    return bodies


def run(prod_tsv, migrations_dir, bodies=None):
    """bodies: {簽章: prosrc}。回傳四個桶 + 分母。"""
    prod_rows, saw_control = read_prod_tsv(prod_tsv)
    raw_i, norm_i, newest, newest_bodies, points = scan_repo(migrations_dir)
    green, older, cosmetic, red, absent = [], [], [], [], []
    for name, h, ln, sig in prod_rows:
        nv = newest.get(name)
        if nv and h in newest_bodies.get(name, set()):
            if len(newest_bodies[name]) > 1:
                # 🔴 R1 M2:同一個最新版本底下有兩組 body(overload)⇒ 本工具**判不準**,
                #    不可以印 🟢。⇒ 進 🟡, 而且說出為什麼。
                older.append((sig, '⚠️ 同名在最新一代 %s 底下有 %d 組 body(overload)⇒ '
                                   '本工具不解析簽章, **這一支判不準**'
                              % (nv, len(newest_bodies[name]))))
            else:
                green.append((sig, nv))
            continue
        prev = raw_i.get((name, h))
        if prev:
            older.append((sig, '🟡 **正式庫跑著較舊一代 %s**(repo 最新 %s)⇒ 這是【真的不同】'
                          % (prev, nv)))
            continue
        if name not in newest:
            absent.append(sig)
            red.append((sig, '🔴 repo 裡【連一代都找不到】 —— 可能是真漂移, 也可能是解析器漏接'))
            continue
        body = (bodies or {}).get(sig)
        if body is None:
            red.append((sig, '🔴 原文對不上, 而【沒有拿到 body】⇒ 第二層沒跑(未判)'))
            continue
        nk = norm_key(body)
        if norm_i.get((name, nk)) == nv:
            cosmetic.append((sig, '剝掉註解與空白後等於 repo 最新一代 ⇒ **不是行為漂移**'))
        elif norm_i.get((name, nk)):
            older.append((sig, '🟡 剝掉註解與空白後等於**較舊一代** %s ⇒ 這是【真的不同】'
                          % norm_i[(name, nk)]))
        else:
            # 🔴🔴 **[2026-09-07] 宣告「真漂移」之前, 先做一發【寬鬆搜尋】** ——
            #    來源:本工具第一次真的抓到「🔴 1」時, 那一格是 `pcm_order_refund_cap_guard`,
            #    而它**不是漂移** —— 定義藏在 `20260907110000` 的
            #    `DO … EXECUTE $patch$ CREATE OR REPLACE FUNCTION … $patch$` 裡。
            #    嚴格掃描(`comment_mask` 會整塊跳過 dollar 區塊)**看不見動態 DDL**。
            #    ⇒ 📌 **「我沒看見它的定義」與「正式庫跑著版控沒有的東西」印同一個 🔴**,
            #      而後者是事故、前者是我的射程。**兩者必須分開報。**
            loose = _loose_find(migrations_dir, name, nk)
            if loose:
                cosmetic.append((sig, '🔵 嚴格掃描找不到, 而**寬鬆搜尋**在 %s 的 dollar 區塊裡'
                                      '找到逐字相同的定義(動態 DDL)⇒ **不是漂移, 是解析器看不見它**'
                                 % loose))
            else:
                # 🔴🔴 **第二種回退:有沒有一支 migration 是【用字串取代產生 body】的**
                #    (`pg_get_functiondef` 讀現行 ⇒ `replace(…)` ⇒ `EXECUTE`)。
                #    實例:`20260907110000_…cap_guard_letpass.sql` 對
                #    `pcm_order_refund_cap_guard` 就是這樣做的。
                #    ⇒ 📌 **那一版的 body【版控裡從來不存在】** —— 它是 apply 當下從
                #      「當時線上長什麼樣」算出來的。⇒ 本工具對它**永遠不可能綠**,
                #      而那**不是漂移, 也不是我沒看見** —— 是**設計上就沒有那份原文**。
                #    🛑 所以它進 🟡(要人讀)不進 🔴(真漂移):兩者的處置完全不同。
                patched = _patch_style_migration(migrations_dir, name)
                if patched:
                    older.append((sig, '🟡 **版控裡沒有這一版的原文, 而那是設計上的** —— '
                                       '`%s` 用「讀現行定義 ⇒ 字串取代 ⇒ EXECUTE」產生它 '
                                       '⇒ 本工具對這一支**永遠不會綠**;它也沒有可貼回的前一代。' % patched))
                else:
                    red.append((sig, '🔴 剝掉註解與空白之後【仍然不同】, 寬鬆搜尋與字串取代式 migration 都找不到 ⇒ 真漂移'))
    return dict(prod=len(prod_rows), points=points, saw_control=saw_control,
                green=green, older=older, cosmetic=cosmetic, red=red, absent=absent)


def report(r):
    print('正式庫 public 的 function(prokind=f) ........ %d 支' % r['prod'])
    print('repo 掃到的 function 定義點(已剝註解) ...... %d 個' % r['points'])
    print('🔴 repo 裡【連一代都找不到】的 .............. %d 支   ← 這個數 = 解析器的漏接率'
          % len(r['absent']))
    print()
    print('🟢 原文逐字 = repo 最新一代 ................. %d' % len(r['green']))
    print('🟡 **真的不同 / 判不準** —— 要人讀 .......... %d' % len(r['older']))
    print('🔵 只差註解與空白 ⇒ 不是行為漂移 ............ %d' % len(r['cosmetic']))
    print('🔴 剝完仍不同 · 未判 · repo 查無 ............ %d' % len(r['red']))
    for title, bucket in (('🟡 真的不同 / 判不準', r['older']),
                          ('🔵 只差註解與空白', r['cosmetic']),
                          ('🔴', r['red'])):
        if bucket:
            print('\n── %s 逐條 ──' % title)
            for sig, why in bucket:
                print('   %-70s %s' % (sig[:70], why))
    if not r['saw_control']:
        print('\n🔴 讀數裡【沒有】那一列正對照(`0-CONTROL`)⇒ 這份讀數可能不是那支查詢產的, '
              '不要拿它當答案。')
    print('\n🛑 射程:只有 public 的 function —— view / table / policy / GRANT / trigger / index '
          '沒比;repo 側不解析簽章(同名 overload 依名字聚合, 同一代兩組 body 一律進 🟡)。')


# ────────────────────────── selftest ──────────────────────────
def selftest():
    # 🔴 第一件事:剝掉繼承來的 git 環境(照 CLAUDE.md 快速自檢清單那一格;`git -C` 擋不住它)
    for v in ('GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'GIT_OBJECT_DIRECTORY',
              'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_NAMESPACE'):
        os.environ.pop(v, None)
    p = f = 0

    def ck(label, got, want):
        nonlocal p, f
        if got == want:
            p += 1
        else:
            f += 1
            print('  🔴 FAIL %s (得 %r, 該是 %r)' % (label, got, want))

    d = tempfile.mkdtemp(prefix='prodvsvc-selftest.')
    mig = os.path.join(d, 'migrations')
    os.makedirs(mig)
    seq = [0]

    def write(ver, body_map):
        s = ''
        for name, body in body_map:
            s += ('CREATE OR REPLACE FUNCTION public.%s()\nRETURNS int\nLANGUAGE sql\n'
                  'AS $fn$%s$fn$;\n\n' % (name, body))
        io.open(os.path.join(mig, '%s_selftest.sql' % ver), 'w', encoding='utf-8').write(s)

    def prod_tsv(rows, control=True):
        seq[0] += 1
        f2 = os.path.join(d, 'prod-%d.tsv' % seq[0])
        with io.open(f2, 'w', encoding='utf-8') as fh:
            if control:
                fh.write('0-CONTROL\t%s\t0\t0\n' % md5('x'))
            for name, body in rows:
                fh.write('%s\t%s\t%d\t%s()\n' % (name, raw_key(body), len(body), name))
        return f2

    B_SAME = "\n  -- repo 這一版多一句訂正註解\n  SELECT 1 + 1;\n"
    B_PROD = "\n  SELECT 1 + 1;\n"                      # 只差註解
    B_SPACE = "\n  SELECT 1 +  1;\n"                    # 只差空白
    B_DIFF = "\n  SELECT 1 + 2;\n"                      # 差一個【字面】
    B_OLD = "\n  SELECT 1 + 9;\n"                       # 舊一代的 body
    write('20990101000000', [('fn_comment', B_SAME), ('fn_space', B_SAME),
                             ('fn_literal', B_SAME), ('fn_exact', B_PROD),
                             ('fn_older', B_OLD)])

    # ═ ① 正對照:原文逐字相同 ⇒ 🟢 ═
    r = run(prod_tsv([('fn_exact', B_PROD)]), mig, bodies={'fn_exact()': B_PROD})
    ck('① 逐字相同 ⇒ 🟢=1', len(r['green']), 1)
    ck('① 而且不是 🔴', len(r['red']), 0)
    ck('① 正對照:讀數有 0-CONTROL ⇒ saw_control=True', r['saw_control'], True)

    # ═ ② 只差【註解】⇒ 必須 🔵, 不可以是 🔴 ═
    r = run(prod_tsv([('fn_comment', B_PROD)]), mig, bodies={'fn_comment()': B_PROD})
    ck('② 只差註解 ⇒ 🔴=0', len(r['red']), 0)
    ck('② 只差註解 ⇒ 🔵=1', len(r['cosmetic']), 1)

    # ═ ③ 只差【空白】⇒ 同樣不可以是 🔴 ═
    r = run(prod_tsv([('fn_space', B_SPACE)]), mig, bodies={'fn_space()': B_SPACE})
    ck('③ 只差空白 ⇒ 🔴=0', len(r['red']), 0)
    ck('③ 只差空白 ⇒ 🔵=1', len(r['cosmetic']), 1)

    # ═ ④ 🔴 負對照:差一個【字面】⇒ 必須是 🔴 ═
    r = run(prod_tsv([('fn_literal', B_DIFF)]), mig, bodies={'fn_literal()': B_DIFF})
    ck('④ 差一個字面 ⇒ 🔴=1', len(r['red']), 1)
    ck('④ 而且不是 🔵', len(r['cosmetic']), 0)

    # ═ ④b 只差【標點旁的一個空白】⇒ 必須 🔵(不然那一格會永遠紅)═
    write('20990102000000', [('fn_punct', "\n  SELECT f( 'a', 1);\n"),
                             ('fn_instr', "\n  SELECT f('a, b');\n"),
                             ('fn_estr', "\n  SELECT f(E'a\\', b');\n")])
    B_PUNCT = "\n  SELECT f('a', 1);\n"
    r = run(prod_tsv([('fn_punct', B_PUNCT)]), mig, bodies={'fn_punct()': B_PUNCT})
    ck('④b 只差標點旁空白 ⇒ 🔴=0', len(r['red']), 0)
    ck('④b 只差標點旁空白 ⇒ 🔵=1', len(r['cosmetic']), 1)

    # ═ ④c 🔴 負對照:差在【字串字面裡面】⇒ 必須是 🔴 ═
    #    這一格證「去標點旁空白」**沒有伸進字串裡** —— 伸進去就會製造假陰性。
    B_INSTR = "\n  SELECT f('a,b');\n"
    r = run(prod_tsv([('fn_instr', B_INSTR)]), mig, bodies={'fn_instr()': B_INSTR})
    ck('④c 差在字串裡面 ⇒ 🔴=1', len(r['red']), 1)
    ck('④c 而且不是 🔵', len(r['cosmetic']), 0)

    # ═ ④d 🔴 R1 M3:`E'…\'…'` 的反斜線轉義不可以讓切分錯位 ═
    #    repo 是 `E'a\', b'`, 正式庫是 `E'a\',b'` —— 差在**字串裡面** ⇒ 必須 🔴。
    B_ESTR = "\n  SELECT f(E'a\\',b');\n"
    r = run(prod_tsv([('fn_estr', B_ESTR)]), mig, bodies={'fn_estr()': B_ESTR})
    ck('④d E 字串裡的差異 ⇒ 🔴=1(切分沒錯位)', len(r['red']), 1)
    ck('④d 而且不是 🔵', len(r['cosmetic']), 0)

    # ═ ⑤ repo 裡查無 ⇒ 進【找不到任何一代】那格, 而它同時是 🔴 ═
    r = run(prod_tsv([('fn_not_in_repo', B_PROD)]), mig, bodies={'fn_not_in_repo()': B_PROD})
    ck('⑤ repo 查無 ⇒ absent=1', len(r['absent']), 1)
    ck('⑤ repo 查無 ⇒ 🔴=1', len(r['red']), 1)

    # ═ ⑥ 分母:讀數裡沒有那列正對照 ⇒ 必須講出來(與 ① 成對, 兩個世界) ═
    r = run(prod_tsv([('fn_exact', B_PROD)], control=False), mig,
            bodies={'fn_exact()': B_PROD})
    ck('⑥ 沒有 0-CONTROL ⇒ saw_control=False', r['saw_control'], False)
    ck('⑥ 而那一支照樣判得出來(🟢=1)', len(r['green']), 1)

    # ═ ⑦ 第二層沒 body ⇒ 標【未判】, 不可以靜靜算成沒事 ═
    r = run(prod_tsv([('fn_literal', B_DIFF)]), mig, bodies=None)
    ck('⑦ 沒 body ⇒ 🔴=1(未判也算紅)', len(r['red']), 1)
    ck('⑦ 理由寫著「第二層沒跑」', '第二層沒跑' in (r['red'][0][1] if r['red'] else ''), True)

    # ═ ⑧ 🔴 R1 M4①:「正式庫跑著較舊一代」那一桶必須有格在守 ═
    write('20990103000000', [('fn_older', B_PROD)])      # fn_older 的新一代
    r = run(prod_tsv([('fn_older', B_OLD)]), mig, bodies={'fn_older()': B_OLD})
    ck('⑧ 正式庫跑著較舊一代 ⇒ 🟡=1', len(r['older']), 1)
    ck('⑧ 而且【不是】🟢', len(r['green']), 0)
    # 🔴 這一格要釘**第一層**那句話, 不能只釘「真的不同」——
    #    把第一層拿掉之後, 第二層會用**另一句**話把它接住(也含「真的不同」)⇒ 那一格照樣綠。
    #    實測:突變 `prev = None` ⇒ 舊版三格全過。⇒ 判準改成第一層的專屬字串。
    ck('⑧ 理由是【第一層】那句(不是被第二層接住)',
       '正式庫跑著較舊一代' in (r['older'][0][1] if r['older'] else ''), True)

    # ═ ⑨ 🔴 R1 M2:同一代兩組 body(overload)⇒ 一律進 🟡, 不可以印 🟢 ═
    write('20990104000000', [('fn_over', B_PROD), ('fn_over', B_DIFF)])
    r = run(prod_tsv([('fn_over', B_PROD)]), mig, bodies={'fn_over()': B_PROD})
    ck('⑨ 同一代兩組 body ⇒ 🟢=0', len(r['green']), 0)
    ck('⑨ ⇒ 🟡 且說「判不準」', '判不準' in (r['older'][0][1] if r['older'] else ''), True)

    # ═ ⑩ 🔴 R1 M4③:`raw_key` 要剝 CR(正式庫那邊是 `replace(prosrc, chr(13),'')`)═
    CR = "\r\n  SELECT 1 + 1;\r\n"
    io.open(os.path.join(mig, '20990105000000_selftest.sql'), 'w', encoding='utf-8',
            newline='').write('CREATE OR REPLACE FUNCTION public.fn_cr()\nRETURNS int\n'
                              'LANGUAGE sql\nAS $fn$%s$fn$;\n' % CR)
    r = run(prod_tsv([('fn_cr', CR)]), mig, bodies={'fn_cr()': CR})
    ck('⑩ 帶 \\r 的 body ⇒ 🟢=1(兩邊都剝 CR)', len(r['green']), 1)

    # ═ ⑪ 🔴 R1 nit:註解裡的假定義不可以進分母 ═
    io.open(os.path.join(mig, '20990106000000_selftest.sql'), 'w', encoding='utf-8').write(
        "-- CREATE OR REPLACE FUNCTION public.fn_in_comment() AS $fn$ SELECT 0 $fn$;\n"
        "/* CREATE OR REPLACE FUNCTION public.fn_in_block() AS $fn$ SELECT 0 $fn$; */\n"
        "CREATE OR REPLACE FUNCTION public.fn_real()\nRETURNS int\nLANGUAGE sql\n"
        "AS $fn$ SELECT 1 $fn$;\n")
    r = run(prod_tsv([('fn_real', ' SELECT 1 ')]), mig, bodies={'fn_real()': ' SELECT 1 '})
    ck('⑪ 真的那一支 🟢=1', len(r['green']), 1)
    ck('⑪ 註解裡那兩支不進分母(定義點 = 5+3+1+2+1+1 = 13)', r['points'], 13)
    ck('⑪ 而且 fn_in_comment 對它是【repo 查無】', len(run(
        prod_tsv([('fn_in_comment', ' SELECT 0 ')]), mig, bodies=None)['absent']), 1)

    # ═ ⑫ 🔴 **[2026-09-07] 字串取代式 migration ⇒ 進 🟡 不進 🔴** ═
    #   來源:本工具第一次抓到「🔴 1」時, 那一格是 `pcm_order_refund_cap_guard` ——
    #   而它不是漂移:`20260907110000` 用「讀現行定義 ⇒ `replace(…)` ⇒ `EXECUTE`」產生 body
    #   ⇒ **那一版的原文版控裡從來不存在**, 本工具對它**永遠不會綠**。
    #   🛑 而我第一版加了這個分類【沒有配格】—— 突變(`patched = None`)⇒ **30 格照樣全過**。
    #     📌 我一小時前才在別支修同一個病, 而我自己立刻犯了一次。⇒ 補這兩格。
    write('20990102000000', [('fn_patched', B_OLD)])   # 版控裡有【舊】一代
    io.open(os.path.join(mig, '20990201000000_selftest.sql'), 'w', encoding='utf-8').write(
        "-- 這一支不含 fn_patched 的完整定義, 它是【算出來】的\n"
        "DO $patch$\nDECLARE v_def text;\nBEGIN\n"
        "  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p WHERE p.proname='fn_patched';\n"
        "  EXECUTE pg_catalog.replace(v_def, 'A', 'B');\nEND $patch$;\n")
    B_PATCHED = "\n  SELECT 1 + 12345;\n"          # 版控裡沒有任何一代長這樣
    r = run(prod_tsv([('fn_patched', B_PATCHED)]), mig, bodies={'fn_patched()': B_PATCHED})
    ck('⑫ 字串取代式 ⇒ 🔴=0(不可以報成真漂移)', len(r['red']), 0)
    ck('⑫ ⇒ 進 🟡 且說「設計上的」',
       '設計上的' in (r['older'][0][1] if r['older'] else ''), True)
    # ═ ⑫c 🔴 **寬尺會把【真漂移】藏成「設計上的」** —— 這一格就是為了那件事 ═
    #   量到的:三字面【同檔任何地方】⇒ 全庫 37/376 支命中;而【同一句】⇒ 1/376。
    #   ⇒ 那 37 支裡任何一支將來真的漂移, 寬尺會判 🟡 不判 🔴 ⇒ **一次真事故被藏起來**。
    write('20990103000000', [('fn_scattered', B_OLD)])
    io.open(os.path.join(mig, '20990204000000_selftest.sql'), 'w', encoding='utf-8').write(
        "-- 這一支【提到】fn_scattered, 三個字面也都在, 而它們【不在同一句】\n"
        "-- 註解裡提到 pg_get_functiondef 只是為了說明\n"
        "SELECT regexp_replace('a', 'b', 'c');\n"
        "DO $d$ BEGIN EXECUTE 'SELECT 1'; END $d$;\n")
    r = run(prod_tsv([('fn_scattered', B_PATCHED)]), mig,
            bodies={'fn_scattered()': B_PATCHED})
    ck('⑫c 三字面【不同句】⇒ 仍是 🔴 真漂移(寬尺會誤放成 🟡)', len(r['red']), 1)

    # 🔴 負對照:同一個對不上的 body, 而【沒有】那種 migration ⇒ 必須是真漂移
    r = run(prod_tsv([('fn_exact', B_PATCHED)]), mig, bodies={'fn_exact()': B_PATCHED})
    ck('⑫b 🔴 負對照:沒有字串取代式 migration ⇒ 🔴=1', len(r['red']), 1)

    print('── selftest: %d PASS / %d FAIL' % (p, f))
    if p + f != 34:
        print('  🔴 【格數】不對:跑了 %d 格 ≠ 34 ⇒ 有格被刪掉或沒跑到' % (p + f))
        return 1
    return 1 if f else 0


def main():
    a = sys.argv[1:]
    if '--selftest' in a:
        sys.exit(selftest())

    def opt(flag, default):
        if flag not in a:
            return default
        i = a.index(flag)
        if i + 1 >= len(a):
            sys.stderr.write('🔴 %s 少了值 ⇒ 停(不猜)\n' % flag)
            sys.exit(2)
        return a[i + 1]

    mig = opt('--migrations-dir', os.path.join(ROOT, 'supabase', 'migrations'))
    tsv = opt('--prod-tsv', None)
    if tsv:
        print('🔵 用既有讀數 %s(沒有連線)⇒ **第二層拿不到 body, 對不上的會標【未判】**\n' % tsv)
        report(run(tsv, mig, bodies=None))
        return
    tsv = pull_prod()
    print('🔵 唯讀讀數存於 %s\n' % tsv)
    r = run(tsv, mig, bodies=None)
    if r['red']:
        r = run(tsv, mig, bodies=fetch_bodies(sorted({sig for sig, _ in r['red']})))
    report(r)


if __name__ == '__main__':
    main()
