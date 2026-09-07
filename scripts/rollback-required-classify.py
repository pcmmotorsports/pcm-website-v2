#!/usr/bin/env python3
# ══════════════════════════════════════════════════════════════════════════════
# rollback-required-classify.py —— ⟦db-NOROLLBACKARTIFACT⟧ 關閉條件①的【判準】
#
# 🛑 它答的是「哪些 migration 【必須】有回頭路」, 不是「哪些【已經】有」。
#    那兩個都是分母、都在講 rollback, 而它們回答的是相反的問題。
#    (`-db` 2026-09-07 量的 19 = 已經有的;本支量的是必須有的。)
#
# 🔴 判準來源不是我發明的 —— 逐字取自 CLAUDE.md 鐵則 12 的六類「高風險」,
#    因為「出事要能退」與「commit 前要對抗審查」問的是同一件事:這支改動壞掉會不會很貴。
#    ⇒ 判準與既有制度同源, 不是第二套標準。
#
# 🛑 **它是【上界】不是【實數】**:字面掃描會把註解裡談到那些字的也算進來。
#    ⇒ 每一類都印「剝註解前 / 剝註解後」兩個數(今晚全艦四次同族的坑)。
#
# ⚠️ 它【不】判斷那份回頭路寫得對不對 —— 那是 rollback-drill.sh 的事。
#    本支只答「該有沒有」。
# ══════════════════════════════════════════════════════════════════════════════
import re, sys, pathlib, json

ROOT = pathlib.Path(__file__).resolve().parent.parent
MIG  = ROOT / 'supabase' / 'migrations'

# 六類 —— 命中任一 ⇒ 必須有回頭路。每一類的 pattern 都要能說出「它為什麼危險」。
RULES = [
    ('②權限', r'\b(GRANT|REVOKE|ALTER\s+DEFAULT\s+PRIVILEGES|ALTER\s+ROLE|CREATE\s+POLICY|DROP\s+POLICY|ALTER\s+TABLE\s+\S+\s+(ENABLE|DISABLE)\s+ROW\s+LEVEL)\b'),
    ('③結構', r'\b(DROP\s+(TABLE|COLUMN|CONSTRAINT|TYPE|INDEX)|ALTER\s+TABLE\s+\S+\s+(ADD|DROP|ALTER)\s+COLUMN|ALTER\s+TYPE)\b'),
    ('③大量寫入', r'^\s*(UPDATE|DELETE\s+FROM|INSERT\s+INTO)\s'),
]
# 🔴 **「錢」不是【觸發】條件, 是【嚴重度】標籤** —— 這一格我第一版寫錯, 訂正在此:
#    ⛔ ~~提到 order_manual_refunds / payments / wallet … ⇒ 必須有回頭路~~
#    🛑 那會把【只是 SELECT 一張金流表】的 migration 也算進來 ⇒ 第一版得到 352 支, 而那個數沒有人用得下去。
#    ✅ 不可逆性來自 **DDL 與 DML**, 不來自「碰到哪一張表」。
#    ⇒ 錢只用來標【同一支已經因結構/權限/大量寫入而命中】的嚴重度, 不自己觸發。
MONEY = r'\b(order_manual_refunds|payments?|refunds?|wallet|price_store|price_by_tier|settlement)\b'

def strip_sql_comments(t):
    t = re.sub(r'/\*.*?\*/', '', t, flags=re.S)       # 區塊註解
    t = re.sub(r'^\s*--.*$', '', t, flags=re.M)        # 整行 --
    t = re.sub(r'--(?=(?:[^\']*\'[^\']*\')*[^\']*$).*$', '', t, flags=re.M)  # 行尾 --(不在字串裡)
    return t

def down_artifact_for(version):
    """回頭路產物三個位置(2026-09-07 db 量到第三個, 原本只認兩個):
       ① scripts/<版本>-down.sql
       ② supabase/rollbacks/<版本>*.sql —— 命名不一致:13 支 `-rollback.sql` · 1 支 `_down.sql`
          ⇒ 所以這裡用 `<版本>*` 不用固定尾綴;寫死任一種尾綴都會少算另一種。
       ③ 信箱貼板 <N>r_<版本>_還原_災難用.sql
       🔴 少一個位置 ⇒ 覆蓋率被【低估】, 而低估的方向沒有症狀:
          沒有人會去查一支「被判成缺回頭路」的 migration 是不是其實有。"""
    if (ROOT / 'scripts' / f'{version}-down.sql').exists():
        return 'scripts'
    for p in (ROOT / 'supabase' / 'rollbacks').glob(f'{version}*.sql'):
        return 'supabase/rollbacks'
    mbox = pathlib.Path.home() / 'pcm-mailbox'
    for p in mbox.glob(f'貼板-*/*r_{version}_*.sql'):
        return 'mailbox'
    return None

