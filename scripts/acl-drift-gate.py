#!/usr/bin/env python3
"""acl-drift-gate.py — 新 migration 裡的【ACL 漂移】⇒ 擋下 commit。

══ 存在理由(cf 2026-08-27 盤點量到的,不是設計偏好)═══════════════════════════
`supabase/migrations/` 裡 774 個 privilege 檢查呼叫(has_table_privilege / aclexplode …)
**100% 住在 apply 時一次性的 `DO` 區塊裡**;repo 內可執行的 `CREATE EVENT TRIGGER` = 0;
6 個 pg_cron job 沒有一個回頭量 ACL;CI 不重播 migration。
⇒ 對「apply 之後才發生的 GRANT / REVOKE / ALTER DEFAULT PRIVILEGES」, 資料庫裡沒有任何東西會紅。
⇒ 例:`20260817060000` E683 把 postgres 的 public 表預設 ACL 收到只剩 owner + service_role,
   而一支後來的 `ALTER DEFAULT PRIVILEGES … GRANT … ON TABLES TO anon` 會**乾淨通過**、
   把【之後每一張新表】的 anon 權限重新打開, 而 E683 的斷言只在 replay 時才炸。

授權鏈(逐字, 不要寫寬):Sean 2026-08-27「這兩個問題應該是你們要自己決定的, 用你建議的方式
繼續就好」⇒ **Sean 授權主視窗決定、指定照推薦案;主視窗裁 (d)= 擴文字閘**。
🔴 不得寫成「Sean 拍了 (d)」—— 他沒有看過四個選項的字面。

══ 它擋什麼(每條各附一發紅 / 一發綠在 --selftest)══════════════════════════
  R1  `ALTER DEFAULT PRIVILEGES … GRANT …`            ⇒ 紅(REVOKE 方向不擋)
      —— 爆炸半徑是【未來每一張新物件】, 這是選 (d) 的主要理由。
  R2  `GRANT … ON ALL (TABLES|SEQUENCES|FUNCTIONS|…) IN SCHEMA …` ⇒ 紅
  R3  `GRANT … TO anon | authenticated | authenticator | PUBLIC`(任何物件;多物件逐一判)⇒ 紅
      —— 除非同檔加 `-- ACL-GATE-EXEMPT: <object> -- <理由>`
         🔴 理由要 ≥ 8 字 **且帶可稽核錨**(`#885` / `20260824010000` / `2026-08-27`)。
         不帶錨 ⇒ 那個豁免【不成立】而且會被點名(規則 EX)。
         來源:Fable R3 F4、主視窗 2026-08-27 裁「要」;理由 = 本閘自己印的 31/219 ≈ 14%
         ⇒ 寫 EXEMPT 會是常規動作不是例外 ⇒ **要讓豁免數得出來。**
  R4  `GRANT … ON [TABLE] <表> TO service_role` 而 <表> 在【閉集】裡 ⇒ 紅(同樣可 EXEMPT)
      閉集 = 依 migration 檔名順序重放【HEAD 那一版】的 ACL 語句後, 最後狀態是「service_role 被
      REVOKE ALL/SELECT 且之後沒再 GRANT」的表(2026-08-27 對真 219 支算 = 九張 + 一個 view)。
      被修改的檔用它 HEAD 的版本算(關門若就在那支檔裡, 同檔新增的重開照樣紅);
      `REVOKE GRANT OPTION FOR …` 與欄級 `REVOKE SELECT (col)` 不算關門;
      `REVOKE … FROM PUBLIC`(沒點名 service_role)不算關門 —— 它證不了 service_role 沒有直接權限。
      新檔內 REVOKE 再 GRANT 是本 repo 的標準形狀, **不算漂移**(閉集只從 HEAD 算)。
  R5  `GRANT service_role | pg_read_all_data | postgres | supabase_admin TO <角色>`(成員關係)⇒ 紅
  R6  `EXECUTE '…'` / `EXECUTE format('…')` / 函式體 `AS '…'` 的字串是 SQL:先當靜態語句跑 R1-R5,
      再看 `GRANT … TO <公開角色>`;角色或表名由 `%I` / `%s` / `||` 代入 ⇒ **印 ⚠️ 未判、不擋**
      (把沒被判的印出來)。純顯示用的 `format(…)`(沒有 EXECUTE)當資料, 不判。

修改既有檔:整支檔重判, 但**只回報與本次新增行有交集的語句**(不追歷史舊債);刪掉 EXEMPT 行 ⇒
整支檔重判且全部回報。

══ 天花板(兩欄都要在;一份只列漏擋的天花板讀起來像誤擋為零)══════════════════
✅ 擋得住  上面 R1-R6, 而且讀的是 **index 那一份**(與 commit 收走的是同一份;selftest 有 index≠工作樹 兩格)
❌ 漏擋
   ① 🔴 **路⑤:Supabase dashboard / SQL Editor / MCP apply_migration 手動 GRANT** ——
      那條路不經過 commit, 本閘**結構上永遠看不到**。`product_fitments_effective` 三張就是走這條路
      進線上的。⇒ 做完本閘 ≠ 「ACL 漂移」關了;板子那一列要留一格寫路⑤仍開。
   ② 只看 `supabase/migrations/*.sql` 的 staged 內容
   ③ 動態 SQL 的表名 / 角色靠 `%I` / `||` 組出來、或 SQL 先存進變數再 `EXECUTE v` ⇒ 判不出, 只印 ⚠️
   ④ 閉集是從 migration **字面**算的, 不是線上 `relacl`;線上手動 GRANT 過的表本閘不知道
   ⑤ 🔴 **本閘【程式自身】以【工作樹】版本執行**(Fable R3 N1)——
      上面 ① 說「讀的是 index 那一份」, 那對**被檢查的 migration** 成立, **對閘本身不成立**。
      八窗共用一棵樹 ⇒ 別窗未 commit 的閘編輯, 會改變【你這顆 commit 被哪一版檢查】。
      ⚠️ 炸掉會 rc=2 fail-closed;而**靜默弱化不會**。(git hook 通病, 非本閘新增。)
   ⑤ `ALTER DEFAULT PRIVILEGES` 的 `REVOKE` 方向不擋 —— 收緊不算漂移
   ⑥ 字串裡的 SQL 只認 EXECUTE / EXECUTE format( / AS 三種前文;其它把 SQL 藏進字串再執行的寫法未列舉
❌ 誤擋(它會擋, 而東西是對的)
   ⑦ 新表公開讀(`GRANT SELECT ON products TO anon`)是合法需求 ⇒ 要寫 EXEMPT 理由。
      --selftest 末段「歷史命中」= 把每支既有 migration 當新檔跑;**不是誤擋率**。

離場碼(三態;不要用 `!= 0` 讀它):
  0 = 沒有漂移      1 = 有漂移(訊息以「🔴 ACL 漂移」開頭)
  2 = 工具層壞了(git 失敗 / 讀不到 index / rls gate 模組缺或壞 / 本閘自己丟例外)——訊息以「🔴 本閘【沒有跑】」開頭
  ⇒ 殼層對「python3 不在 / .py 不在 / 殼不在」也回 2(工具層), 不回 1。

自檢:python3 scripts/acl-drift-gate.py --selftest
"""
import importlib.util
import os
import re
import shutil
import subprocess
import sys
import tempfile
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
OWN = ['scripts/acl-drift-gate.py', '.husky/acl-drift-gate.sh']


def tool_layer(msg, exc=None):
    print('🔴 本閘【沒有跑】:' + msg + ' ⇒ 擋下(fail-closed, rc=2;這不是漂移)', file=sys.stderr)
    if exc is not None:
        traceback.print_exception(type(exc), exc, exc.__traceback__, file=sys.stderr)
    sys.exit(2)


