#!/usr/bin/env python3
"""rls-service-role-policy-gate.py — 開了 RLS 卻沒有 service_role 讀得到的政策 ⇒ 擋下 commit。

══ 存在理由(2026-08-26 量到的,不是設計偏好)═══════════════════════════════════
正式庫 50 張表開了 RLS,其中 42 張缺一條 service_role 用得到的 SELECT 政策。
今天不爆,是因為 service_role 帶 BYPASSRLS —— 那是【平台角色屬性】,repo 內零行宣告、
零行檢查。⇒ 那 42 張是「靠平台特權活著」,不是「被政策允許」。

🔴 而成因的權重是量出來的,不是猜的(b4 2026-08-26):
     40 張  migration 裡【明明白白寫著】ENABLE RLS   ← 有人手寫的
      2 張  migration 裡零支提到                     ← event trigger ensure_rls 自動開的
   ⇒ **那不是 40 次疏忽,是同一個習慣做了 40 次。而那隻手現在還在寫 migration。**
   ⇒ 下一支開 RLS 的 migration 會變成第 43 張,而三綠全綠、審查看不出來、零訊號。

⇒ 本閘擋的是【第 43 張】,不是既有那 42 張。先關水龍頭,再擦地板。

══ 誤擋率是量過的,不是估的 ═══════════════════════════════════════════════════
「政策要寫在同一支 migration 檔裡」這個判準會不會大量誤擋(政策其實寫在後續 migration)?
2026-08-26 對全 repo 47 張版控看得見的 RLS 表逐張量:
    A 同一支檔內就有 service_role 可用的 SELECT 政策   7
    B 政策寫在【別支】migration 裡                     1   ← 唯一會被誤擋的形狀
    C 到現在都沒有政策                                39
🔴 而那唯一的 B 是 `customers`,它的政策就是 `20260826000035` 那支【還按住沒套】的 migration
   —— 是我們自己昨晚造出來的,不是這個 repo 的既有習慣。
   ⇒ **對【現有這 47 張】實測誤擋 = 0**(2026-08-26 量;修完 cf 的 7 條 must-fix 後用新尺重量,
     `47 / 7 / 1 / 39` 四個數與舊尺逐格相同)。
   🔴 **時態不要寫寬**:~~「實質誤擋 = 0」~~ 是錯的說法 —— 那句沒有時點,聽起來像「以後也不會誤擋」。
     而 M3(`FOR ALL`)那類**是未來有人這樣寫才會中**,它不在這 47 張的分母裡。
     ⇒ **數字旁邊要帶時點與分母,因為表會被複製走而前後文不會。**
⚠️ 分母寫在旁邊跟著走:那是【版控看得見的 47 張】,不是正式庫的 50 張。
   正式庫另有 2 張 repo 完全不認識的表(product_fitments_effective_staging / _sync_log)
   ⇒ 本閘對它們**結構上不可能有判別力** —— 它讀的是 migration 檔,而它們沒有 migration 檔。

══ 天花板 ═══════════════════════════════════════════════════════════════════
🔴 **這一節本來只有【漏擋】那一欄, 而 cf 2026-08-26 指出:**
   **「一份只列漏擋的天花板, 讀起來像【誤擋為零】。」** ⇒ 兩欄都要在。

✅ 擋得住  新 migration 開了 RLS 而同檔沒有 service_role 讀得到的 SELECT 政策
           (讀的是 **index 那一份**, 不是工作樹 —— 見 `staged_content()`)

❌ 漏擋(它會放行, 而東西是壞的)
   ① 走 SQL Editor 手貼 / MCP apply_migration —— 那條路不經過 commit, 本閘看不到
      🔴 而那條路【現在還開著】, 2026-08-25 才剛量到一支這樣進去的
   ② event trigger `ensure_rls` 自動開的 RLS(沒有 migration 檔可讀)
   ③ 政策存在而 `USING` 是 false —— 本閘不看 `USING` 的內容
   ④ permissive 政策在, 而**另一條 restrictive 把它掐死** —— 本閘只排除「唯一一條是 restrictive」
   ⑤ 政策真的寫在【後續另一支 migration】裡(本 repo 現況只有 1 例, 而那 1 例是我們自己造的)
   ⑥ `--no-verify`
   ⑦ 只掃 `supabase/migrations/*.sql`;別處的 SQL 一律不在分母
   ⑧ **GRANT 那一層** —— 政策對而 `service_role` 沒有 table 的 SELECT GRANT ⇒ 照樣讀不到,
      而它的失效長相是【報錯】不是【空的】。本閘一行都沒有看 GRANT
      (cf 2026-08-26 地面真相:`t6_nogrant` 政策好、沒 GRANT ⇒ 報錯)
   ⑨ **它擋的是「開 RLS 而沒補政策」, 不是「這張表安全了」** —— 補了政策只代表
      拿掉 BYPASSRLS 那天後台還讀得到, 不代表權限設計是對的
   ⑩ **刪除一支【唯一提供某張表政策】的 migration**(codex must-fix 9):
      `--diff-filter` 不含 `D` ⇒ staged 清單是空的 ⇒ 印「沒有動到 migration」並放行。
      🔴 對【正式庫】無害(政策已經在庫裡, 刪檔不會撤掉它);
        會痛的是**從 migration 重建一個乾淨庫**的那條路。**這一格是知道而沒有做。**
   ⑪ 這些形狀曾經是漏擋, **2026-08-26 已修並各留一格自檢證人**, 列在這裡是因為
      **「修過了」與「從來沒壞過」在產物上長得一樣, 而下一個改壞它的人需要知道這裡有洞過**:
      index 與工作樹落差 · 註解/字串/`DO $$` 裡的假政策 · 跨 schema 同名 ·
      角色名子字串比對 · quoted identifier 帶 `-` 或空白 · 政策名叫 `"on"` ·
      唯一一條是 `AS RESTRICTIVE` · `FOR ALL` 被誤判 · 裸的假豁免

⚠️ 誤擋(它會擋, 而東西其實是對的)
   ⑫ 上面 ⑤ 的反面:刻意把政策拆到後續 migration 的寫法會被擋
      ⇒ 撞到時**人工判**, 不要加集中式豁免清單(見下方「豁免」)
   ⑬ cwd 不在 repo 根時原本會【靜靜放行】(cf nit N1)⇒ 已改成先 `goto_repo_root()`,
      失敗則 exit 2。經 husky 這條路不可達(husky 把 cwd 設在根), 這格擋的是人工自檢
   ⑭ 改動【既有】migration 時本閘只看**這顆 commit 新增的行**(codex must-fix 9 的誤擋那半):
      不這樣做的話, 一個去修錯字的人會被那支檔 2026-05 就欠著的 4 張舊債擋住。
      🔴 代價要明寫:**在既有檔【末尾追加】一段新的 ENABLE 仍然擋得住**(它是新增的行),
        而把既有那行 ENABLE 從註解狀態改成生效, 也算新增 ⇒ 擋得住。
        擋不住的是「這支檔本來就欠著的那幾張」—— 而那是刻意的, 它們屬於那 42 張。

══ 審查來源 ═════════════════════════════════════════════════════════════════
2026-08-26 兩輪獨立對抗審查, findings 逐條落在本檔的自檢格裡:
  cf(`pcm-website-v2-d8`)7 must-fix / 4 nit —— 用本機拋棄式 PostgreSQL 17.10 造地面真相,
     建一個 `INHERIT service_role` **但沒有 BYPASSRLS** 的角色真的去讀、數回幾列
  codex(`-s read-only`)11 must-fix —— 另外抓到 quoted identifier 字元集合、政策名叫 `"on"`、
     刪除 migration、以及「自檢沒有測到正式執行路徑」
🔴 **兩輪重疊約一半, 而各自都有對方沒抓到的。** 只跑其中一輪會留下另一輪那幾條。
⚠️ 兩輪都**沒有在正式庫跑過任何東西**;cf 的地面真相是本機 17.10, **與線上版本未覆核**。

══ 豁免 ═══════════════════════════════════════════════════════════════════
**沒有集中式豁免清單**(那正是上一輪 must-fix 的成因:清單會離開它解釋的那段碼,
然後長出沒有人記得為什麼的條目)。要豁免就在【那支 migration 自己檔內】寫一行:

    RLS-GATE-EXEMPT: <表名> -- <理由>

它會跟著 diff 一起被看到、跟著 blame 一起被查到,而清單不會。
"""
import os, re, subprocess, sys

