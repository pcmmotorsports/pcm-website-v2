#!/usr/bin/env python3
"""⟦b4-LOCK1⟧ 守門:會拿 `ACCESS EXCLUSIVE` 的 rollback 腳本必須**先**設好 `lock_timeout`。

🔴 **它擋的是什麼**(板列 `docs/launch-todo.md:695`, 線C `-24` 2026-08-28 實測, 拋棄式 PG 17.10):
   一個連線開著交易在讀那張表 ⇒ 另一個連線拿不到 `ACCESS EXCLUSIVE`, 擋在那裡;
   而 `psql` **預設沒有 `lock_timeout`** ⇒ **無限等**。
   🛑 **而「很慢」與「卡在鎖上」在那個畫面上是同一件事** —— 兩者都是一個不動的游標。
   🔴 **時序最毒**:半夜沒人用 ⇒ 20ms;而**要用回退的那一天, 通常是白天**。

══ 本檔 v2 —— v1 被 code-reviewer 打穿八條, 每一條都是【該紅而印綠】。留痕: ══
  ⛔ ~~只認 `DROP TABLE / ALTER TABLE / TRUNCATE / CREATE INDEX / DROP INDEX`~~
     🔬 reviewer 對 PG 17.10 實測(`pg_locks` join `pg_class`, 同一 backend):
       `DROP TRIGGER` ⇒ 那張表的 **AccessExclusiveLock** · `DROP POLICY` ⇒ **同樣是表的 AEL**
       · `CREATE OR REPLACE VIEW` ⇒ 那支 view 的 AEL · 負對照 `SELECT 1;` ⇒ 零 lock 列(尺會動)
     ⇒ 📌 **我原本寫「物件級拿的不是那張表的 AEL」是【錯的】** —— 而它讓
       `scripts/20260815040000-down.sql:58` 的 `DROP TRIGGER … ON public.orders`(全站最忙的表之一)
       被判成「不歸我管」。
  ⛔ ~~`LOCK TABLE … IN ACCESS EXCLUSIVE MODE` 不在清單裡~~ —— 那是**唯一把「我要拿 AEL」寫成字面**的語句。
  ⛔ ~~只問「檔裡有沒有那一行」~~ ⇒ 三種假綠:
     ① `SET lock_timeout` 寫成 **`CREATE FUNCTION` 的屬性子句**(`scripts/452-down.sql:37`)——
        它只在那支函式執行時生效, **管不到同檔後面的 `DROP INDEX` / `ALTER TABLE`**。
     ② 寫在 DDL **後面** ⇒ 太晚。
     ③ 用 `SET LOCAL` 而檔裡**沒有 `BEGIN;`** ⇒ psql 只給 WARNING, **完全不生效**。
  ⛔ ~~認不得 `PERFORM set_config('lock_timeout', …)`~~ —— 那是本 repo 已被 codex 審過的慣例
     (`scripts/20260829190000-down.sql:49`)⇒ 舊版會對一支**寫對了**的檔印紅。
  ⛔ ~~自己寫剝註解~~ ⇒ 區塊註解 `/* … */` 裡的 `SET` 會被算數。
     ✅ 改接 `scripts/sql-comment-strip-audit.py` 的 `lex_strip`(它實作了 PG 四條規則:
       `--` / `/* */` 巢狀 / `'…''…'` / `$tag$…$tag$`)。**不要再寫一個更弱的。**
  ⛔ ~~selftest 有一格恆真~~:`ck(t == len(paths))` 而 `scan()` 回的就是 `len(paths)`
     ⇒ 那一格在任何世界都綠。✅ 改成數**真的開成功幾支**。

🔵 **射程**:本閘掃 **兩個目錄** —— `scripts/*-down.sql` 與 `supabase/rollbacks/*.sql`。
   ⛔ ~~本閘只掃 `scripts/*-down.sql`~~ ⇒ 🔴 **那句話在寫下的時候是完整的描述, 而它當晚就過期了**:
     2026-09-06 21:3x 合 `origin/dev` 之後 dev 上多了 `supabase/rollbacks/`(12 支)——
     用同一把尺去掃, **其中 2 支含 AEL 語句而沒有 lock_timeout**。
   ⇒ 📌 **閘綠與「沒有問題」在畫面上是同一件事**, 而那時它綠的分母裡沒有那一整個目錄。
   ⚠️ **仍然不涵蓋**:migration 本體、SQL Editor 手貼、以及**下一個還沒出生的目錄**
     ⇒ 🛑 加新目錄的人要回來改這裡, 而**沒有任何東西會提醒他**(已知缺口, 不是漏寫)。
   物件級的鎖問題**已知存在**(見上面 reviewer 的實測), 而本閘不涵蓋 migration 本體與 SQL Editor 手貼。
   ⇒ 📌 **不要拿本閘的綠當「這支回退不會卡」的保證** —— 它只答「該設的地方設了沒」。

🛑 **它的第二個分母**:「它掃得到嗎」本檔答得出;「它會被叫嗎」由 `package.json` 的 lint-staged 決定。
   ⛔ ~~v1 檔頭寫「現在沒有被任何東西自動叫」~~ ⇒ ✅ **同一顆 commit 已登記兩條**:
     · `scripts/down-script-lock-timeout-gate.py` ⇒ 改本檔就跑 `--selftest`
     · `scripts/*-down.sql`                        ⇒ 改任何一支回退腳本就跑真掃
   ⇒ 📌 那句話**在被寫下的那一刻就開始過期** —— reviewer 也是這樣說的:「它馬上就會不對」。
   ⚠️ 而 lint-staged 只在【那些檔被 staged】時叫它 ⇒ **`git merge` 不跑 pre-commit**
     ⇒ 別人 merge 進來的 down.sql 它掃不到(那正是 `⟦db-MERGEBLINDGATE⟧` 那一族;
       本閘是掃整棵樹的形狀, 可以接進 `harvest-chain` 的 `REPORT_ONLY`, **而那要主視窗裁**)。

用法:
  python3 scripts/down-script-lock-timeout-gate.py
  python3 scripts/down-script-lock-timeout-gate.py --selftest
rc: 0 = 全過 · 1 = 有檔缺 · 2 = 用法/環境錯
"""
import glob
import importlib.util
import io
import os
import re
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ── 接既有的 lexer, 不自己寫 ────────────────────────────────────────────────
_spec = importlib.util.spec_from_file_location(
    'sql_comment_strip_audit', os.path.join(REPO, 'scripts', 'sql-comment-strip-audit.py'))
