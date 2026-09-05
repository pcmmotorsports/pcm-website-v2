#!/usr/bin/env python3
"""把 migration 的 PCM-EXPECTED-BLOCK 換成本機世界那幾張表(給 verify.sh 的格⑪ 用)。

🔴 它是**測試用的突變器**, 不是生產路徑。而它自己也要能說「我沒換到」——
   換不到時 **不寫出檔案**, 讓呼叫端的 cmp 抓到, 而不是靜靜產出一份與原檔相同的副本。
"""
import io, os, re, sys

src = os.environ['MIG_SRC']; dst = os.environ['MIG_DST']; names_file = os.environ['NAMES_FILE']
names = [n.strip() for n in io.open(names_file, encoding='utf-8').read().split('\n') if n.strip()]
if not names:
    print('🔴 本機表名清單是空的 ⇒ 不產副本', file=sys.stderr); sys.exit(2)
body = '\n'.join("  ('%s')," % n for n in names).rstrip(',')
s = io.open(src, encoding='utf-8').read()
pat = re.compile(r'(PCM-EXPECTED-BLOCK-BEGIN[^\n]*\n).*?(\n\s*-- PCM-EXPECTED-BLOCK-END)', re.S)
if not pat.search(s):
    print('🔴 找不到 PCM-EXPECTED-BLOCK 錨 ⇒ 不產副本', file=sys.stderr); sys.exit(2)
io.open(dst, 'w', encoding='utf-8').write(pat.sub(lambda m: m.group(1) + body + m.group(2), s))