# 🔴 識別字的字元集合(codex 2026-08-26 must-fix 5):原本寫 `[a-z0-9_."]+`
#    ⇒ `public."audit-log"` / `"weird table"` **抓不到**(合法 SQL, 而 `-` 與空白不在集合裡)
#    ⇒ EN 漏抓 ⇒ **印綠**。而 `"public" . "widgets"`(點號旁有合法空白)同樣漏。
#    ⇒ 改成「引號段 or 裸字」的組合, 並允許點號兩側有空白。
IDENT = r'(?:"[^"]*"|[a-z0-9_$]+)'
QNAME = r'(?:%s\s*\.\s*)*%s' % (IDENT, IDENT)
EN = re.compile(r'alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(%s)\s+enable\s+row\s+level\s+security' % QNAME, re.I | re.S)
# 🔴 codex must-fix 6 後半:政策名可以叫 `"on"` ⇒ 用 `.*?\bon\b` 會咬到名字裡那個 on。
#    ⇒ 政策名先吃掉一個完整識別字, 再要求緊接著的 `ON`。
POL = re.compile(r'create\s+policy\s+(?:if\s+not\s+exists\s+)?%s\s+on\s+(%s)(.*?);' % (IDENT, QNAME), re.I | re.S)
EXEMPT = re.compile(r'^\s*--\s*RLS-GATE-EXEMPT:\s*([a-z0-9_."]+)\s*--\s*(\S[^\n]*)$', re.I | re.M)
DOLLAR = re.compile(r'\$([a-z_][a-z0-9_]*)?\$', re.I)
EXEMPT_MIN_REASON = 8