def main():
    files = sorted(MIG.glob('*.sql'))
    rows, tot_raw, tot_stripped = [], 0, 0
    for f in files:
        raw = f.read_text(encoding='utf-8', errors='replace')
        stripped = strip_sql_comments(raw)
        hit_raw  = [n for n, p in RULES if re.search(p, raw,      re.I | re.M)]
        hit_strp = [n for n, p in RULES if re.search(p, stripped, re.I | re.M)]
        if hit_strp and re.search(MONEY, stripped, re.I | re.M):
            hit_strp = hit_strp + ['①錢']
        if hit_raw:  tot_raw += 1
        if hit_strp: tot_stripped += 1
        if hit_strp:
            ver = f.name.split('_')[0]
            rows.append((ver, f.name, hit_strp, down_artifact_for(ver)))

    print(f'migration 總數           {len(files)}')
    print(f'必須有回頭路 剝註解前     {tot_raw}')
    print(f'必須有回頭路 剝註解後     {tot_stripped}   ← 這個才是分母')
    print(f'  🛑 兩個數的差 {tot_raw - tot_stripped} 支 = 只在【註解裡】談到那些字的')
    have = [r for r in rows if r[3]]
    print()
    print(f'✅ 已有回頭路             {len(have)}')
    print(f'🔴 缺回頭路               {len(rows) - len(have)}   ← 這個是缺口')
    if len(rows):
        print(f'   涵蓋率 {len(have)}/{len(rows)} = {100*len(have)//len(rows)}%')
    print()
    print('── 缺回頭路的(版本號 · 命中哪幾類)──')
    for ver, name, hits, _ in [r for r in rows if not r[3]][:40]:
        print(f'  {ver}  {"/".join(hits)}')
    n_missing = len(rows) - len(have)
    if n_missing > 40:
        print(f'  …還有 {n_missing - 40} 支(只印前 40)')
    print()
    print('🛑 射程:本支只答「該不該有」, 不答「那份回頭路對不對」(那是 rollback-drill.sh)。')
    print('🛑 它是【上界】—— 字面掃描仍可能把字串常數裡的字算進來。')

def selftest():
    """兩個世界要印不同的東西, 而且要看得到它讀了什麼。"""
    ok = 0; fail = 0
    def ck(label, got, want):
        nonlocal ok, fail
        if str(got) == str(want): ok += 1;  print(f'  PASS {label} = {got}')
        else:                     fail += 1; print(f'  FAIL {label} = {got}, 期望 {want}')
    # ① 剝註解:一個字只出現在註解裡 ⇒ 剝後不該命中
    ck('註解裡的 GRANT 剝後零命中',
       bool(re.search(RULES[0][1], strip_sql_comments('-- GRANT SELECT ON x TO y;\nSELECT 1;'), re.I|re.M)), False)
    # ② 正對照:同一個字在碼裡 ⇒ 剝後仍命中
    ck('碼裡的 GRANT 剝後仍命中',
       bool(re.search(RULES[0][1], strip_sql_comments('GRANT SELECT ON x TO y;'), re.I|re.M)), True)
    # ③ 負對照:現造的字 ⇒ 任何一類都不該命中
    ck('現造字 zzq_nowhere 零命中',
       any(re.search(p, 'zzq_nowhere_token;', re.I|re.M) for _, p in RULES), False)
    # ④ 分母不是 0(尺要是活的)
    n = len(list(MIG.glob('*.sql')))
    ck('讀得到 migration(>0)', n > 0, True)
    print(f'  🔬 我讀了 {n} 支 migration · 判準 {len(RULES)} 類')
    print(f'{ok} PASS / {fail} FAIL')
    return 1 if fail else 0

if __name__ == '__main__':
    sys.exit(selftest() if '--selftest' in sys.argv else main())