def _load_rls_gate():
    """共用 rls-service-role-policy-gate.py 的 git 讀法與 norm —— 兩把尺讀 index 的方式要是同一份。
    缺檔 / 語法錯 / import 錯 ⇒ 工具層(rc 2), 不是漂移、也不是 traceback 的 rc 1。"""
    p = os.path.join(HERE, 'rls-service-role-policy-gate.py')
    try:
        spec = importlib.util.spec_from_file_location('rls_gate', p)
        if spec is None or spec.loader is None or not os.path.exists(p):
            raise FileNotFoundError(p)
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        for need in ('git_out', 'staged_migrations', 'staged_content', 'norm', 'DOLLAR', 'IDENT', 'QNAME', 'EXEMPT_MIN_REASON'):
            getattr(m, need)
        return m
    except BaseException as e:  # noqa: BLE001 — 任何載入失敗都是工具層
        tool_layer('載不到 scripts/rls-service-role-policy-gate.py(本閘共用它的 git 讀法)', e)


G = _load_rls_gate()
norm, IDENT, QNAME = G.norm, G.IDENT, G.QNAME

PUBLIC_ROLES = ('anon', 'authenticated', 'authenticator', 'public')
MEMBERSHIP_DANGEROUS = ('service_role', 'pg_read_all_data', 'postgres', 'supabase_admin')
EXEMPT = re.compile(r'^\s*--\s*ACL-GATE-EXEMPT:\s*([a-z0-9_."*]+)\s*--\s*(\S[^\n]*)$', re.I | re.M)
EXEMPT_MIN_REASON = G.EXEMPT_MIN_REASON

OBJ_TYPES = (r'table|sequence|function|procedure|routine|schema|database|domain|type|language|tablespace|'
             r'large\s+object|foreign\s+data\s+wrapper|foreign\s+server|foreign\s+table|materialized\s+view|parameter|'
             r'all\s+(?:tables|sequences|functions|procedures|routines)\s+in\s+schema')
ADP_GRANT = re.compile(r'alter\s+default\s+privileges\b(?:(?!\brevoke\b).)*?\bgrant\b', re.I | re.S)
GRANT_ALL_IN_SCHEMA = re.compile(r'\bgrant\b.*?\bon\s+all\s+(tables|sequences|functions|routines|procedures)\s+in\s+schema\b', re.I | re.S)
PLPGSQL_LEAD = r'(?:^|\b(?:begin|then|else|loop|declare))\s*'
GRANT_STMT = re.compile(PLPGSQL_LEAD + r'grant\b(?P<body>.*)$', re.I | re.S)
ON_CLAUSE = re.compile(r'\bon\s+(?:(?P<type>%s)\s+)?(?P<objs>%s(?:\s*,\s*%s)*)' % (OBJ_TYPES, QNAME, QNAME), re.I | re.S)
TO_CLAUSE = re.compile(r'\bto\s+(?P<roles>.+?)(?:\s+with\s+(?:grant|admin|inherit|set)\s+\w+|\s+granted\s+by\b.*)?\s*$', re.I | re.S)
MEMBERSHIP = re.compile(PLPGSQL_LEAD + r'grant\s+(?P<roles>[^;]+?)\s+to\s+(?P<grantee>.+?)(?:\s+with\s+\w+\s+\w+|\s+granted\s+by\b.*)?\s*$', re.I | re.S)
REVOKE_STMT = re.compile(r'\brevoke\s+(?P<gof>grant\s+option\s+for\s+)?(?P<privs>.*?)\s+on\s+(?:(?P<type>%s)\s+)?(?P<objs>%s(?:\s*,\s*%s)*)\s+from\b(?P<roles>[^;]*)' % (OBJ_TYPES, QNAME, QNAME), re.I | re.S)
GRANT_ON = re.compile(r'\bgrant\b.*?\bon\s+(?:(?P<type>%s)\s+)?(?P<objs>%s(?:\s*,\s*%s)*)\s+to\b(?P<roles>[^;]*)' % (OBJ_TYPES, QNAME, QNAME), re.I | re.S)
CLOSES = re.compile(r'\b(all|select)\b', re.I)
SQL_LITERAL_CTX = re.compile(r'(\bexecute\s*(?:format\s*\()?|\bas)\s*$', re.I)  # 這三種前文的字串是 SQL
EXEC_BODY_CTX = re.compile(r'(\bdo\b(?:\s+language\s+\w+)?|\bas\b)\s*$', re.I)  # DO [LANGUAGE x] / AS ⇒ 可執行體(R2 #1)
CONCAT_CTX = re.compile(r'\|\|\s*$')
EXEC_IDENT = re.compile(r'\bexecute\s+[a-z_]\w*\s*(?:using\b|$)', re.I)
EXEC_CONCAT = re.compile(r'\bexecute\b[^;]*\|\|', re.I)  # EXECUTE 'a' || x || 'b':整句 SQL 被拆在多段(R2 must-fix 2)
PLACEHOLDER = re.compile(r'%[IsL]|\|\|', re.I)  # roles_of 會小寫化, %I 變 %i
TABLE_TYPES = (None, 'table')


def roles_of(text):
    text = re.split(r'\s+granted\s+by\b', text, flags=re.I)[0]
    text = re.split(r'\s+with\s+(?:grant|admin|inherit|set)\s+\w+', text, flags=re.I)[0]
    out = []
    for r in re.split(r'\s*,\s*', text.strip()):
        r = re.sub(r'^\s*group\s+', '', r.strip(), flags=re.I).strip()
        if not r:
            continue
        out.append(r[1:-1] if r.startswith('"') and r.endswith('"') else r.lower())
    return out


def split_objs(text):
    return [norm(o) for o in re.split(r'\s*,\s*', text.strip()) if o.strip()]


def tokenize(sql):
    """單趟掃描, 同時認得 `--` / `/* */`(可巢狀)/ `'…'` / `E'…'`(反斜線逸出)/ `$tag$…$tag$`。
    回 (code, bodies, literals):
      code     = 原文長度不變, 註解、字串、dollar 體挖成空白(給語句規則用)
      bodies   = [(前文 40 字, dollar 體原文, 起始行)];前文是 DO / AS ⇒ 可執行體, 否則是資料
      literals = [(前文 40 字, 字串常值內容, 起始行)]
    🔴 為什麼不用 rls gate 的 strip_strings+strip_comments 兩段式:那個順序對「註解裡的撇號」會失步。"""
    n = len(sql)
    code, bodies, literals = [], [], []
    i, line = 0, 1
    while i < n:
        c = sql[i]
        if sql.startswith('--', i):
            j = sql.find('\n', i)
            j = n if j < 0 else j
            code.append(' ' * (j - i)); i = j; continue
        if sql.startswith('/*', i):
            depth, j = 1, i + 2
            while j < n and depth:
                if sql.startswith('/*', j):
                    depth += 1; j += 2
                elif sql.startswith('*/', j):
                    depth -= 1; j += 2
                else:
                    j += 1
            seg = sql[i:j]
            code.append(re.sub(r'[^\n]', ' ', seg)); line += seg.count('\n'); i = j; continue
        if c == "'" or (c in 'eE' and i + 1 < n and sql[i + 1] == "'" and (i == 0 or not (sql[i - 1].isalnum() or sql[i - 1] == '_'))):
            esc = c in 'eE'
            j = i + (2 if esc else 1)
            buf = []
            while j < n:
                ch = sql[j]
                if esc and ch == '\\' and j + 1 < n:
                    buf.append(sql[j + 1]); j += 2; continue
                if ch == "'":
                    if j + 1 < n and sql[j + 1] == "'":
                        buf.append("'"); j += 2; continue
                    break
                buf.append(ch); j += 1
            pre = ''.join(code)[-40:]
            lit = ''.join(buf)
            literals.append((pre, lit, line))
            seg = sql[i:min(j + 1, n)]
            code.append(re.sub(r'[^\n]', ' ', seg)); line += seg.count('\n'); i = j + 1; continue
        if c == '$':
            m = G.DOLLAR.match(sql, i)
            if m:
                tag = m.group(0)
                j = sql.find(tag, m.end())
                end = n if j < 0 else j + len(tag)
                pre = ''.join(code)[-40:]
                body = sql[m.end():(n if j < 0 else j)]
                bodies.append((pre, body, line))
                seg = sql[i:end]
                code.append(re.sub(r'[^\n]', ' ', seg)); line += seg.count('\n'); i = end; continue
        code.append(c)
        if c == '\n':
            line += 1
        i += 1
    return ''.join(code), bodies, literals


