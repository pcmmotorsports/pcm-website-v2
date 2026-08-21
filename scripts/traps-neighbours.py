#!/usr/bin/env python3
"""traps-neighbours — 投稿 traps 條目前,先撈出既有最相似的 N 條。

為什麼要這支:2026-08-22 一夜五個窗、七次「重新發現」一條檔裡已經有的教訓,
而每一次都做了字面 grep、每一次都回 0 —— 因為【提案者的詞】與【既有條目的詞】不一樣。
實測:拿那七次的原始搜尋詞去打 404 條標題 ⇒ 命中 1/7;打全檔 ⇒ 4/7。

⇒ 本支不比對字面,比對【中文字元 bigram 的餘弦相似度】:
   換句話說時字元大量重疊(尺/量/對照/世界/零/命中),所以不需要任何人維護同義詞表
   —— 那種表會過期,而過期時零訊號。

效度限制(量到的,不是估的;2026-08-22 以那七發為分母):
  · 真正該命中的那條進 top-5 = 2/7
  · top-3 出現【同族】條目   = 6/7   ⚠️ 這一格是【人判的】,不是算出來的
🔴 而【排名低不代表沒撞到】—— 2026-08-22 實錘:真正撞車的那條被排到第 5 名、
   分數比第一名低快三倍。⇒ **只看排名會放行,擋下來的是【開檔讀】那一步。**
🔴 母體含 traps-inbox/(2026-08-22 補;`-5f` 指出原版少了它)——
   inbox 那批是最近幾天的產出,**最可能與新投稿撞車的正是它們**,而原版看不到。
   輸出會標來源:【正本】有 ⇒ 這條不新;【inbox】有 ⇒ 有人寫過而【還沒進正本】。
⇒ 🔴 所以它的用途是【撈出候選讓你自己讀】,不是【判定新不新】。
   貼進投稿時要寫「**我開了哪幾條、為什麼判它不同族**」,不能只貼表、也不能只寫「都不像」。

用法
  python3 scripts/traps-neighbours.py <草稿檔>
  cat 草稿 | python3 scripts/traps-neighbours.py
  python3 scripts/traps-neighbours.py --selftest      # 兩個世界都要表演(--selfcheck 同義)
"""
import io
import math
import os
import re
import sys
from collections import Counter

TRAPS = 'docs/patterns/guard-and-instrument-traps.md'
INBOX = 'docs/patterns/traps-inbox'      # 🔴 暫存區也算母體 —— 它是最近幾天的產出,
                                         #    最可能與新投稿撞車的正是這一批(2026-08-22 -5f 指出)
TOP_N = 8
BODY_CHARS = 4000          # 每條只取前 N 字元,避免長條目靠體積贏
_STRIP = re.compile(r'[*`~#>|\-—【】「」()()\s]')


def load_sections(path, source):
    """以 ^'## ' 切條。回傳 [{line, title, text, source}]。source 是給人看的來源標籤。"""
    lines = io.open(path, encoding='utf-8').read().split('\n')
    secs, cur = [], None
    for i, l in enumerate(lines, 1):
        if l.startswith('## '):
            if cur:
                secs.append(cur)
            cur = {'line': i, 'title': l, 'body': []}
        elif cur is not None:
            cur['body'].append(l)
    if cur:
        secs.append(cur)
    for s in secs:
        s['text'] = s['title'] + ''.join(s['body'])[:BODY_CHARS]
        s['bg'] = bigrams(s['text'])
        s['source'] = source
    return secs


def load_corpus(root):
    """母體 = canonical + traps-inbox/(README 除外)。兩者意義不同,輸出要分得出來。"""
    canon = os.path.join(root, TRAPS)
    if not os.path.exists(canon):
        sys.exit('找不到 %s —— 請在 repo 根目錄跑,或設 PCM_ROOT' % TRAPS)
    secs = load_sections(canon, '正本')
    inbox_dir = os.path.join(root, INBOX)
    n_inbox = 0
    if os.path.isdir(inbox_dir):
        for f in sorted(os.listdir(inbox_dir)):
            if not f.endswith('.md') or f == 'README.md':
                continue
            got = load_sections(os.path.join(inbox_dir, f), 'inbox/' + f)
            secs.extend(got)
            n_inbox += len(got)
    return secs, len(secs) - n_inbox, n_inbox


def bigrams(s):
    s = _STRIP.sub('', s)
    return Counter(s[i:i + 2] for i in range(len(s) - 1))


