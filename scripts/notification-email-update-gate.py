#!/usr/bin/env python3
"""有人給 `orders.notification_email` 加了一條【事後更新】的路 ⇒ 叫住他。

🔴 **為什麼這件事需要一道閘**(⟦f3-…⟧ 來源 = `-tidy` `4f368d930` 2026-09-07):
   全樹**零事後更新路徑** —— 而那是「**還沒有人做**」, 不是「**有東西擋著**」。
   ⇒ 📌 **下一個要加「客人改通知信箱」功能的人, 不會撞到任何紅燈。**

🛑 **而那個欄位是【刻意凍結】的, 不是漏掉的功能。**逐字證據在建表那支:
   `supabase/migrations/20260718120000_m4a_b1_orders_notification_email.sql:137` 的 COMMENT ——
   「訂單通知信箱**快照**(客人結帳當下填寫、**凍結於訂單層, 不隨會員檔變動**)」。
   ⇒ 🎯 **一條 UPDATE 路徑會把「快照」變成「可變欄位」, 而那是 B-0 PRD 的設計被推翻,
     不是一個 bug 被修好。**

✅ **本閘不禁止那件事** —— 它只保證**做的人知道自己在推翻什麼**。撞到之後要看的:
   ① `docs/specs/2026-07-18-b0-order-notification-email-prd.md` §3.1(欄位設計)
   ② **已寄出去的信** 與 訂單上顯示的信箱會不會對不起來(快照的意義就在這裡)
   ③ DB 的 CHECK 只是 **backstop**(可列印 ASCII / 254 **octet** / 禁 LINE 合成域),
      **真防線在 server 端的 canonical 正規化** ⇒ 新路徑有沒有繞過它。

🔵 **INSERT 不算** —— 結帳當下寫入正是它的設計。本閘只看【更新】。

⚪ 2026-09-07 基線:`UPDATE orders` 語句 **80** 條, 碰本欄的 **0** 條
   (正對照:同一把尺找 `workflow_status` ⇒ **2** ⇒ 尺是活的)。
   ⇒ 基線是 0 ⇒ **擋的成本是零**, 所以這道是**擋**不是只報。

退出碼:0 = 沒有新增的更新路徑 · 1 = selftest 失敗 · 3 = 抓到(擋)
        2 = **分母是 0**(一個候選檔都沒掃到)⇒ 尺沒接上, 不是乾淨
"""
import re
import subprocess
import sys

