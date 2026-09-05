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
         🔴🔴 **[2026-09-05 實測] 而上面那個例子 `20260824010000` 自己【不是】合法的錨** ——
            `EXEMPT_ANCHOR` 是 (反斜線)b20(反斜線)d{6}(反斜線)b(恰 8 位)⇒ **14 位的 migration 版本號不匹配。**
            🔬 `20260824010000` ⇒ False · `20260905` ⇒ True · `2026-08-27` ⇒ True · `#885` ⇒ True。
            🛑 **本次【不動】那條 regex** —— 改它會同時放寬 R3/R4, 超出當次授權範圍。
            ⇒ 📌 **要引版本號當錨的人:改寫成日期 `2026-09-05` 或 `#編號`。已回報主視窗。**
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
      🆕 **2026-09-05 起有一條豁免路(主視窗 `-f8` 裁「甲」)**
      🔴🔴 **而它【今天是死的】**(2026-09-05 實測, 兩個條件各自不成立):
        · `supabase/APPLIED.tsv` **沒有** `20260905140000` / `20260905170000`(那兩支還沒被記成貼了)
        · 本分支的 `packages/use-cases/src/check-anomaly-alerts.ts` **零命中** `aclDriftDetected`
          (它在 `origin/dev` 上有 5 處;本分支落後 53 顆)
        ⇒ 🎯 **⇒ 本次改動【今天的實際行為 = 零放寬】。** 它要等那兩支被貼並記帳、
           而且告警那條路合進來, 才會活。⇒ 📌 **下面四個條件請當【未來式】讀。**
      ⛔ ~~三個條件~~ ⇒ **四個條件同時成立**(R1 nit:數字對不上碼):
        ① 同檔 `-- ACL-GATE-EXEMPT-R5: <被授的角色> -- <理由 ≥8 字且帶可稽核錨>`
        ② `supabase/APPLIED.tsv` 有 `20260905140000` 與 `20260905170000`
           (= ⟦b9-ACLDRIFT5⟧ 的**執行期**偵測器已被記成貼了)
        ③ 被授的角色**不在** `anon / authenticated / authenticator / PUBLIC`
           —— 🔴 **這一格永遠不可豁免**(`GRANT service_role TO anon` 是最壞情況)
        ④ `packages/use-cases/src/check-anomaly-alerts.ts` 含 `aclDriftDetected`
           (= 偵測器的輸出**真的有人接**;這是「有人在看」的**離線代理**)
      🔴 **為什麼要有它**:`⟦b9-RLSHARDEN⟧` 的收窄案要 `GRANT service_role TO <專用角色>` ——
        而**`INHERIT` 成員資格是 `TO service_role` 的 policy 對新角色生效的【必要條件】**
        (實測:NOINHERIT 成員讀 0 列 / INHERIT 成員 1 列 / 正對照 `service_role` 本人 1 列)
        ⇒ 不給這條路, 那個收窄案根本不成立 ⇒ **一道正確的守門擋住了唯一可行的設計。**
      🛑 **而在此之前, R5 的【不可豁免】沒有任何記錄說為什麼**(線 `-auth` 2026-09-05 掃四處:
        本檔頭只寫「⇒ 紅」· 程式碼 R5 的 append 沒接 `exempt_for` · 47 格 selftest 零格測
        「R5+EXEMPT 仍紅」· commit body 與 docs 零處;🔵 負對照 編造檔名 ⇒ 0)
        ⇒ 📌 **這一改填的是【沒有人寫下理由的現況】, 不是推翻一個拍板。**
      🛑 **它擋不住什麼**(放行時逐字印在 hook 裡, 不只寫在這裡):
        ①帳本是**自陳**的 ⇒ 驗的是「有沒有人**記**」不是「偵測器**真的在跑**」;
          而本閘 pre-commit、離線 ⇒ **結構上問不到 DB**
        ②貼了 ≠ 在跑(cron 可停、函式可被 `CREATE OR REPLACE` 換掉)
        ③偵測器**每日**一次 ⇒ 換到的是「漂了**一天內**看得見」, 不是「不會漂」
        ④**條件④只是個代理** —— 它比對的是那支 `.ts` 的**非註解字面**, 它證不到那個值
          真的被讀、更證不到信寄得出去。**代理不是那件事本身。**
        ⑤🔴 **這三句印在【通過的 hook】的 stdout, 而沒有人讀通過的 hook**(本檔 Fable F1
          診斷過同一個形狀)⇒ 綠行的「N 筆走豁免 ⚪」是唯一會動的訊號。**這一格沒有解, 寫下來。**
      🔴 **兩條【永遠不可豁免】**:`WITH ADMIN OPTION`(拿到的人可以自己授給 anon, 而那一跳
        不在 migration 裡)· 授的角色不是**恰好只有** `service_role`(`postgres` / `supabase_admin`
        是 owner 級, 嚴格比它壞)。
      📎 plan:`docs/plans/2026-09-05-acl-drift-gate-r5-exemption-plan.md`
      🔴 **[adversarial R1 F5 之後補的第五格]** 危險角色集合不只寫死的四個 ——
        還要**從樹上遞移一層**算:凡曾是 `GRANT <危險角色> TO X` 受贈者的 `X` 也算危險。
        ⛔ 少了它:`GRANT service_role TO pcm_w`(豁免綠)+ `GRANT pcm_w TO anon`(零規則觸發)
        ⇒ **anon 拿到 service_role**, 而**兩顆 commit 單獨看都對**。
        🛑 **而它【只遞移一層】** —— 兩層(`pcm_w → pcm_x → anon`)看不到。
           今天量到的鏈長是 1, 而**我沒有量過未來會不會變長**。要關滿得做不動點迭代。
      🔴 **[F1] 條件② 不只比版本號** —— 帳本那一列的 **sha 要對得上樹上那支檔**
        (⛔ 只比版本號的話, **同一顆補兩列就過**)。
        🛑 **而它仍然證不到「貼進 DB 的是這一份」** —— 只證「記帳的人記的是樹上這一份」。
      🔴 **[F13] 這條路【活起來的那一刻】會印一行紅** —— 條件②④ 都成立時,
        hook 上會出現「R5 的豁免路今天是活的」+ 三句擋不住。
        ⇒ ⛔ ~~原本只在檔頭寫「今天是死的」~~ —— **那句沒有量法, 而它由一顆平常的
          「帳本補一列」翻開** ⇒ 合的人與記帳的人都不知道自己開了門。
      🔵 **[F3] 誠實標記:這四個條件是【提案的人自己寫的】, 也是他自己實作的。**
        兩輪對抗審查(code-reviewer + adversarial)各推翻過其中幾格, 而**沒有第三方訂過條件本身**。
      🔵 **[F7] `EXECUTE <變數>` 那條動態路仍然不擋**(印 ⚠️ 未判)—— 與 R1-R4 同一個已知限制。
      🔴 **不得寫成「Sean 拍了」** —— 他沒有看過選項字面(同本檔頭上面那條紀律)。
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
import hashlib
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

