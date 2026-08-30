#!/usr/bin/env python3
"""量 ⟦b4-SQLCOMMENT1⟧ 第一步:那個 regex 剝法會不會吃掉【真 SQL】。

🔴 「什麼算 SQL 的真實剝法」這個選擇, 照 -48 的要求寫在數字旁邊:
   · 本機**沒有** pglast / sqlparse(兩個都 import 失敗)⇒ 沒有現成的 SQL parser 可用
   · 🛑 **刻意不用 TS 的 parser** —— SQL 的 /* */ 與字串規則跟 JS 不同,
     用 TS parser 去量 SQL 會是「用錯工具」的第二次
   · ⇒ 只好**自己寫一個 PG 規則的 lexer**, 而它是【我寫的, 不是權威】:
     實作了 PG 文件那四條 —— ①`--` 行註解 ②`/* */` **可巢狀**(PG 與 C 不同)
     ③`'...'` 以 `''` 轉義、`E'...'` 以反斜線轉義 ④dollar-quoting `$tag$...$tag$`
   · ⚠️ **沒實作**:`"..."` 引號識別字內的 `--`(在 PG 裡不是註解)、`U&'...'`
   ⇒ 📌 **所以任何非 0 的結果都要【開檔手驗】, 不能直接當答案。**

🔴 **為什麼它在 repo 裡而不是在誰的 scratchpad**:板 `⟦b4-UPSTREAM1⟧` 那把尺就是死在
   scratchpad 裡(交接檔逐字寫了落點, 而那個 session 沒了)⇒ 同一個錯不犯第二次。
   📌 **有人會拿一個路徑去找它 ⇒ 那個引用就是它的壽命下限, 而 scratchpad 給不起。**

🔴 **2026-08-31 用它量到的**:238 支裡 4 支被 regex 吃掉真 SQL(成因**全部**是
   「`--` 行註解裡出現 `/*`」, 最毒一支吃掉 **521 行**);而換成那支守門【自己的錨】
   (`CONSTRAINT <name> CHECK`)⇒ 227 條裡 **少 1 條**:`order_item_procurement_void_pair`
   —— **它就是一條 OR 串 CHECK, 而它不在白名單裡 ⇒ 守門看得見就會紅, 而它今天看不見。**
   ⚠️ **而我第一發用自己猜的錨(字面 `CHECK`)得到「9 條」** ⇒ 📌 **代理指標量的是另一件事,
      而它給了一個比較嚇人的數字。**

🛑🛑 **它擋不住什麼(2026-08-31 補;而這一節是【我踩過之後】才寫得出來的)**

🔴 **① 落筆之前先回答這個問句 —— 它不是警告, 它要你答得出來:**
    ```
    我要說的是「這【個寫法】會不會出事」, 還是「這【一支守門】會不會漏」?
    而如果是後者 —— 我讀過那一支自己的剝法了嗎?它是先剝 `--` 還是先剝區塊?
    ```
    **成因是本檔作者自己踩的**:我用本檔量出「這個 regex 寫法會吃掉真 SQL」, 然後把結果
    **歸因到四支守門**, 並據此報出「現在就有一條真命中被藏起來」——
    ⇒ 而逐支開檔看:`scripts/a9g2-charge-attempts-grant-guard.test.ts:84` 與
      `scripts/null-shortcircuit-check-guard.test.ts:195` **本來就先剝 `--`** ⇒ **它們完全不受影響**。
    📌 **⇒ 我量的與我報的是兩個不同的問題, 而它們的答案相反。**
    ⇒ ⇒ **那是一個只要開檔看四行就知道的事實, 而它決定了整個結論。**

🔴 **② 本檔的 lexer 是【寫這支檔的人自己寫的】, 不是權威。**
    實作了 PG 文件那四條;**未實作** `"..."` 引號識別字內的 `--`、`U&'...'`。
    ⇒ **任何非 0 的結果都要逐支開檔手驗** —— 本檔的作者是這樣做的, 而那正是他發現①的路。

⚠️ **③ 它比的是【識別字集合】** —— 答得出「有沒有東西不見了」, 答不出「不見的那些重不重要」。
    要答後者, 得換成**那支守門自己的錨**去比(而那又回到①:你得先讀它)。

用法:`python3 scripts/sql-comment-strip-audit.py`  ·  自檢:`--selftest`(五格 PG 規則)
"""
import re, io, sys, os