COL = 'notification_email'
# 🔴 **不要用 `\b`** —— 本 repo 的 grep/ugrep 對它**靜默不匹配**(2026-09-07 實測:
#    `\bupdate\b` 正對照回 **0**, 而 `update +public\.orders` 回 **44 支檔**)。
#    這裡用 python re 沒有那個問題, 而**樣式仍寫成不依賴 `\b` 的形狀**, 免得有人搬去 shell。
SQL_STMT = re.compile(r'update\s+(?:public\.)?orders\s(.*?);', re.I | re.S)
# ⚠️ **天花板**:TS 這一側用「`.update(`/`.upsert(` 之後 400 字元內出現欄名」近似 ——
#    它**看不懂巢狀括號**, 所以可能少報(欄名在 400 字元之外)也可能多報(同一段裡剛好提到)。
#    今天兩種的實測命中都是 0 ⇒ 不預先做 parser。**要收窄的人先量誤報數。**
# 🔴 **R1 逐條實測後的完整天花板清單(漏報方向, 今天真實碼庫全部 0 命中)**:
#    · `.update(payload)` —— 欄名走變數/helper, 原始碼看不到字面 ⇒ 漏
#    · `||` 串接組出來的動態 SQL(字面上 `orders` 不連續)⇒ 漏
#      (而 `EXECUTE format('UPDATE public.orders SET …')` **會**命中, R1 實測確認)
#    · `MERGE INTO orders … WHEN MATCHED THEN UPDATE SET …`(PG15+)⇒ 漏(repo 內零用法)
# 🔴🔴 **誤報方向的第二條(2026-09-07 主視窗全艦廣播, 同一形狀當天四次)**:
#    **`grep` / `LIKE` / `strpos` 都分不出【碼】與【註解】—— 而註解裡最常出現的,
#    正是你在找的那個字。**本閘掃的是 `.sql` 的**字面** ⇒ 一句寫在
#    `COMMENT ON … IS '…'` 或 `--` 裡的 `UPDATE orders SET notification_email …`
#    **會被算成命中**。
#    🔬 2026-09-07 當場量:含註解 **0** · 剝掉 `--` 與 `COMMENT ON` 整段後 **0** ⇒ **差值 0**
#      (正對照 同尺找 `workflow_status` ⇒ **2**, 尺是活的;負對照 現造欄名 ⇒ **0**)
#      ⇒ 📌 **今天沒有實例, 而【結構上的洞在】** —— 有人日後在註解裡寫那句就會誤報。
#    ✅ **而本閘【不修它】, 理由是方向**:本閘是**守門**不是**盤點** ——
#      守門容得下誤報(有人被叫住 30 秒), 盤點容不下(它的數字會變成別人的分母)。
#      🛑 同一天 `⟦f3-STATEGATESCOMMENT⟧` 那次就是**拿守門的樣式去做盤點** ⇒
#      印出 9 支具體檔名的漏報清單, 開檔核**全部是誤報**。
#    📌 **⇒ 上一次記住的若是【受詞】而不是【形狀】, 下一次換個受詞就會再踩**
#      —— 那個形狀在 `.sql` / `.ts` / `pg_proc.prosrc` / 產生出來的表上**完全一樣**。
#    ✅ R1 實測**確認會命中**的:CTE `WITH … UPDATE orders SET …` · `UPDATE orders o SET … FROM (…)`
#      · 跨多行的 `UPDATE\npublic.orders\nSET\n  <欄> = $1` · trigger 的 `NEW.<欄> :=`(本次補)
TS_CALL = re.compile(r'\.(?:update|upsert)\s*\((.{0,400})', re.S)
# 🔴🔴 **PL/pgSQL 的 trigger 賦值 —— code-reviewer R1 Important(2026-09-07)**:
#    `BEFORE UPDATE ... FOR EACH ROW` 的函式裡寫 `NEW.notification_email := ...`
#    **完全沒有 `UPDATE orders` 這幾個字** ⇒ 上面那條 `SQL_STMT` 一個字都不會說。
#    🛑 而那**不是刁鑽構造, 是這件事最典型的合法寫法之一**(reviewer 真的建了一支測到漏報)。
#    ⇒ 📌 **一道閘漏掉「最正常的那個寫法」, 它的 0 就沒有意義。**
# 🟡 **已知誤報, 而它是【想清楚的取捨】不是沒想到**(R2 nit, 2026-09-07):
#    `:?=` 也吃裸 `=` ⇒ `IF NEW.<欄> = OLD.<欄> THEN` 這種**只讀的比較**會被算成命中。
#    🛑 **分不開是真的** —— PL/pgSQL 裡 `NEW.col = x` 在 SET 子句是賦值、在 IF 裡是比較,
#      那是**語意**不是字面, 一條 regex 判不了。
#    ✅ **而方向是對的那一邊**:誤報 = 有人被叫住然後說「我只是在比較」(30 秒),
#      漏報 = 一條更新路徑安靜上線(這道閘存在的唯一理由落空)。
#    ⚠️ ⇒ 這一格**是把已知行為寫成期望值**(⑪), 而它與「沒想清楚的規格」的差別在這段註解:
#      **取捨寫得出來、方向說得出來, 才叫取捨。**
TRIGGER_ASSIGN = re.compile(r'\bnew\s*\.\s*' + COL + r'\s*:?=', re.I)