if _spec is None or _spec.loader is None:
    print('🔴 載不到 scripts/sql-comment-strip-audit.py ⇒ ENV-FAIL(這【不是】通過)', file=sys.stderr)
    sys.exit(2)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
lex_strip = _mod.lex_strip

# 會拿【那張表】ACCESS EXCLUSIVE 的語句(reviewer 2026-09-06 對 PG 17.10 逐條量過)
AEL = re.compile(
    r'\b(DROP\s+TABLE|ALTER\s+TABLE|TRUNCATE|CREATE\s+(UNIQUE\s+)?INDEX|DROP\s+INDEX'
    r'|DROP\s+TRIGGER|DROP\s+POLICY|CREATE\s+POLICY|ALTER\s+POLICY'
    r'|LOCK\s+TABLE|LOCK\s+(?!TABLE))', re.I)
# 設 timeout 的兩種寫法:`SET [LOCAL] lock_timeout` 與 `set_config('lock_timeout', …)`
SET_TO = re.compile(r'\bSET\s+(LOCAL\s+)?lock_timeout\b', re.I)
CFG_TO = re.compile(r"set_config\s*\(\s*'lock_timeout'", re.I)
# `CREATE … FUNCTION … AS $tag$` 的【屬性區】—— 這一段裡的 SET 是函式屬性, 不是語句
FN_ATTR = re.compile(r'\bCREATE\s+(OR\s+REPLACE\s+)?FUNCTION\b[\s\S]*?\bAS\s+\$', re.I)
BEGINTX = re.compile(r'^\s*BEGIN\s*;', re.I | re.M)