def strip_strings(sql):
    """把字串常值挖空(長度不變, 換成空白)——**行號與位移不動, 之後的比對才對得上原文。**

    🔴 為什麼一定要先做這一步(cf 2026-08-26 對抗審查 must-fix 群的共同前提):
       ① `USING` 裡的字串若含分號, POL 那個 `(.*?);` 會在錯的地方切斷 body。
          cf 實測那次「答案仍正確」——**而它靠的是 SQL 文法規定 `TO` 排在 `USING` 前面,
          不是靠這支尺。那是運氣, 不是設計。**
       ② `DO $$ ... $$` / dollar-quoted 字串裡寫的 `CREATE POLICY` 不會真的建政策,
          而字面在 ⇒ 不挖空的話它會讓本閘誤放行。
    """
    out, i, n = [], 0, len(sql)
    while i < n:
        c = sql[i]
        if c == "'":
            j = i + 1
            while j < n:
                if sql[j] == "'":
                    if j + 1 < n and sql[j + 1] == "'":
                        j += 2
                        continue
                    j += 1
                    break
                j += 1
            out.append("''" + ' ' * (j - i - 2))
            i = j
            continue
        if c == '$':
            m = DOLLAR.match(sql, i)
            if m:
                tag = m.group(0)
                j = sql.find(tag, m.end())
                j = n if j < 0 else j + len(tag)
                out.append(' ' * (j - i))
                i = j
                continue
        out.append(c)
        i += 1
    return ''.join(out)


def strip_comments(sql):
    """把 `--` 行註解與 `/* */` 區塊註解挖空(同樣保長度)。

    🔴 為什麼(cf must-fix M4, 兩個方向各壞一次):
       · 被註解掉的 `CREATE POLICY ... TO service_role` ⇒ 不挖空 ⇒ **誤放行**(地面真相 0 列)
       · 被註解掉的 `ALTER TABLE ... ENABLE RLS`        ⇒ 不挖空 ⇒ **誤擋**
       同一個盲點, 而它往兩個方向各壞一次 ⇒ 只補一邊會留下另一邊。
    """
    sql = re.sub(r'--[^\n]*', lambda m: ' ' * len(m.group(0)), sql)
    return re.sub(r'/\*.*?\*/', lambda m: ' ' * len(m.group(0)), sql, flags=re.S)


def norm(t):
    """正規化成 `schema.table`。🔴 **不砍 schema**(cf must-fix M6):

    砍掉的話 `ALTER TABLE audit.widgets ENABLE RLS` + `CREATE POLICY ... ON public.widgets`
    會被判成同一張表 ⇒ **假綠**;豁免也會跨 schema 洩漏出去。
    """
    parts = [p.strip().strip('"') for p in re.split(r'\s*\.\s*', t.strip())]
    parts = [p.lower() for p in parts if p != '']
    if len(parts) == 1:
        parts = ['public'] + parts
    return '.'.join(parts[-2:])


def enabled_tables(sql):
    return {norm(m.group(1)) for m in EN.finditer(sql)}


def readable_by_service_role(sql):
    """同檔內建了哪些表的、service_role 讀得到的 SELECT 政策。

    🔴 為什麼不用單行 grep:`CREATE POLICY` 常跨多行,單行尺對它【恆零命中】——
       而零命中與「真的沒有」印同一個結果。2026-08-25 踩過一次。
    🔴 為什麼不 grep 'TO service_role':`GRANT ... TO service_role` 也會命中
       ⇒ 2026-08-26 第一發量到 28,而實際只有 7。**那把尺量的是別的東西。**
    """
    out = set()
    for m in POL.finditer(sql):
        table, body = norm(m.group(1)), m.group(2)
        head = body.split('using', 1)[0] if re.search(r'\busing\b', body, re.I) else body

        # 🔴 cf must-fix M7:唯一一條政策是 RESTRICTIVE ⇒ 它【不給任何權】, 只會再收緊。
        #    地面真相:沒有 BYPASSRLS 的角色讀回 0 列。檔頭原本那句「被 RESTRICTIVE 蓋掉」
        #    預設有一條 permissive 在 ⇒ **「唯一一條是 restrictive」不在那句話的射程裡。**
        if re.search(r'\bas\s+restrictive\b', head, re.I):
            continue

        # 🔴 cf must-fix M3:`FOR ALL` 明文寫出來的人反而被擋 —— 而 FOR ALL 涵蓋 SELECT。
        #    地面真相:FOR ALL TO service_role, 沒有 BYPASSRLS 照樣讀到 1 列。
        is_select = bool(re.search(r'\bfor\s+(select|all)\b', body, re.I)) or not re.search(
            r'\bfor\s+(insert|update|delete)\b', body, re.I)

        to_m = re.search(r'\bto\s+([a-z0-9_,\s"]+?)(?:\busing\b|\bwith\s+check\b|$)', body, re.I)
        # 無 TO 子句 ⇒ PostgreSQL 預設 TO PUBLIC ⇒ service_role 也在裡面
        raw = to_m.group(1) if to_m else 'public'
        # 🔴 cf must-fix M5:原本用子字串比對 ⇒ `TO public_readers` 會被當成 public ⇒ 假綠
        #    (地面真相 0 列)。逗號切開、逐個【全等】比。
        roles = {r.strip().strip('"').lower() for r in raw.split(',')}
        if is_select and ({'service_role', 'public'} & roles):
            out.add(table)
    return out


