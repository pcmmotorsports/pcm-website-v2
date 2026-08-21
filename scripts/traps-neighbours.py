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
🔴 母體有【三個抽屜】:canonical / traps-inbox/ / memory/(後兩個都是 2026-08-22 補的)。
   ⚠️ **少一個抽屜的症狀是「輸出完全正常」** ⇒ 找不到 memory 目錄時本支會往 stderr 出聲,
      而 `--selftest` 的世界四會直接 FAIL。**不要忽略那一行警告。**
🔴 traps-inbox/(`-5f` 指出原版少了它)——
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
# 🔴 第三個抽屜:memory。2026-08-22 `-86` 撞到 —— 它的候選住在 memory 而工具看不到
#    (那不是邊角:`feedback_*` 這一族的【主要住所】就是這裡)。
#    ⚠️ 它在 repo 外 ⇒ 路徑【推導】不寫死,換一台機器才不會靜靜少一個抽屜;
#       推不出來就【出聲】,不要用兩個抽屜安靜地跑完。
MEMORY_ENV = 'PCM_MEMORY_DIR'            # 手動覆蓋用
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


def memory_dir(root):
    """推導 memory 目錄(不寫死)。順序:環境變數 → Claude Code 的 projects 慣例。
    推不出來回 None —— 呼叫端必須【出聲】,不可安靜地少一個抽屜。"""
    env = os.environ.get(MEMORY_ENV)
    if env:
        return env if os.path.isdir(env) else None
    # 🔴 Claude Code 的 projects slug 把【路徑分隔符與底線】都換成 `-`
    #    (實測 2026-08-22:/Users/sean_1/pcm-website-v2 ⇒ -Users-sean-1-pcm-website-v2。
    #     只換 os.sep 會推出 `sean_1` 而目錄是 `sean-1` ⇒ 靜靜地少一個抽屜。第一版就是這樣錯的。)
    slug = os.path.abspath(root).replace(os.sep, '-').replace('_', '-')
    cand = os.path.join(os.path.expanduser('~'), '.claude', 'projects', slug, 'memory')
    if os.path.isdir(cand):
        return cand
    # 退一步:同名前綴只有一個候選時接受它(避免 slug 規則日後再變就整族缺席)
    base = os.path.join(os.path.expanduser('~'), '.claude', 'projects')
    tail = os.path.basename(os.path.abspath(root))
    if os.path.isdir(base):
        hits = [d for d in os.listdir(base) if d.endswith('-' + tail)
                and os.path.isdir(os.path.join(base, d, 'memory'))]
        if len(hits) == 1:
            return os.path.join(base, hits[0], 'memory')
    return None


def load_memory(d):
    """memory 檔【不是 ## 分節的】—— 一檔一則。
    🔴 若照 load_sections 切,它會回 0 則,而母體看起來仍然「載入了」⇒ 那正是本工具在講的病。
    所以這裡整檔當一則,標題取 frontmatter 的 description(沒有就用檔名)。"""
    out = []
    for f in sorted(os.listdir(d)):
        if not f.endswith('.md') or f in ('MEMORY.md',):
            continue
        try:
            t = io.open(os.path.join(d, f), encoding='utf-8').read()
        except OSError:
            continue
        desc = ''
        m = re.search(r'^description:\s*(.+)$', t, re.M)
        if m:
            desc = m.group(1).strip()
        title = '## ' + (desc or f[:-3])
        out.append({'line': 1, 'title': title, 'body': [t[:BODY_CHARS]],
                    'text': title + t[:BODY_CHARS], 'source': 'memory/' + f})
    for x in out:
        x['bg'] = bigrams(x['text'])
    return out