# 🔴 **字串字面裡的字不是語句** —— 實測 `scripts/20260905260000-down.sql:55` 逐字
#    `CROSS JOIN (VALUES ('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),` ⇒ 那個 `TRUNCATE`
#    是**資料**, 而舊版把它當成一句會拿 AEL 的 DDL ⇒ 假陽性。
# 🛑 而**只對 AEL 那一半挖空字面** —— timeout 那一半不行:
#    `set_config('lock_timeout', …)` 的判準**就住在字面裡**, 挖掉它會變成假陰性。
#    ⇒ 📌 同一份碼, 兩個問題要用兩個視圖。
STRLIT = re.compile(r"'(?:[^']|'')*'")


def analyse(body):
    """回 (需不需要, 有沒有保護, 原因)。原因是給人讀的一句話。"""
    code = lex_strip(body)                    # 註解已剝掉, 字面還在
    # 🔴 **等長取代** —— `sub("''")` 會讓兩個視圖的位置對不起來, 而下面的 `ael_at` 是拿去跟
    #    `code`(沒挖空那份)的位置比的。實測 `sub("''")` 之後長度就變了 ⇒ 用同長度的空白填。
    code_nostr = STRLIT.sub(lambda m: "'" + ' ' * (len(m.group(0)) - 2) + "'", code)
    m_ael = AEL.search(code_nostr)
    if not m_ael:
        return False, True, '沒有會拿 AEL 的語句 ⇒ 不進分母'
    ael_at = m_ael.start()   # 🔵 兩個視圖等長 ⇒ 這個位置拿去跟 code 比是對的

    # 🔴 屬性區裡的 SET 不算 —— 它只在那支函式執行時生效
    attr_spans = [(m.start(), m.end()) for m in FN_ATTR.finditer(code)]

    def in_attr(pos):
        return any(a <= pos < b for a, b in attr_spans)

    best = None
    for rx in (SET_TO, CFG_TO):
        for m in rx.finditer(code):
            if in_attr(m.start()):
                continue
            if best is None or m.start() < best[0]:
                best = (m.start(), m.group(0))
    if best is None:
        why = '有 AEL 語句而【沒有】任何 lock_timeout 設定'
        if any(in_attr(m.start()) for m in SET_TO.finditer(code)):
            why += '(檔裡那個 SET 是 CREATE FUNCTION 的屬性子句 ⇒ 管不到後面的 DDL)'
        return True, False, why
    if best[0] > ael_at:
        return True, False, 'lock_timeout 設在【第一個 AEL 語句之後】⇒ 太晚'
    # `SET LOCAL` 需要交易 —— 沒有 BEGIN 的話 psql 只給 WARNING, 完全不生效
    if re.match(r'SET\s+LOCAL', best[1], re.I) and not BEGINTX.search(code):
        return True, False, '用了 `SET LOCAL` 而檔裡沒有 `BEGIN;` ⇒ psql 只給 WARNING, 不生效'
    return True, True, 'ok'


def scan(paths):
    opened, need, missing = 0, 0, []
    for p in paths:
        try:
            body = io.open(p, encoding='utf-8').read()
        except OSError:
            continue
        opened += 1                       # 🔵 數【真的開成功幾支】, 不是 len(paths)
        req, ok, why = analyse(body)
        if not req:
            continue
        need += 1
        if not ok:
            missing.append((p, why))
    return opened, need, missing