def statements(code, base_line=1):
    """挖空後的 code 以 `;` 切;每段回 (段文字, 起始行, 結束行)(絕對行號)。"""
    out, start = [], 0
    for m in re.finditer(r';', code):
        seg = code[start:m.start()]
        if seg.strip():
            s = code.count('\n', 0, start + (len(seg) - len(seg.lstrip())))
            e = code.count('\n', 0, m.start())
            out.append((seg, base_line + s, base_line + e))
        start = m.end()
    tail = code[start:]
    if tail.strip():
        s = code.count('\n', 0, start + (len(tail) - len(tail.lstrip())))
        out.append((tail, base_line + s, base_line + code.count('\n')))
    return out


def sql_layers(sql, base_line=1, depth=0):
    """[(code, literals, base_line)]:最外層 + 每個【可執行】dollar 體(前文 DO / AS;遞迴 4 層)。
    資料型 dollar 字串(RAISE NOTICE $q$…$q$ 等)當常值。行號全部換算成絕對行。"""
    code, bodies, literals = tokenize(sql)
    lits = [(pre, lit, base_line + ln - 1) for pre, lit, ln in literals]
    out = [(code, lits, base_line)]
    for pre, b, ln in bodies:
        if depth < 4 and EXEC_BODY_CTX.search(pre):
            out += sql_layers(b, base_line + ln - 1, depth + 1)
        else:
            out[0][1].append((pre, b, base_line + ln - 1))
    return out


# 🔴 **Fable R3 F4(主視窗 2026-08-27 裁「要」)**:豁免理由要帶【可稽核錨】。
#    理由是本閘自己印出來的那個數:**歷史命中 31/219 ≈ 14%**
#    ⇒ 若那個比例有代表性, **寫 EXEMPT 會是常規動作而不是例外**。
#    而在這一改之前, 三件事加起來 = 一個【低摩擦、無審計、無總覽】的出口:
#      · 理由只驗 `len(why) >= 8`
#      · 被擋時 stderr 直接給 copy-paste 模板
#      · 沒有任何地方彙總全部豁免給人看
#    📌 加錨不是為了刁難, **是為了讓豁免【數得出來】** ——
#       一個數不出來的例外, 與沒有例外在報表上長得一樣。
# ⚠️ **回溯成本 = 0**:本改落地當下 `grep -rn "ACL-GATE-EXEMPT" supabase/migrations/*.sql` ⇒ **0 行**
#    (正對照 同一把尺量 `REVOKE` ⇒ 160 支檔;負對照 `ZZZ-GATE-EXEMPT` ⇒ 0)
#    ⇒ **沒有任何既有豁免需要補**。這個數是本改能收緊的原因, 不是它的裝飾。
EXEMPT_ANCHOR = re.compile(r'(#\d{2,}|\b20\d{6}\b|\b20\d{2}-\d{2}-\d{2}\b)')


def exemptions(sql):
    """回 {物件: 理由}。理由要 ≥ EXEMPT_MIN_REASON 字 **且帶可稽核錨**。

    錨 = backlog 編號(`#885`)/ migration 版本號(`20260824010000`)/ 拍板日期(`2026-08-27`)。
    🔴 不合格的豁免【直接不成立】—— 不是警告。因為一個「寫了但不算數」的豁免
       會讓寫的人以為他豁免了, 而閘照樣紅 ⇒ 他會再寫一次更長的理由, 而不是去補錨。
       ⇒ 所以不合格要**在紅字裡點名**(見 report 的 bad_exempt 那段), 不能靜靜忽略。
    """
    out, bad = {}, []
    for obj, why in EXEMPT.findall(sql):
        w = why.strip()
        if len(w) < EXEMPT_MIN_REASON:
            bad.append((obj, w, '理由少於 %d 字' % EXEMPT_MIN_REASON))
        elif not EXEMPT_ANCHOR.search(w):
            bad.append((obj, w, '理由裡沒有可稽核錨(#編號 / 版本號 / 日期)'))
        else:
            out[norm(obj) if obj != '*' else '*'] = w
    return out, bad


def acl_events(sql):
    """一支 migration 裡對 service_role 的表級 GRANT / REVOKE, 依出現順序:[(kind, obj)]。"""
    ev = []
    for code, _, base in sql_layers(sql):
        for seg, _, _ in statements(code, base):
            m = REVOKE_STMT.search(seg)
            if m and (m.group('type') is None or m.group('type').lower() == 'table'):
                closes = ('service_role' in roles_of(m.group('roles')) and CLOSES.search(m.group('privs'))
                          and not m.group('gof') and '(' not in m.group('privs'))
                if closes:
                    for o in split_objs(m.group('objs')):
                        ev.append(('close', o))
            m = GRANT_ON.search(seg)
            if m and (m.group('type') is None or m.group('type').lower() == 'table'):
                if 'service_role' in roles_of(m.group('roles')):
                    for o in split_objs(m.group('objs')):
                        ev.append(('open', o))
    return ev


def closed_set(committed):
    """committed = [(檔名, sql)];依檔名排序重放, 最後狀態是 close 的表 = 閉集(順序有看)。"""
    state = {}
    for name, sql in sorted(committed, key=lambda x: x[0]):
        for kind, obj in acl_events(sql):
            state[obj] = kind
    return {o for o, k in state.items() if k == 'close'}


def rules_for(seg, closed, exempt_for):
    out = []
    if ADP_GRANT.search(seg):
        return [('R1', 'ALTER DEFAULT PRIVILEGES … GRANT(未來每一張新物件都吃到)')]
    if GRANT_ALL_IN_SCHEMA.search(seg):
        return [('R2', 'GRANT … ON ALL … IN SCHEMA(整批授權)')]
    gm = GRANT_STMT.search(seg)
    if not gm:
        return out
    body = gm.group('body')
    if not re.search(r'\bon\b', body, re.I):
        mm = MEMBERSHIP.search(seg)
        if mm and any(r in MEMBERSHIP_DANGEROUS for r in roles_of(mm.group('roles'))):
            out.append(('R5', 'GRANT %s TO %s(成員關係複製一份權限)' % (mm.group('roles').strip(), mm.group('grantee').strip())))
        return out
    om = ON_CLAUSE.search(body)
    tm = TO_CLAUSE.search(body)
    if not om or not tm:
        return out
    otype = (om.group('type') or '').lower() or None
    objs = [om.group('objs')] if otype and otype.startswith('all') else split_objs(om.group('objs'))
    grantees = roles_of(tm.group('roles'))
    for obj in objs:
        # 🔴 **Fable R3 F2**:靜態 R3/R4 一律 `allow_star=False` —— **不吃 `EXEMPT: *`**。
        #    `*` 是為了讓「無法靜態判定的動態 GRANT」有一條出路(R6),
        #    而它一旦被寫下, 舊寫法會**連同全檔所有靜態語句一起豁免**, 包含【日後新增的行】。
        #    ⇒ 靜態的要逐物件具名豁免, 不准搭 `*` 的便車。
        if any(r in PUBLIC_ROLES for r in grantees):
            if not exempt_for(obj, allow_star=False):
                out.append(('R3', 'GRANT … ON %s%s TO %s' % ((otype + ' ') if otype else '', obj, ', '.join(grantees))))
        elif 'service_role' in grantees and otype in TABLE_TYPES and obj in closed:
            if not exempt_for(obj, allow_star=False):
                out.append(('R4', 'GRANT … ON %s TO service_role —— 這張表在 HEAD 的 migration 裡被 REVOKE ALL/SELECT 過且沒再開(閉集)' % obj))
    return out


