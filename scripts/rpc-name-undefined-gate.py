#!/usr/bin/env python3
"""rpc-name-undefined-gate.py — app 叫的那個函式名, 在我們的 migrations 裡有沒有定義。

🔴 為什麼有這一道(板列 ⟦db-DOGBLOCKORNOT⟧ / ⟦db-DOGBLINDBRANCH⟧):
   `deploy-order-gate.sh` 的第三個世界 —— **migration 只活在別條 agent 分支上** ——
   它印 `0 blocked / 0 pending`, 而**真的乾淨**那個世界印的**一模一樣**。
   🔬 2026-09-07 `-ship` 在拋棄式 repo 重現:③ 與 ④ **rc 都是 0**。
   ⇒ 🎯 而它放行的正是那道閘存在的理由:app 呼叫一個線上不存在的函式 ⇒ **PGRST202**
     (2026-08-07 A9h:壞約 8 小時)。

✅ **主視窗 `-f1` 2026-09-07 裁的判準(不是掃分支)**:
   「app 新增的 `.rpc()` 名字, 在 **HEAD 的全部 migrations**(含 `pcm:ddl-into-vc` 補版控型)裡
     **零定義** ⇒ 擋 —— 它只可能在**別條線**或**根本不存在**, 兩種都不該上 prod。」
   🛑 **為什麼不掃分支**(同一裁定):本地 `agent/line-*` **17 條**且隨時在動、
      遠端 `origin/agent/line-*` **0 條** ⇒ **兩種判準都壞**。

🟡 **現在是【只報不擋】**(`REPORT_ONLY`)—— 主視窗指定:先跑一批看誤擋數,
   **0 誤擋才轉擋**。⚪ 2026-09-07 首次全樹量:**零定義 = 0 個**(46 個 rpc 名字全有定義;定義側 **238** 個物件名 ——
   ⚪ 修好跨 schema 之後從 235 變 238)。

⚠️ **它答不出 / 已知盲區**:
  · 只認 `.rpc('字面')` —— **變數組出來的名字看不到**(方向:少報)。
  · 定義側只認 `CREATE [OR REPLACE] FUNCTION|VIEW|MATERIALIZED VIEW` ——
    用 `DO $$ … $$` 動態建的、或 `ALTER … RENAME` 改過名的, 看不到(方向:**多報**)。
    ⚪ 而 R1 實查:`EXECUTE $fndef$CREATE OR REPLACE FUNCTION …$fndef$` 那種
       **仍然抓得到**(本正則無錨點、不要求語句起首);migrations 裡
       `ALTER FUNCTION … RENAME` **0 命中** ⇒ 改名那條路今天沒有實例。
  · 它**不問正式庫** —— 一個「migrations 裡沒有而線上真的有」的函式會被它叫。
    🔴 那正是**誤擋**的來源, 而今天的讀數是 0。

用法:`python3 scripts/rpc-name-undefined-gate.py [--selftest]`
退出碼:0 = 掃完(只報不擋)· 1 = selftest 失敗 · 2 = 分母是 0(尺沒接上)
"""
import glob
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP = {'node_modules', '.next', 'dist', 'build', '.turbo'}
RPC = re.compile(r"\.rpc\(\s*['\"]([a-z_][a-z0-9_]*)['\"]")
DEF = re.compile(
    r'CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|VIEW|MATERIALIZED\s+VIEW)\s+'
    # 🔴 任意 schema 前綴, 不是只有 `public.`(R1 nit):
    #    舊版寫 `(?:public\.)?` 而它是【可選】的 ⇒ 遇到 `pcm_cron.invoke_cron_route`
    #    只捕到 **schema 名** `pcm_cron`, 真正的函式名整個漏掉。
    #    ⚪ 今天不影響讀數(app 零處呼叫非 public schema 的 rpc), 而**轉擋之後會誤擋**。
    r'(?:IF\s+NOT\s+EXISTS\s+)?(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)', re.I)


def defined_names(sql_texts):
    """回 {物件名} —— 🔴 先剝 SQL 行註解:註解裡的 CREATE 不算定義。"""
    out = set()
    for s in sql_texts:
        out |= {m.group(1).lower()
                for m in DEF.finditer(re.sub(r'--.*$', '', s, flags=re.M))}
    return out