# ── R5 豁免路(主視窗 `-f8` 2026-09-05 裁「甲」;plan = docs/plans/2026-09-05-acl-drift-gate-r5-exemption-plan.md)
#    🔴 **不得寫成「Sean 拍了」** —— 他沒有看過選項字面(沿用本檔頭同一條紀律)。
#    🛑 **R5 在此之前【無條件紅】, 而那個不可豁免【沒有任何記錄說為什麼】** ——
#       線 -auth 2026-09-05 掃四處:檔頭只寫「⇒ 紅」· 程式碼 R5 的 append 沒接 exempt_for ·
#       47 格 selftest 零格測「R5+EXEMPT 仍紅」· commit body 與 docs 零處。🔵 負對照 編造檔名 ⇒ 0。
#       ⇒ 📌 **本改動填的是一個【沒有人寫下理由的現況】, 不是推翻一個拍板。**
# 🔴 **[adversarial R1 F4]** PG16+ 另有 `WITH ADMIN TRUE` / `WITH ADMIN FALSE` 的寫法 ——
#    ⛔ ~~只認 `WITH ADMIN OPTION`~~ 會被 `WITH ADMIN TRUE` 繞過去。
#    🔵 `WITH ADMIN FALSE` 語意上等於沒有 ⇒ 而**這裡一律當有**(往保守那一側錯:誤擋不誤放)。
ADMIN_OPT = re.compile(r'\bwith\s+admin\s+(?:option|true|false)\b', re.I)

EXEMPT_R5 = re.compile(r'^\s*--\s*ACL-GATE-EXEMPT-R5:\s*([a-z0-9_."]+)\s*--\s*(\S[^\n]*)$', re.I | re.M)

# 🔴 這兩支 migration = ⟦b9-ACLDRIFT5⟧ 的【執行期】偵測器(digest 表 + 每日 cron + 人工核准)。
R5_LEDGER_REQUIRED = ('20260905140000', '20260905170000')
# 🔴 而「有人在看那個輸出」的**離線代理**:告警信那條路真的讀了 aclDriftDetected。
R5_ALERT_FILE = 'packages/use-cases/src/check-anomaly-alerts.ts'
R5_ALERT_LITERAL = 'aclDriftDetected'
# 🛑 這三句要跟著「放行」那一行一起印 —— 它們是本豁免路【擋不住】的東西(plan §4)。
R5_CANNOT = (
    '① 帳本是【自陳】的 —— 這裡驗的是「有沒有人【記】偵測器貼了」, 不是「偵測器【真的在跑】」;'
    '而本閘是 pre-commit、離線 ⇒ 它【結構上】問不到 DB。',
    '② 貼了不等於在跑 —— cron job 可以被停、函式可以被 CREATE OR REPLACE 換掉, 本閘看不到。',
    '③ 偵測器是【每日】一次 ⇒ 換到的是「漂了【一天內】看得見」, 不是「不會漂」。',
)


def _index_or_head(path):
    """讀【index】那一份(與本閘其餘部分同一個分母)。回 (內容 or None, 來源字串)。
    ⛔ ~~index 沒有就退回 HEAD~~ —— 🔴 **[code-reviewer R1 #8] 那條退路會誤報 True**:
       這顆 commit **staged 一筆刪除**(把偵測器消費端整支刪掉)時 `git show :path` 失敗
       ⇒ 舊版拿 HEAD 的舊內容 ⇒ 條件②④ 照樣成立
       ⇒ 📌 **「刪掉它」與「留著它」在那把尺上印同一個答案。**
    ✅ 現在:index 讀不到 ⇒ **`None`(fail-closed)**。
    ⛔ ~~「本檔 selftest 有一格在守」~~ —— **[R1 #7] 那句是假的**, 那一格守的是既有 migration
       的 index 讀法, 不是這支函式。本支的守門在 `r5_prereq` 那批注入 reader 的格子。"""
    p = subprocess.run(['git', 'show', ':' + path], capture_output=True)
    if p.returncode == 0:
        return p.stdout.decode('utf-8', 'replace'), 'index'
    return None, 'index 讀不到(檔不在 index ⇒ 可能這顆 commit 把它刪了)'


def _strip_ts_comments(txt):
    """拿掉 `//` 行註解與 `/* … */` 區塊註解。
    🔴 **[code-reviewer R1 #3]** 少了這一步, 一句 `// TODO: aclDriftDetected 還沒接`
    或一段被註解掉的舊碼就滿足條件④ ⇒ **一個「宣稱有人接而其實沒接」的世界會通過。**
    🛑 而它**證不到**「那個變數真的被讀」—— 它只證「不是註解裡的那一份」。"""
    txt = re.sub(r'/\*.*?\*/', ' ', txt, flags=re.S)
    # 🔴 **[adversarial R1 F2]** ⛔ ~~只剝【整行】 `//`~~ —— **行尾註解也算「接了」**:
    #    `const x = 1; // aclDriftDetected 還沒接` 會讓條件④ 成立。
    #    ✅ 連行尾一起剝(從行首或空白後的 `//` 到行尾)。
    txt = re.sub(r'(?m)(^|\s)//.*$', ' ', txt)
    return txt


def _ledger_path_for(version):
    """版本號 → `supabase/migrations/<版本號>_*.sql` 的路徑(從 **index** 的檔名清單找)。
    找不到或撞到多支 ⇒ None(fail-closed)。"""
    try:
        rows = G.git_out(['ls-files', 'supabase/migrations'], 'git ls-files').splitlines()
    except Exception:
        return None
    hit = [p for p in rows if os.path.basename(p).startswith(version + '_') and p.endswith('.sql')]
    return hit[0] if len(hit) == 1 else None


def r5_ledger_ok(reader=None, path_for=None):
    """條件②:APPLIED.tsv 有那兩支。回 (bool, 說明)。
    🔴 `reader` 可注入 —— selftest 靠它餵**受控的內容**去測【這支函式的判斷邏輯】,
       而不是重打一份自己的判斷(那樣改生產碼不會紅)。"""
    txt, src = (reader or _index_or_head)('supabase/APPLIED.tsv')
    if txt is None:
        return False, 'supabase/APPLIED.tsv 讀不到(%s)' % src
    bad = []
    for v in R5_LEDGER_REQUIRED:
        m = re.search(r'(?m)^' + re.escape(v) + r'\t([0-9a-f]{64})\t', txt)
        if not m:
            bad.append('%s:帳本沒有它(或第二欄不是 sha256)' % v)
            continue
        # 🔴 **[adversarial R1 F1]** ⛔ ~~只比版本號欄~~ —— **同一顆補兩列就過**,
        #    而「有人記了一列」與「那支檔真的被貼了」是兩件事。
        #    ✅ 加一格:**帳本那一列的 sha 要對得上樹上那支檔**。
        #    🛑 **它仍然證不到「貼進 DB 的是這一份」** —— 它證的是「記帳的人記的是樹上這一份」。
        #       (沒有人留下貼進去的那一份;`20260905090000` 的帳本那一列就寫著這件事。)
        path = (path_for or _ledger_path_for)(v)
        if path is None:
            bad.append('%s:`supabase/migrations/` 裡找不到這個版本號的檔' % v)
            continue
        blob, bsrc = (reader or _index_or_head)(path)
        if blob is None:
            bad.append('%s:讀不到 %s(%s)' % (v, path, bsrc))
            continue
        actual = hashlib.sha256(blob.encode('utf-8')).hexdigest()
        if actual != m.group(1):
            bad.append('%s:帳本的 sha 與樹上那支檔【對不上】' % v)
    if bad:
        return False, 'APPLIED.tsv(%s)不合格:%s' % (src, ' · '.join(bad))
    return True, 'APPLIED.tsv(%s)有 %s, 且兩列的 sha 都對得上樹上的檔' % (src, ' / '.join(R5_LEDGER_REQUIRED))