def sql_offends(text):
    """SQL 兩種寫法都要看:①`UPDATE orders … ;` 的 SET 子句 ②trigger 裡的 `NEW.<欄> :=`。

    🔴 ② 是 R1 補的 —— 少了它, 一支 `BEFORE UPDATE` trigger 可以整條繞過本閘而零訊號。
    """
    hits = [m.start() for m in SQL_STMT.finditer(text) if COL in m.group(1)]
    hits += [m.start() for m in TRIGGER_ASSIGN.finditer(text)]
    return sorted(set(hits))


def ts_offends(text):
    """TS:`.update(` / `.upsert(` 之後的近距離出現 ⇒ 命中。純函式。"""
    return [m.start() for m in TS_CALL.finditer(text) if COL in m.group(1)]


def offends(path, text):
    if path.endswith('.sql'):
        return sql_offends(text)
    if path.endswith(('.ts', '.tsx')):
        return ts_offends(text)
    return []


def _run(args):
    r = subprocess.run(args, capture_output=True, text=True)
    return (r.returncode == 0, r.stdout)


def candidates(staged):
    if staged:
        ok, out = _run(['git', 'diff', '--cached', '--name-only', '--diff-filter=ACMR'])
    else:
        ok, out = _run(['git', 'ls-files', 'supabase', 'apps', 'packages'])
    if not ok:
        return None
    return [p for p in out.split('\n') if p.endswith(('.sql', '.ts', '.tsx'))]


def read(path, staged):
    # 🔴 `--staged` 要讀 **index**, 不是工作樹 —— 否則「兩個數來自不同的檔」
    #    (同 `board-state-consistency.py` 那支記過的教訓)。
    if staged:
        ok, out = _run(['git', 'show', ':' + path])
        return out if ok else None
    try:
        return open(path, encoding='utf-8', errors='ignore').read()
    except OSError:
        return None


def selftest():
    bad = 0

    def ck(name, got, want):
        nonlocal bad
        if got != want:
            bad += 1
        print(('  ✅ ' if got == want else '  🔴 ') + name
              + ('' if got == want else f'  得 {got!r} 期望 {want!r}'))

    ck('① UPDATE 碰到它 ⇒ 命中',
       len(sql_offends(f'UPDATE public.orders SET {COL} = $1 WHERE id = $2;')), 1)
    ck('② UPDATE 別的欄 ⇒ 不命中',
       len(sql_offends('UPDATE public.orders SET workflow_status = 1;')), 0)
    # 🔴 ③ 是本閘最重要的一格:INSERT 是【設計】, 不是違規。
    #    少了它, 一個「掃到欄名就叫」的實作會把結帳那條路一起擋掉, 而那會擋住出貨。
    ck('③ INSERT 帶那個欄 ⇒ 不命中(結帳當下寫入是它的設計)',
       len(sql_offends(f'INSERT INTO public.orders ({COL}) VALUES ($1);')), 0)
    ck('④ 同一段裡先 UPDATE 別的、後面才提到欄名(跨語句)⇒ 不命中',
       len(sql_offends(f'UPDATE public.orders SET a = 1; SELECT {COL} FROM public.orders;')), 0)
    ck('⑤ TS .update({…欄名…}) ⇒ 命中',
       len(ts_offends(f'.update({{ {COL}: next }})')), 1)
    # 🔴 ⛔ ~~原 ⑥ 是 `.select(...)` ⇒ 不命中~~ —— **那是恆真的**(R1 nit):
    #    `TS_CALL` 只認 `.update(`/`.upsert(`, 任何不含那兩個字面的輸入都不會命中
    #    ⇒ 它測的是 regex 的字面結構, 不是「讀 vs 寫」的語意判斷。
    #    換成一個**真的分得出讀寫**的:同一句裡兩者都在, 只有寫那半該算。
    ck('⑥ 同一行既有 .select 也有 .update ⇒ 只算 update 那半(1 處不是 2)',
       len(ts_offends(f'.select("{COL}").update({{ {COL}: v }})')), 1)
    # ⑦ 負對照:現造欄名不得憑空出現。
    # 🔴 ⑨⑩ 守 R1 補的 trigger 形狀 —— **加了樣式而沒有格子, 就是我這一小時剛學到的那件事。**
    ck('⑨ trigger 賦值 NEW.<欄> := ⇒ 命中(它整段沒有「UPDATE orders」這幾個字)',
       len(sql_offends('BEGIN NEW.' + COL + ' := lower($1); RETURN NEW; END;')), 1)
    ck('⑩ 負對照:讀 NEW.<欄> 而不賦值 ⇒ 不命中',
       len(sql_offends('IF NEW.' + COL + ' IS NULL THEN RETURN NEW; END IF;')), 0)
    ck('⑪ 已知誤報:NEW.<欄> = OLD.<欄> 的【比較】也會命中(fail-safe 方向, 見上面註解)',
       len(sql_offends('IF NEW.' + COL + ' = OLD.' + COL + ' THEN NULL; END IF;')), 1)
    ck('⑦ 負對照:現造欄名 ⇒ 0',
       len(sql_offends('UPDATE public.orders SET zqx8never_email = $1;')), 0)
    ck('⑧ 副檔名不對的檔一律不看(避免 .md 裡的範例被當成碼)',
       len(offends('docs/x.md', f'UPDATE public.orders SET {COL} = 1;')), 0)
    print(f'  ⇒ {11 - bad} PASS / {bad} FAIL')
    return 1 if bad else 0


