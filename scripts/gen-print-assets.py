#!/usr/bin/env python3
"""產生 apps/admin/src/components/print/print-assets.ts —— 列印單據那兩張圖的 base64 常數。

為什麼要有這支:那支 .ts 的檔頭寫著「重新產生跑這一行」,而**一句指向不存在的腳本的說明,
比沒有說明糟** —— 它會讓下一個人以為有路可走, 然後手改那 12 萬字元的檔。

用法(在 repo 根):  python3 scripts/gen-print-assets.py
自檢:              python3 scripts/gen-print-assets.py --self-check

🔴 本腳本【不是】守門 —— 守門是 print-assets.test.ts(它當場重算並比對)。
   本腳本只負責產生;產生錯了由那道守門叫。
"""
import base64
import hashlib
import io
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, 'apps/admin/src/components/print/print-assets.ts')
SRC = [
    ('LOGO', 'apps/admin/public/print/logo-p2-bicolor.png'),
    ('QR', 'apps/admin/public/print/line-qr.png'),
]

HEADER = """// 🔴🔴 **這支檔是【產生出來的】—— 不要手改任何一個字元。**
//
// 重新產生(換過 png 之後跑這一行, 在 repo 根):
// ```
// python3 scripts/gen-print-assets.py
// ```
//
// ## 為什麼是「常數」而不是「執行期讀檔」(2026-08-29 線A;主視窗 `-06` 裁 D′)
//
// 出貨明細單原本用 `<img src='/print/logo-p2-bicolor.png' />` 走 HTTP 拿圖,
// 而 `proxy.ts` 的登入閘涵蓋 `public/` ⇒ **沒有 cookie 的請求會被 303**。
// ⇒ 員工用瀏覽器列印(帶 cookie)看得到;而 Sean 2026-08-23 拍的「伺服器渲染出圖」
//   那個請求【沒有任何人的 cookie】⇒ 必然拿不到。
// 🔴 而症狀是【圖不見了, 不是錯誤】—— 不報錯、三綠全綠(那兩顆 `<img>` 的 onError ⇒ 0)。
//
// ⚠️ **來源標記(2026-08-29 code-reviewer 抓到, §6-b「量到 vs 推出」)**:
//   · **量到的**:那兩顆 `<img>` 的 `onError` 命中 **0**(負對照 `className` ⇒ 144)
//     ⇒ 它證的是【拿不到圖時不會有東西叫】, **不是**【圖真的被 303 了】。
//   · **推出的(未複量)**:「沒有 cookie 的請求會被 303 / 必然拿不到」——
//     來源是下手窗 `-c8` 的一發量測 + 我讀 `proxy.ts` 的 matcher 與登入閘。
//     🔴 我自己那一發【沒跑成】:dev server 被 dev-db-guard 擋住, 五個路徑全印 `HTTP 000`
//        (連對照組也是)⇒ 那一發整個作廢, 不是證據。
//   · **缺哪一道檢查**:在一個【沒有 cookie 的請求】上實際拿到 303 —— 走
//     `scripts/admin-probe/up.sh`。⚠️ 而那支 probe 用 `ADMIN_DEV_BYPASS=1` ⇒ 登入閘是關的
//     ⇒ **它量不到這一格**;要量得換一條不 bypass 的路。
//   ✅ **而這一格【不改變本片的結論】**:圖改成內嵌常數之後, 它不再發出任何請求
//     ⇒ 303 成不成立都與它無關。⇒ 這是「修法比病因更確定」的一種。
//
// ⛔ **考慮過而【否決】的三案, 留著免得下一個人重新發明**:
//   · 在 `proxy.ts` matcher 排除 `print/`
//     🛑 而【列印頁本身的網址也是 /print/…】(`/print/orders/<id>/shipping/<sid>`)
//     ⇒ 那會把【客人姓名地址電話品項金額】那兩頁的登入閘一起關掉(鐵則 12②)。
//     ✅ 而 `proxy-matcher.test.ts` 逐字「排除清單=恰三項, 一項都不能多」⇒ 它會紅, 而它擋得對。
//   · 走 Next 靜態 image import(`import logo from './x.png'`)
//     🛑 實測:同一個 import 在兩個環境給【兩種形狀】—— vitest(Vite) ⇒ `typeof string`、
//        `.src` 是 `undefined`;Next build ⇒ `StaticImageData` 物件。**而 TypeScript 說它們一樣。**
//     ⇒ `<img src={logo.src}>` 在測試裡會 render 成 `src={undefined}`, 而 typecheck 全綠。
//     ⇒ 要救它得動 root `vitest.config.ts`(三個 app 共用)⇒ 代價遠超過兩張圖。
//   · server component 用 `fs.readFileSync` 讀 `public/`
//     🛑 它靠 Vercel 的 file tracing 把那兩個 png 追進容器 ⇒ **而本機永遠量不到那一格**
//        (本機 `public/` 一定在)⇒ 那是同一個母題:【本機有的東西, 容器沒有】。
//        ⚠️ 「本機永遠量不到」是**推的**:我沒有構造出一個本機缺檔的世界去證明它。
//        而它成立的理由是結構性的(本機跑的就是這棵樹), 不是量出來的。
//     📌 D 在它自己的層次上是對的(消掉了 HTTP 那一格), 而**病搬家了** ——
//        搬到一個更不容易量的地方。
//
// ## ⚠️ 而本案自己的失敗模式(先講, 再講守門)
// 有人換了 png ⇒ 這裡的常數不會跟著變 ⇒ **安靜地印舊 LOGO**。
// ✅ 守門 = `print-assets.test.ts`:**當場從 png 重算 base64 比對本檔**, 不一致就紅;
//    🔴 而它在【讀不到 png 時也要紅, 不得 skip】—— 一個「找不到就跳過」的測試,
//    在檔被刪掉時全綠, 那正是這一片在躲的那個失敗模式從測試那一側跑回來。
"""