def main_scan():
    paths = sorted(glob.glob(os.path.join(REPO, 'scripts', '*-down.sql'))
                   + glob.glob(os.path.join(REPO, 'supabase', 'rollbacks', '*.sql')))
    opened, need, missing = scan(paths)
    print('══ ⟦b4-LOCK1⟧ rollback 鎖超時守門 ══')
    print(f'   glob 找到 {len(paths)} 支 · 真的讀成功 {opened} 支 ⇒ ' +
          ('一致' if opened == len(paths) else '🔴 不一致 ⇒ 有檔讀不開, 這不是通過'))
    if opened != len(paths):
        return 2
    print(f'   其中含【會拿 AEL 的語句】{need} 支 ⇒ 只有這 {need} 支在分母裡')
    if not missing:
        print(f'   ✅ {need} 支全都在第一個 AEL 語句之前設好了 lock_timeout')
        return 0
    print(f'   🔴 缺 {len(missing)} 支:')
    for p, why in missing:
        print(f'      {os.path.relpath(p, REPO)} —— {why}')
    print("   修法:有 `BEGIN;` ⇒ `SET LOCAL lock_timeout = '5s';`(放在第一個 AEL 語句之前)")
    print("         沒有交易 ⇒ session 級 `SET lock_timeout = '5s';`")
    print("         在 DO 區塊裡 ⇒ `PERFORM set_config('lock_timeout', '5s', true);`")
    return 1


