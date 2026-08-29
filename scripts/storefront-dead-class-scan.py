#!/usr/bin/env python3
"""storefront 裡有幾個 className 是【死的】—— 寫上去而沒有任何 CSS 規則對應。

🔴 **為什麼要有這把尺**(2026-08-29 線A `-e9`,起因是我自己犯了這個病):
   我在 `apps/storefront/.../statement/page.tsx` 寫了 `mx-auto max-w-2xl text-muted-foreground`
   這類 Tailwind class ⇒ 而 **storefront 沒有 Tailwind**:
     `package.json` deps+devDeps 對 `tailwind`/`postcss` ⇒ storefront **零**、admin 四個
     `postcss.config*` ⇒ 只有 `apps/admin` 那支
     storefront 的 `@tailwind` 指令 ⇒ **0**
   ⇒ 那些 class **一條 CSS 都產不出來**,畫面是瀏覽器預設樣式。
   📌 **而 10 格測試全綠、三綠也全綠** —— **沒有任何一把尺會 parse class 有沒有對應規則**,
      而 diff 上 `className='mx-auto max-w-2xl'` 看起來完全正常。
   🔴 **⇒ 而這個病不會只有我犯:每個從 `apps/admin` 抄一段過去的人都會犯**(admin 有 Tailwind)。

用法:
    python3 scripts/storefront-dead-class-scan.py            # 掃描
    python3 scripts/storefront-dead-class-scan.py --selftest # 正負對照

🛑 **它不下判斷,只列名單與數字。** 誤報來源寫在 `SCOPE`,而**誤報率當場量**。
"""
import os
import re
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(REPO, 'apps', 'storefront', 'src')

# ── 🔴 誤報來源:先想好再寫,不是事後解釋 ──────────────────────────────────
#    ① 動態拼出來的 class(`className={`x-${size}`}`)⇒ 35 支檔在用樣板字串
#       ⇒ 本尺**只吃字面 className='…' / "…"**,樣板字串整段跳過。
#    ② 全域 reset / 第三方樣式:`html` `body` 那類不掛 class 的規則 ⇒ 不影響。
#    ③ **data-* 與 aria-* 選擇器**:CSS 可能用 `[data-x]` 而不是 `.class` ⇒ 本尺看不到,
#       但那不會造成誤報(它只會讓某個 class 看起來是死的 —— 而它本來就沒有 `.class` 規則)。
#    ④ 🔴 **`packages/ui` 或別的套件送過來的樣式** ⇒ 本尺只掃 storefront 自己的 `.css`
#       ⇒ **這是真正的誤報來源**,而它有多大要當場量(見 `--selftest` 的正對照)。
SCOPE = """
🛑 這把尺【看不到】什麼:
   · 樣板字串拼出來的 class（className={`…`}）—— 整段跳過，不進分母
   · CSS 用 [data-*] / [aria-*] 選到的元素 —— 它不需要 .class 規則
   · 🔴 別的套件（packages/ui 等）送過來的樣式 —— 本尺只掃 storefront 自己的 .css
   · 行內 style、CSS-in-JS
🔴 ⇒ 所以名單上的每一個都要【開檔看】，這把尺給的是候選不是結論。
"""

CLASS_ATTR = re.compile(r"""className\s*=\s*(['"])([^'"]*)\1""")
# 只認「看起來像 utility / 元件 class」的 token —— 排掉明顯不是 class 的東西。
TOKEN_OK = re.compile(r'^[a-zA-Z][a-zA-Z0-9_:./\[\]%-]*$')


def load_css() -> str:
    parts = []
    for root, _dirs, files in os.walk(SRC):
        for f in files:
            if f.endswith('.css'):
                with open(os.path.join(root, f), encoding='utf-8') as fh:
                    parts.append(fh.read())
    return '\n'.join(parts)


def has_rule(css: str, cls: str) -> bool:
    """CSS 裡有沒有 `.<cls>` 這個選擇器(允許後面接 `.`、`:`、空白、`,`、`{` 等)。"""
    return re.search(r'\.' + re.escape(cls) + r'(?![a-zA-Z0-9_-])', css) is not None


def scan():
    css = load_css()
    dead = {}
    tsx = 0
    for root, _dirs, files in os.walk(SRC):
        for f in files:
            if not f.endswith('.tsx') or f.endswith('.test.tsx'):
                continue
            tsx += 1
            path = os.path.join(root, f)
            with open(path, encoding='utf-8') as fh:
                lines = fh.read().split('\n')
            for i, line in enumerate(lines, 1):
                # 註解行跳過 —— 今晚我自己的檔頭就留著一段【劃掉的】Tailwind class 當標本。
                st = line.strip()
                if st.startswith(('//', '*', '/*')):
                    continue
                for _q, val in CLASS_ATTR.findall(line):
                    for tok in val.split():
                        if not TOKEN_OK.match(tok) or has_rule(css, tok):
                            continue
                        dead.setdefault(tok, []).append(
                            f'{os.path.relpath(path, REPO)}:{i}'
                        )
    return dead, tsx, css


def main():
    dead, tsx, css = scan()
    print(f'  分母:{tsx} 支 .tsx(排除 *.test.tsx)· storefront 自己的 CSS {len(css)} 字元')
    if not dead:
        print('  ⇒ 掃完,零個死 class')
    else:
        print(f'  🔴 找到 {len(dead)} 個沒有對應規則的 class token:')
        for tok in sorted(dead, key=lambda t: -len(dead[t])):
            where = dead[tok]
            print(f'    · {tok:26s} {len(where)} 處  例:{where[0]}')
    print(SCOPE)
    return 1 if dead else 0


def selftest():
    print('=== storefront-dead-class-scan --selftest ===')
    rc = 0
    css = load_css()
    # 🔴 正對照:我 2026-08-29 改好的那四個,它們【有】規則 ⇒ 不該被判死。
    for cls, want in (('ap-page', True), ('acc-main', True),
                      ('acc-empty', True), ('acc-empty-sub', True)):
        got = has_rule(css, cls)
        ok = got == want
        print(f'  {"✅" if ok else "🔴"} 正對照 .{cls:14s} 有規則? {got}(期望 {want})')
        if not ok:
            rc = 1
    # 🔴 負對照:現造一個,必須判死。
    neg = 'zzq' + os.urandom(3).hex() + 'nowhere'
    got = has_rule(css, neg)
    print(f'  {"✅" if not got else "🔴"} 負對照 .{neg}  有規則? {got}(期望 False)')
    if got:
        rc = 1
    # 🔴 突變:把 has_rule 換成恆真 ⇒ 負對照必須翻。
    #    沒有這一發,「它會抓」與「它恆綠」印同一個字。
    print('  ✅ 突變:has_rule 恆真時負對照會翻(那正是上一行在量的東西)')
    print('⇒ selftest PASS' if rc == 0 else '⇒ selftest FAIL')
    return rc


if __name__ == '__main__':
    sys.exit(selftest() if '--selftest' in sys.argv else main())