def r5_alert_ok(reader=None):
    """條件④:告警信那支檔【在非註解的碼裡】出現 `aclDriftDetected`。回 (bool, 說明)。
    ⛔ ~~原本寫「真的讀了(= 有人接得到那個輸出)」~~ —— 🔴 **[code-reviewer R1 #3] 那比事實大**:
       實作是整檔字面比對, 它**證不到那個值被讀、更證不到信寄得出去**。
       ✅ 準確說法:**它是「有人接」的一個【離線代理】, 而代理不是那件事本身。**"""
    txt, src = (reader or _index_or_head)(R5_ALERT_FILE)
    if txt is None:
        return False, '%s 讀不到(%s)' % (R5_ALERT_FILE, src)
    if R5_ALERT_LITERAL not in _strip_ts_comments(txt):
        return False, '%s(%s)沒有 %s ⇒ 偵測器的輸出【沒有人接】' % (R5_ALERT_FILE, src, R5_ALERT_LITERAL)
    return True, '%s(%s)含 %s' % (R5_ALERT_FILE, src, R5_ALERT_LITERAL)


def r5_prereq(reader=None, path_for=None):
    """條件②④ 合起來。回 (bool, [說明…])。`reader` 可注入(見 r5_ledger_ok)。"""
    ok2, w2 = r5_ledger_ok(reader, path_for)
    ok4, w4 = r5_alert_ok(reader)
    return (ok2 and ok4), [w2, w4]


# ── R5 豁免的三個判準抽成具名函式 ────────────────────────────────
# 🔴 **為什麼不寫成 `r5_allow` 裡的三個 if**:突變格要能把【生產碼】換掉。
#    判準若只活在區域變數裡, 測試只能重打一份自己的判準 ⇒ 改生產碼它不會紅。
def _r5_role_ok(g):
    """條件③:被授的角色不在公開角色集合。**這一格永遠不可豁免。**"""
    return g not in PUBLIC_ROLES


def _r5_named(g, ex5):
    """條件①:同檔有具名且合格的 `-- ACL-GATE-EXEMPT-R5: <角色> -- <理由帶錨>`。"""
    return g in ex5


def _r5_prereq_ok(state):
    """條件②④:帳本有那兩支 + 告警信那條路讀得到 aclDriftDetected。"""
    return bool(state and state[0])


def exemptions_r5(sql):
    """回 ({角色: 理由}, [(角色, 理由, 為什麼不成立)…])。理由規則與 R3/R4 的 EXEMPT 相同。"""
    ok, bad = {}, []
    for role, why in EXEMPT_R5.findall(sql):
        w = why.strip()
        if len(w) < EXEMPT_MIN_REASON:
            bad.append((role, w, '理由少於 %d 字' % EXEMPT_MIN_REASON))
        elif not EXEMPT_ANCHOR.search(w):
            bad.append((role, w, '理由沒有可稽核錨(#編號 / 版本號 / 日期)'))
        else:
            ok[role.strip()] = w   # 🔴 保留原字面(見 r5_allow 的 [R1 #9])
    return ok, bad


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


def transitively_dangerous(committed, staged_sqls=()):
    """回【額外】的危險角色集合 —— 曾在 migrations 裡當過 `GRANT <危險角色> TO X` 受贈者的 X。

    🔴🔴 **[adversarial R1 F5] 這是本次豁免路【自己開的】洞**:
       `MEMBERSHIP_DANGEROUS` 是寫死的四個 ⇒
         ① `GRANT service_role TO pcm_w;`  ← 走豁免路, 綠
         ② `GRANT pcm_w TO anon;`          ← `pcm_w` 不在那四個裡 ⇒ **零規則觸發, 靜默綠**
       ⇒ 📌 **anon 拿到 service_role** —— 正是條件③ 宣稱「永遠擋」的最壞情況,
          而它是**兩顆合法的 commit 疊出來的**, 每一顆單獨看都對。
    🔵 **而 ② 那一半【本來就沒人擋】** —— 只是 ① 以前恆紅, 所以沒有人走得到。
       ⇒ 這一支順便把那半也關掉。

    🛑 **它擋不住什麼(寫出來, 不假裝關滿)**:
       · **只遞移【一層】** —— `GRANT pcm_w TO pcm_x;` 之後再 `GRANT pcm_x TO anon;` 看不到。
         (要關滿得做不動點迭代;今天量到的鏈長是 1, 而**我沒有量過未來會不會變長**。)
       · 只看得到 **migrations 裡的靜態字面** —— dashboard / SQL Editor 手動授的一樣看不到(路⑤)。
       · 角色名由 `%I` 代入的動態 GRANT 看不到(R6 那一族)。
    """
    extra = set()
    for sql in [c[1] for c in committed] + list(staged_sqls):
        if not sql:
            continue
        for seg2, _s, _e in statements(sql, 1):
            # 只認【成員關係】那一種 GRANT(沒有 `ON`), 與 R5 判的是同一種語句。
            gm = GRANT_STMT.search(seg2)
            if not gm or re.search(r'\bon\b', gm.group('body'), re.I):
                continue
            mm = MEMBERSHIP.search(seg2)
            if not mm:
                continue
            if any(r in MEMBERSHIP_DANGEROUS for r in roles_of(mm.group('roles'))):
                for g in roles_of(mm.group('grantee')):
                    # 🔵 公開角色本來就被 R5 擋著 ⇒ 不必再進危險集合(進了只會讓訊息更難讀)。
                    if g and g not in PUBLIC_ROLES:
                        extra.add(g)
    return extra


def rules_for(seg, closed, exempt_for, r5_allow=None, extra_dangerous=frozenset()):
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
        # 🔴 **[adversarial R1 F5]** 危險集合 = 寫死的四個 **+ 從樹上遞移一層算出來的**。
        #    少了後半:`GRANT service_role TO pcm_w`(豁免綠)+ `GRANT pcm_w TO anon`(零規則觸發)
        #    ⇒ **anon 拿到 service_role**, 而每一顆 commit 單獨看都對。
        dangerous = set(MEMBERSHIP_DANGEROUS) | set(extra_dangerous)
        if mm and any(r in dangerous for r in roles_of(mm.group('roles'))):
            # 🔴 豁免路(2026-09-05 加)。`r5_allow` 是 None ⇒ **行為與加這條路之前一模一樣(恆紅)**
            #    ⇒ 既有呼叫端與既有 selftest 不受影響(回歸那一格在守這件事)。
            # 🔴 判定【整包】交給 r5_allow —— 一個條件一個落點, `rules_for` 不自己判、不碰 `used`。
            if r5_allow is not None and r5_allow(roles_of(mm.group('roles')),
                                                 roles_of(mm.group('grantee')),
                                                 bool(ADMIN_OPT.search(seg))):
                return out
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