def exemptions(sql):
    """豁免只認【真的 `--` 行註解】裡的契約形狀, 且理由要寫得像個理由。

    🔴 cf nit N2/N3:原本 `--` 前綴是選配 ⇒ 豁免可以藏在 dollar-quoted 字串裡而生效;
       理由欄 `(\\S.*)` 允許只寫一個標點 ⇒ 三週後沒有人知道它為什麼在那裡。
    """
    out = {}
    for t, why in EXEMPT.findall(sql):
        why = why.strip()
        if len(why) >= EXEMPT_MIN_REASON:
            out[norm(t)] = why
    return out


def check(sql, added=None):
    """回傳 (缺政策的表, 有豁免的表->理由)。純函式, 給自檢與正式路徑共用同一條路。

    順序是有意義的:先挖空字串, 再從【還看得到註解】的那一份抽豁免(豁免本來就寫在註解裡),
    最後才挖掉註解去找 ENABLE / CREATE POLICY。

    `added` = 這顆 commit **新增的那幾行**(只給改動既有檔時用)。
    🔴 為什麼要分這一層(codex 2026-08-26 must-fix 9 的誤擋那半):
       不分的話, 有人只是去改 `20260523034911` 裡的一個錯字, 本閘會把那支檔**整份重掃**,
       然後對 4 張【2026-05 就欠著的舊債】開火 ⇒ **一個修錯字的人被 42 張的歷史債擋住。**
       ⇒ 政策照樣全檔找(政策本來就可以寫在檔案任何地方),
         而【要不要為某張表開火】只看那張表的 ENABLE 是不是**這顆 commit 新增的**。
    """
    nostr = strip_strings(sql)
    ex = exemptions(nostr)
    code = strip_comments(nostr)
    ok = readable_by_service_role(code)
    if added is None:
        en = enabled_tables(code)
    else:
        en = enabled_tables(strip_comments(strip_strings(added)))
    return sorted(en - ok - set(ex)), {t: ex[t] for t in sorted(en & set(ex))}


def goto_repo_root():
    """把 cwd 移到 repo 根。🔴 cf nit N1:不做這件事的話, cwd 不在根時
    `git diff --cached -- supabase/migrations` 回空 ⇒ 本閘印「這顆 commit 沒有動到
    migrations」而它動了 ⇒ **靜靜放行**。
    ⚠️ 射程誠實講:husky 會把 cwd 設在 repo 根 ⇒ 經 hook 這條路現在不可達。
       這一格擋的是【人工自檢】與【未來接到別處】。
    """
    p = subprocess.run(['git', 'rev-parse', '--show-toplevel'], capture_output=True, text=True)
    if p.returncode != 0:
        print('🔴 找不到 repo 根 ⇒ 本閘無法判斷 ⇒ 擋下(fail-closed)', file=sys.stderr)
        print(p.stderr, file=sys.stderr)
        sys.exit(2)
    os.chdir(p.stdout.strip())


def git_out(args, why):
    p = subprocess.run(['git'] + args, capture_output=True)
    if p.returncode != 0:
        print(f'🔴 {why} 失敗 ⇒ 本閘【沒有跑】⇒ 擋下(fail-closed)', file=sys.stderr)
        print(p.stderr.decode('utf-8', 'replace'), file=sys.stderr)
        sys.exit(2)
    return p.stdout.decode('utf-8', 'replace')


def self_protect():
    """本閘自己的三支檔若被 staged 成【刪除】⇒ 擋下。

    🔴 codex 2026-08-26 must-fix 2:薄殼那句 `[ -f scripts/...py ]` 檢查的是【工作樹】。
       先 `git rm --cached` 掉守門、再把檔案只還原到工作樹 ⇒ hook 看見工作樹的檔、
       **跑得起來、印綠**, 而那顆 commit 把守門從 repo 裡刪掉了。
       ⇒ 與 `scripts-whitelist-gate` 同款理由:**fail-open 會讓一道閘被它自己要防的動作關掉。**
    """
    own = ['scripts/rls-service-role-policy-gate.py', '.husky/rls-service-role-policy-gate.sh']
    gone = [ln.split('\t', 1)[1] for ln in
            git_out(['diff', '--cached', '--name-status', '--diff-filter=D', '--'] + own,
                    'git diff --cached --diff-filter=D').splitlines() if '\t' in ln]
    if gone:
        print('🔴 這顆 commit 要【刪掉本閘自己】⇒ 擋下(fail-closed)', file=sys.stderr)
        for f in gone:
            print(f'   · {f}', file=sys.stderr)
        print('   真的要退場 ⇒ 停下來問 Sean, 並把「為什麼不再需要它」寫進 commit body。', file=sys.stderr)
        sys.exit(2)