def check(sql, closed, added=None):
    """回 (drifts, unresolved, exempted)。drifts = [(規則, 行, 說明)]。
    added = 本次新增的行號集合(修改既有檔);None = 整支檔全部回報。
    整支檔都判(跨行語句不會被拆斷), 只回報與新增行有交集的語句(不追歷史舊債)。"""
    ex, bad_ex = exemptions(sql)
    drifts, unresolved, used = [], [], []
    # 🔴 **不合格的豁免當成一條 drift(規則 EX), 不是靜靜忽略。**
    #    理由在 `exemptions()` 的 docstring:一個「寫了但不算數」的豁免
    #    會讓寫的人以為他豁免了, 而閘照樣紅 ⇒ 他會再寫一次更長的理由, 而不是去補錨。
    # ⚠️ 回傳 tuple 形狀不動(drifts, unresolved, used)⇒ 既有呼叫端不必改。
    for _obj, _why, _reason in bad_ex:
        drifts.append(('EX', None,
                       'ACL-GATE-EXEMPT: %s 不成立 —— %s(理由:%s)' % (_obj, _reason, _why)))

    def exempt_for(obj, allow_star=True):
        # 🔴 **Fable R3 F2**:原本靜態與動態共用同一個查法 ⇒ 要豁免一個合法的動態 GRANT
        #    就被迫寫 `EXEMPT: *`, 而那個 `*` **同時豁免全檔所有靜態 R3/R4**。
        #    失敗情境:某檔為了動態授權寫了 `*`, 半年後別窗在同一支檔補一行
        #    `GRANT SELECT ON private.x TO anon` ⇒ **靜默豁免、rc=0**,
        #    唯一痕跡是通過 hook 裡的一行 ⚪。
        # ⇒ `*` 只滿足【字串 / 動態】那條路(R6);靜態 R3/R4 不吃 `*`, 要逐物件具名。
        keys = (obj, '*') if allow_star else (obj,)
        for key in keys:
            if key in ex:
                used.append((key, ex[key]))
                return True
        return False

    def touches(s, e):
        return added is None or any(s <= ln <= e for ln in added)

    for code, literals, base in sql_layers(sql):
        for seg, s, e in statements(code, base):
            if not touches(s, e):
                continue
            for rule, msg in rules_for(seg, closed, exempt_for):
                drifts.append((rule, s, msg))
        for seg, s, e in statements(code, base):
            if touches(s, e) and EXEC_IDENT.search(seg):
                unresolved.append('第 %d 行:EXECUTE <變數>(SQL 先存進變數再執行)⇒ 本閘看不到那段 SQL(R2 nit)' % s)
            if touches(s, e) and EXEC_CONCAT.search(seg):
                unresolved.append('第 %d 行:EXECUTE 用 || 串接 SQL ⇒ 表名 / 角色可能在別段, 本閘判不出整句(R2 must-fix 2)' % s)
        for pre, lit, ln in literals:
            if CONCAT_CTX.search(pre):
                # `EXECUTE 'GRANT … ON ' || t || ' TO anon'`:第二段字面的前文是 `||`(R2 must-fix 2)
                if not touches(ln, ln + lit.count('\n')):
                    continue
                m = re.search(r'\bto\s+([a-z0-9_",%\s]+)', lit, re.I)
                rs = roles_of(m.group(1)) if m else []
                if any(r in PUBLIC_ROLES for r in rs):
                    if not exempt_for('*'):
                        drifts.append(('R6', ln, '動態 GRANT(|| 串接的片段)… TO %s' % ', '.join(rs)))
                else:
                    unresolved.append('第 %d 行:用 || 串接的 SQL 片段 ⇒ 本閘判不出整句(表名 / 角色可能在別段)' % ln)
                continue
            if not SQL_LITERAL_CTX.search(pre):
                continue
            lit_lines = lit.count('\n')
            if not touches(ln, ln + lit_lines):
                continue
            # 字串是 SQL(EXECUTE / EXECUTE format( / AS 函式體):先當靜態語句跑 R1-R5(code-reviewer must-fix 3)
            hit_static = False
            for lcode, llits, lbase in sql_layers(lit, ln):
                for seg, s, _ in statements(lcode, lbase):
                    for rule, msg in rules_for(seg, closed, exempt_for):
                        hit_static = True
                        drifts.append((rule, s, '字串內 SQL:' + msg))
            if hit_static:
                continue
            for m in re.finditer(r'\bgrant\b[^;]*?\bto\s+([a-z0-9_",%\s]+)', lit, re.I | re.S):
                rs = roles_of(m.group(1))
                if any(r in PUBLIC_ROLES for r in rs):
                    if not exempt_for('*'):
                        drifts.append(('R6', ln, '動態 GRANT(字串內)… TO %s' % ', '.join(rs)))
                elif any(PLACEHOLDER.search(r) for r in rs):
                    unresolved.append('第 %d 行:動態 GRANT 的角色由 %%I/%%s 代入 ⇒ 本閘判不出給誰(codex r4 #5)' % ln)
                elif 'service_role' in rs:
                    if PLACEHOLDER.search(lit):
                        unresolved.append('第 %d 行:動態 GRANT … TO service_role, 表名由 format/串接組出 ⇒ 判不出在不在閉集' % ln)
                    else:
                        unresolved.append('第 %d 行:動態 GRANT … TO service_role(字面表名不在閉集, 或本閘解析不到)' % ln)
    return drifts, unresolved, used


# ── git 面 ────────────────────────────────────────────────────────────────
def self_protect():
    gone = [ln.split('\t', 1)[1] for ln in
            G.git_out(['diff', '--cached', '--name-status', '--diff-filter=D', '--'] + OWN,
                      'git diff --cached --diff-filter=D').splitlines() if '\t' in ln]
    if gone:
        tool_layer('這顆 commit 要刪掉本閘自己(' + ', '.join(gone) + ')')


def diff_lines(path):
    """(新增行號集合, 被刪行文字)。🔴 被刪的 `--` 註解行在 diff 裡長成 `---…`, 不能用 `startswith('---')`
    當檔頭濾掉(code-reviewer nit 的世界第一版就是這樣綠的)—— 檔頭只有 `--- a/` / `--- /dev/null` 兩種。"""
    d = G.git_out(['diff', '--cached', '-U0', '--', path], 'git diff --cached -U0')
    added, removed, cur = set(), [], None
    for ln in d.splitlines():
        m = re.match(r'^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@', ln)
        if m:
            start, cnt = int(m.group(1)), int(m.group(2) if m.group(2) is not None else 1)
            cur = start
            added.update(range(start, start + cnt))
            continue
        if ln.startswith('--- a/') or ln.startswith('--- /dev/null') or ln.startswith('+++ '):
            continue
        if ln.startswith('-'):
            removed.append(ln[1:])
    return added, '\n'.join(removed)


def head_content(path):
    p = subprocess.run(['git', 'show', 'HEAD:' + path], capture_output=True)
    return p.stdout.decode('utf-8', 'replace') if p.returncode == 0 else None


def committed_migrations(staged):
    """閉集的分母 = **HEAD 樹**上的全部 migration(`git ls-tree HEAD`, 不是 index 的路徑清單):
    改名 / 刪掉的檔在 index 路徑清單裡取不回 HEAD 內容 ⇒ 閉集少一支而印綠(R2 must-fix 3);
    被修改的檔用 HEAD 版 ⇒ 關門就在那支檔裡時, 同檔新增的重開照樣紅(codex r4 #1)。"""
    rows = G.git_out(['ls-tree', '-r', '--name-only', 'HEAD', '--', 'supabase/migrations'], 'git ls-tree HEAD').splitlines()
    out = []
    for p in rows:
        if not p.endswith('.sql'):
            continue
        h = head_content(p)
        if h is None:
            tool_layer('git show HEAD:%s 讀不到(閉集分母缺一支)' % p)
        out.append((p, h))
    return out


def renamed_or_deleted_migrations():
    rows = G.git_out(['diff', '--cached', '--name-status', '--diff-filter=DR', '--', 'supabase/migrations'],
                     'git diff --cached --diff-filter=DR').splitlines()
    return [ln for ln in rows if ln.strip()]


