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
⇒ 🔴 所以它的用途是【撈出候選讓你自己讀】,不是【判定新不新】。
   輸出貼進投稿時要寫「其中 :NNNN 最近,而本條與它的差別是 X」,不能只寫「都不像」。

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
TOP_N = 8
BODY_CHARS = 4000          # 每條只取前 N 字元,避免長條目靠體積贏
_STRIP = re.compile(r'[*`~#>|\-—【】「」()()\s]')


def load_sections(path):
    """以 ^'## ' 切條。回傳 [{line, title, text}]。"""
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
    return secs


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
    """兩個世界都要表演:餵已知內文要撈到它自己;餵無關字元不可以。"""
    target = max(secs, key=lambda s: len(s['text']))
    world_a = rank(target['text'], secs, 3)
    hit_a = world_a[0][1]['line'] == target['line']

    noise = '甲乙丙丁戊己庚辛壬癸' * 400
    world_b = rank(noise, secs, 3)
    hit_b = world_b[0][1]['line'] == target['line']

    print('世界一 餵那條自己的內文 ⇒ 第一名是它自己嗎? %s (:%d)'
          % ('是' if hit_a else '否', world_a[0][1]['line']))
    print('世界二 餵無關字元       ⇒ 第一名【不是】它嗎? %s (:%d, 分數 %.4f)'
          % ('是' if not hit_b else '否', world_b[0][1]['line'], world_b[0][0]))
    ok = hit_a and not hit_b
    print('⇒ 自檢 %s' % ('PASS(兩個世界印出不同答案)' if ok else 'FAIL(尺沒有判別力)'))
    return 0 if ok else 1


def main():
    root = os.environ.get('PCM_ROOT') or os.getcwd()
    path = os.path.join(root, TRAPS)
    if not os.path.exists(path):
        sys.exit('找不到 %s —— 請在 repo 根目錄跑,或設 PCM_ROOT' % TRAPS)
    secs = load_sections(path)
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

    print('分母:%s 共 %d 條(當場切的,不是寫死的)' % (TRAPS, len(secs)))
    print('⚠️ 這是【候選】不是【判定】:實測 top-5 只有 2/7 命中,top-3 同族 6/7(那格是人判的)\n')
    for i, (score, s) in enumerate(rank(query, secs), 1):
        print('%2d. %.4f  :%-6d %s' % (i, score, s['line'], s['title'][:88]))
    print('\n貼進投稿時要寫:「其中 :NNNN 最近,而本條與它的差別是 X」——**不要只寫「都不像」**。')


if __name__ == '__main__':
    main()