def used_names(ts_texts):
    """回 {rpc 名: {出處}} —— 🔴 先剝 TS 行註解:註解裡提到不算在用。"""
    out = {}
    for name, s in ts_texts:
        for m in RPC.finditer(re.sub(r'//.*$', '', s, flags=re.M)):
            out.setdefault(m.group(1), set()).add(name)
    return out


def selftest():
    bad = 0

    def ck(n, got, want):
        nonlocal bad
        ok = got == want
        print(f"  {'✅' if ok else '🔴'} {n}(得 {got} 期望 {want})")
        bad += 0 if ok else 1

    d = defined_names(["CREATE FUNCTION public.zz_ok() RETURNS void AS $$ $$;"])
    u = used_names([('a.ts', "await sb.rpc('zz_ok'); await sb.rpc('zz_missing')")])
    ck('① 有定義的不叫 · 沒定義的叫', sorted(set(u) - d), ['zz_missing'])
    ck('② 定義側只在 -- 註解裡 ⇒ 不算定義',
       defined_names(["-- CREATE FUNCTION public.zz_ok() RETURNS void AS $$ $$;"]), set())
    ck('③ 使用側只在 // 註解裡 ⇒ 不算在用',
       sorted(used_names([('a.ts', "// await sb.rpc('zz_x')")])), [])
    ck('④ CREATE OR REPLACE VIEW 也算定義',
       'zz_v' in defined_names(['CREATE OR REPLACE VIEW public.zz_v AS SELECT 1;']), True)
    # 🔴 ⑤ 第一版是套套邏輯(隨便一個沒餵進去的字當然不出現)—— R1 指出無鑑別力。
    #    換成兩格【有咬合力】的:跨 schema 要撈到函式名(不是 schema 名),
    #    而 `CREATE TABLE` 不得被當成函式/view 定義。
    ck('⑤ 跨 schema:要撈到函式名, 不是 schema 名',
       sorted(defined_names(['CREATE FUNCTION pcm_cron.zz_job() RETURNS void AS $$ $$;'])),
       ['zz_job'])
    ck('⑥ 負對照:CREATE TABLE 不算函式/view 定義',
       defined_names(['CREATE TABLE public.zz_tbl (id int);']), set())
    print(f'  ⇒ {6 - bad} PASS / {bad} FAIL')
    return 1 if bad else 0


if '--selftest' in sys.argv[1:]:
    sys.exit(selftest())

mig = sorted(glob.glob(os.path.join(ROOT, 'supabase/migrations/*.sql')))
defined = defined_names(
    [io.open(f, encoding='utf-8', errors='replace').read() for f in mig])

ts = []
for base in ('apps', 'packages'):
    for dp, dirs, files in os.walk(os.path.join(ROOT, base)):
        dirs[:] = [x for x in dirs if x not in SKIP]
        for fn in files:
            if fn.endswith(('.ts', '.tsx')):
                p = os.path.join(dp, fn)
                ts.append((os.path.relpath(p, ROOT),
                           io.open(p, encoding='utf-8', errors='replace').read()))

# 🔴 分母是 0 【不是乾淨】—— 那與「尺沒接上」印同一個東西
if not mig or not ts:
    print(f'🔴 分母是 0(migrations {len(mig)} · ts {len(ts)})⇒ 尺沒接上', file=sys.stderr)
    sys.exit(2)

used = used_names(ts)
missing = sorted(n for n in used if n not in defined)
print(f'rpc-name-undefined:migrations {len(mig)} 支 ⇒ 定義 {len(defined)} 個物件名'
      f' · app {len(ts)} 支 ⇒ 用到 {len(used)} 個 rpc 名')
if missing:
    for n in missing:
        print(f'  🔴 `{n}` 在我們的 migrations 裡【零定義】—— 出處 {sorted(used[n])[:2]}')
    print('  ⇒ 它只可能在【別條線】或【根本不存在】, 兩種都不該上 prod(PGRST202)。')
    print('  🟡 只報不擋 —— 主視窗 2026-09-07 裁:先看誤擋數, 0 誤擋才轉擋。')
else:
    print('  ✅ 沒有「app 在叫而 migrations 裡沒有」的名字')
sys.exit(0)