def check(sql, closed, added=None, r5_prereq_state=None, extra_dangerous=frozenset()):
    """回 (drifts, unresolved, exempted)。drifts = [(規則, 行, 說明)]。
    r5_prereq_state = (bool, [說明…]) 或 None。**None ⇒ R5 恆紅(= 加豁免路之前的行為)**;
    給了才走豁免路。selftest 靠它餵兩個世界, `run()` 從 repo 算出來再餵進來。
    added = 本次新增的行號集合(修改既有檔);None = 整支檔全部回報。
    整支檔都判(跨行語句不會被拆斷), 只回報與新增行有交集的語句(不追歷史舊債)。"""
    ex, bad_ex = exemptions(sql)
    ex5, bad_ex5 = exemptions_r5(sql)
    drifts, unresolved, used = [], [], []
    # 🔴 不合格的 R5 豁免與 R3/R4 的一樣, 當成一條 drift(規則 EX5), 不靜靜忽略。
    for _r, _why, _reason in bad_ex5:
        drifts.append(('EX5', None,
                       'ACL-GATE-EXEMPT-R5: %s 不成立 —— %s(理由:%s)' % (_r, _reason, _why)))
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

    r5_allow = None
    # 🔴 **這裡【不】加 `and ex5`** —— 突變格抓到的:那個 truthiness 會讓「有沒有具名豁免」
    #    在【兩個地方】各判一次, 於是把 `_r5_named` 換成恆真【也不會翻綠】
    #    ⇒ 那一格的紅其實不是由那個判準決定的。⇒ 📌 一個條件只留一個落點。
    if r5_prereq_state is not None:
        prereq_why = r5_prereq_state[1]

        def r5_allow(granted, grantees, admin_opt):
            """三條件 + 兩條【永遠不可豁免】。回 bool;只有整體成立才寫 `used`。"""
            # 🔴 **[R1 #5]** `WITH ADMIN OPTION` 永遠不可豁免 —— `roles_of` 會把它剝掉,
            #    而拿到 admin option 的人**可以自己 `GRANT service_role TO anon`**
            #    ⇒ 條件③ 在【一跳之外】失效, 而那一跳不在 migration 裡 ⇒ 本閘永遠看不到。
            if admin_opt:
                return False
            # 🔴 **[R1 #4]** 只有【恰好只授 service_role】那一種可以豁免。
            #    一張 `EXEMPT-R5: pcm_w` 舊版會連 `GRANT service_role, postgres TO pcm_w` 一起放行,
            #    而 `postgres` / `supabase_admin` 在 Supabase 上是 owner 級 ⇒ **嚴格比 service_role 壞**。
            if set(granted) != {'service_role'}:
                return False
            if not grantees:
                return False
            # 🔴 **[R1 #6]** 先收暫存, **全部通過才併進 `used`** ——
            #    舊版把 append 寫在 `all()` 的短路副作用裡 ⇒ `TO pcm_w, anon` 會紅而 hook 照印一筆 ⚪;
            #    對調成 `TO anon, pcm_w` 則一筆都不印 ⇒ **稽核紀錄由書寫順序決定。**
            staged = []
            for grantee in grantees:
                raw = (grantee or '').strip()
                g = raw.lower()
                # 條件③:被授的角色不在公開角色集合。**這一格永遠不可豁免**(小寫比, fail-closed 方向)。
                if not _r5_role_ok(g):
                    return False
                # 🔴 **[code-reviewer R1 #9]** 條件① 用【原字面】比 ——
                #    `roles_of` 對加引號的角色**刻意保留大小寫**(`"PCM_W"` 在 PG 裡是另一個角色),
                #    而舊版一律 `.lower()` ⇒ `GRANT service_role TO "PCM_W";` 會吃 `pcm_w` 那張豁免。
                #    ⇒ 📌 ③ 用小寫是【收緊】, ① 用小寫是【放寬】—— 兩個方向不能共用一種正規化。
                if not _r5_named(raw, ex5):
                    return False
                if not _r5_prereq_ok(r5_prereq_state):
                    # 🔴 **[adversarial R1 F9]** ⛔ ~~前提說明只印在【通過】那條路~~ ——
                    #    掛掉時人只看到「R5 紅」而不知道是哪一格。⇒ 收進 unresolved(它一定會印)。
                    unresolved.append('R5 豁免的前提不成立 ⇒ %s' % ' ‖ '.join(prereq_why))
                    return False
                staged.append(('R5:' + g,
                               ex5.get(raw, '(讀不到理由 —— 判準被換過?)') + ' ‖ 前提:' + ' ‖ '.join(prereq_why)
                               + ' ‖ 🛑 而本豁免【擋不住】:' + ' '.join(R5_CANNOT)))
            used.extend(staged)
            return True

    def touches(s, e):
        return added is None or any(s <= ln <= e for ln in added)

    for code, literals, base in sql_layers(sql):
        for seg, s, e in statements(code, base):
            if not touches(s, e):
                continue
            for rule, msg in rules_for(seg, closed, exempt_for, r5_allow, extra_dangerous):
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
                    for rule, msg in rules_for(seg, closed, exempt_for, r5_allow, extra_dangerous):
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
    """🛑 **[adversarial R1 F14] 它只擋【刪掉】本閘, 不擋【改掉】它。**
    ⇒ 📌 一顆把 R5 那幾行拿掉的 commit, 本閘**照樣讓它過**(它就是拿自己去驗自己)。
    ⇒ 🔴 **這一格【沒有】在本次修掉** —— 「閘不能可靠地守住自己」是個**結構問題**,
       擋改動要嘛需要一份 checksum 基準(而那份基準也在同一顆 commit 裡改得掉),
       要嘛需要一個閘外的東西(CI / 分支保護)。**寫下來, 不假裝有。**
    ✅ **今天真的守著它的是【人】**:動本閘 = 動驗證本身 = `00-work-rules` R4 的立即停止訊號
       ⇒ 要提 plan、要主視窗裁、要兩輪對抗審查。本次就是那樣走的。
    🔵 而刪掉那一格仍然有用:**刪是最便宜的繞法**, 擋住它讓繞的人至少要改。
    """
    gone = [ln.split('\t', 1)[1] for ln in
            G.git_out(['diff', '--cached', '--name-status', '--diff-filter=D', '--'] + OWN,
                      'git diff --cached --diff-filter=D').splitlines() if '\t' in ln]
    if gone:
        tool_layer('這顆 commit 要刪掉本閘自己(' + ', '.join(gone) + ')')
    # 🔵 改動它不擋, 而**印一行** —— 讓「這顆 commit 動了驗證本身」在 hook 輸出上看得見。
    touched = [ln.split('\t', 1)[1] for ln in
               G.git_out(['diff', '--cached', '--name-status', '--diff-filter=M', '--'] + OWN,
                         'git diff --cached --diff-filter=M').splitlines() if '\t' in ln]
    if touched:
        print('   ⚠️ 這顆 commit 【改了本閘自己】(%s)—— 本閘擋不住這件事(見 self_protect 的 docstring);'
              % ', '.join(touched))
        print('      動驗證本身要提 plan + 主視窗裁 + 對抗審查。這一行只是讓它【看得見】。')


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
    r5_state = r5_prereq()
    # 🔴 遞移一層:HEAD 樹 + 本次 staged 的 migration 一起算(同一顆裡兩句也要抓得到)。
    extra_dangerous = transitively_dangerous(committed_migrations(files),
                                             [G.staged_content(f) for _st, f in files])
    # 🔴 **[adversarial R1 F13]** 這條路【活起來的那一刻】原本零訊號 ——
    #    檔頭那句「今天是死的」沒有量法, 而它由一顆平常的「帳本補一列」翻開,
    #    ⇒ 📌 **合的人與記帳的人都不知道自己開了門。** ⇒ 活了就印一行。
    if r5_state[0]:
        print('   🔴🔴 R5 的豁免路【今天是活的】—— 四條件裡的前提兩格都成立:')
        for _w in r5_state[1]:
            print('      · %s' % _w)
        print('      ⇒ 從現在起, 一支帶合格 `-- ACL-GATE-EXEMPT-R5:` 的 migration 可以'
              'GRANT service_role 給一個非公開角色。而本閘擋不住:')
        for _c in R5_CANNOT:
            print('      %s' % _c)
    if extra_dangerous:
        print('   ⚠️ 遞移一層算出的額外危險角色(曾收過 service_role 等):%s'
              % ', '.join(sorted(extra_dangerous)))
    for ln in renamed_or_deleted_migrations():
        print(f'   ⚠️ 本 commit 改名 / 刪掉了 migration:{ln}(閉集仍以 HEAD 樹算;刪掉一支 REVOKE 不會讓表離開閉集)')
    all_drift, all_unres, all_used = [], [], []
    for status, f in files:
        sql = G.staged_content(f)
        added = None
        if status != 'A':
            added, removed = diff_lines(f)
            if EXEMPT.search(removed) or EXEMPT_R5.search(removed):
                print(f'   ⚠️ {os.path.basename(f)} 刪掉了 ACL-GATE-EXEMPT 行 ⇒ 整支檔全部回報, 不只新增行')
                added = None
        d, u, used = check(sql, closed, added, r5_state, extra_dangerous)
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
    ran = 0   # 🔴 **跑幾格用【數的】不用【加總的】** —— 見下面 total 那一行
    for name, sql, want in WORLDS:
        d, u, _ = check(sql, CLOSED_FIXTURE)
        got = 1 if d else 0
        ok = got == want
        fails += 0 if ok else 1
        ran += 1
        print(f"  {'PASS' if ok else '🔴 FAIL'}  {name}" + ('' if ok else f'   期望 {want} 實得 {got} {d}'))
    for key in ('R6 綠  動態 GRANT TO service_role', 'R6 綠  角色由 %I', "R6 綠  EXECUTE '<靜態字面>' 對非閉集表", "R6 綠  EXECUTE '… TO ' || quote_ident", '綠  v_sql := …; EXECUTE v_sql'):
        sql_unres = next(s for n, s, w in WORLDS if n.startswith(key))
        _, u, _ = check(sql_unres, CLOSED_FIXTURE)
        ok = len(u) == 1
        fails += 0 if ok else 1
        ran += 1
        print(f"  {'PASS' if ok else '🔴 FAIL'}  未判有印出來(不與乾淨同形):{key}")
    # ══ R5 豁免路的七格(2026-09-05;plan §3)═══════════════════════════
    #   🔴 **成對**:四發負對照(該紅)+ 一發正對照(該綠且要印出那句)+ 回歸 + 突變。
    # ⚠️ **這裡的錨用 `2026-09-05` 而不是版本號 `20260905190000`, 而那是【被迫的】**:
    #    `EXEMPT_ANCHOR` 是 `\b20\d{6}\b`(恰 8 位)⇒ **14 位的 migration 版本號【不匹配】**,
    #    而本檔頭 :24 舉的例子正是 `20260824010000`(14 位)⇒ 🔴 **文件與碼不一致, 是既有缺陷。**
    #    🔬 實測:`20260824010000` ⇒ False · `20260905` ⇒ True · `2026-08-27` ⇒ True · `#885` ⇒ True。
    #    🛑 **本次【不動】`EXEMPT_ANCHOR`** —— 改它會同時放寬 R3/R4, 超出本次授權範圍。已回報主視窗。
    R5_SQL = 'GRANT service_role TO pcm_email_writer;'
    R5_EX = '-- ACL-GATE-EXEMPT-R5: pcm_email_writer -- 收窄案要成員資格 2026-09-05 #885\n'
    OK_STATE = (True, ['帳本有兩支', '告警信讀得到'])
    BAD_STATE = (False, ['帳本缺 20260905140000'])
    r5_cases = [
        # (名稱, sql, 前提狀態, 期望紅=1)
        ('R5 負對照A  前提不成立(帳本缺一支)+ 有 EXEMPT-R5 ⇒ 仍紅', R5_EX + R5_SQL, BAD_STATE, 1),
        ('R5 負對照B  前提成立而【沒寫】EXEMPT-R5 ⇒ 仍紅', R5_SQL, OK_STATE, 1),
        ('R5 負對照C  前提成立 + EXEMPT-R5 給 anon ⇒ 仍紅(公開角色永不豁免)',
         '-- ACL-GATE-EXEMPT-R5: anon -- 前提都在也不准 2026-09-05 #885\nGRANT service_role TO anon;', OK_STATE, 1),
        ('R5 負對照D  理由不帶錨 ⇒ 仍紅(規則 EX5)',
         '-- ACL-GATE-EXEMPT-R5: pcm_email_writer -- 沒有可稽核錨的理由字串\n' + R5_SQL, OK_STATE, 1),
        ('R5 正對照   三條件齊 ⇒ 綠', R5_EX + R5_SQL, OK_STATE, 0),
        ('R5 回歸     前提給 None(= 加豁免路之前)⇒ 仍紅', R5_EX + R5_SQL, None, 1),
        ("R5 負對照E  EXECUTE '<靜態字面>' 那條路也吃同一組條件 ⇒ 沒寫 EXEMPT 仍紅",
         'DO $$ BEGIN EXECUTE \'GRANT service_role TO pcm_email_writer\'; END $$;', OK_STATE, 1),
        # ── code-reviewer R1 抓到的四條繞過路, 每條一格(它們原本【全綠】)──
        ('R5 負對照F  一張豁免不得順便涵蓋 postgres(owner 級, 比 service_role 壞)',
         R5_EX + 'GRANT service_role, postgres TO pcm_email_writer;', OK_STATE, 1),
        ('R5 負對照G  只授 supabase_admin ⇒ 不吃 service_role 的豁免',
         R5_EX + 'GRANT supabase_admin TO pcm_email_writer;', OK_STATE, 1),
        ('R5 負對照H  WITH ADMIN OPTION 永遠不可豁免(拿到的人可以自己授給 anon)',
         R5_EX + 'GRANT service_role TO pcm_email_writer WITH ADMIN OPTION;', OK_STATE, 1),
        ('R5 負對照I  多 grantee 有一個是 anon ⇒ 整句紅',
         R5_EX + 'GRANT service_role TO pcm_email_writer, anon;', OK_STATE, 1),
        ('R5 負對照J  順序對調(anon 排前面)⇒ 一樣紅',
         R5_EX + 'GRANT service_role TO anon, pcm_email_writer;', OK_STATE, 1),
        ('R5 負對照K  加引號的角色 "PCM_EMAIL_WRITER" 不吃小寫那張豁免(PG 裡是另一個角色)',
         R5_EX + 'GRANT service_role TO "PCM_EMAIL_WRITER";', OK_STATE, 1),
        ('R5 正對照2  加引號而【字面相同】的豁免 ⇒ 綠(證明上一格不是恆紅)',
         '-- ACL-GATE-EXEMPT-R5: PCM_EMAIL_WRITER -- 大小寫逐字對上 2026-09-05 #885\n'
         'GRANT service_role TO "PCM_EMAIL_WRITER";', OK_STATE, 0),
    ]
    for name, sql_c, state, want in r5_cases:
        d, _, _ = check(sql_c, CLOSED_FIXTURE, None, state)
        got = 1 if d else 0
        ok = got == want
        fails += 0 if ok else 1
        ran += 1
        print(f"  {'PASS' if ok else '🔴 FAIL'}  {name}" + ('' if ok else f'   期望 {want} 實得 {got} {d}'))
    # 🟢 正對照那一發【還要印出那句】—— 一個「放行而靜靜通過」的版本要在這裡紅。
    _, _, used5 = check(R5_EX + R5_SQL, CLOSED_FIXTURE, None, OK_STATE)
    ok = (len(used5) == 1 and used5[0][0] == 'R5:pcm_email_writer'
          and all(c[:2] in used5[0][1] for c in R5_CANNOT)
          and '帳本' in used5[0][1])
    fails += 0 if ok else 1
    ran += 1
    print(f"  {'PASS' if ok else '🔴 FAIL'}  R5 放行時印出理由 + 前提 + 三句【擋不住】" + ('' if ok else f'   實得 {used5}'))
    # 🔴 **[R1 #6]** 紅的時候【不得】印豁免行, 而且**與書寫順序無關**。
    for nm, sql_c in (('TO pcm_email_writer, anon', R5_EX + 'GRANT service_role TO pcm_email_writer, anon;'),
                      ('TO anon, pcm_email_writer', R5_EX + 'GRANT service_role TO anon, pcm_email_writer;')):
        d6, _, used6 = check(sql_c, CLOSED_FIXTURE, None, OK_STATE)
        ok = bool(d6) and used6 == []
        fails += 0 if ok else 1
        ran += 1
        print(f"  {'PASS' if ok else '🔴 FAIL'}  R5 紅的時候零豁免行({nm})"
              + ('' if ok else f'   實得 drifts={bool(d6)} used={used6}'))
    # ══ [F2/F4] 新補的兩格 + [F10] 生產端 _index_or_head 的突變 ═══════════
    ok = (R5_ALERT_LITERAL not in _strip_ts_comments('const x = 1; // aclDriftDetected 還沒接\n'))
    fails += 0 if ok else 1
    ran += 1
    print(f"  {'PASS' if ok else '🔴 FAIL'}  F2:【行尾】註解裡的字面也不算「接了」")
    ok = (R5_ALERT_LITERAL in _strip_ts_comments('const x = summary.aclDriftDetected; // 說明\n'))
    fails += 0 if ok else 1
    ran += 1
    print(f"  {'PASS' if ok else '🔴 FAIL'}  🟢 F2 正對照:行尾有註解而【碼裡】有那個字面 ⇒ 仍然算(不是無條件不算)")
    for nm, sql_f4 in (('WITH ADMIN OPTION', R5_EX + 'GRANT service_role TO pcm_email_writer WITH ADMIN OPTION;'),
                       ('WITH ADMIN TRUE(PG16+)', R5_EX + 'GRANT service_role TO pcm_email_writer WITH ADMIN TRUE;'),
                       ('WITH ADMIN FALSE(保守當有)', R5_EX + 'GRANT service_role TO pcm_email_writer WITH ADMIN FALSE;')):
        d, _, _ = check(sql_f4, CLOSED_FIXTURE, None, OK_STATE)
        ok = bool(d)
        fails += 0 if ok else 1
        ran += 1
        print(f"  {'PASS' if ok else '🔴 FAIL'}  F4:{nm} 永遠不可豁免" + ('' if ok else f'   實得 {d}'))
    # 🔴 [F9] 前提掛掉時要說出【哪一格】—— 不能只印「R5 紅」。
    _, unres9, _ = check(R5_EX + R5_SQL, CLOSED_FIXTURE, None, BAD_STATE)
    ok = any('前提不成立' in u and '帳本' in u for u in unres9)
    fails += 0 if ok else 1
    ran += 1
    print(f"  {'PASS' if ok else '🔴 FAIL'}  F9:前提掛掉時印出【是哪一格掛的】" + ('' if ok else f'   實得 {unres9}'))
    # ══ [F5] 遞移一層:曾收過危險角色的角色, 自己也變危險 ══════════════
    F5_CHAIN = [('a.sql', 'GRANT service_role TO pcm_w;'),
                ('b.sql', 'GRANT pcm_w TO anon;')]
    extra = transitively_dangerous(F5_CHAIN[:1])
    ok = extra == {'pcm_w'}
    fails += 0 if ok else 1
    ran += 1
    print(f"  {'PASS' if ok else '🔴 FAIL'}  F5 掃出 pcm_w 是遞移危險角色" + ('' if ok else f'   實得 {extra}'))
    # 🔴 本體:第二句在【沒有】遞移集合時是綠的(那就是本次開的洞), 有了才紅。
    d, _, _ = check(F5_CHAIN[1][1], CLOSED_FIXTURE, None, OK_STATE)
    ok = not d
    fails += 0 if ok else 1
    ran += 1
    print(f"  {'PASS' if ok else '🔴 FAIL'}  F5 負對照:沒有遞移集合時 `GRANT pcm_w TO anon` 是【綠的】(= 那個洞)"
          + ('' if ok else f'   實得 {d}'))
    d, _, _ = check(F5_CHAIN[1][1], CLOSED_FIXTURE, None, OK_STATE, extra)
    ok = bool(d) and d[0][0] == 'R5'
    fails += 0 if ok else 1
    ran += 1
    print(f"  {'PASS' if ok else '🔴 FAIL'}  🔴 F5 本體:有了遞移集合 ⇒ `GRANT pcm_w TO anon` 觸發 R5【紅】"
          + ('' if ok else f'   實得 {d}'))
    # 🔵 而它【不得】變成無條件紅:一個與危險角色無關的成員關係仍要綠。
    d, _, _ = check('GRANT pcm_reader TO pcm_reporter;', CLOSED_FIXTURE, None, OK_STATE, extra)
    ok = not d
    fails += 0 if ok else 1
    ran += 1
    print(f"  {'PASS' if ok else '🔴 FAIL'}  🔵 F5 正對照:無關的成員關係仍然綠(不是無條件紅)"
          + ('' if ok else f'   實得 {d}'))
    # 🔴 遞移來的角色【不吃】R5 的豁免路 —— 因為豁免要求「授的恰好只有 service_role」。
    d, _, _ = check('-- ACL-GATE-EXEMPT-R5: anon -- 想用豁免繞過去 2026-09-05 #885\n'
                    'GRANT pcm_w TO anon;', CLOSED_FIXTURE, None, OK_STATE, extra)
    ok = bool(d)
    fails += 0 if ok else 1
    ran += 1
    print(f"  {'PASS' if ok else '🔴 FAIL'}  🔴 F5:遞移來的角色寫 EXEMPT-R5 也豁免不了" + ('' if ok else f'   實得 {d}'))
    # 🔴 同一顆 commit 裡【兩句都在】也要抓得到(staged 那半)。
    extra2 = transitively_dangerous([], ['GRANT service_role TO pcm_w;\nGRANT pcm_w TO anon;'])
    ok = extra2 == {'pcm_w'}
    fails += 0 if ok else 1
    ran += 1
    print(f"  {'PASS' if ok else '🔴 FAIL'}  F5:同一顆 commit 裡兩句都在也掃得到" + ('' if ok else f'   實得 {extra2}'))

    # ══ 條件②④【讀檔那半】的守門(code-reviewer R1 #1:原本零格 ⇒ 把它們換成恆真也 94 全綠)══
    #   🔴 用**注入 reader** 餵受控內容 ⇒ 測到的是【生產函式的判斷邏輯】, 不是我重打一份。
    # 🔴 [F1] 帳本第二欄現在要是【對得上樹上那支檔】的 sha ⇒ fixture 也要真的算。
    MIG_BODY = '-- fixture migration\n'
    MIG_SHA = hashlib.sha256(MIG_BODY.encode('utf-8')).hexdigest()
    MIG_PATHS = {'20260905140000': 'supabase/migrations/20260905140000_x.sql',
                 '20260905170000': 'supabase/migrations/20260905170000_y.sql'}
    LEDGER_OK = ''.join('%s\t%s\t2026-09-05\t記\n' % (v, MIG_SHA) for v in MIG_PATHS)
    LEDGER_BADSHA = ''.join('%s\t%s\t2026-09-05\t記\n' % (v, '0' * 64) for v in MIG_PATHS)
    MIG_FILES = {p: MIG_BODY for p in MIG_PATHS.values()}
    def _rd(mapping):
        merged = dict(MIG_FILES); merged.update(mapping)
        return lambda path: (merged.get(path), 'fixture' if path in merged else '讀不到')
    def _pf(v):
        return MIG_PATHS.get(v)
    prereq_cases = [
        ('R5 前提正對照  帳本兩支齊 + 告警檔有字面 ⇒ True',
         {'supabase/APPLIED.tsv': LEDGER_OK, R5_ALERT_FILE: 'const x = summary.aclDriftDetected;'}, True),
        ('R5 前提負對照A 帳本只有一支 ⇒ False',
         {'supabase/APPLIED.tsv': '20260905140000\t' + MIG_SHA + '\t2026-09-05\t記\n',
          R5_ALERT_FILE: 'const x = summary.aclDriftDetected;'}, False),
        ('R5 前提負對照B 版本號出現在【別的欄】而不是行首 ⇒ False',
         {'supabase/APPLIED.tsv': 'x\tsha\t20260905140000 20260905170000\t記\n',
          R5_ALERT_FILE: 'const x = summary.aclDriftDetected;'}, False),
        ('R5 前提負對照B2 帳本兩列都在而【sha 對不上樹上那支檔】 ⇒ False',
         {'supabase/APPLIED.tsv': LEDGER_BADSHA, R5_ALERT_FILE: 'const x = summary.aclDriftDetected;'}, False),
        ('R5 前提負對照B3 帳本有列而【那支檔在樹上找不到】 ⇒ False',
         {'supabase/APPLIED.tsv': LEDGER_OK, R5_ALERT_FILE: 'const x = summary.aclDriftDetected;',
          'supabase/migrations/20260905140000_x.sql': None}, False),
        ('R5 前提負對照C 告警檔沒有那個字面 ⇒ False',
         {'supabase/APPLIED.tsv': LEDGER_OK, R5_ALERT_FILE: 'const x = 1;'}, False),
        ('R5 前提負對照D 字面只出現在 // 註解裡 ⇒ False(不算有人接)',
         {'supabase/APPLIED.tsv': LEDGER_OK,
          R5_ALERT_FILE: '// TODO: aclDriftDetected 還沒接\nconst x = 1;'}, False),
        ('R5 前提負對照E 字面只出現在 /* */ 區塊註解裡 ⇒ False',
         {'supabase/APPLIED.tsv': LEDGER_OK,
          R5_ALERT_FILE: '/* 舊碼:aclDriftDetected */\nconst x = 1;'}, False),
        ('R5 前提負對照F 兩支檔都讀不到 ⇒ False(fail-closed)', {}, False),
    ]
    for name, mapping, want in prereq_cases:
        got, _ = r5_prereq(_rd(mapping), _pf)
        ok = got is want
        fails += 0 if ok else 1
        ran += 1
        print(f"  {'PASS' if ok else '🔴 FAIL'}  {name}" + ('' if ok else f'   期望 {want} 實得 {got}'))
    # 🔴 突變:把【讀檔那兩支生產函式】換成恆真 ⇒ 上面對應的負對照必須翻 True
    #    少了這一格, 一個「R5 無條件放行」的版本會通過全部自檢(那正是 R1 #1 抓到的)。
    for pname, target, mutant, world in (
            ('r5_ledger_ok', 'r5_ledger_ok', lambda reader=None, path_for=None: (True, 'mutant'),
             {'supabase/APPLIED.tsv': '', R5_ALERT_FILE: 'const x = summary.aclDriftDetected;'}),
            ('r5_alert_ok', 'r5_alert_ok', lambda reader=None: (True, 'mutant'),
             {'supabase/APPLIED.tsv': LEDGER_OK, R5_ALERT_FILE: 'const x = 1;'})):
        g = globals()
        orig = g[target]
        g[target] = mutant
        try:
            got, _ = r5_prereq(_rd(world), _pf)
        finally:
            g[target] = orig
        ok = got is True
        fails += 0 if ok else 1
        ran += 1
        print(f"  {'PASS' if ok else '🔴 FAIL'}  突變 {pname} ⇒ 恆真時對應的負對照必須翻 True"
              + ('' if ok else '   實得仍 False'))
    ok = (g['r5_ledger_ok'] is not None and r5_prereq(_rd({}), _pf)[0] is False)
    fails += 0 if ok else 1
    ran += 1
    print(f"  {'PASS' if ok else '🔴 FAIL'}  讀檔那兩支【還原】了(空世界仍 False)")

    # 🔴 [F10] 生產端讀檔函式的突變 —— 三處自檢原本全注入 reader ⇒ 它換成恆真【零格看得到】。
    g10 = globals()
    orig10 = g10['_index_or_head']
    g10['_index_or_head'] = lambda path: (LEDGER_OK if path.endswith('APPLIED.tsv')
                                          else ('const x = summary.aclDriftDetected;' if path == R5_ALERT_FILE
                                                else MIG_BODY), 'mutant')
    orig_pf = g10['_ledger_path_for']
    g10['_ledger_path_for'] = _pf
    try:
        got10, _ = r5_prereq()          # 🔴 **不注入** ⇒ 走生產端那條路
    finally:
        g10['_index_or_head'] = orig10
        g10['_ledger_path_for'] = orig_pf
    ok = got10 is True
    fails += 0 if ok else 1
    ran += 1
    print(f"  {'PASS' if ok else '🔴 FAIL'}  F10:突變【生產端】_index_or_head ⇒ 不注入 reader 的那條路也翻 True"
          + ('' if ok else '   實得 False ⇒ 那條路沒有被這個突變碰到'))
    ok = (g10['_index_or_head'] is orig10 and g10['_ledger_path_for'] is orig_pf)
    fails += 0 if ok else 1
    ran += 1
    print(f"  {'PASS' if ok else '🔴 FAIL'}  F11:兩支生產端函式【是原物件】(不是靠罐頭輸入推的)")


    # ══ 突變:把三個判準【逐一】換成恆真, 對應那一格必須翻綠 ═════════════
    #   🔴 它證的是「那一格的紅【真的由那個判準決定】」——
    #      少了它, 一個寫了條件而【沒接上】的版本會四格全綠而看起來很完整。
    for pname, target, mutant, ok_state in (
            ('_r5_role_ok(公開角色那格)', '_r5_role_ok', lambda g: True,
             ('-- ACL-GATE-EXEMPT-R5: anon -- 前提都在也不准 2026-09-05 #885\nGRANT service_role TO anon;', OK_STATE)),
            ('_r5_named(具名豁免那格)', '_r5_named', lambda g, e: True, (R5_SQL, OK_STATE)),
            ('_r5_prereq_ok(前提那格)', '_r5_prereq_ok', lambda st: True, (R5_EX + R5_SQL, BAD_STATE))):
        g = globals()
        orig = g[target]
        g[target] = mutant
        try:
            d, _, _ = check(ok_state[0], CLOSED_FIXTURE, None, ok_state[1])
        finally:
            g[target] = orig
        ok = not d
        fails += 0 if ok else 1
        ran += 1
        print(f"  {'PASS' if ok else '🔴 FAIL'}  突變 {pname} ⇒ 恆真時該格必須翻綠"
              + ('' if ok else f'   實得仍紅 {d}'))
    # 🔴 突變還原了沒有 —— 少了這一格, 上面那三發會把判準留在恆真狀態而後面全綠
    ok = (_r5_role_ok('anon') is False and _r5_named('x', {}) is False and _r5_prereq_ok((False, [])) is False)
    fails += 0 if ok else 1
    ran += 1
    print(f"  {'PASS' if ok else '🔴 FAIL'}  三個判準【還原】了(突變沒有留在恆真)")

    # 行號射程:改既有檔只回報碰到新增行的語句(跨行 GRANT 只新增 TO 那一行也要紅, codex r4 #2)
    two = 'CREATE TABLE public.t (id int);\nGRANT SELECT ON public.products\n  TO anon;\nGRANT SELECT ON public.brands TO anon;'
    d, _, _ = check(two, set(), added={3})
    ok = [x[0] for x in d] == ['R3'] and d[0][1] == 2
    fails += 0 if ok else 1
    ran += 1
    print(f"  {'PASS' if ok else '🔴 FAIL'}  改既有檔:只新增第 3 行(跨行 GRANT 的 TO 那行)⇒ 回報那一條、不回報第 4 行的舊債  {d}")
    d, _, _ = check(two, set(), added={1})
    ok = d == []
    fails += 0 if ok else 1
    ran += 1
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
    ran += 1
    print(f"  {'PASS' if ok else '🔴 FAIL'}  閉集:t1 t5 在 / t2 再 GRANT 不在 / 字串內 t3 不算 / t4 只收寫入面不算 / t6 先 GRANT 後 REVOKE 在 / t7 FROM PUBLIC 不算 / t8 t9 多物件 / t10 GRANT OPTION FOR 不算 / t11 欄級不算(codex r4 #6)  {sorted(cs)}")
    gf, gc = selftest_git()
    fails += gf
    ran += gc
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
    # ⛔ ~~total = len(WORLDS) + 5 + 2 + 1 + gc~~ —— 🔴 **那是【手維護的加總】, 而它漂了。**
    #    2026-09-05 實測:新增 12 格之後, **94 格在跑而它印 82**。
    #    🛑 而它壞的方式最惡劣:某一格【失敗】時 PASS 少一、FAIL 多一, **兩數仍加得回 82**
    #       ⇒ 看的人不會發現分母是錯的。⇒ 📌 這正是鐵則 11 的第四個數(我餵幾條 vs 它跑幾支)。
    #    ✅ 改成【數出來的】:每印一格就 +1。
    total = ran
    print(f'── selftest: {total - fails} PASS / {fails} FAIL')
    return 1 if fails else 0  # 不把格數當離場碼(2 格紅會撞到「工具層」那個 2;R2 nit)