def build() -> str:
    meta, parts = [], []
    for name, rel in SRC:
        p = os.path.join(REPO, rel)
        raw = io.open(p, 'rb').read()
        if not raw:
            raise SystemExit(f'🔴 {rel} 是空的 ⇒ 不產生(空的 base64 會安靜地變成一張看不見的圖)')
        meta.append((name, rel, len(raw), hashlib.sha256(raw).hexdigest()))
        parts.append((name, base64.b64encode(raw).decode('ascii')))

    out = [HEADER, '\n// 產生當下的來源指紋(重算時一併更新;守門測試不讀這裡, 它自己算)。\n']
    for name, rel, size, sha in meta:
        out.append(f'// {name}: {rel} · {size} bytes · sha256 {sha}\n')
    out.append('\n')
    for name, b64 in parts:
        out.append(f"export const {name}_DATA_URI =\n  'data:image/png;base64,{b64}';\n\n")
    return ''.join(out)


def self_check() -> None:
    """演兩個世界:①正常來源產得出來 ②來源不存在必須【炸】, 不得安靜產出空的。"""
    ok = build()
    assert 'data:image/png;base64,' in ok, '正常世界:產不出 data URI'
    assert len(ok) > 100_000, f'正常世界:產物只有 {len(ok)} 字元, 太短'
    print(f'  ✅ 正常世界:產出 {len(ok)} 字元、含兩個 data URI')

    saved = list(SRC)
    SRC[:] = [('LOGO', 'apps/admin/public/print/zz-does-not-exist.png')]
    try:
        build()
    except FileNotFoundError:
        print('  ✅ 負對照:來源不存在 ⇒ FileNotFoundError(有炸, 沒有安靜回空)')
    else:
        SRC[:] = saved
        raise SystemExit('🛑 負對照失敗:來源不存在竟然產得出來 ⇒ 本腳本不可信')
    SRC[:] = saved

    # 🔴 第三格(2026-08-29 code-reviewer 抓到的缺口):
    #    前兩格從頭到尾【沒有讀過 OUT】⇒ 「產生器改了而 .ts 沒重產」沒有任何人會叫。
    #    (而 package.json 那行白名單的 key 是這支 .py ⇒ 只有動這支才跑 ——
    #     換 png 不會觸發它, 那一格由 print-assets.test.ts 守, 不是由這裡守。)
    try:
        on_disk = io.open(OUT, encoding='utf-8').read()
    except FileNotFoundError:
        raise SystemExit(f'🛑 {OUT} 不存在 ⇒ 跑 python3 scripts/gen-print-assets.py 產生它')
    if on_disk != ok:
        raise SystemExit(
            '🛑 磁碟上的 print-assets.ts 與本腳本現在會產出的【不一樣】\n'
            f'   磁碟 {len(on_disk)} 字元 · 現在會產 {len(ok)} 字元\n'
            '   ⇒ 改法:python3 scripts/gen-print-assets.py(然後把它一起 commit)'
        )
    print(f'  ✅ 第三格:磁碟上的 .ts 與本腳本產出逐字相同({len(ok)} 字元)')
    print('  ✅ 自檢三格都過')


if __name__ == '__main__':
    if '--self-check' in sys.argv:
        self_check()
    else:
        content = build()
        io.open(OUT, 'w', encoding='utf-8').write(content)
        print(f'寫入 {OUT}\n  {len(content)} 字元 / {content.count(chr(10)) + 1} 行')