def load_corpus(root):
    """母體 = canonical + traps-inbox/ + memory/。三者意義不同,輸出要分得出來。"""
    canon = os.path.join(root, TRAPS)
    if not os.path.exists(canon):
        sys.exit('找不到 %s —— 請在 repo 根目錄跑,或設 PCM_ROOT' % TRAPS)
    secs = load_sections(canon, '正本')
    n_canon = len(secs)
    n_inbox = 0
    inbox_dir = os.path.join(root, INBOX)
    if os.path.isdir(inbox_dir):
        for f in sorted(os.listdir(inbox_dir)):
            if not f.endswith('.md') or f == 'README.md':
                continue
            got = load_sections(os.path.join(inbox_dir, f), 'inbox/' + f)
            secs.extend(got)
            n_inbox += len(got)
    md = memory_dir(root)
    n_mem = 0
    if md:
        got = load_memory(md)
        secs.extend(got)
        n_mem = len(got)
        if n_mem == 0:
            print('🔴 警告:memory 目錄存在而【一則都沒讀到】(%s)⇒ 少一個抽屜,'
                  '而下面的結果看起來完全正常。先修這個再用。' % md, file=sys.stderr)
    else:
        print('🔴 警告:找不到 memory 目錄 ⇒ 本次只用【兩個抽屜】跑。'
              '而 feedback_* 那一族的主要住所就是 memory ⇒ 候選可能整族缺席。'
              '設 %s 指到它。' % MEMORY_ENV, file=sys.stderr)
    return secs, n_canon, n_inbox, n_mem


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
    # 🔴 這裡必須【逐個抽屜精確挑】,不能寫「不是正本的」——
    #    第一版寫成 != '正本',而 memory 進母體之後它把 memory 也吃進來
    #    ⇒ 世界三改用一則 memory 當靶,而斷言仍然通過(它只要求「不是正本」)。
    #    那正是本工具在講的:檢查過了,而它過的理由是錯的。2026-08-22 當場抓到。
    inbox = [s for s in secs if s['source'].startswith('inbox/')]

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
    hit_c = wc[0][1] is tgt_c and wc[0][1]['source'].startswith('inbox/')
    print('世界三 餵【只在 inbox】的內文 ⇒ 撈得到而且標成 inbox 嗎? %s (%s)'
          % ('是' if hit_c else '否', wc[0][1]['source']))

    mem = [s for s in secs if s['source'].startswith('memory/')]
    if not mem:
        print('世界四 FAIL:母體裡一則 memory 都沒有 ⇒ 第三個抽屜沒生效(或找不到目錄)')
        return 1
    tgt_d = max(mem, key=lambda s: len(s['text']))
    wd = rank(tgt_d['text'], secs, 3)
    hit_d = wd[0][1] is tgt_d and wd[0][1]['source'].startswith('memory/')
    print('世界四 餵【只在 memory】的內容  ⇒ 撈得到而且標成 memory 嗎? %s (%s)'
          % ('是' if hit_d else '否', wd[0][1]['source']))

    ok = hit_a and not hit_b and hit_c and hit_d
    print('⇒ 自檢 %s' % ('PASS(四個世界印出不同答案)' if ok else 'FAIL(尺沒有判別力)'))
    return 0 if ok else 1


def main():
    root = os.environ.get('PCM_ROOT') or os.getcwd()
    secs, n_canon, n_inbox, n_mem = load_corpus(root)
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

    print('分母:正本 %d + inbox %d + memory %d = %d 則(當場切的,不是寫死的)'
          % (n_canon, n_inbox, n_mem, len(secs)))
    print('🔴 三種來源意義不同:【正本】有 ⇒ 這條不新;【inbox】有 ⇒ 寫過而還沒進正本;')
    print('   【memory】有 ⇒ 它是跨專案的行為教訓(`feedback_*` 那一族主要住這裡)')
    print('⚠️ 這是【候選】不是【判定】。本工具已知的五種失效(全部是量到的,2026-08-22):')
    print('   ① 排名低到會被放行(真正撞車的排第 5 名、分數低快三倍)')
    print('   ② 完全不在名單上(兩套詞彙字元重疊極低時,最高分只有 0.1311 而那還是無關的)')
    print('   ③ 連作者本人都忘了自己幾小時前寫過(而漏掉的三方裡有一個是作者)')
    print('   ④ 道①最高只有 0.1740,而【grep 標題行】當場撈到真正那條')
    print('   ⑤ 🔴 候選住在工具看不到的抽屜裡(memory —— 本版才補上)')
    print('🔴 ⇒ 除了讀下面這 8 條,再拿【你那條的機制關鍵字】自己 grep 一次標題行。\n')
    for i, (score, s) in enumerate(rank(query, secs), 1):
        print('%2d. %.4f  [%s] :%-6d %s' % (i, score, s['source'], s['line'], s['title'][:76]))
    print('\n貼進投稿時要寫:**我開了哪幾條、為什麼判它不同族** —— 不是只貼這張表,也不要只寫「都不像」。')


if __name__ == '__main__':
    main()