def main():
    if '--selftest' in sys.argv:
        sys.exit(selftest())
    staged = '--staged' in sys.argv
    files = candidates(staged)
    if files is None:
        print('🔴 git 查詢失敗 ⇒ 沒有掃, 不是乾淨', file=sys.stderr)
        sys.exit(2)
    # 🔵 `--staged` 且這批沒有 .sql/.ts ⇒ **這一發沒有東西可看**, 那不是「尺沒接上」。
    if not files:
        if staged:
            sys.exit(0)
        print('🔴 分母是 0(一個候選檔都沒掃到)⇒ 尺沒接上, 不是乾淨', file=sys.stderr)
        sys.exit(2)
    hits = []
    for p in files:
        t = read(p, staged)
        if t is None:
            continue
        for off in offends(p, t):
            hits.append(f'{p}:{t[:off].count(chr(10)) + 1}')
    if not hits:
        print(f'[notification-email-update] 掃 {len(files)} 支 ⇒ 0 條更新路徑')
        sys.exit(0)
    print(f'🔴 有人給 orders.{COL} 加了【事後更新】的路({len(hits)} 處):', file=sys.stderr)
    for h in hits:
        print(f'   {h}', file=sys.stderr)
    print('\n🛑 那個欄位是【刻意凍結的快照】, 不是漏掉的功能 ——'
          '\n   `supabase/migrations/20260718120000_m4a_b1_orders_notification_email.sql:137`'
          ' 的 COMMENT 逐字:'
          '\n   「訂單通知信箱快照(客人結帳當下填寫、**凍結於訂單層, 不隨會員檔變動**)」'
          '\n\n✅ 本閘不禁止你做, 它只要你知道自己在推翻什麼。撞到之後要看三件:'
          '\n   ① docs/specs/2026-07-18-b0-order-notification-email-prd.md §3.1'
          '\n   ② 已寄出去的信 與 訂單上顯示的信箱會不會對不起來(快照的意義就在這裡)'
          '\n   ③ DB 的 CHECK 只是 backstop(可列印 ASCII / 254 octet / 禁 LINE 合成域),'
          '\n      **真防線在 server 端 canonical 正規化** ⇒ 你的新路徑有沒有繞過它',
          file=sys.stderr)
    sys.exit(3)


if __name__ == '__main__':
    main()
