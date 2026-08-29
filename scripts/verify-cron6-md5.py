#!/usr/bin/env python3
"""⟦b4-CRON6⟧ 片2 的 md5 自檢 —— 而它防的是一個【真的發生過】的病。

2026-08-29:折 must-fix ① 時算出完成版 md5,接著折 must-fix ③ 把一段實測註解寫進
**函式體裡面** ⇒ 第二次折改掉了第一次折量的那個東西。同一個人、同一輪、同一支檔。
⇒ 首次 apply 會過(prosrc = L3a,在名單裡),而**重跑就 RAISE** ——
  而那支 migration 旁邊的註解逐字寫著「重跑冪等放行」。
📌 那行註解描述的是它【想要】的行為,不是它會有的行為。(`-b4` R3 抓到)

🔴 **本腳本自己帶正對照**:先拿 L3a 那支【已知 md5】驗抽法。
   少了那一步,一把壞掉的抽法與對的答案會印同一個綠 ——
   而那正是 `-b4` 自己第一發踩到的:它的 regex 命中註解裡的 `$fn$` 字面 ⇒ 抽到 3 個字元。

用法:  python3 scripts/verify-cron6-md5.py
       rc=0 一致 / rc=1 不一致(要更新那兩個字面)/ rc=2 抽法壞了(正對照沒過)
"""
import hashlib
import io
import re
import sys

L3A = 'supabase/migrations/20260809160000_m4b_lifecycle_l3a_expire_unpaid_orders_fn.sql'
CRON6 = 'supabase/migrations/20260828060000_m4b_b4cron6_expire_unpaid_orders_heartbeat.sql'
FN = 'pcm_cron.expire_unpaid_orders'
L3A_KNOWN = '456db40fd5f959b9d1b96af7cfc8d4d2'  # L3a 檔 :39 記的,2026-08-28 與正式庫逐 byte 相同


def body(path: str) -> str | None:
    """取 `AS $fn$` 與下一個 `$fn$` 之間那段 = PG 存進 prosrc 的東西。

    🔴 **從 `CREATE OR REPLACE FUNCTION <名>` 那一行開始找**,不要對全檔跑 regex ——
       檔裡的【註解】也含 `$fn$` 字面,對全檔跑會抽到註解那一段。
    """
    s = io.open(path, encoding='utf-8').read()
    i = s.find('CREATE OR REPLACE FUNCTION ' + FN)
    if i < 0:
        return None
    m = re.search(r'AS \$fn\$', s[i:])
    if not m:
        return None
    start = i + m.end()
    j = s.find('$fn$', start)
    return s[start:j] if j > 0 else None


def selftest() -> int:
    """`--selftest`:證明這把尺【會叫】,不只是「今天剛好綠」。

    🔴 而它演的是兩個世界,不是跑一次看綠 ——
       一把恆綠的尺與一把對的尺,在正常那一發上印同一個結果。
    """
    b = body(L3A)
    if b is None:
        print('🔴 selftest 失敗:抽不到 L3a 的函式體')
        return 2
    h = hashlib.md5(b.encode()).hexdigest()
    # 世界 A:該綠的綠
    if h != L3A_KNOWN:
        print(f'🔴 selftest 失敗:L3a 實算 {h} 與已知值不符 ⇒ 抽法壞了')
        return 2
    # 世界 B:該紅的紅 —— 動一個字元,md5 必須變
    if hashlib.md5((b + ' ').encode()).hexdigest() == h:
        print('🔴 selftest 失敗:加一個空白而 md5 沒變 ⇒ 這把尺是恆綠的')
        return 2
    # 世界 C:抽法壞掉時要能認出來(不是印「值過期了」)
    fake = '-- 這不是函式體'
    if 'sweeper_heartbeat' in fake or 'clock_timestamp' in fake:
        print('🔴 selftest 失敗:健全性檢查的判準自己就命中假輸入')
        return 2
    print('✅ selftest:三個世界都演過(該綠綠 / 動一字必變 / 假輸入認得出)')
    return 0


def main() -> int:
    if '--selftest' in sys.argv:
        return selftest()

    # ── 正對照:抽法對不對 ────────────────────────────────
    b = body(L3A)
    if b is None:
        print(f'🔴 rc=2 抽法壞了:{L3A} 裡找不到 {FN}')
        return 2
    got = hashlib.md5(b.encode()).hexdigest()
    if got != L3A_KNOWN:
        print(f'🔴 rc=2 抽法壞了 —— 正對照沒過\n'
              f'   L3a 實算 {got} (長度 {len(b)})\n'
              f'   而已知值 {L3A_KNOWN}\n'
              f'   ⇒ 【先修抽法,不要動那支 migration 的字面】')
        return 2
    print(f'✅ 正對照:L3a 長度 {len(b)} md5 {got} ⇒ 與已知值相符 ⇒ 抽法是對的')

    # ── 負對照:這把尺會不會動 ────────────────────────────
    if hashlib.md5((b + ' ').encode()).hexdigest() == got:
        print('🔴 rc=2 負對照失敗:加一個空白而 md5 沒變 ⇒ 這把尺是壞的')
        return 2
    print('✅ 負對照:末尾加一個空白 ⇒ md5 改變 ⇒ 這把尺會動')

    # ── 正題:完成版現值 vs 那支 migration 寫死的字面 ──────
    c = body(CRON6)
    if c is None:
        print(f'🔴 rc=2 抽法壞了:{CRON6} 裡找不到 {FN}')
        return 2
    # 🔴 **CRON6 那一側也要有自己的健全性檢查**(2026-08-29 突變抓到):
    #    上面的正對照只驗了【L3a 那一支】的抽法。而突變測試證明:
    #    把抽法弄壞(讓它從檔頭而不是從 `CREATE OR REPLACE` 開始找)⇒
    #    L3a 那側【碰巧仍然抽對】⇒ 正對照過關 ⇒ 而 CRON6 這側抽到別的東西
    #    ⇒ 本腳本會印 `rc=1 值過期了` —— **而它會叫下一個人去改一個對的字面。**
    #    📌 一把壞掉的尺印出「你的值錯了」,比印「我壞了」危險得多。
    #    ⇒ 判準:完成版的函式體【一定】含這兩個字串(它們是本片的存在理由)。
    for must in ('sweeper_heartbeat', 'clock_timestamp'):
        if must not in c:
            print(f'🔴 rc=2 抽法壞了 —— CRON6 側抽到的東西不含 `{must}`\n'
                  f'   (抽到 {len(c)} 個字元)⇒ 那不是完成版的函式體\n'
                  f'   ⇒ 【先修抽法,不要動那支 migration 的字面】')
            return 2
    now = hashlib.md5(c.encode()).hexdigest()
    src = io.open(CRON6, encoding='utf-8').read()
    if now in src:
        print(f'✅ 完成版:長度 {len(c)} md5 {now} ⇒ **那支 migration 裡有這個字面** ⇒ 一致')
        return 0
    print(f'🔴 rc=1 不一致 —— 那支 migration 的 allowlist 過期了\n'
          f'   完成版現值:長度 {len(c)} md5 {now}\n'
          f'   ⇒ 把 {CRON6} 裡那兩處字面(碼與註解)換成上面這個值\n'
          f'   ⚠️ 而【重跑冪等】會壞:首次 apply 過(prosrc=L3a),重跑就 RAISE')
    return 1


if __name__ == '__main__':
    sys.exit(main())