def selftest():
    cells, fails = 0, 0

    def ck(ok, label):
        nonlocal cells, fails
        cells += 1
        print(('  ✅ ' if ok else '  🔴 ') + label)
        if not ok:
            fails += 1

    W = {
        'a_無保護': "BEGIN;\nDROP TABLE public.zzq;\nCOMMIT;\n",
        'b_有保護': "BEGIN;\nSET LOCAL lock_timeout = '5s';\nDROP TABLE public.zzq;\nCOMMIT;\n",
        'c_物件級無表': "BEGIN;\nDROP FUNCTION public.zzq_fn(uuid);\nCOMMIT;\n",
        'd_只在行註解': "-- DROP TABLE public.only_a_comment;\nBEGIN;\nDROP FUNCTION public.f(uuid);\nCOMMIT;\n",
        'e_區塊註解裡的SET': "BEGIN;\n/* SET LOCAL lock_timeout = '5s'; */\nDROP TABLE public.zzq;\nCOMMIT;\n",
        'f_屬性子句': ("BEGIN;\nCREATE OR REPLACE FUNCTION public.f() RETURNS void\n"
                       "LANGUAGE sql\nSET lock_timeout = '5s'\nAS $f$ SELECT 1 $f$;\n"
                       "DROP INDEX public.zzq_idx;\nCOMMIT;\n"),
        'g_設在DDL之後': "BEGIN;\nDROP TABLE public.zzq;\nSET LOCAL lock_timeout = '5s';\nCOMMIT;\n",
        'h_SETLOCAL無交易': "SET LOCAL lock_timeout = '5s';\nDROP TABLE public.zzq;\n",
        'i_DROP TRIGGER': "BEGIN;\nDROP TRIGGER IF EXISTS t ON public.orders;\nCOMMIT;\n",
        'j_LOCK TABLE': "BEGIN;\nLOCK TABLE public.orders IN ACCESS EXCLUSIVE MODE;\nCOMMIT;\n",
        'k_set_config': ("BEGIN;\nDO $$ BEGIN\n  PERFORM set_config('lock_timeout','5s',true);\n"
                         "  LOCK TABLE public.orders IN ACCESS EXCLUSIVE MODE;\nEND $$;\nCOMMIT;\n"),
        'l_session級': "SET lock_timeout = '5s';\nALTER TABLE public.zzq DROP COLUMN c;\n",
        # 🔴 實檔實錘:20260905260000-down.sql:55 的 VALUES 裡有 'TRUNCATE' —— 那是資料不是語句
        'm_字面裡的DDL字': ("BEGIN;\nSELECT * FROM x CROSS JOIN (VALUES ('INSERT'),('TRUNCATE')) v(op);\n"
                            "DROP FUNCTION public.f(uuid);\nCOMMIT;\n"),
    }
    exp = {   # (需不需要, 有沒有保護)
        'a_無保護': (True, False), 'b_有保護': (True, True), 'c_物件級無表': (False, True),
        'd_只在行註解': (False, True), 'e_區塊註解裡的SET': (True, False), 'f_屬性子句': (True, False),
        'g_設在DDL之後': (True, False), 'h_SETLOCAL無交易': (True, False),
        'i_DROP TRIGGER': (True, False), 'j_LOCK TABLE': (True, False),
        'k_set_config': (True, True), 'l_session級': (True, True),
        'm_字面裡的DDL字': (False, True),
    }
    for name, body in W.items():
        req, ok, why = analyse(body)
        want = exp[name]
        ck((req, ok) == want, f'{name}:需要={req} 有保護={ok}(期望 {want[0]}/{want[1]})—— {why}')

    paths = sorted(glob.glob(os.path.join(REPO, 'scripts', '*-down.sql'))
                   + glob.glob(os.path.join(REPO, 'supabase', 'rollbacks', '*.sql')))
    opened, need, missing = scan(paths)
    # 🔵 分母格:**數真的開成功幾支**(v1 這一格是恆真的, reviewer 抓的)
    ck(opened == len(paths), f'分母格 讀成功 {opened} = glob {len(paths)}')
    ck(need > 0, f'分母格 需要保護的有 {need} 支(> 0 —— 是 0 的話上面每一格都在對空集合說話)')
    # 🔴 現造一支必紅的丟進真的那批 ⇒ 它必須被抓出來(證明真跑那條路也活著)
    with tempfile.TemporaryDirectory() as d:
        bad = os.path.join(d, 'zzq-down.sql')
        io.open(bad, 'w', encoding='utf-8').write(W['a_無保護'])
        _, n2, m2 = scan(paths + [bad])
        ck(len(m2) == len(missing) + 1 and any(p == bad for p, _ in m2),
           f'混進一支必紅的 ⇒ 缺數 {len(missing)} ⇒ {len(m2)}(真跑那條路會抓)')

    # 🔴 **模擬 lint-staged 的呼叫形狀** —— 它會把 staged 的檔路徑接在後面。
    #    v2 第一版對這種呼叫回 rc=2 ⇒ pre-commit 當場紅在自己身上。
    import subprocess as _sp
    _r = _sp.run([sys.executable, os.path.abspath(__file__),
                  os.path.join(REPO, 'scripts', '452b-down.sql')],
                 capture_output=True, text=True)
    ck(_r.returncode in (0, 1) and '不認得的參數' not in (_r.stdout + _r.stderr),
       f'lint-staged 形狀(帶檔路徑)⇒ rc={_r.returncode}(不得是 2「不認得的參數」)')
    _r2 = _sp.run([sys.executable, os.path.abspath(__file__), '--zzq-not-a-flag'],
                  capture_output=True, text=True)
    ck(_r2.returncode == 2, f'🔴 負對照:真的不認得的旗標 ⇒ rc={_r2.returncode}(期望 2 —— 證明上一格不是把什麼都放行)')

    EXPECT_CELLS = 18
    print(f'\n   跑了 {cells} 格 · 紅 {fails} 格 · 期望 {EXPECT_CELLS} 格')
    if cells != EXPECT_CELLS:
        print('   🔴 格數與期望不符(多或少)⇒ 有格沒跑到, 而少跑一格在畫面上沒有形狀')
        return 1
    if fails:
        return 1
    print(f'   ✅ {cells} 格全過')
    return 0


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--selftest':
        sys.exit(selftest())
    # 🔴 **lint-staged 會把 staged 的檔路徑接在後面** —— v2 第一版對它們回「不認得的參數」rc=2
    #    ⇒ 📌 **一道自己拒絕自己被呼叫的閘**(2026-09-06 實測:pre-commit 當場紅在這裡)。
    #    ✅ 存在的檔路徑一律忽略(本閘的語意是【掃全部】, 不是只掃 staged 的那幾支 ——
    #      一支被別人改壞的 down.sql 不會因為「這次沒 stage 到它」就不重要)。
    unknown = [a for a in sys.argv[1:] if not os.path.exists(a)]
    if unknown:
        print(f'🔴 不認得的參數:{unknown[0]}', file=sys.stderr)
        sys.exit(2)
    sys.exit(main_scan())