def staged_migrations():
    """回傳 [(狀態, 路徑)]。狀態 A = 新增(整份檢查), M/R = 改動(只看新增的行)。

    🔴 `--diff-filter` 不含 D 是刻意的, 而它的代價寫在檔頭天花板 ⑩:
       刪掉一支【唯一提供某張表政策】的 migration, 本閘看不到。
    """
    rows = git_out(['diff', '--cached', '--name-status', '--diff-filter=ACMR',
                    '--', 'supabase/migrations'], 'git diff --cached --name-status').splitlines()
    out = []
    for ln in rows:
        parts = ln.split('\t')
        if len(parts) < 2:
            continue
        path = parts[-1]
        if path.endswith('.sql'):
            out.append((parts[0][0].upper(), path))
    return out


def added_lines(path):
    """這顆 commit 在這支檔【新增】的那幾行(不含 +++ 標頭)。"""
    d = git_out(['diff', '--cached', '-U0', '--', path], 'git diff --cached -U0')
    return '\n'.join(ln[1:] for ln in d.splitlines()
                     if ln.startswith('+') and not ln.startswith('+++'))


def staged_content(path):
    """讀【index 那一份】, 不是工作樹那一份。

    🔴 為什麼不能用 open(path)(2026-08-26 在拋棄式 repo 構造出來的, 不是想到的):
       index 放壞的、工作樹放好的 ⇒ open() 讀到好的 ⇒ 本閘印綠而放行,
       **而那顆 commit 收走的是 index 那一份, 也就是壞的那一份。**
       實測 rc=0 放行。⇒ 守門要判的東西, 必須跟 commit 要收的東西是同一份。
    """
    p = subprocess.run(['git', 'show', ':' + path], capture_output=True)
    if p.returncode != 0:
        print(f'🔴 讀不到 index 裡的 {path} ⇒ 本閘對這支【沒有判斷力】⇒ 擋下(fail-closed)', file=sys.stderr)
        print(p.stderr.decode('utf-8', 'replace'), file=sys.stderr)
        sys.exit(2)
    return p.stdout.decode('utf-8', 'replace')


