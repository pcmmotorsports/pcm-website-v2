#!/usr/bin/env python3
"""手機樣式【雙寫】盤點 —— @media (max-width:1079px) 的規則，有沒有 [data-mobile] 那條孿生兄弟。

為什麼要雙寫（`apps/storefront/src/styles/account.css:749-754` 逐字）：
  手機 UA 但 viewport >= 1080px（Android 平板橫放）**不會**命中 @media
  ⇒ 只寫 @media 那一條，那些人拿到的是桌機版面，**而畫面完全正常、沒有任何東西會紅**。

🔴 本工具【不是】守門，是【盤點】。它答得出的只有一句：
   「這條選擇器出現在 1079 區塊裡，而同一支檔的 data-mobile 那一路找不到它」。
它答不出：
   · 這一條【該不該】雙寫（有些規則只在真的窄螢幕才需要，本來就不必雙寫）
   · 雙寫的內容對不對（它只比對選擇器在不在，不比對宣告）
   · 跨檔雙寫（A 檔寫 @media、B 檔寫 data-mobile ⇒ 本工具會誤報）
⇒ 讀它的輸出時，把每一條當【待人判】，不要當【缺陷】。

自檢：`--selftest` 會用三個合成檔驗它自己會不會動（齊全⇒0 / 缺一半⇒1 / 只在註解裡提到⇒仍算缺）。
      **沒跑過自檢的輸出不算數** —— 一個永遠回 0 的盤點工具，讀起來跟「很乾淨」一模一樣。
"""
import re, sys, glob, os, tempfile

DEFAULT_GLOB = 'apps/storefront/src/styles/*.css'

def _blocks(css, header_re):
    out = []
    for m in re.finditer(header_re, css):
        i = css.find('{', m.end() - 1)
        if i < 0:
            continue
        depth, j = 0, i
        while j < len(css):
            if css[j] == '{':
                depth += 1
            elif css[j] == '}':
                depth -= 1
                if depth == 0:
                    break
            j += 1
        out.append(css[i + 1:j])
    return out

def _selectors(body):
    sels, depth, buf = [], 0, ''
    for ch in body:
        if ch == '{':
            depth += 1
            if depth == 1:
                s = buf.strip()
                if s and not s.startswith('@'):
                    for one in s.split(','):
                        one = ' '.join(one.split())
                        if one:
                            sels.append(one)
                buf = ''
                continue
        elif ch == '}':
            depth -= 1
            if depth == 0:
                buf = ''
            continue
        if depth == 0:
            buf += ch
    return sels

def scan(paths):
    rows = []
    for f in sorted(paths):
        css = open(f, encoding='utf-8').read()
        # 🔴 先砍註解：不砍的話註解會被當成選擇器（第一版就是這樣，虛報 143 → 實際 97）
        css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
        media = []
        for b in _blocks(css, r'@media[^{]*max-width:\s*1079px[^{]*'):
            media += _selectors(b)
        if not media:
            continue
        dm_text = '\n'.join(l for l in css.splitlines() if 'data-mobile' in l)
        missing = []
        for s in sorted(set(media)):
            parts = s.replace('html', '').strip().split()
            key = parts[-1] if parts else s
            key = key.split(':')[0].split('>')[-1].strip()
            if key and key not in dm_text:
                missing.append(s)
        rows.append((f, len(set(media)), missing))
    return rows

def self_test():
    d = tempfile.mkdtemp()
    w = lambda n, t: (open(os.path.join(d, n), 'w', encoding='utf-8').write(t), os.path.join(d, n))[1]
    a = w('a.css', '@media (max-width: 1079px){.foo{color:red}.bar{color:blue}}\n'
                   'html[data-mobile="true"] .foo{color:red}\n'
                   'html[data-mobile="true"] .bar{color:blue}\n')
    b = w('b.css', '@media (max-width: 1079px){.qux{color:red}.baz{color:blue}}\n'
                   'html[data-mobile="true"] .qux{color:red}\n')
    c = w('c.css', '@media (max-width: 1079px){.trap{color:red}}\n'
                   '/* html[data-mobile="true"] .trap 只是註解，不算數 */\n')
    got = {os.path.basename(f): len(m) for f, _, m in scan([a, b, c])}
    want = {'a.css': 0, 'b.css': 1, 'c.css': 1}
    ok = got == want
    print('自檢:', '✅ 通過' if ok else f'🔴 失敗 期望{want} 實得{got}')
    print('  · 雙寫齊全 ⇒ 0     （尺不會亂叫）')
    print('  · 只寫一半 ⇒ 1     （尺會叫）')
    print('  · 只在註解裡提到 ⇒ 仍算缺（不被註解騙）')
    return 0 if ok else 1

def main():
    if '--selftest' in sys.argv or '--self-test' in sys.argv:
        return self_test()
    if self_test():                      # 🔴 每次正式掃描【一定】先跑自檢，不給人跳過
        print('自檢沒過 ⇒ 本次掃描結果作廢')
        return 1
    print()
    rows = scan(glob.glob(DEFAULT_GLOB))
    tot_s = tot_m = 0
    print(f"{'檔案':<26}{'1079內選擇器':>14}{'找不到雙寫':>12}")
    for f, ns, missing in rows:
        tot_s += ns; tot_m += len(missing)
        print(f"{os.path.basename(f):<26}{ns:>14}{len(missing):>12}{'  ←' if missing else ''}")
        for s in missing[:5]:
            print(f"      · {s}")
        if len(missing) > 5:
            print(f"      · …另外 {len(missing)-5} 條")
    print(f"\n合計：1079 區塊內 {tot_s} 條選擇器，其中 {tot_m} 條在同一支檔找不到 data-mobile 雙寫")
    print("🔴 這 %d 條是【待人判】不是【缺陷】——理由見本檔開頭那三個「答不出」。" % tot_m)
    return 0

if __name__ == '__main__':
    sys.exit(main())