def run():
    p = subprocess.run(['git', 'rev-parse', '--show-toplevel'], capture_output=True, text=True)
    if p.returncode != 0:
        tool_layer('找不到 repo 根(git rev-parse 失敗:%s)' % p.stderr.strip())
    os.chdir(p.stdout.strip())
    self_protect()
    files = G.staged_migrations()
    if not files:
        print('── acl-drift-gate:這顆 commit 沒有動到 supabase/migrations/*.sql ⇒ 不適用')
        return 0
    closed = closed_set(committed_migrations(files))
    for ln in renamed_or_deleted_migrations():
        print(f'   ⚠️ 本 commit 改名 / 刪掉了 migration:{ln}(閉集仍以 HEAD 樹算;刪掉一支 REVOKE 不會讓表離開閉集)')
    all_drift, all_unres, all_used = [], [], []
    for status, f in files:
        sql = G.staged_content(f)
        added = None
        if status != 'A':
            added, removed = diff_lines(f)
            if EXEMPT.search(removed):
                print(f'   ⚠️ {os.path.basename(f)} 刪掉了 ACL-GATE-EXEMPT 行 ⇒ 整支檔全部回報, 不只新增行')
                added = None
        d, u, used = check(sql, closed, added)
        all_drift += [(f, *x) for x in d]
        all_unres += [(f, x) for x in u]
        all_used += [(f, *x) for x in used]
    for f, obj, why in all_used:
        print(f'   ⚪ 豁免  {obj}  ({os.path.basename(f)}) —— {why}')
    for f, msg in all_unres:
        print(f'   ⚠️ 未判  {msg}  ({os.path.basename(f)})')
    print(f'   閉集(HEAD 重放後仍關著的 REVOKE 表):{len(closed)} 張')
    if not all_drift:
        # 🔴 **Fable R3 F1**:原本這一行在 `all_unres` 非空時【照印】「沒有 ACL 漂移(R1-R6)」,
        #    而 R6 的設計本身就是「未判不擋、只印 ⚠️」⇒ **綠行把【未判】說成了【沒有】。**
        #    失敗情境:有人 commit 一支 `EXECUTE format('GRANT … TO %I', r)`, r apply 時是 anon
        #    ⇒ ⚠️ 印在【通過的 hook】的 stdout(沒有人讀通過的 hook), 而最後一行是 ✅、rc=0
        #    ⇒ 之後引用「閘綠」的人, 拿到的是【對未判之物的背書】。
        # 📌 這與本 repo 今天另一個實例同形狀(一道尺比它保護的那道寬一個空白),
        #    差別是**這次寬的是【結論句】不是尺**。
        # ⚠️ 而**恆定警語不進綠行**(無條件印的句子零判別力, 本 repo 立過)——
        #    只有【變動的事實】(未判數 / 豁免數)才有資格出現在這裡;
        #    路⑤ 那種永遠成立的天花板屬於檔頭與板子。
        tail = ''
        if all_unres:
            tail += f';另 {len(all_unres)} 筆 R6【未判】⚠️(見上,本閘沒有對它們下結論)'
        if all_used:
            tail += f';{len(all_used)} 筆走豁免 ⚪'
        print(f'✅ acl-drift-gate:本次 staged 的 {len(files)} 支 migration '
              f'裡沒有本閘認得的 R1-R5 開權語句{tail}')
        return 0
    print('', file=sys.stderr)
    print('🔴 ACL 漂移:新 migration 打開了一條 apply 之後沒有任何東西會再量的權限', file=sys.stderr)
    for f, rule, line, msg in all_drift:
        print(f'   · [{rule}] {os.path.basename(f)}:{line or "?"}  {msg}', file=sys.stderr)
    print('', file=sys.stderr)
    # 🔴🔴 **Fable R3 F5 —— 本閘假設層最大的風險, 印在被擋的人眼前**:
    #    紅字原本只給【兩條路】(改 SQL / 寫豁免), 而現實有**第三條更便宜的**:
    #    把這段 GRANT 改寫成「給 Sean 的一鍵複製 SQL」貼進 SQL Editor。
    #    ⇒ **本閘把【留紀錄】那條路變貴, 而【免紀錄】那條路價格不變**
    #      ⇒ 經濟上把流量推向它自己的盲區。
    #    ⚠️ 而這不是假設:`docs/launch-todo.md:235` 的 product_fitments_effective 七物件
    #      就是這樣進線上的, **repo 零紀錄**。
    print('   🔴 三條路裡有一條是【錯的】:把這段改端給 Sean 貼 SQL Editor 跑 ——', file=sys.stderr)
    print('      那就是路⑤(本閘的盲區), **比被擋更糟**:線上改了而 repo 一個字都沒有。', file=sys.stderr)
    print('      前例:docs/launch-todo.md:235 的 product_fitments_effective 七物件。', file=sys.stderr)
    print('', file=sys.stderr)
    print('   為什麼要擋:migration 裡所有 ACL 斷言都是 apply 時一次性(774 個呼叫 100% 在 DO 內),', file=sys.stderr)
    print('   正式庫從不 replay ⇒ 這一行 apply 之後, 沒有東西會再紅。', file=sys.stderr)
    print('   兩條路(都在【那支 migration 自己檔內】做):', file=sys.stderr)
    print('     1. 拿掉 / 改成 REVOKE 方向 / 對單表明文 GRANT 並在同檔寫斷言', file=sys.stderr)
    print('     2. 真的需要 ⇒ 同檔加一行, 理由要寫得出「誰要用、為什麼不是 service_role」(只對 R3 / R4 / R6 有效;', file=sys.stderr)
    print('        R1 ALTER DEFAULT PRIVILEGES 與 R2 整批 GRANT【不可豁免】, 只能改寫成單物件明文 GRANT):', file=sys.stderr)
    # 🔴 模板本身要帶錨 —— 否則被擋的人照抄模板, 會再被擋一次而不知道為什麼。
    print('          -- ACL-GATE-EXEMPT: <schema.object 或 *> -- <理由 ≥ 8 字, 且帶 #編號 / 版本號 / 日期>', file=sys.stderr)
    print('          例:-- ACL-GATE-EXEMPT: public.brands -- 品牌目錄公開讀(#885, 2026-08-27 裁)', file=sys.stderr)
    print('   🔴 本閘對 dashboard / SQL Editor 手動 GRANT 是盲的(檔頭天花板 ①)。', file=sys.stderr)
    print('   自檢:  python3 scripts/acl-drift-gate.py --selftest', file=sys.stderr)
    return 1


def main():
    if '--selftest' in sys.argv:
        return selftest()
    try:
        return run()
    except SystemExit:
        raise
    except BaseException as e:  # noqa: BLE001 — 本閘自己炸 = 工具層, 不得以 traceback 的 rc 1 冒充漂移
        tool_layer('本閘自己丟了例外', e)