def selftest():
    """三個世界都要表演過。🔴 只跑「該綠的」的話, 一支什麼都不做的空腳本會通過驗收。"""
    W = [
        ('① 該紅:開了 RLS 而同檔零政策',
         'ALTER TABLE public.widgets ENABLE ROW LEVEL SECURITY;',
         ['public.widgets'], {}),
        ('② 該綠:同檔有 TO service_role 的 SELECT 政策',
         'ALTER TABLE public.widgets ENABLE ROW LEVEL SECURITY;\n'
         'CREATE POLICY widgets_select_service_role ON public.widgets\n'
         '  FOR SELECT TO service_role\n  USING (true);',
         [], {}),
        ('③ 該綠:完全沒碰 RLS',
         'CREATE TABLE public.widgets (id uuid primary key);', [], {}),
        ('④ 該綠:無 TO 子句 = TO PUBLIC, service_role 在裡面',
         'ALTER TABLE public.widgets ENABLE ROW LEVEL SECURITY;\n'
         'CREATE POLICY p ON public.widgets FOR SELECT USING (true);', [], {}),
        ('⑤ 該紅:政策是 TO authenticated ⇒ service_role 讀不到',
         'ALTER TABLE public.widgets ENABLE ROW LEVEL SECURITY;\n'
         'CREATE POLICY p ON public.widgets FOR SELECT TO authenticated USING (true);',
         ['public.widgets'], {}),
        ('⑥ 該紅:政策是 FOR INSERT ⇒ 不涵蓋 SELECT',
         'ALTER TABLE public.widgets ENABLE ROW LEVEL SECURITY;\n'
         'CREATE POLICY p ON public.widgets FOR INSERT TO service_role WITH CHECK (true);',
         ['public.widgets'], {}),
        ('⑦ 該綠:同檔明文豁免(理由跟著檔案走, 不是清單)',
         'ALTER TABLE public.widgets ENABLE ROW LEVEL SECURITY;\n'
         '-- RLS-GATE-EXEMPT: widgets -- 這張表只給 anon 讀, 後台不碰',
         [], {'public.widgets': '這張表只給 anon 讀, 後台不碰'}),
        ('⑧ 該紅:豁免寫了【表名對不上】⇒ 不算豁免',
         'ALTER TABLE public.widgets ENABLE ROW LEVEL SECURITY;\n'
         '-- RLS-GATE-EXEMPT: gadgets -- 打錯字',
         ['public.widgets'], {}),
        ('⑨ 該紅:ALTER TABLE 跨多行 + 表名帶引號 ⇒ 尺要看得懂',
         'ALTER TABLE "public"."widgets"\n  ENABLE ROW LEVEL SECURITY;',
         ['public.widgets'], {}),
        ('⑩ 負對照:空字串 ⇒ 零表、零豁免(尺不會無中生有)', '', [], {}),
        # ── 以下是 cf 2026-08-26 對抗審查的 7 must-fix / 4 nit,每一條都留一格證人 ──
        ('⑪ 該綠 [M3]:FOR ALL TO service_role ⇒ 涵蓋 SELECT(把它寫明的人不該被擋)',
         'ALTER TABLE public.widgets ENABLE ROW LEVEL SECURITY;\n'
         'CREATE POLICY p ON public.widgets FOR ALL TO service_role USING (true);',
         [], {}),
        ('⑫ 該紅 [M4-正]:政策被 -- 註解掉 ⇒ 它沒有真的建(地面真相 0 列)',
         'ALTER TABLE public.widgets ENABLE ROW LEVEL SECURITY;\n'
         '-- CREATE POLICY p ON public.widgets FOR SELECT TO service_role USING (true);',
         ['public.widgets'], {}),
        ('⑬ 該綠 [M4-反]:ALTER TABLE 被註解掉 ⇒ 那張表根本沒開 RLS, 不該誤擋',
         '/* ALTER TABLE public.widgets ENABLE ROW LEVEL SECURITY; */',
         [], {}),
        ('⑭ 該紅 [M5]:TO public_readers 不是 public ⇒ 逐個全等比, 不是子字串',
         'ALTER TABLE public.widgets ENABLE ROW LEVEL SECURITY;\n'
         'CREATE POLICY p ON public.widgets FOR SELECT TO public_readers USING (true);',
         ['public.widgets'], {}),
        ('⑮ 該紅 [M6]:audit.widgets 與 public.widgets 是兩張表, schema 不能砍',
         'ALTER TABLE audit.widgets ENABLE ROW LEVEL SECURITY;\n'
         'CREATE POLICY p ON public.widgets FOR SELECT TO service_role USING (true);',
         ['audit.widgets'], {}),
        # 🔴 這一格的期望值我第一版寫錯了(2026-08-26):我原本期望回報那條豁免。
        #    而它【不該】被回報 —— 豁免只對「本檔真的開了 RLS 的表」有意義,
        #    audit.widgets 這檔沒開它 ⇒ 那條豁免是懸空的, 印出來只會讓人以為它生效了。
        #    ⇒ 錯的是期望值不是程式。留下這一格與這段字, 因為【下一個人會犯同一個錯】。
        ('⑯ 該紅 [M6-豁免]:豁免寫 audit.widgets 不該把 public.widgets 一起放掉, 也不該被印成生效',
         'ALTER TABLE public.widgets ENABLE ROW LEVEL SECURITY;\n'
         '-- RLS-GATE-EXEMPT: audit.widgets -- 那張表是另一個 schema 的稽核表',
         ['public.widgets'], {}),
        ('⑰ 該紅 [M7]:唯一一條政策是 AS RESTRICTIVE ⇒ 它不給權, 只會再收緊',
         'ALTER TABLE public.widgets ENABLE ROW LEVEL SECURITY;\n'
         'CREATE POLICY p ON public.widgets AS RESTRICTIVE FOR SELECT TO service_role USING (true);',
         ['public.widgets'], {}),
        ('⑱ 該紅 [N2]:豁免藏在 dollar-quoted 字串裡 ⇒ 那不是註解, 不算',
         'ALTER TABLE public.widgets ENABLE ROW LEVEL SECURITY;\n'
         "DO $$ BEGIN RAISE NOTICE 'x'; END $$;\n"
         '$tag$\n-- RLS-GATE-EXEMPT: public.widgets -- 藏在字串裡的假豁免\n$tag$',
         ['public.widgets'], {}),
        ('⑲ 該紅 [N3]:豁免理由只有一個標點 ⇒ 那不是理由',
         'ALTER TABLE public.widgets ENABLE ROW LEVEL SECURITY;\n'
         '-- RLS-GATE-EXEMPT: public.widgets -- .',
         ['public.widgets'], {}),
        ('⑳ 該紅 [字串分號]:USING 的字串常值裡有分號 ⇒ 挖空後才切得對',
         'ALTER TABLE public.widgets ENABLE ROW LEVEL SECURITY;\n'
         "CREATE POLICY p ON public.widgets FOR SELECT TO authenticated\n"
         "  USING (note = 'a;b;c');",
         ['public.widgets'], {}),
        ('㉑ 該綠 [DO 區塊]:政策寫在 DO $$ 的字串裡 ⇒ 字面在而政策沒建 ⇒ 那張表也沒開 RLS',
         "DO $$ BEGIN EXECUTE 'CREATE POLICY p ON public.widgets FOR SELECT TO service_role USING (true)'; END $$;",
         [], {}),
        ('㉒ 該紅 [codex 5]:表名帶連字號的 quoted identifier',
         'ALTER TABLE public."audit-log" ENABLE ROW LEVEL SECURITY;',
         ['public.audit-log'], {}),
        ('㉓ 該紅 [codex 5]:點號兩側有合法空白',
         'ALTER TABLE "public" . "widgets" ENABLE ROW LEVEL SECURITY;',
         ['public.widgets'], {}),
        ('㉔ 該紅 [codex 6]:TO not_service_role 不是 service_role',
         'ALTER TABLE public.widgets ENABLE ROW LEVEL SECURITY;\n'
         'CREATE POLICY p ON public.widgets FOR SELECT TO not_service_role USING (true);',
         ['public.widgets'], {}),
        ('㉕ 該紅 [codex 6]:政策名就叫 "on" ⇒ 不可以咬到名字裡那個 on',
         'ALTER TABLE public.widgets ENABLE ROW LEVEL SECURITY;\n'
         'CREATE POLICY "on" ON public.gadgets FOR SELECT TO service_role USING (true);',
         ['public.widgets'], {}),
        ('㉖ 該紅 [codex 7]:ON 與 FOR 之間的區塊註解裡有分號',
         'ALTER TABLE public.x ENABLE ROW LEVEL SECURITY;\n'
         'CREATE POLICY p ON public.x /* ; */ FOR SELECT TO authenticated USING (true);',
         ['public.x'], {}),
        ('㉗ 該紅 [codex 8]:裸的(非註解)RLS-GATE-EXEMPT 不算豁免',
         'ALTER TABLE public.widgets ENABLE ROW LEVEL SECURITY;\n'
         'RLS-GATE-EXEMPT: public.widgets -- 沒有寫成註解的假豁免',
         ['public.widgets'], {}),
    ]
    fails = 0
    for name, sql, want_missing, want_ex in W:
        got_missing, got_ex = check(sql)
        ok = got_missing == want_missing and got_ex == want_ex
        if not ok:
            fails += 1
        print(f"  {'PASS' if ok else '🔴 FAIL'}  {name}")
        if not ok:
            print(f"        期望 缺={want_missing} 豁免={want_ex}")
            print(f"        實得 缺={got_missing} 豁免={got_ex}")
    fails += selftest_git()
    print(f"── selftest: {len(W) + GIT_WORLDS - fails} PASS / {fails} FAIL")
    return 0 if fails == 0 else 1