def cosine(a, b):
    common = set(a) & set(b)
    if not common:
        return 0.0
    num = sum(a[k] * b[k] for k in common)
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    return num / (na * nb) if na and nb else 0.0


def rank(query, secs, n=TOP_N):
    qb = bigrams(query)
    scored = [(cosine(qb, s['bg']), s) for s in secs]
    scored.sort(key=lambda x: -x[0])
    return scored[:n]


def selfcheck(secs):
    """三個世界都要表演。第三個是 2026-08-22 補的:沒有它,
    「母體加了 inbox」與「加了但沒生效」印一模一樣的答案。"""
    canon = [s for s in secs if s['source'] == '正本']
    inbox = [s for s in secs if s['source'] != '正本']

    tgt_a = max(canon, key=lambda s: len(s['text'])) if canon else None
    if tgt_a is None:
        print('世界一 FAIL:母體裡沒有正本的條目')
        return 1
    wa = rank(tgt_a['text'], secs, 3)
    hit_a = wa[0][1] is tgt_a
    print('世界一 餵【正本】一條的內文 ⇒ 第一名是它自己嗎? %s (:%d %s)'
          % ('是' if hit_a else '否', wa[0][1]['line'], wa[0][1]['source']))

    noise = '甲乙丙丁戊己庚辛壬癸' * 400
    wb = rank(noise, secs, 3)
    hit_b = wb[0][1] is tgt_a
    print('世界二 餵無關字元           ⇒ 第一名【不是】它嗎? %s (:%d, 分數 %.4f)'
          % ('是' if not hit_b else '否', wb[0][1]['line'], wb[0][0]))

    if not inbox:
        print('世界三 FAIL:母體裡一條 inbox 的條目都沒有 ⇒ 母體沒生效')
        return 1
    tgt_c = max(inbox, key=lambda s: len(s['text']))
    wc = rank(tgt_c['text'], secs, 3)
    hit_c = wc[0][1] is tgt_c and wc[0][1]['source'] != '正本'
    print('世界三 餵【只在 inbox】的內文 ⇒ 撈得到而且標成 inbox 嗎? %s (%s)'
          % ('是' if hit_c else '否', wc[0][1]['source']))

    ok = hit_a and not hit_b and hit_c
    print('⇒ 自檢 %s' % ('PASS(三個世界印出不同答案)' if ok else 'FAIL(尺沒有判別力)'))
    return 0 if ok else 1


def main():
    root = os.environ.get('PCM_ROOT') or os.getcwd()
    secs, n_canon, n_inbox = load_corpus(root)
    if not secs:
        sys.exit('切不出任何條目(^## )⇒ 先確認那份檔還是原本的結構')

    flags = {'--selftest', '--selfcheck'}   # repo 慣例是 --selftest;舊名保留為同義
    args = [a for a in sys.argv[1:] if a not in flags]
    if flags & set(sys.argv[1:]):
        sys.exit(selfcheck(secs))

    if args:
        query = io.open(args[0], encoding='utf-8').read()
    elif not sys.stdin.isatty():
        query = sys.stdin.read()
    else:
        sys.exit('用法:traps-neighbours.py <草稿檔>  或  cat 草稿 | traps-neighbours.py')
    if not _STRIP.sub('', query):
        sys.exit('草稿是空的(剝掉格式之後沒有字)')

    print('分母:正本 %d 條 + inbox %d 條 = %d 條(當場切的,不是寫死的)'
          % (n_canon, n_inbox, len(secs)))
    print('🔴 兩種來源意義不同:【正本】有 ⇒ 這條不新;【inbox】有 ⇒ 有人寫過而【還沒進正本】')
    print('⚠️ 這是【候選】不是【判定】:實測 top-5 只有 2/7 命中(分母=2026-08-22 那七發)')
    print('🔴 而分數低【不代表沒撞到】:2026-08-22 實錘,真正撞車的那條被排到第 5 名、')
    print('   分數比第一名低快三倍 ⇒ **只看排名會放行**。下面 8 條要【開檔讀】,不是掃標題。\n')
    for i, (score, s) in enumerate(rank(query, secs), 1):
        print('%2d. %.4f  [%s] :%-6d %s' % (i, score, s['source'], s['line'], s['title'][:76]))
    print('\n貼進投稿時要寫:**我開了哪幾條、為什麼判它不同族** —— 不是只貼這張表,也不要只寫「都不像」。')


if __name__ == '__main__':
    main()