# ── 自檢 ─────────────────────────────────────────────────────────────────
CLOSED_FIXTURE = {'public.order_payments', 'public.payment_refunds'}
WORLDS = [
    ('R1 紅  ALTER DEFAULT PRIVILEGES … GRANT', 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO anon;', 1),
    ('R1 綠  ALTER DEFAULT PRIVILEGES … REVOKE(收緊不算漂移)', 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;', 0),
    ('R1 紅  換行 + 小寫 + IN SCHEMA 在前 + FOR USER', 'alter default privileges\n  in schema public\n  for user postgres\n  grant usage on sequences to authenticated;', 1),
    ('R1 紅  寫在 DO 體內', "DO $$ BEGIN ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO authenticated; END $$;", 1),
    ("R1 紅  EXECUTE '<靜態字面>' 裡的 ALTER DEFAULT PRIVILEGES … GRANT(code-reviewer must-fix 3)", "DO $$ BEGIN EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO service_role'; END $$;", 1),
    ('R2 紅  GRANT … ON ALL TABLES IN SCHEMA', 'GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;', 1),
    ("R2 紅  EXECUTE '<靜態字面>' GRANT … ON ALL TABLES IN SCHEMA", "DO $$ BEGIN EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role'; END $$;", 1),
    ('R2 綠  單表 GRANT 給 service_role(不在閉集)', 'GRANT SELECT ON public.orders TO service_role;', 0),
    ('R3 紅  GRANT … TO anon', 'GRANT SELECT ON public.products TO anon;', 1),
    ('R3 紅  跨兩行的 GRANT', 'GRANT SELECT ON public.products\n  TO anon;', 1),
    ('R3 紅  多角色', 'GRANT SELECT, INSERT ON TABLE public.customers TO authenticated, service_role;', 1),
    ('R3 紅  TO GROUP anon(codex r2 #1)', 'GRANT SELECT ON public.products TO GROUP anon;', 1),
    ('R3 紅  … TO anon GRANTED BY CURRENT_USER(codex r2 #2)', 'GRANT SELECT ON public.products TO anon GRANTED BY CURRENT_USER;', 1),
    ('R3 紅  欄級 GRANT SELECT (id) ON', 'GRANT SELECT (id, name) ON public.products TO anon;', 1),
    ('R3 紅  多物件, 第一個豁免、第二個不豁免(codex r2 #3)', '-- ACL-GATE-EXEMPT: public.products -- 商品目錄供匿名訪客讀取(#885, 2026-08-27 裁)\nGRANT SELECT ON public.products, private.secrets TO anon;', 1),
    ('R3 紅  ON SEQUENCE … TO authenticated', 'GRANT USAGE ON SEQUENCE public.order_display_seq TO authenticated;', 1),
    ('R3 紅  GRANT USAGE ON SCHEMA … TO PUBLIC', 'GRANT USAGE ON SCHEMA public TO PUBLIC;', 1),
    ('R3 紅  GRANT EXECUTE ON FUNCTION … TO authenticator', 'GRANT EXECUTE ON FUNCTION public.f(uuid) TO authenticator;', 1),
    ('R3 紅  ON DATABASE … TO anon(型別關鍵字不當物件名, 仍認得 anon)', 'GRANT CONNECT ON DATABASE pcm TO anon;', 1),
    ('R3 紅  "anon" 帶引號', 'GRANT SELECT ON public.products TO "anon";', 1),
    ('R3 綠  同檔 EXEMPT 帶理由', '-- ACL-GATE-EXEMPT: public.products -- 商品目錄公開讀, storefront 匿名逛(#885, 2026-08-27 裁)\nGRANT SELECT ON public.products TO anon;', 0),
    ('R3 紅  EXEMPT 理由太短', '-- ACL-GATE-EXEMPT: public.products -- 要\nGRANT SELECT ON public.products TO anon;', 1),
    # 🔴 **Fable R3 F4(主視窗 2026-08-27 裁)的兩個世界** —— 沒有這兩格,
    #    「豁免要帶錨」這條規則與「我把樣本改成帶錨了」在自檢上長得一模一樣。
    ('R3 紅  EXEMPT 理由夠長【而沒有可稽核錨】(F4)',
     '-- ACL-GATE-EXEMPT: public.products -- 商品目錄公開讀給匿名訪客瀏覽用\n'
     'GRANT SELECT ON public.products TO anon;', 1),
    ('R3 綠  EXEMPT 帶錨(日期)(F4 對照組)',
     '-- ACL-GATE-EXEMPT: public.products -- 商品目錄公開讀(2026-08-27 裁)\n'
     'GRANT SELECT ON public.products TO anon;', 0),
    ('R3 綠  REVOKE … FROM anon 不是漂移', 'REVOKE ALL ON public.products FROM anon, authenticated;', 0),
    ('R3 綠  GRANT … TO pcm_reader(不是公開角色)', 'GRANT SELECT ON public.products TO pcm_reader;', 0),
    ('R3 紅  GRANT 寫在 DO 體內(plpgsql 直接執行)', 'DO $$ BEGIN GRANT SELECT ON public.products TO anon; END $$;', 1),
    ("R3 紅  函式體 AS '…' 單引號裡的 GRANT(codex r4 #3)", "CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS\n'BEGIN GRANT SELECT ON public.products TO anon;\nEND';", 1),
    ('R3 紅  函式體 AS $fn$ … $fn$ 裡的 GRANT', 'CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $fn$ BEGIN GRANT SELECT ON public.products TO anon; END $fn$;', 1),
    ('R4 紅  GRANT … TO service_role 而表在閉集', 'GRANT SELECT ON public.order_payments TO service_role;', 1),
    ('R4 紅  閉集表, 不帶 schema、帶 TABLE 關鍵字', 'GRANT INSERT ON TABLE payment_refunds TO service_role;', 1),
    ("R4 紅  EXECUTE '<靜態字面>' 對閉集表 GRANT TO service_role", "DO $$ BEGIN EXECUTE 'GRANT SELECT ON public.order_payments TO service_role'; END $$;", 1),
    ('R4 綠  閉集同名 sequence 不算(codex r2 #4)', 'GRANT USAGE ON SEQUENCE public.order_payments TO service_role;', 0),
    ('R4 綠  閉集表 + EXEMPT', '-- ACL-GATE-EXEMPT: public.order_payments -- 後台對帳頁改走直讀(#885, 2026-08-27 裁)\nGRANT SELECT ON public.order_payments TO service_role;', 0),
    ('R5 紅  GRANT service_role TO x', 'GRANT service_role TO pcm_reporter;', 1),
    ('R5 紅  GRANT service_role TO x WITH ADMIN OPTION', 'GRANT service_role TO pcm_reporter WITH ADMIN OPTION;', 1),
    ("R5 紅  EXECUTE '<靜態字面>' GRANT service_role TO x", "DO $$ BEGIN EXECUTE 'GRANT service_role TO pcm_x'; END $$;", 1),
    ('R5 紅  GRANT pg_read_all_data TO x', 'GRANT pg_read_all_data TO anon;', 1),
    ('R5 綠  一般角色成員關係', 'GRANT pcm_reader TO pcm_reporter;', 0),
    ('R6 紅  EXECUTE format 字串內 TO anon', "DO $$ BEGIN EXECUTE format('GRANT SELECT ON %I TO anon', 'products'); END $$;", 1),
    ('R6 紅  EXECUTE $q$…$q$ dollar 字串 TO anon', 'DO $$ BEGIN EXECUTE $q$GRANT SELECT ON public.products TO anon$q$; END $$;', 1),
    ('R6 綠  動態 GRANT TO service_role 表名解析不到 ⇒ 未判不擋', "DO $$ BEGIN EXECUTE format('GRANT SELECT ON %I TO service_role', v_t); END $$;", 0),
    ("R6 綠  EXECUTE '<靜態字面>' 對非閉集表 GRANT TO service_role ⇒ 不擋但印未判", "DO $$ BEGIN EXECUTE 'GRANT SELECT ON public.orders TO service_role'; END $$;", 0),
    ('R6 綠  角色由 %I 代入 ⇒ 未判不擋(codex r4 #5)', "DO $$ BEGIN EXECUTE format('GRANT SELECT ON products TO %I', 'anon'); END $$;", 0),
    ('綠  純顯示用 format(…) 不是動態執行(codex r4 #4)', "DO $$ BEGIN RAISE NOTICE '%', format('GRANT SELECT ON products TO anon'); END $$;", 0),
    ('綠  RAISE NOTICE 的 dollar 字串含 GRANT 字面是資料不是碼(codex r2 #6)', 'DO $$ BEGIN\n  RAISE NOTICE $q1$GRANT SELECT ON public.products TO anon;$q1$;\nEND $$;', 0),
    ('綠  RAISE 訊息(單引號)含 GRANT … TO PUBLIC', "DO $$ BEGIN RAISE EXCEPTION 'E683: 預設 GRANT EXECUTE TO PUBLIC 要收掉'; END $$;", 0),
    ('綠  註解掉的 GRANT 不算', '-- GRANT SELECT ON public.products TO anon;\n/* ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon; */', 0),
    ('綠  巢狀區塊註解 /* a /* b */ c */ 裡的 GRANT', '/* a /* GRANT SELECT ON public.products TO anon; */ still comment */\nSELECT 1;', 0),
    ('綠  COMMENT 字串含 GRANT 字面', "COMMENT ON TABLE public.orders IS 'GRANT 面見 E683';", 0),
    ("綠  E'\\''(反斜線逸出)之後的 SELECT 不被讀成字串(codex r2 #5)", "SELECT E'\\'';\nSELECT 1;", 0),
    ("R3 紅  E'\\'' 之後的真 GRANT 仍看得到(codex r2 #5)", "SELECT E'\\'';\nGRANT SELECT ON public.products TO anon;", 1),
    ("綠  註解裡的撇號不會讓後面整段被讀成字串(it's)", "-- it's a comment\nGRANT SELECT ON public.orders TO service_role;", 0),
    ("R3 紅  註解裡的撇號之後的真 GRANT 仍看得到", "-- it's a comment\nGRANT SELECT ON public.orders TO anon;", 1),
    ('R3 紅  DO LANGUAGE plpgsql $$ … $$ 體內的 GRANT(R2 must-fix 1)', 'DO LANGUAGE plpgsql $$ BEGIN GRANT SELECT ON public.products TO anon; END $$;', 1),
    ("R6 紅  EXECUTE 'GRANT … ON ' || t || ' TO anon'(R2 must-fix 2)", "DO $$ DECLARE t text; BEGIN EXECUTE 'GRANT SELECT ON ' || t || ' TO anon'; END $$;", 1),
    ("R6 綠  EXECUTE '… TO ' || quote_ident(r) ⇒ 角色在別段 ⇒ 未判不擋", "DO $$ BEGIN EXECUTE 'GRANT SELECT ON public.products TO ' || quote_ident(r); END $$;", 0),
    ('綠  v_sql := …; EXECUTE v_sql ⇒ 未判不擋(R2 nit)', "DO $$ DECLARE v_sql text; BEGIN v_sql := 'x'; EXECUTE v_sql; END $$;", 0),
    ('綠  空檔', '', 0),
]


def selftest():
    fails = 0
    for name, sql, want in WORLDS:
        d, u, _ = check(sql, CLOSED_FIXTURE)
        got = 1 if d else 0
        ok = got == want
        fails += 0 if ok else 1
        print(f"  {'PASS' if ok else '🔴 FAIL'}  {name}" + ('' if ok else f'   期望 {want} 實得 {got} {d}'))
    for key in ('R6 綠  動態 GRANT TO service_role', 'R6 綠  角色由 %I', "R6 綠  EXECUTE '<靜態字面>' 對非閉集表", "R6 綠  EXECUTE '… TO ' || quote_ident", '綠  v_sql := …; EXECUTE v_sql'):
        sql_unres = next(s for n, s, w in WORLDS if n.startswith(key))
        _, u, _ = check(sql_unres, CLOSED_FIXTURE)
        ok = len(u) == 1
        fails += 0 if ok else 1
        print(f"  {'PASS' if ok else '🔴 FAIL'}  未判有印出來(不與乾淨同形):{key}")
    # 行號射程:改既有檔只回報碰到新增行的語句(跨行 GRANT 只新增 TO 那一行也要紅, codex r4 #2)
    two = 'CREATE TABLE public.t (id int);\nGRANT SELECT ON public.products\n  TO anon;\nGRANT SELECT ON public.brands TO anon;'
    d, _, _ = check(two, set(), added={3})
    ok = [x[0] for x in d] == ['R3'] and d[0][1] == 2
    fails += 0 if ok else 1
    print(f"  {'PASS' if ok else '🔴 FAIL'}  改既有檔:只新增第 3 行(跨行 GRANT 的 TO 那行)⇒ 回報那一條、不回報第 4 行的舊債  {d}")
    d, _, _ = check(two, set(), added={1})
    ok = d == []
    fails += 0 if ok else 1
    print(f"  {'PASS' if ok else '🔴 FAIL'}  改既有檔:只新增第 1 行(CREATE TABLE)⇒ 零回報(不追舊債)")
    committed = [('20260101_a.sql', 'REVOKE ALL ON public.t1 FROM anon, authenticated, service_role;'),
                 ('20260102_b.sql', 'REVOKE ALL ON public.t2 FROM service_role;\nGRANT SELECT ON public.t2 TO service_role;'),
                 ('20260103_c.sql', "DO $$ BEGIN EXECUTE 'REVOKE ALL ON public.t3 FROM service_role'; END $$;"),
                 ('20260104_d.sql', 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.t4 FROM service_role;'),
                 ('20260105_e.sql', 'REVOKE SELECT ON TABLE public.t5 FROM service_role;'),
                 ('20260106_f.sql', 'GRANT SELECT ON public.t6 TO service_role;'),
                 ('20260107_g.sql', 'REVOKE ALL ON public.t6 FROM service_role;'),
                 ('20260108_h.sql', 'GRANT SELECT ON public.t7 TO PUBLIC;\nREVOKE ALL ON public.t7 FROM PUBLIC;'),
                 ('20260109_i.sql', 'REVOKE ALL ON public.t8, public.t9 FROM service_role;'),
                 ('20260110_j.sql', 'REVOKE GRANT OPTION FOR SELECT ON public.t10 FROM service_role;'),
                 ('20260111_k.sql', 'REVOKE SELECT (id) ON public.t11 FROM service_role;')]
    cs = closed_set(committed)
    want = {'public.t1', 'public.t5', 'public.t6', 'public.t8', 'public.t9'}
    ok = cs == want
    fails += 0 if ok else 1
    print(f"  {'PASS' if ok else '🔴 FAIL'}  閉集:t1 t5 在 / t2 再 GRANT 不在 / 字串內 t3 不算 / t4 只收寫入面不算 / t6 先 GRANT 後 REVOKE 在 / t7 FROM PUBLIC 不算 / t8 t9 多物件 / t10 GRANT OPTION FOR 不算 / t11 欄級不算(codex r4 #6)  {sorted(cs)}")
    gf, gc = selftest_git()
    fails += gf
    try:
        migdir = os.path.join(HERE, '..', 'supabase', 'migrations')
        mig = sorted(f for f in os.listdir(migdir) if f.endswith('.sql'))
        hit = 0
        for f in mig:
            with open(os.path.join(migdir, f), encoding='utf-8') as fh:
                d, _, _ = check(fh.read(), set())
            hit += 1 if d else 0
        print(f'  (紀錄, 不是判定, 不是誤擋率;讀的是工作樹) 歷史命中:{hit} / {len(mig)} 支既有 migration 若當新檔會被 R1-R3/R5/R6 要求寫 EXEMPT 理由(閉集設空)')
    except OSError as e:
        print(f'  (紀錄) 歷史命中:量不到({e})')
    total = len(WORLDS) + 5 + 2 + 1 + gc
    print(f'── selftest: {total - fails} PASS / {fails} FAIL')
    return 1 if fails else 0  # 不把格數當離場碼(2 格紅會撞到「工具層」那個 2;R2 nit)


def selftest_git():
    """走真的 git index:紅 / 綠 / 修改既有檔 / index≠工作樹 / 工具層 rc=2(三種)。回 (fails, 格數)。"""
    fails, count = 0, 0
    tmp = tempfile.mkdtemp(prefix='aclgate-')
    q = dict(capture_output=True)
    env = dict(os.environ, GIT_AUTHOR_NAME='t', GIT_AUTHOR_EMAIL='t@t', GIT_COMMITTER_NAME='t', GIT_COMMITTER_EMAIL='t@t')
    try:
        d = os.path.join(tmp, 'r')
        os.makedirs(os.path.join(d, 'scripts'))
        os.makedirs(os.path.join(d, 'supabase', 'migrations'))
        for src in ('acl-drift-gate.py', 'rls-service-role-policy-gate.py'):
            shutil.copy(os.path.join(HERE, src), os.path.join(d, 'scripts', src))
        subprocess.run(['git', 'init', '-q', d], **q)
        base = os.path.join(d, 'supabase', 'migrations', '20260101000000_base.sql')
        BASE_SQL = ('CREATE TABLE public.order_payments (id int);\n'
                    'REVOKE ALL ON public.order_payments FROM anon, authenticated, service_role;\n'
                    '-- ACL-GATE-EXEMPT: public.brands -- 品牌目錄公開讀, storefront 匿名逛(#885, 2026-08-27 裁)\n'
                    'GRANT SELECT ON public.brands TO anon;\n')
        with open(base, 'w', encoding='utf-8') as fh:
            fh.write(BASE_SQL)
        subprocess.run(['git', '-C', d, 'add', 'scripts', 'supabase'], **q)
        subprocess.run(['git', '-C', d, '-c', 'core.hooksPath=', 'commit', '-qm', 'base'], env=env, **q)
        gate = [sys.executable, os.path.join(d, 'scripts', 'acl-drift-gate.py')]
        NEW = os.path.join(d, 'supabase', 'migrations', '20260102000000_new.sql')

        def run_world(name, want, new_sql=None, modify_base=None, rewrite_base=None, worktree_after=None,
                      must_contain=None, must_not=None, cwd=None):
            nonlocal fails, count
            count += 1
            if new_sql is not None:
                with open(NEW, 'w', encoding='utf-8') as fh:
                    fh.write(new_sql)
                subprocess.run(['git', '-C', d, 'add', NEW], **q)
            if modify_base is not None:
                with open(base, 'a', encoding='utf-8') as fh:
                    fh.write(modify_base)
                subprocess.run(['git', '-C', d, 'add', base], **q)
            if rewrite_base is not None:
                with open(base, 'w', encoding='utf-8') as fh:
                    fh.write(rewrite_base)
                subprocess.run(['git', '-C', d, 'add', base], **q)
            if worktree_after is not None:  # index 與工作樹不同:證明本閘讀的是 index(code-reviewer must-fix 1)
                with open(NEW, 'w', encoding='utf-8') as fh:
                    fh.write(worktree_after)
            r = subprocess.run(gate, cwd=cwd or d, capture_output=True, env=env)
            err = r.stderr.decode('utf-8', 'replace')
            ok = r.returncode == want and (must_contain is None or must_contain in err) and (must_not is None or must_not not in err)
            fails += 0 if ok else 1
            print(f"  {'PASS' if ok else '🔴 FAIL'}  [git] {name}" + ('' if ok else f'   期望 rc={want} 實得 rc={r.returncode}\n        {err[:300]}'))
            subprocess.run(['git', '-C', d, 'reset', '-q', '--hard'], **q)
            subprocess.run(['git', '-C', d, 'clean', '-qfd', 'supabase'], **q)

        BAD = 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO anon;\n'
        run_world('路④ 紅:新檔 ALTER DEFAULT PRIVILEGES … GRANT', 1, new_sql=BAD, must_contain='ACL 漂移')
        run_world('路④ 綠:同一支檔拿掉那一句', 0, new_sql='CREATE TABLE public.t (id int);\n')
        run_world('路① 紅:新檔對閉集表 GRANT … TO service_role(閉集由 base 的 REVOKE 算出)', 1, new_sql='GRANT SELECT ON public.order_payments TO service_role;\n', must_contain='[R4]')
        run_world('路① 綠:同檔 REVOKE 再 GRANT 是標準形狀', 0, new_sql='CREATE TABLE public.t (id int);\nREVOKE ALL ON public.t FROM service_role;\nGRANT SELECT ON public.t TO service_role;\n')
        run_world('綠:修改既有檔、新增行沒有 GRANT ⇒ 不為舊債開火', 0, modify_base='-- 補一行註解\n')
        run_world('紅:修改既有檔、新增一行 GRANT … TO anon(code-reviewer must-fix 2)', 1, modify_base='GRANT SELECT ON public.products TO anon;\n', must_contain='[R3]')
        run_world('紅:修改【關門就在裡面】的檔, 新增重開 ⇒ 閉集用 HEAD 版算(codex r4 #1)', 1, modify_base='GRANT SELECT ON public.order_payments TO service_role;\n', must_contain='[R4]')
        run_world('紅:index 放壞的、工作樹放好的 ⇒ 本閘讀 index(code-reviewer must-fix 1)', 1, new_sql=BAD, worktree_after='CREATE TABLE public.t (id int);\n', must_contain='[R1]')
        run_world('綠:index 放好的、工作樹放壞的 ⇒ 本閘不讀工作樹', 0, new_sql='CREATE TABLE public.t (id int);\n', worktree_after=BAD)
        run_world('紅:刪掉 EXEMPT 那一行而 GRANT 留著 ⇒ 整支檔重判(code-reviewer nit)', 1, rewrite_base=BASE_SQL.replace('-- ACL-GATE-EXEMPT: public.brands -- 品牌目錄公開讀, storefront 匿名逛(#885, 2026-08-27 裁)\n', ''), must_contain='[R3]')
        run_world('工具層:不在 repo 裡 ⇒ rc=2 且訊息是「沒有跑」不是「漂移」', 2, cwd=tmp, must_contain='沒有跑', must_not='ACL 漂移')
        count += 2
        for how in ('mv', 'rm'):
            if how == 'mv':
                subprocess.run(['git', '-C', d, 'mv', base, base.replace('_base.sql', '_renamed.sql')], **q)
            else:
                subprocess.run(['git', '-C', d, 'rm', '-q', base], **q)
            os.makedirs(os.path.dirname(NEW), exist_ok=True)  # git rm 掉唯一一支後目錄會被收走
            with open(NEW, 'w', encoding='utf-8') as fh:
                fh.write('GRANT SELECT ON public.order_payments TO service_role;\n')
            subprocess.run(['git', '-C', d, 'add', NEW], **q)
            r = subprocess.run(gate, cwd=d, capture_output=True, env=env)
            err = r.stderr.decode('utf-8', 'replace'); out = r.stdout.decode('utf-8', 'replace')
            ok = r.returncode == 1 and '[R4]' in err and '改名 / 刪掉' in out
            fails += 0 if ok else 1
            print(f"  {'PASS' if ok else '🔴 FAIL'}  [git] 紅:本 commit {how} 掉含 REVOKE 的檔 + 新檔重開 ⇒ 閉集用 HEAD 樹算、且印 ⚠️(R2 must-fix 3)" + ('' if ok else f'   實得 rc={r.returncode} {err[:200]} {out[:200]}'))
            subprocess.run(['git', '-C', d, 'reset', '-q', '--hard'], **q)
            subprocess.run(['git', '-C', d, 'clean', '-qfd', 'supabase'], **q)
        count += 2  # 下面兩格手寫的工具層世界
        rg = os.path.join(d, 'scripts', 'rls-service-role-policy-gate.py')
        os.rename(rg, rg + '.bak')
        r = subprocess.run(gate, cwd=d, capture_output=True, env=env)
        os.rename(rg + '.bak', rg)
        err = r.stderr.decode('utf-8', 'replace')
        ok = r.returncode == 2 and '沒有跑' in err and 'ACL 漂移' not in err
        fails += 0 if ok else 1
        print(f"  {'PASS' if ok else '🔴 FAIL'}  [git] 工具層:rls gate 模組缺 ⇒ rc=2 且「沒有跑」(codex r2 #7)" + ('' if ok else f'   實得 rc={r.returncode} {err[:200]}'))
        weird = os.path.join(d, 'supabase', 'migrations', '20260103000000_x.sql')
        with open(weird, 'w', encoding='utf-8') as fh:
            fh.write('SELECT 1;\n')
        subprocess.run(['git', '-C', d, 'add', weird], **q)
        env_bad = dict(env, GIT_INDEX_FILE=os.path.join(tmp, 'no-such-index'))
        r = subprocess.run(gate, cwd=d, capture_output=True, env=env_bad)
        err = r.stderr.decode('utf-8', 'replace')
        ok = r.returncode == 2 and '沒有跑' in err and 'ACL 漂移' not in err
        fails += 0 if ok else 1
        print(f"  {'PASS' if ok else '🔴 FAIL'}  [git] 工具層:git 讀不到 index ⇒ rc=2 且「沒有跑」" + ('' if ok else f'   實得 rc={r.returncode} {err[:200]}'))
        subprocess.run(['git', '-C', d, 'reset', '-q', '--hard'], **q)
        subprocess.run(['git', '-C', d, 'clean', '-qfd', 'supabase'], **q)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return fails, count


if __name__ == '__main__':
    sys.exit(main())