GIT_WORLDS = 5


def selftest_git():
    """🔴 上面那 27 格全部只測【純函式】, 而 codex must-fix 10 講得對:

    **「10 格全綠, 但沒有測到正式執行路徑, 無法發現最嚴重的 index／工作樹洞。」**
    ⇒ 這一段在拋棄式 git repo 裡真的 stage 東西、真的跑一遍主路徑。
    ⇒ 五個世界裡有兩個是【該綠】的 —— 少了它們, 一支「一律回紅」的實作也會過。
    """
    import shutil, tempfile
    # 🔴 git hook 會 export GIT_DIR / GIT_INDEX_FILE / GIT_WORK_TREE。
    #    不清掉的話, 拋棄式 repo 裡的每一個 git 指令都會【被拉回真正的那棵樹】——
    #    2026-08-26 第一發 commit 就是這樣紅的: 自檢去讀真 repo 的 20260505130758,
    #    而它不在那個假 index 裡 ⇒ 5 格全紅。
    #    📌 **手動跑 --selftest 是綠的, 只有走 hook 那條路才紅** ——
    #      兩條路的環境不同, 而自檢自己不會告訴你它現在在哪一條上。
    env = {k: v for k, v in os.environ.items()
           if not k.startswith('GIT_')}
    F = 'supabase/migrations/29990101000000_selftest.sql'
    BAD = 'ALTER TABLE public.gadgets ENABLE ROW LEVEL SECURITY;\n'
    GOOD = BAD + 'CREATE POLICY p ON public.gadgets FOR SELECT TO service_role USING (true);\n'
    root = os.path.dirname(os.path.abspath(__file__))
    me = os.path.join(root, os.path.basename(__file__))
    worlds = [
        ('A 該紅:index 壞', BAD, None, False, 1),
        ('B 該綠:index 好、工作樹壞 ⇒ 證明它真的讀 index, 不是一律變紅', GOOD, BAD, False, 0),
        ('C 該紅:index 壞、工作樹好(codex must-fix 1)', BAD, GOOD, False, 1),
        ('D 該紅:staged 之後工作樹那支被刪掉(cf must-fix M2)', BAD, None, True, 1),
        ('E 該綠:改動【既有】檔而沒有新增 ENABLE ⇒ 不為歷史舊債開火(codex must-fix 9)',
         None, None, False, 0),
    ]
    fails = 0
    tmp = tempfile.mkdtemp(prefix='rlsgate-selftest-')
    try:
        for name, idx, wt, rm_wt, want in worlds:
            d = os.path.join(tmp, name[0])
            os.makedirs(os.path.join(d, 'supabase', 'migrations'))
            os.makedirs(os.path.join(d, 'scripts'))
            shutil.copy(me, os.path.join(d, 'scripts', os.path.basename(__file__)))
            q = dict(cwd=d, capture_output=True, env=env)
            subprocess.run(['git', 'init', '-q'], **q)
            subprocess.run(['git', 'config', 'user.email', 's@s'], **q)
            subprocess.run(['git', 'config', 'user.name', 's'], **q)
            p = os.path.join(d, F)
            if idx is None:
                # 世界 E:先讓那支【欠債的】migration 成為歷史, 再只改它的註解
                with open(p, 'w', encoding='utf-8') as fh:
                    fh.write(BAD)
                subprocess.run(['git', 'add', F], **q)
                subprocess.run(['git', '-c', 'core.hooksPath=', 'commit', '-qm', 'base'], **q)
                with open(p, 'a', encoding='utf-8') as fh:
                    fh.write('-- 改一個錯字\n')
                subprocess.run(['git', 'add', F], **q)
            else:
                with open(p, 'w', encoding='utf-8') as fh:
                    fh.write(idx)
                subprocess.run(['git', 'add', F], **q)
                if wt is not None:
                    with open(p, 'w', encoding='utf-8') as fh:
                        fh.write(wt)
                if rm_wt:
                    os.remove(p)
            r = subprocess.run([sys.executable, os.path.join(d, 'scripts', os.path.basename(__file__))],
                               cwd=d, capture_output=True, env=env)
            ok = r.returncode == want
            if not ok:
                fails += 1
            print(f"  {'PASS' if ok else '🔴 FAIL'}  [git] {name}")
            if not ok:
                print(f"        期望 rc={want}  實得 rc={r.returncode}")
                print('        ' + r.stdout.decode('utf-8', 'replace').strip()[:200])
                print('        ' + r.stderr.decode('utf-8', 'replace').strip()[:200])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return fails


