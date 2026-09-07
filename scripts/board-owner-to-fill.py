#!/usr/bin/env python3
"""誰該填那一列的族欄 —— 唯讀,不動板。

規則(主視窗 A 2026-09-08 定):
  取【最後一個未被刪除線包住】的線名;讀不出來 ⇒「無主 ⇒ 主視窗 A」。
  🛑 歷史括號 ⟪原誰欄:…⟫ 裡的線名【不算】—— 它是給人看的紀錄,而尺看不見「作廢」。

🔴 為什麼「最後一個」而不是「第一個」:
   誰欄是【追加】寫的 —— 舊主人在前、劃掉;新主人在後。
   取第一個 ⇒ 撈到已經被劃掉的舊主人 ⇒ 新主人在自己的堆裡看不到那一列。
   實錘(2026-09-07 量)::2370 堆=-f3 而現在是 front · :1068 堆=-b4 而現在是 account。

🔴 族值只在 ⟨…⟩ token 內、且【緊接 · 之後】才算 —— 不在末格全文搜。
   成因:九個族值全是日常詞。實測末格全文搜「記著」94 列 /「決策」56 列;
   而 token 內寬鬆比對的 6 個裡有 2 個是假的:
     「沒有人在做」含「有人在做」·「Sean 決策」含「決策」。

🛑 本尺證不到什麼:
   · 誰欄最後一個線名不一定是【主人】—— 也可能是【發現的人】(:2362 的 `-f3` 是發現者)。
   · 候選 ≥2 時本尺回「需人判」而【不挑一個】—— 挑就是猜。
     🔴 理由:撈到了而派錯人, 與沒撈到的差別只是【錯得比較晚】;
     而「印出全部署名讓人看」仍然回了一個名字 ⇒ 下游機械讀那一欄的還是拿到錯的那個。
   · 🔴 本尺分不出【被指派】與【被提到】—— 刪除線與歷史括號是【作廢標記】, 擋得掉;
     而「警告句裡的名字」(:442 誰欄逐字「掃派工欄的人會派 `db` 去做一件已經撤掉的事」)
     與「發現的人」(:2362 的 `-f3`)【從來就不是指派】, 沒有標記可以擋
     ⇒ 這一類只能靠「候選 ≥2 ⇒ 舉手」接住, 接不住的(只有一個名字而它是發現者)會安靜地錯。
   · 「無主」= 誰欄沒有線名,【不代表】沒有人在做。
"""
import argparse, io, re, sys

FAM = ['有人在做','記著','決策','跨repo','待翻態','無關閉條件','等真資料','時刻觸發','讀不出來']
# 🔴 字典 = 誰欄裡【真的以線名形式出現過】的 7 個(2026-09-08 量:反引號形式的出現次數)
#    -db 123 · -ship 84 · -auth 69 · -mail 32 · -account 32 · -front 21 · tidy 12
# ⛔ ~~supply / search~~ 拿掉 —— 它們【從來沒有】以反引號線名出現過, 只在散文與錨字首裡
#    ⇒ 放進字典會把散文算成候選, 而那會【灌大】需人判 的數。
WIN = ['front', 'ship', 'mail', 'auth', 'account', 'db', 'tidy']
# 🔴 只在誰欄裡真的看過的變體才放行 —— 不寫成通則樣式。
#    通則樣式(`-?(win)[a-z0-9-]*`)實測會撈到 authenticated / db-pre-request /
#    auth-server / 一個 commit sha dbfbbe786 ⇒ 那是【尺亂咬】。
VARIANT = {'-account-step7', 'ship-5b'}
UNOWNED = '無主 ⇒ 主視窗 A'
AMBIG = '需人判'   # 🔴 候選 ≥2 時不挑一個 —— 挑就是猜(主視窗 B 2026-09-08 裁)


def strip_noise(who):
    """拿掉歷史括號與刪除線,回傳(乾淨字串, 拿掉幾段)"""
    n = 0
    for pat in (r'⟪.*?⟫', r'~~.*?~~'):
        who, k = re.subn(pat, ' ', who)
        n += k
    return who, n


def owner(who):
    """回 (誰該填, 全部署名 list)"""
    clean, _ = strip_noise(who)
    def is_name(tok):
        if tok in VARIANT:
            return True
        if tok.lstrip('-') in WIN:
            return True
        return bool(re.fullmatch(r'-[0-9a-z]{1,4}', tok))   # 匿名線名如 -f3 -15 -c8
    hits = [(m.start(), m.group(1)) for m in re.finditer(r'`(-?[a-z0-9]+(?:-[a-z0-9]+)*)`', clean)
            if is_name(m.group(1))]
    hits += [(m.start(), w) for w in WIN
             for m in re.finditer(rf'(?<![a-zA-Z`-]){w}(?![a-zA-Z])', clean)]
    # 同一個位置只留一次(反引號版與裸版會重疊)
    seen, out = set(), []
    for p, n in sorted(hits):
        key = n.lstrip('-')
        if any(abs(p - q) <= 1 for q in seen):
            continue
        seen.add(p); out.append(key)
    uniq = list(dict.fromkeys(out))
    if not uniq:
        return UNOWNED, out
    return (uniq[0] if len(uniq) == 1 else AMBIG), out