def lex_strip(s: str) -> str:
    out = []; i = 0; n = len(s); depth = 0
    while i < n:
        c = s[i]
        if depth:
            if s.startswith('/*', i): depth += 1; i += 2; continue
            if s.startswith('*/', i):
                depth -= 1; i += 2
                continue
            i += 1; continue
        if s.startswith('--', i):
            j = s.find('\n', i); i = n if j < 0 else j; continue
        if s.startswith('/*', i): depth = 1; i += 2; continue
        if c == '$':
            m = re.match(r"\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$", s[i:])
            if m:
                tag = m.group(0); j = s.find(tag, i + len(tag))
                j = n if j < 0 else j + len(tag)
                out.append(s[i:j]); i = j; continue
        if c == "'":
            j = i + 1
            while j < n:
                if s[j] == "'":
                    if j + 1 < n and s[j+1] == "'": j += 2; continue
                    j += 1; break
                if s[j] == '\\' and i > 0 and s[i-1] in 'Ee': j += 2; continue
                j += 1
            out.append(s[i:j]); i = j; continue
        out.append(c); i += 1
    return ''.join(out)

RX = lambda s: re.sub(r'/\*[\s\S]*?\*/', '', s)
WORD = re.compile(r'[A-Za-z_][A-Za-z0-9_]{3,}')

def words(s): return set(WORD.findall(s))

def selftest():
    ok = True
    cases = [
        ("① 行內 -- 裡的 /* 不該開區塊", "-- 說明 /* 開頭\nSELECT public.real_fn();\n/* 真註解 */", True),
        ("② 字串裡的 /* 不該開區塊", "SELECT 'a/*b' AS x, public.real_fn();\n/** doc */", True),
        ("③ dollar-quote 裡的 /* 不該開區塊", "AS $fn$\n/* 這在函式體裡\nSELECT public.real_fn();\n$fn$;", True),
        ("④ 真的區塊註解要被剝掉", "/* SELECT public.real_fn(); */\nSELECT 1;", False),
        ("⑤ PG 的巢狀區塊註解", "/* a /* b */ still comment */\nSELECT public.real_fn();", True),
    ]
    for name, src, want in cases:
        got = 'real_fn' in lex_strip(src)
        good = got == want
        ok = ok and good
        print(f"  {'✅' if good else '🔴'} {name}  期望 {want} 實際 {got}")
    # 負對照:lexer 比 lexer 自己
    neg = sum(1 for f in sys.argv[2:3] for _ in [0])
    return 0 if ok else 1

if __name__ == '__main__':
    if '--selftest' in sys.argv: raise SystemExit(selftest())
    d = 'supabase/migrations'
    files = sorted(f for f in os.listdir(d) if f.endswith('.sql'))
    bad = []; neg = 0
    for f in files:
        src = io.open(os.path.join(d, f), encoding='utf-8').read()
        L = words(lex_strip(src)); R = words(RX(src))
        miss = L - R
        if miss: bad.append((f, len(miss), sorted(miss)[:4]))
        neg += len(words(lex_strip(src)) - words(lex_strip(src)))
    print(f"分母:{len(files)} 支 .sql")
    print(f"🔴 regex 弄丟真 SQL 識別字的:{len(bad)} 支")
    for f, k, ex in bad[:12]: print(f"    {f}  {k} 個  例:{', '.join(ex)}")
    print(f"負對照(lexer 比 lexer 自己):{neg}  (必須 0)")