def main():
    if '--selftest' in sys.argv:
        sys.exit(selftest())

    goto_repo_root()
    self_protect()
    files = staged_migrations()
    if not files:
        print('── rls-service-role-policy-gate:這顆 commit 沒有動到 supabase/migrations/*.sql ⇒ 不適用')
        return 0

    bad, exempted = [], []
    for status, f in files:
        # A = 新增的 migration ⇒ 整份檢查。M/R = 改了既有的 ⇒ 只看這顆 commit 新增的行,
        # 否則一個修錯字的人會被那支檔 2026-05 就欠著的舊債擋住(codex must-fix 9)。
        missing, ex = check(staged_content(f), None if status == 'A' else added_lines(f))
        bad += [(f, t) for t in missing]
        exempted += [(f, t, why) for t, why in ex.items()]

    for f, t, why in exempted:
        print(f'   ⚪ 豁免  {t}  ({os.path.basename(f)}) —— {why}')

    if not bad:
        print(f'✅ rls-service-role-policy-gate:本次 staged 的 {len(files)} 支 migration 都沒有'
              f'「開了 RLS 而 service_role 讀不到」的表')
        return 0

    print('', file=sys.stderr)
    print('🔴 RLS 守門:有表開了 row level security, 而同一支檔內沒有 service_role 讀得到的 SELECT 政策', file=sys.stderr)
    for f, t in bad:
        print(f'   · {t}    ({f})', file=sys.stderr)
    print('', file=sys.stderr)
    print('   為什麼要擋:今天它照樣會動 —— 因為 service_role 帶 BYPASSRLS。', file=sys.stderr)
    print('   那是【平台角色屬性】, 不是你寫的政策 ⇒ 拿掉它的那一天, 這張表會變成【後台讀到空的】,', file=sys.stderr)
    print('   而空資料看起來像正常資料, 沒有人會叫。正式庫現在已經有 42 張這樣的表。', file=sys.stderr)
    print('', file=sys.stderr)
    print('   兩條路(都在【那支 migration 自己檔內】做, 沒有集中清單可以改):', file=sys.stderr)
    print('     1. 補政策:', file=sys.stderr)
    print('          CREATE POLICY <表>_select_service_role ON public.<表>', file=sys.stderr)
    print('            FOR SELECT TO service_role USING (true);', file=sys.stderr)
    print('     2. 真的不需要 ⇒ 同檔加一行, 理由要寫得出「誰會讀它」:', file=sys.stderr)
    print('          -- RLS-GATE-EXEMPT: <表> -- <理由>', file=sys.stderr)
    print('', file=sys.stderr)
    print('   自檢:  python3 scripts/rls-service-role-policy-gate.py --selftest', file=sys.stderr)
    return 1


if __name__ == '__main__':
    sys.exit(main())