def has_family(tail):
    m = re.match(r'\s*⟨(.*?)⟩', tail)
    return bool(m) and any(f'·{f}' in m.group(1) for f in FAM)


def rows(path):
    for i, line in enumerate(io.open(path, encoding='utf-8'), 1):
        if not line.startswith('|'):
            continue
        c = re.split(r'(?<!\\)\|', line)
        if len(c) <= 5 or '---' in c[1]:
            continue
        anc = re.search(r'⟦(.+?)⟧', '|'.join(c[1:5]))
        yield i, c[1].strip(), (anc.group(1) if anc else '(無錨)'), c[4].strip(), c[5]


CASES = [
    # (誰欄, 期望的誰該填, 這一格在驗什麼)
    ('**front** · Sean 親眼看到', 'front', '裸窗名'),
    ('⛔ ~~線 `-f3` 撿到, 未做~~ ⇒ 線 `front` 訂正', 'front', '刪除線裡的舊主人不算'),
    ('線【信】`mail` 給步驟 ⟪原誰欄:線【身分】`-auth` 接⟫', 'mail', '歷史括號裡的不算'),
    ('待派', UNOWNED, '沒有線名 ⇒ 無主'),
    ('⛔ ~~`-b4`~~ ⇒ ⛔ ~~死窗~~ ⇒ 線【帳號】`account` 接', 'account', '連兩段刪除線'),
    ('**db**(RPC)+ **front**(呼叫端)', '需人判', '兩個候選 ⇒ 不挑, 回需人判'),
    ('線 `front` 接;而掃派工欄的人會派 `db` 去做已經撤掉的事', '需人判',
     '🔴 警告句裡的名字 —— 尺分不出「指派」與「被提到」⇒ 至少要舉手'),
    ('線 `mail` 接 · 線 `mail` 2026-09-07 覆驗', 'mail',
     '⚪ 負對照:同一個名字出現兩次【不算】兩個候選'),
    ('⛔ ~~線 `front` 接~~', UNOWNED, '負對照:唯一的名字被劃掉 ⇒ 必須回無主'),
    ('線 `zq7fh3k2m` 接', UNOWNED, '負對照:現造隨機名不在字典 ⇒ 無主'),
]

TOKCASES = [
    ('⟨擋·記著⟩ 內文', True, '嚴格命中'),
    ('⟨不擋(那 31 件【沒有人在做】的載體)⟩', False, '負對照:「沒有人在做」含「有人在做」而不該算'),
    ('⟨未判(取決於 Sean 決策)⟩', False, '負對照:「Sean 決策」含「決策」而不該算'),
    ('內文裡寫了 記著 而 token 沒有', False, '負對照:末格全文不算'),
]


def selftest():
    bad = 0
    print('=== 誰該填 ===')
    for who, want, why in CASES:
        got, _ = owner(who)
        ok = got == want
        bad += not ok
        print(f'  {"✅" if ok else "🔴"} 期望 {want:<14} 得到 {got:<14} — {why}')
    print('=== 有沒有 ·族 ===')
    for tail, want, why in TOKCASES:
        got = has_family(tail)
        ok = got == want
        bad += not ok
        print(f'  {"✅" if ok else "🔴"} 期望 {str(want):<5} 得到 {str(got):<5} — {why}')
    print(f'\n{"⇒ 自檢 PASS(每一格都有一個會紅的世界)" if not bad else f"⇒ 自檢 FAIL {bad} 格"}')
    return 1 if bad else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--selftest', action='store_true')
    ap.add_argument('--board', default='docs/launch-todo.md')
    ap.add_argument('--anchor')
    ap.add_argument('--unfilled-only', action='store_true', help='只印還沒有 ·族 的列')
    # 🔴🔴 **lint-staged 會把【staged 的檔名】接在命令後面** —— 不吃掉它們, `--selftest` 會 rc=2。
    #   🔬 實測:`--selftest` 單獨跑 rc=0;`--selftest scripts/x.py package.json` ⇒ **rc=2**
    #     ⇒ 而 pre-commit 印的是 `[FAILED] … --selftest [FAILED]`, **看起來像自檢不過**。
    #   📌 ⇒ 那是「工具沒壞而它的呼叫形狀變了」, 而兩者在 rc 上印同一個非 0。
    #   🛑 本參數收下就丟 —— 本工具的分母是【整塊板】, 不是 staged 的那幾支檔。
    ap.add_argument('files', nargs='*', help=argparse.SUPPRESS)
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    for ln, st, anc, who, tail in rows(a.board):
        if a.anchor and a.anchor not in anc:
            continue
        filled = has_family(tail)
        if a.unfilled_only and filled:
            continue
        pick, allnames = owner(who)
        multi = ' ⚠️兩個以上署名' if len(set(allnames)) > 1 else ''
        print(f'{ln}\t{st}\t⟦{anc}⟧\t{"已填" if filled else "未填"}\t{pick}\t{"/".join(allnames) or "—"}{multi}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
