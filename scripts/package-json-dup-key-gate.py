#!/usr/bin/env python3
"""JSON 重複 key 守門 —— 一份有重複 key 的 JSON 是【合法的】, 而後者靜靜蓋掉前者。

🔴 **為什麼要有它**(2026-09-05 實錘, 我自己造的):
   我在 `package.json` 的 lint-staged 加了一個 `"supabase/migrations/*.sql"` key ——
   **而那個 key 已經存在**, 底下是一串七條命令。JSON 後者覆蓋前者
   ⇒ **七道 migration 靜態閘整串消失**, 而 `package.json` 讀起來完全正常。
   📌 **diff 上它是 `+1 行`;而效果是 `−7 道閘`。加法與減法在這裡長得一樣。**

🛑 **而我 commit 前【有驗】, 驗錯了東西**:我跑的是「JSON 仍可解析」⇒ 綠。
   **我驗的是「它還讀得懂嗎」, 而壞的是「它讀成了什麼」。**

🔵 它證不到什麼:
   · 只看重複 key, 不看內容對不對。
   · **JSONC(帶 `//` 註解的 json, 例 `.vscode/*.json`)它讀不動** —— 那不是重複 key,
     兩件事要分開報, 否則一個「讀不動」會被算成一個「有重複」而製造假警報。
   · 它不看 `.json` 以外的設定檔。
"""
import collections
import io
import json
import subprocess
import sys


class DupKey(Exception):
    def __init__(self, keys):
        self.keys = keys
        super().__init__(','.join(keys))


def _hook(pairs):
    c = collections.Counter(k for k, _ in pairs)
    dup = sorted(k for k, n in c.items() if n > 1)
    if dup:
        raise DupKey(dup)
    return dict(pairs)


def check(path):
    """回 (狀態, 說明)。狀態 = ok | dup | unparsable。"""
    try:
        json.load(io.open(path, encoding='utf-8'), object_pairs_hook=_hook)
        return ('ok', '')
    except DupKey as e:
        return ('dup', ','.join(e.keys))
    except json.JSONDecodeError as e:
        # 🔵 讀不動【不是】重複 key。JSONC / 尾逗號 / 壞檔都落這裡, 而它們不該擋 commit。
        return ('unparsable', str(e)[:60])
    except OSError as e:
        return ('unparsable', '讀不到:%s' % type(e).__name__)


def selftest():
    import tempfile, os
    d = tempfile.mkdtemp()
    w = lambda n, s: (io.open(os.path.join(d, n), 'w', encoding='utf-8').write(s),
                      os.path.join(d, n))[1]
    worlds = [
        ('世界一 重複 key      ⇒ 該叫',
         w('a.json', '{"x": 1, "x": 2}'), 'dup'),
        ('世界二 乾淨          ⇒ 【不叫】',
         w('b.json', '{"x": 1, "y": 2}'), 'ok'),
        ('世界三 JSONC 讀不動  ⇒ 報【讀不動】不是【重複】',
         w('c.json', '// hi\n{"x": 1}'), 'unparsable'),
        ('世界四 巢狀裡重複    ⇒ 該叫(不是只看最外層)',
         w('d.json', '{"a": {"k": 1, "k": 2}}'), 'dup'),
    ]
    ok = True
    for name, path, want in worlds:
        got = check(path)[0]
        hit = got == want
        ok = ok and hit
        print('  %s ⇒ %s(得 %s)' % (name, '是' if hit else '否', got))
    print('  ⇒ 自檢 %s' % ('PASS(四個世界印不同答案)' if ok else 'FAIL'))
    return 0 if ok else 1


def main(argv):
    if '--selftest' in argv:
        return selftest()
    files = [a for a in argv if a.endswith('.json')]
    scope = '這一發改到的'
    if not files:
        files = subprocess.run(['git', 'ls-files', '*.json'],
                               capture_output=True, text=True).stdout.split()
        scope = '全樹'
    dup, unp = [], []
    for f in files:
        st, why = check(f)
        (dup if st == 'dup' else unp if st == 'unparsable' else []).append((f, why))
    print('  🔵 分母:%s %d 支 .json' % (scope, len(files)))
    if unp:
        print('  ⚠️ 讀不動 %d 支(JSONC / 壞檔)—— **那不是重複 key, 不擋**:' % len(unp))
        for f, why in unp[:5]:
            print('     %s ⇒ %s' % (f, why))
    if not dup:
        print('  ✅ 沒有重複 key')
        return 0
    print('  🔴 **這些檔有重複 key —— 後者會靜靜蓋掉前者**:', file=sys.stderr)
    for f, keys in dup:
        print('     %s ⇒ %s' % (f, keys), file=sys.stderr)
    print('  ⇒ 判別:先看那個 key 底下【本來有什麼】, 再決定是合併還是改名。', file=sys.stderr)
    print('     (2026-09-05 實錘:合併時漏掉既有的七條命令 ⇒ 七道閘整串消失。)', file=sys.stderr)
    return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
