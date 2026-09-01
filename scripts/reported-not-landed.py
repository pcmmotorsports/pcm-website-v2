#!/usr/bin/env python3
"""碼裡那句「已回報 / 已立 backlog」有沒有帶一個【查得到的落點】。

為什麼有這支
------------
2026-09-01 線【帳號】`-7a` 在 `apps/admin/src/lib/shipping/shipment-actions.ts:377`
撞到一句逐字「已回報主視窗立 backlog。**不要以為這裡漏做。**」——
而板上查無那一列。

🔴 而那句話的作用不是記錄, 是【關掉下一個人的尋找動作】:
   它下一句就是「不要以為這裡漏做」, 而那正是來找它的人會讀到的最後一句。
📌 形狀:**「我報過了」與「它落地了」是兩個宣稱, 而碼裡只寫得下前者。**

🛑 而這條規矩【已經有人寫過了, 兩次, 兩種說法】:
   · `apps/admin/src/lib/products/product-repository.ts:220`
     逐字「寫『已回報主視窗』不算落點, **通道不是載體**(R2 nit)」
   · `supabase/migrations/20260821113000_m4b_legal_terms_v4_search_logging.sql:90-91`
     逐字「那是一句**沒有編號的承接宣稱**…… 有編號才查得到。」並當場改成 `#804`
   ⇒ 規矩存在、名字存在、修正過至少兩次 —— 而 2026-09-01 實測套用率是 8/30。
   ⇒ 📌 所以這支不是「再寫一次規矩」, 是把它變成一個可以跑的東西(機制優先律)。

它擋不住什麼(先讀這一節, 不要拿它的數字當結論)
------------------------------------------------
🔴 **甲/乙/丙的界線機械分不出來。** 2026-09-01 逐條開檔分堆的結果:
      甲 真缺口而沒掛號        7
      乙 交給 Sean 的【決策題】 10   ← 它們不該用 backlog 號掛
      丙 對象是 OD(外部)      3    ← 我們板上不會有它們的號
      丁 指到【窗名】不是號      1    ← 而那個窗名今晚就死了(全隊改名)
   ⇒ 本工具會把【乙+丙】那 13 條一起報出來 ⇒ 假報率可能 13/21。
🔴 **而假報會被修, 而最省力的修法是【把那句話拿掉】** ——
   那會讓資訊消失, 而本工具會變綠。
   ⇒ ⇒ **所以這支【刻意不掛 pre-commit】。它是一支手動盤點工具, 不是一道閘。**
   ⇒ 要掛之前先量它的假報率, 而那要人逐條開檔, 沒有捷徑。

⚠️ 其他射程限制
   · 只掃 apps / packages / scripts 的 .ts .tsx 與 supabase/migrations/*.sql
     ⇒ docs/ 與 .md 不在分母裡
   · 「落點」只認兩種:板錨 ⟦…⟧ / backlog 號 #NNN
     🔴 而【窗名一定不算】(例 `-48`)—— 窗名是收訊人不是落點, 而它會過期
     ⛔ ~~第一版還認日期與 pcm-* 專案名~~ ⇒ 實測當場多放行 2 條真缺口(見 LANDING 那段註解)
     ⚠️ ⇒ 所以丙堆(對象是 OD)本工具【分不出來】, 它會被報進「沒有落點」那一堆。這是已知誤報。
   · 整行被 ~~…~~ 劃掉的視為【已撤回】, 不計
   · 上下文窗 = 前 3 行 + 後 1 行。落點寫在更遠的地方 ⇒ 本工具看不到 ⇒ 會誤報
"""
from __future__ import annotations
import glob, io, re, sys

CLAIM = re.compile(
    r'(已回報\s*(主視窗|OD|Sean)|已回報。|已回報,|已回報$|已上報|已交主視窗|已立\s*backlog|已回報主視窗)'
)
# 🔴 少認一種就會把守規矩的人算成違規(2026-09-01 實測:只認 ⟦…⟧ 會把 8 條做對的判成違規)。
# ⛔ ~~而我第一版還認【日期 YYYY-MM-DD】與【pcm-* 專案名】~~ —— 🔴 那是錯的, 而它【立刻多報了 2 條「已落地」】:
#    `scripts/rpm-partial-report.ts:22` 與 `20260820100000…:403` 兩條靠【附近剛好有一個日期】過關,
#    而那兩條我逐條開檔判的是【甲 真缺口而沒掛號】。
# 📌 ⇒ **一個日期是【什麼時候】, 不是【去哪裡查】。而這個 repo 的註解幾乎每一段都帶日期**
#    ⇒ 拿它當落點 = 幾乎全部放行 ⇒ **一把會安靜地印出好消息的尺。**
# 🔵 ⇒ OD 那一族(丙堆)也拿掉:`pcm-` 開頭的字在本 repo 到處都是(pcm-website-v2 / pcm-admin …)
#    ⇒ 它們該用別的方式分, 不是靠一個會誤命中的樣式。
LANDING = re.compile(r'(⟦[a-zA-Z0-9-]+⟧|#\d{2,4})')
# 窗名長這樣, 而它【不算落點】
WINDOW_NAME = re.compile(r'`-[0-9a-z]{2}`')
STRUCK = re.compile(r'~~.*~~')