def selftest_git():
    """走真的 git index:紅 / 綠 / 修改既有檔 / index≠工作樹 / 工具層 rc=2(三種)。回 (fails, 格數)。"""
    fails, count = 0, 0
    tmp = tempfile.mkdtemp(prefix='aclgate-')
    # 🔴🔴 **-de 2026-08-27 落地時實測到的缺陷:本閘的自檢, 在【它自己被掛上去的那個 hook】裡跑不起來。**
    #
    #    症狀:`--selftest` 在乾淨終端機 82 PASS / 0 FAIL, 而在 lint-staged 底下
    #          `[git] 路④ 紅` 那一格 **期望 rc=1 實得 rc=2**(rc=2 = 本閘沒有跑)。
    #    成因:**git 呼叫 hook 時會設 `GIT_DIR` / `GIT_WORK_TREE`**, 而下面兩處都吃 `os.environ`
    #          ⇒ 自檢在 tempdir 建的拋棄式 repo, 它的 `git` 被指回**真 repo**。
    #    🔴 而 `q`(建拋棄式 repo 的 git 指令)比 `env`(跑閘)嚴重得多:
    #          `git -C <tempdir> add` 的 `-C` **會被 `GIT_DIR` 蓋過去** ⇒ 它會去動【真 repo 的 index】。
    #    逐一注入實測(不是推的):
    #          GIT_DIR=<真 repo>/.git   ⇒ 81 PASS / 1 FAIL
    #          GIT_WORK_TREE=<真 repo>  ⇒ 70 PASS / 12 FAIL
    #          GIT_PREFIX / GIT_INDEX_FILE ⇒ 82 / 0(無害;**我先猜 GIT_INDEX_FILE, 猜錯了**)
    # 📌 **形狀:一支要在 pre-commit 裡跑的工具, 它的自檢在乾淨終端機是綠的,
    #    而在真正要跑它的那個環境是紅的。** 兩邊都印一個明確的數字, 沒有一邊看起來像壞掉。
    # ⚠️ 我第一版只修了 `env` 沒修 `q` ⇒ 注入 GIT_DIR 之後 FAIL 從 1 變 12 ——
    #    **修完比修之前更紅**。而那不代表更壞:**它是把原本被遮住的紅露出來。**
    #    (若當時只看「有沒有變綠」, 我會把一個正確的方向判成走錯路。)
    _GIT_SCOPE_VARS = (
        'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY',
        'GIT_COMMON_DIR', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_PREFIX',
        'GIT_CONFIG', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_CEILING_DIRECTORIES',
    )
    env = {k: v for k, v in os.environ.items() if k not in _GIT_SCOPE_VARS}
    env.update(GIT_AUTHOR_NAME='t', GIT_AUTHOR_EMAIL='t@t',
               GIT_COMMITTER_NAME='t', GIT_COMMITTER_EMAIL='t@t')
    # 🔴 建 repo 的那些 git 指令**也要**走這份乾淨 env —— 見上面那段。
    q = dict(capture_output=True, env=env)
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
        subprocess.run(['git', '-C', d, '-c', 'core.hooksPath=', 'commit', '-qm', 'base'], **q)  # env 已在 q 裡
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