GLOBS = ('apps/**/*.ts', 'apps/**/*.tsx', 'packages/**/*.ts', 'scripts/**/*.ts',
         'supabase/migrations/*.sql')


def collect() -> list[str]:
    out: list[str] = []
    for g in GLOBS:
        out += glob.glob(g, recursive=True)
    return [f for f in out if '/node_modules/' not in f and '/.next/' not in f]


def scan(files: list[str]):
    claims, landed, bare, retracted = [], [], [], []
    for f in files:
        try:
            lines = io.open(f, encoding='utf-8', errors='replace').read().split('\n')
        except OSError:
            continue
        for i, line in enumerate(lines, 1):
            if not CLAIM.search(line):
                continue
            claims.append((f, i, line.strip()))
            if STRUCK.search(line):
                retracted.append((f, i, line.strip()))
                continue
            ctx = '\n'.join(lines[max(0, i - 4):i + 1])
            # 窗名不算落點 ⇒ 先把它從上下文拿掉再判
            ctx_no_win = WINDOW_NAME.sub('', ctx)
            (landed if LANDING.search(ctx_no_win) else bare).append((f, i, line.strip()))
    return claims, landed, bare, retracted


def selftest() -> int:
    import tempfile, os
    bad = 0
    cases = [
        ('🟢 正對照 沒帶落點', '// 已回報主視窗立 backlog。不要以為這裡漏做。', 'bare'),
        ('🟢 正對照 帶 backlog 號', '// 缺口已立 backlog `#518`', 'landed'),
        ('🟢 正對照 帶板錨', '// 已回報主視窗立 backlog(錨 ⟦b4-XX1⟧)', 'landed'),
        ('🔴 窗名不算落點', '// 已回報主視窗 `-48`(那一格歸後台那條線)', 'bare'),
        ('🔵 撤回的不計', '// ~~另一片工,已回報。~~', 'retracted'),
        ('🔴 日期不算落點', '// 2026-08-28 那一發之後, 偏離本身已回報主視窗。', 'bare'),
        ('🔴 專案名不算落點', '// pcm-website-v2 這一側已回報主視窗立 backlog。', 'bare'),
        ('🔵 負對照 沒有宣稱', '// 這一行完全沒有那種句子, 只是一句註解', 'none'),
    ]
    d = tempfile.mkdtemp()
    for n, (label, body, expect) in enumerate(cases):
        p = os.path.join(d, 'c%d.ts' % n)
        io.open(p, 'w', encoding='utf-8').write(body + '\n')
        c, l, b, r = scan([p])
        got = ('none' if not c else 'retracted' if r else 'landed' if l else 'bare')
        ok = got == expect
        bad += 0 if ok else 1
        print('  %s %-22s 期望 %-9s 實得 %s' % ('✅' if ok else '🔴', label, expect, got))
    print('selftest %s(%d 格, %d 紅)' % ('GREEN' if bad == 0 else 'RED', len(cases), bad))
    return 1 if bad else 0


def main() -> int:
    if '--selftest' in sys.argv:
        return selftest()
    files = collect()
    claims, landed, bare, retracted = scan(files)
    print('掃了 %d 支檔(apps / packages / scripts 的 .ts .tsx + supabase/migrations/*.sql,'
          ' 排除 node_modules 與 .next)' % len(files))
    print('上報宣稱          %d 行' % len(claims))
    print('  已撤回(~~劃掉~~) %d' % len(retracted))
    print('  帶得到落點        %d' % len(landed))
    print('  🔴 沒有落點       %d' % len(bare))
    for f, i, s in bare:
        print('    %s:%d\n        %s' % (f, i, s[:120]))
    print()
    print('🛑 這個數字【不是缺陷數】—— 逐條開檔分堆才知道。2026-09-01 那一次:')
    print('   甲 真缺口 7 · 乙 決策題 10 · 丙 對象是 OD 3 · 丁 指到窗名 1')
    print('   ⇒ 而乙+丙【不該掛 backlog 號】⇒ 本工具會把它們一起報出來。')
    print('🔴 而假報會被修, 而最省力的修法是把那句話拿掉 ⇒ 資訊消失而本工具變綠。')
    print('⇒ 所以它刻意不掛 pre-commit。要掛之前先量假報率, 而那要人逐條開檔。')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
