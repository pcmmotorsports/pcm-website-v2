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
⚠️ **失效①有一個形狀值得單獨記(2026-08-22 `-86`)**:候選是**正本表格裡的一列**
   (`guard-and-instrument-traps.md:202`,只有一格文字)。**它短到 bigram 撈不出來**
   ⇒ 八名之內零命中,而它就是同族。**⇒ 表格的一列天生比段落難被本工具找到。**
   那次靠的是**把整張表讀完**,不是排名。**排名沒撞,不等於沒撞。**

🔴 **第六種失效(2026-08-22 `-86` 實測,已修但這裡留著,因為它解釋了為什麼要修)**:
   草稿寫成檔、放進 traps-inbox/ 之後才跑查重 —— **那是最自然、也是規矩要求的順序** ——
   母體會把草稿自己吃進去,而草稿與自己的相似度必然最高 ⇒ **八個名額全被自己佔滿、真候選 0 條**。
   🔴 **而它為什麼比另外五種危險:另外五種的外觀是一張【看起來沒撞到】的名單,
      至少讀的人知道自己在賭;這一種的外觀是【一張滿滿八列、分數還特別高的名單】**
      ⇒ 沒有人會覺得它沒跑。
   📌 它還會【系統性地偏向草稿越完整的人】—— **寫得越用心的投稿,越查不到自己的鄰居。**
   ⚠️ 連帶學到的:**一份誠實的限制清單,會讓【不在清單上】的那一種更難被懷疑。**
      ⇒ 這份清單本身要當成量具看待,它的沉默不是證據。
   修法 = `exclude_self()`(realpath 比對),自檢世界五 + 反向對照守著。
   ⚠️ **而修法本身有兩個方向的洞,兩個都要寫**(只寫一個方向 ⇒ 清單會被讀成完整的):
      · **漏報側**:後衛①只在草稿夠密時才叫(實測佔 7/8 的會叫、只佔 1 格的不叫);
        而 **stdin 那條路排不掉自己**(不知道草稿是哪一份檔)⇒ 那條路上⑥原封不動、只能出聲。
      · **誤報側**:第一版照【任一來源】數,而【正本】是一支檔裝 400+ 則 ⇒
        「多數命中來自正本」是**健康且想要**的結果,卻會觸發警告(實測兩發一誤報)。
        🔴 **一道誤報率高的閘比沒有閘更糟** —— 它先把「注意那行紅字」的習慣訓練掉,
        等它真的抓到自撞時沒有人會停下來。
      ⇒ 真正的保護是 **path 排除**;兩道警告是它失效時的後衛,而**後衛的分母比病窄**。
⇒ 🔴 所以它的用途是【撈出候選讓你自己讀】,不是【判定新不新】。
   貼進投稿時要寫「**我開了哪幾條、為什麼判它不同族**」,不能只貼表、也不能只寫「都不像」。

🔴 **2026-08-22 主視窗留痕(它自己要求記在這裡,而不是 amend 掉)**:
   `fc5b69d5` 的 commit body 宣稱本次「把自檢的 rc 改成 `0 if ok else 1`」——
   **那句是錯的,那一行兩版都有、從來沒被改過。**
   量法(負對照一起跑,證明尺是活的):
     git show fc5b69d5:<本檔>  | grep -c 'return 0 if ok else 1'  ⇒ 1
     git show fc5b69d5^:<本檔> | 同一把尺                          ⇒ 1
     git show fc5b69d5^:<本檔> | grep -c 'return 99 if ok'         ⇒ 0
   真相 = 主視窗用 `… | tail` 量 `$?`,拿到的是 **`tail` 的 rc**,然後把讀數寫進了 commit。
   ⚠️ **⇒ 量本檔自檢的 rc,不要接管線**(或在【呼叫的那個 shell】設 `set -o pipefail`——
      寫在腳本裡管不到包住它的那一個)。同一夜同一條坑踩了兩個人。

🔴 **尺二(本工具幫你組的那條 grep)的兩個天花板 —— 放在檔頭因為【寫對地方 ≠ 會被讀到】**
   ① **它組的是【字面】比對(`grep -F -e`), 不是 regex** —— 這是 2026-08-29 修過的:
      原本印 `grep -E`, 而次數是用字面數的 ⇒ 一份含 `\s` / `.f` 的草稿會讓那條指令 **479/479 全中**。
   ② 🔴 **關鍵字有一半以上是雜訊**:R1 量 20 份真草稿的 120 個關鍵字 ⇒ **含中文只有 52(43%)**,
      **68(57%)** 是 `81` / `c=` / `rm` / `/d` 這類行號・日期・識別字碎片。
      **成因是設計本身**:它按「罕見優先」挑, 而**罕見的東西天生就是雜訊**。
      ⇒ **它是【替你省掉想關鍵字那一步】, 不是【替你判斷】** —— 貼下去之後仍然要自己看。
      ⚠️ 而它抽的是**字元 bigram**, 可能是半個詞(`的條` `經有`)。
   📌 **為什麼還是做**:2026-08-29 量到 8 份真草稿的真近親名次 1,1,1,5,7,58,78,483 ⇒ 前八外 3 份,
      **而那三份全部是靠尺二救回來的** ⇒ **尺二承重一半, 而它原本只活在一句提醒裡。**

用法
  python3 scripts/traps-neighbours.py <草稿檔>
  cat 草稿 | python3 scripts/traps-neighbours.py
  python3 scripts/traps-neighbours.py --selftest      # 八個世界都要表演(--selfcheck 同義)
"""
import io
import math
import os
import re
import unicodedata
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
# 🔴 寬尺的實測地板(2026-08-28 當場量到 49);見 selftest 世界七 M2 那段註解。
WIDE_FLOOR = 40
BODY_CHARS = 4000          # 每條只取前 N 字元,避免長條目靠體積贏
_STRIP = re.compile(r'[*`~#>|\-—【】「」()()\s]')


def load_sections(path, source):
    """以 ^'## ' 切條。回傳 [{line, title, text, source}]。source 是給人看的來源標籤。"""
    # 🔴 nit(R3):非 UTF-8 的檔會噴一個【不含肇事檔名】的裸 traceback ——
    #    大聲, 而不可診斷。⇒ 錯誤訊息一定要帶那支檔的路徑。
    try:
        lines = io.open(path, encoding='utf-8').read().split('\n')
    except UnicodeDecodeError as e:
        sys.exit('🔴 讀不動(不是 UTF-8):%s\n   %s\n'
                 '   ⇒ 那支檔對本工具是【整支隱形】的, 不是「沒有命中」。' % (path, e))
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
    rp = os.path.realpath(path)
    for s in secs:
        s['text'] = s['title'] + ''.join(s['body'])[:BODY_CHARS]
        s['bg'] = bigrams(s['text'])
        s['source'] = source
        s['path'] = rp          # 🔴 排除「草稿自己」要比【正規化後的路徑】,不比 source 標籤
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
                    'text': title + t[:BODY_CHARS], 'source': 'memory/' + f,
                    'path': os.path.realpath(os.path.join(d, f))})
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


def exclude_self(secs, draft_path):
    """把【草稿自己】從母體剔除,回傳 (剩下的, 剔掉幾則)。

    🔴 為什麼需要它(2026-08-22 `-86` 實測,本工具的第六種失效):
       草稿寫成檔放進 traps-inbox/ 之後才跑查重 —— **那是最自然、也是規矩要求的順序** ——
       母體會把草稿自己吃進去,而草稿與自己的相似度必然最高
       ⇒ TOP_N 個名額全被自己的段落佔滿,真候選一條都排不進來。
    🔴 而它的外觀是【一張滿滿八列、分數還特別高的名單】⇒ 沒有人會覺得它沒跑。

    ⚠️ 比對用 realpath:相對路徑 / `./` 前綴 / symlink 都會讓字串比對安靜地漏掉,
       而漏掉的症狀正是「名單看起來完全正常」。
    """
    if not draft_path:
        return secs, 0
    rp = os.path.realpath(draft_path)
    kept = [x for x in secs if x.get('path') != rp]
    return kept, len(secs) - len(kept)


HOG_MIN = 2               # 🔴 門檻是【量出來的】,不是挑一個好看的數字。
                          #    2026-08-22 全 24 份 inbox 檔各當一次草稿(餵整份, 真實用法):
                          #      髒(草稿在母體) 自己佔 1–7 格、中位 3
                          #      乾淨(已排除)   單一 inbox 檔最多佔 【0 或 1】格
                          #    ⇒ 兩個分布【不重疊在 2 以上】⇒ >=2 誤報 0/24、命中 20/24。
                          #    ⚠️ 原本寫 `>50%`(即 >=5)⇒ 24 份裡只叫得出 3 份 —— 那是漏報,
                          #       而它之所以在我自己那份草稿上叫得出來,是因為那份異常密集(7/8)。
                          #       🔴 用一份樣本調出來的門檻,在別人的草稿上會靜悄悄。
SELF_SCORE = 0.9          # 🔴 -4a 2026-08-22 實測:自撞那筆 cosine=1.0000,
                          #    而正常候選 0.158–0.53 ⇒ 兩個分數帶【不重疊】
                          #    ⇒ 這一格【不需要知道 query 從哪來】就叫得出來(stdin 也管用)


def collision_warnings(ranked, n_self=0):
    """自撞偵測。回傳警告字串清單(空 = 沒事)。

    🔴 抽成純函式的理由:寫在 main 裡印一印的東西【驗不了反向對照】——
       而「乾淨的那一發必須不印」與「髒的那一發要印」是兩個世界,兩發都要表演。
    三道各自獨立(任一道壞掉,另外兩道還在):
      ① 單一來源檔霸佔過半名額   —— 不需要知道 query 是誰
      ② 最高分 >= SELF_SCORE     —— 同上,而且對 stdin 也有效
      ③ (呼叫端另做)path 排除    —— 只有給檔路徑時做得到

    🔴 **已知洞(量到的,2026-08-22)**:①【只在草稿夠長時才叫】——
       實測 10 段的草稿吃掉 7/8 個名額(會叫);而只有 1 段擠進前 8 的草稿【不會叫】。
       ⇒ **短草稿自撞了而①靜悄悄。** ②(分數)也一樣:自撞的是後段而非第一名時不叫。
       🔴 **而【誤報】那一側同樣存在,第一版就踩了**(`-2e` 2026-08-22 從 log 量到):
       第一版照【任一來源】數,而【正本】是**一支檔裝著 400+ 則** ⇒
       「多數命中來自正本」是**健康且想要**的結果,而它會觸發警告。實測兩發一誤報。
       ⚠️ **一道誤報率高的閘比沒有閘更糟** —— 它先把「注意那行紅字」的習慣訓練掉,
          等它真的抓到自撞時沒有人會停下來。⇒ 已改成【只數 inbox/】+ 量出來的門檻。
       📌 **兩個方向都要寫** —— 只寫漏報那一側,清單本身就會被讀成完整的。
       ⇒ **真正的保護是 ③ path 排除;①② 是它失效時的後衛,而後衛的分母比病窄。**
    """
    out = []
    if not ranked:
        return out
    # 🔴 只數 inbox/ ——【正本】是【一份檔切出 400+ 則】,它們共用同一個 source 標籤,
    #    healthy 的一發本來就常有 5/8 是正本 ⇒ 照 source 數會【誤報】。
    #    (2026-08-22 自檢當場抓到:排除草稿之後仍然叫,而叫的原因是「正本 5 筆」。)
    #    memory 是一檔一則、天生佔不了名額 ⇒ 會霸佔名單的只可能是 inbox 的某一份檔。
    hog = Counter(s['source'] for _, s in ranked
                  if s['source'].startswith('inbox/')).most_common(1)
    if hog and hog[0][1] >= HOG_MIN:
        out.append('🔴 警告:%d/%d 個名額來自【同一份檔】%s。\n'
                   '   若那就是你的草稿 ⇒ 這一發【等於沒跑】(檔頭第六條)。'
                   '改用 `traps-neighbours.py <草稿路徑>` 重跑。'
                   % (hog[0][1], len(ranked), hog[0][0]))
    if ranked[0][0] >= SELF_SCORE:
        out.append('🔴 警告:最高分 %.4f ——【這通常代表你在跟自己比對】。\n'
                   '   完全相同的文字 cosine = 1.0000;真候選實測落在 0.15–0.55。'
                   % ranked[0][0])
    return out


LOG_REL = os.path.join('logs', 'traps-neighbours.jsonl')
# 🔴 為什麼要落檔(2026-08-22 `-4a` 提):**這支工具本身不落任何檔**
#    ⇒ 一旦跑它的那個 session 被壓縮,「那一發有沒有自撞」就再也查不回來了。
#    今天全隊查得成,只因為三個窗剛好都還沒被壓縮 —— 那是運氣,不是機制。
#    ⇒ 落檔之後,「那一發乾不乾淨」變成一個【查得到的事實】,不是靠回想的東西。
# 📌 位置選 logs/:`.gitignore:48` 已經有 `logs/` ⇒ **零 .gitignore 改動**。
# ⚠️ **效度限制,照實寫**:它是【本機】檔案,不進版控
#    ⇒ 換一台機器 / 重新 clone 就沒有歷史。它解的是「session 被壓縮」,不是「跨機器稽核」。


def write_log(root, query_src, counts, n_self, ranked, warned):
    """每跑一發落一行 JSON。🔴 落檔【失敗不得讓主流程死】—— 但也不得【安靜】。"""
    try:
        path = os.path.join(root, LOG_REL)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        rec = {
            'ts': __import__('datetime').datetime.now().astimezone().isoformat(timespec='seconds'),
            # 🔴 2026-08-25 Sean 拍板:免驗令必須綁【執行者】, 不是只綁時間。
            #    成因(量到的):七個窗共用一棵樹, 而本 log 原本沒有執行者欄位
            #    ⇒ 任何一個窗跑一次, 【所有窗】三小時內都免驗, 事後也查不出是誰跑的
            #    ⇒ 今天三次「重新發現一條已存在的教訓」全部落在別人跑過的三小時內。
            #    📌 那正是查重要防的東西的鏡像:一個人查過, 不代表下一個人知道他查到了什麼。
            #    ⚠️ 取不到 session 時寫 'unknown'。
            #    ~~而 hook 端【不把 unknown 當免驗】,因為「我不知道是誰跑的」與
            #      「是你跑的」不可以印同一個結果。~~
            #    ⇒ 2026-08-25 實查(下手窗複驗):**這個欄位目前有一個寫的人、零個讀的人。**
            #       🔴 量法要【扣掉本檔】才不會被自己汙染 —— 這段註解自己就是命中之一:
            #         `grep -rn 'CLAUDE_CODE_SESSION_ID' .husky scripts | grep -cv 'traps-neighbours.py'`
            #            ⇒ **0**(rc=1)⇒ 本檔以外沒有任何 hook 或腳本讀這個環境變數
            #         `grep -rn 'logs/' .husky/` ⇒ rc=1 零命中 ⇒ 沒有 hook 讀這份 log
            #         正對照(同一組指令、同一個扣法)
            #         `grep -rn 'pcm-reviewer-ran' .husky scripts | grep -cv 'traps-neighbours.py'`
            #            ⇒ **5**(`.husky/reviewer-gate.sh` ×4 + `scripts/write-reviewer-marker.sh` ×1)⇒ 尺會動
            #         負對照 `CLAUDE_CODE_SESSION_ID_zzz` 同一組指令 ⇒ 0 rc=1
            #       📌 **原本這三行報的是【絕對值】而它們會被自己改變** —— 對抗審查 R1 開的兩條 must-fix:
            #         ①「只有本檔這一行自己」在寫下它的那一刻就從 1 變成 2
            #         ②「正對照 4 行」是我**數錯**不是過期 —— `scripts/write-reviewer-marker.sh`
            #           從 `3e1dcd5b`(2026-08-11)就在了,量的當下正確答案是 5,我漏了它。
            #       🔴 **而「數錯」與「過期」在螢幕上長得一樣** —— 兩者都只是一個對不上的數字,
            #         分得開它們的是「去查那一行是什麼時候進來的」,不是再數一次。
            #    ⇒ **免驗令綁執行者這件事,寫的那一半做完了,讀的那一半還沒有。**
            #    🔴 **原句的危害不是它錯,是它會讓下一個人以為保護已經在了** ⇒ 他就不會去做讀的那一半。
            #       而那正是 Sean 拍這塊板要防的東西。劃掉不刪:下一個人要看得到曾經有人拿它當證據。
            'session': os.environ.get('CLAUDE_CODE_SESSION_ID') or 'unknown',
            'query_src': query_src,
            'corpus': {'canon': counts[0], 'inbox': counts[1], 'memory': counts[2]},
            'excluded_self': n_self,
            'warned': warned,
            'top': [{'rank': i, 'score': round(sc, 4), 'source': x['source'], 'line': x['line']}
                    for i, (sc, x) in enumerate(ranked, 1)],
        }
        with io.open(path, 'a', encoding='utf-8') as fh:
            fh.write(__import__('json').dumps(rec, ensure_ascii=False) + '\n')
        return path
    except OSError as e:
        print('⚠️ 紀錄沒落成(%s)⇒ 這一發【查不回來】,但結果本身有效。' % e, file=sys.stderr)
        return None


def bigrams(s):
    s = _STRIP.sub('', s)
    return Counter(s[i:i + 2] for i in range(len(s) - 1))


def ruler2_keywords(query, secs, k=6):
    """尺二(自己 grep 標題行)的候選關鍵字 —— 從草稿自己抽, 不要人去想。

    🔴 **為什麼要有它(2026-08-29 `-c8` 量, `de-c8-量測-TOPN夠不夠-20260829.md`)**:
       8 份真草稿的真近親名次 1,1,1,5,7,58,78,483 ⇒ 中位數 7、**前八外 3 份**
       (扣掉 3 份循環論證後仍是 中位數 7、前八外 2)。
       **而那三份漏掉的, 全部是靠【尺二】救回來的** ⇒
       📌 **尺二不是保險, 它是這個流程實際承重的一半 —— 而它只活在一句提醒裡。**
       ⚠️ **擴 TOP_N 救不了**:它們排 58/78/483, 要涵蓋 483 得開到 483 席。

    **本函式做的事很小, 而範圍要講清楚**:它**只拿掉「要自己想關鍵字」那一步**,
    **不會幫你跑** —— 跑不跑仍然是人的動作。
    🔴 **而它的噪音比例是量過的(R1, 20 份真草稿 120 個關鍵字)**:**含中文只有 43%**,
       **57% 是行號・日期・識別字碎片** —— **成因是「罕見優先」這個設計本身**。
       ⇒ **它省的是「想關鍵字」那一步, 不是「判斷」那一步。**
    ⚠️ 而它抽的是**字元 bigram**, 不是詞 ⇒ 抽出來的可能是半個詞;
       **那不影響它當 `grep -E` 的樣式**, 但**不要拿它當「這條的關鍵字就是這些」**。

    做法:草稿裡有、而【標題母體】裡最罕見的前 k 個 bigram。
    ⚠️ 沒有門檻常數 —— 罕見度直接印在旁邊, 讓讀的人自己看得到這把尺。
    """
    qb = bigrams(query)
    # ⚠️ ~~原本這裡有一個 `for x in secs: tf.update(bigrams(x['title']))`~~ **已刪** ——
    #    那是第二版的錯本尊(在剝過格式的空間數), 而它的結果在下面被整個重新指派 ⇒ 死碼。
    #    R1 量:它佔本函式 0.441 秒裡的 0.043 秒(10%)。
    #    📌 **把一把【已經被判死的尺】擺在正確那把上面, 讀的人會以為它還在用。**
    # 🔴 **只收【在標題母體裡真的出現過】的** —— 這一條是第一版漏掉而當場撞到的:
    #    tf == 0 的 bigram 拿去 grep 標題行, **保證回 0** ⇒ 那不是「查無」, 是尺根本接不上。
    #    而第一版按「最罕見優先」排, 0 次的一大堆 ⇒ 它挑出來的六個全是 tf=0 的碎片
    #    ⇒ **它會產出一條【永遠回 0 的指令】, 而那條指令看起來完全正常。**
    #    📌 與本檔記過的同一族:一把回 0 的尺, 與一個「那裡真的沒有」印同一個東西。
    # 🔴🔴 **第二個當場撞到的**:`tf` 原本數的是 `bigrams(title)` —— 而 `bigrams()` 會先 `_STRIP`
    #    掉 `*` `#` `【】` 等格式字元 ⇒ **它會造出原文裡沒有的 bigram**(例:`缺**席` 剝完變 `缺席`)。
    #    而我們要輸出的那條指令是拿 `grep` 去打【原始標題行】⇒ **尺與被量的東西住在兩個世界。**
    #    實測:第二版挑出 `缺席(1)`, 而 `grep '^## ' | grep 缺席` ⇒ **0 命中**。
    #    📌 **一把在剝過格式的空間裡數、而拿去原始空間用的尺, 兩邊都印得出數字, 而那個數字沒有意義。**
    #    ⇒ 改成在【原始標題行】上數子字串, 與那條指令看到的世界一致。
    # 🔴🔴🔴 **第三次, 同一個母題 —— 而三次的分母都不一樣**:上一版在【原始標題】上數對了,
    #    而它數的是【全語料:正本 + inbox + memory】, 而輸出那條指令只 grep **正本**。
    #    實測:它挑出 `缺席(1)`, 而正本 grep ⇒ **0**(那個 1 住在 inbox 或 memory 的標題裡)。
    #    📌 **同一個函式裡連續三次:格式空間 vs 原始空間 / 全語料 vs 正本 / 出現過 vs 沒出現過** ——
    #       **三次都印得出一個看起來正常的數字, 而三次組出來的指令都回 0。**
    #    ⇒ 判別句:**組指令的那把尺, 與那條指令要跑的地方, 必須是同一個分母。**
    raw = [x['title'] for x in secs if x['source'] == '正本']
    tf = Counter()
    for w in qb:
        c = sum(1 for t in raw if w in t)
        if c:
            tf[w] = c
    live = [w for w in qb if tf.get(w, 0) > 0]
    # 在【出現過】的裡面, 罕見優先(罕見 = 對標題 grep 有判別力);同罕見度時草稿裡越多次越優先
    order = sorted(live, key=lambda w: (tf[w], -qb[w], w))
    return [(w, tf[w]) for w in order[:k]]


def cosine(a, b):
    common = set(a) & set(b)
    if not common:
        return 0.0
    num = sum(a[k] * b[k] for k in common)
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    return num / (na * nb) if na and nb else 0.0


# 🔴 丙(2026-08-28 `-c8`):編號母題系列 —— 兄弟關係住在【檔案結構】,不住在詞彙裡。
#    成因是量到的:APPLYSHADOW1 那發,工具把 `:377`(③)送進第 5 名而我讀到了,
#    但同一串的 `:227`(①)排在第 451 名 ⇒ 相似度尺撈不到它。
#    ⚠️ 而「改成只吃標題行」實測【更糟】:`:227` 從第 451 掉到第 1340 名。
#    ⇒ 所以這裡不加第二把【詞彙】尺,改用一個不需要任何詞彙的關係:同一串編號。
NUMBERED = re.compile('^## [\u2460-\u2473\u3251-\u325f\u32b1-\u32bf]')


def _numberish(ch):
    """一把【比 NUMBERED 寬】的尺,只給自檢當對照用(MF2)。

    🔴 它刻意寬:寬尺誤報的成本是「開檔看一眼」,漏報的成本是【整串兄弟安靜消失】。
    """
    try:
        name = unicodedata.name(ch)
    except ValueError:
        return False
    return any(k in name for k in ('CIRCLED', 'PARENTHESIZED', 'FULLWIDTH DIGIT',
                                   'DINGBAT', 'IDEOGRAPHIC NUMBER'))


def numbered_family(secs):
    """正本裡的編號母題系列(①②③…)。回空 = 這份正本沒有編號條目, 呼叫端要出聲。"""
    return [s for s in secs if s['source'] == '正本' and NUMBERED.match(s['title'])]


def family_siblings(ranked, secs):
    """命中若有任何一條落在編號母題系列上 ⇒ 回傳【整串】(含命中那條);沒落在 ⇒ 回空。

    🔴 判別力來源:它不看分數、不看詞彙 —— 只看「命中那條是不是這一串的成員」。
       ⇒ 一個排在第 451 名的兄弟,只要它哥哥進了前八,它就會被印出來。
    ⚠️ 天花板:它只涵蓋【有編號的】那一串。沒編號的母題級通則(例:正本 :12156)
       仍然撈不到 —— 見輸出裡的失效 ⑦。"""
    if not any(s['source'] == '正本' and NUMBERED.match(s['title']) for _, s in ranked):
        return []
    return numbered_family(secs)


def rank(query, secs, n=TOP_N):
    qb = bigrams(query)
    scored = [(cosine(qb, s['bg']), s) for s in secs]
    scored.sort(key=lambda x: -x[0])
    return scored[:n]


def selfcheck(secs):
    """五個世界都要表演。第三個是 2026-08-22 補的:沒有它,
    「母體加了 inbox」與「加了但沒生效」印一模一樣的答案。
    🔴 第五個是 2026-08-22 `-86` 補的,而它【自帶反向對照】——
       只驗「排除後撈不到自己」是一格恆真的檢查(母體空掉也會過)。"""
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

    # ---- 世界五:排除【草稿自己】(2026-08-22 `-86` 的第六種失效) ----
    # 🔴 這一格【必須兩發】,而且兩發要印出【相反】的答案:
    #    只跑「排除後撈不到自己」的話,母體整個空掉也會通過 —— 那是恆真格。
    #    反向對照(不排除 ⇒ 第一名【必須】是自己)才證明「排除」真的做了事。
    #    ⇒ 把 exclude_self 改成 return secs, 0(等於拿掉排除)⇒ 世界五 FAIL。實測過。
    # 🔴 靶要挑【段落數最多】的那一份檔,不是【最長的那一段】。
    #    第一版挑 tgt_c(最長的一段)⇒ 它所屬的檔只有 1 段擠進前 8
    #    ⇒ 世界六①「髒的會叫」印【否】,而那不是警告壞掉,是【靶不夠髒】。
    #    ⚠️ 而這一格本身就是本工具的已知洞,見 collision_warnings 的 §限制。
    by_file = Counter(x['path'] for x in inbox)
    draft_path_sc = by_file.most_common(1)[0][0]
    draft = next(x for x in inbox if x['path'] == draft_path_sc)
    kept, n_cut = exclude_self(secs, draft['path'])
    w5 = rank(draft['text'], kept, TOP_N)
    leaked = [x for _, x in w5 if x['path'] == draft['path']]
    w5_ctrl = rank(draft['text'], secs, 3)          # 反向對照:同一份輸入,不排除
    ctrl_self = w5_ctrl[0][1]['path'] == draft['path']
    hit_e = n_cut > 0 and not leaked and ctrl_self
    print('世界五 排除草稿自己         ⇒ 剔除 %d 則,前 %d 名【零筆】來自它嗎? %s'
          % (n_cut, TOP_N, '是' if not leaked else '否(漏了 %d 筆)' % len(leaked)))
    print('       ↳ 反向對照(不排除)  ⇒ 第一名【就是】它自己嗎? %s (%s)'
          % ('是' if ctrl_self else '否 —— 排除沒判別力,這格是恆真的',
             w5_ctrl[0][1]['source']))

    # ---- 世界六:兩道自撞警告,各自要表演【該叫】與【不該叫】 ----
    # 🔴 只驗「髒的會叫」是恆真格:一個 `return ['警告']` 的假實作也會過。
    #    所以每一道都要配一發【乾淨的必須不叫】。
    # 🔴 餵【整份檔】,不是餵最長那一段 —— 真實用法是 `traps-neighbours.py <草稿檔>`,
    #    而第一版餵單段 ⇒ 自撞只佔 1/8 ⇒ 世界六①永遠印【否】。
    #    那不是警告壞了,是【靶不夠像真的】。實測:整份 4/8、單段 1/8。
    whole = io.open(draft['path'], encoding='utf-8').read()
    dirty = rank(whole, secs, TOP_N)                  # 沒排除 ⇒ 自撞
    clean = rank(whole, kept, TOP_N)                  # 排除了 ⇒ 乾淨
    w_dirty = collision_warnings(dirty)
    w_clean = collision_warnings(clean)
    hog_d = any('同一份檔' in w for w in w_dirty)
    hog_c = any('同一份檔' in w for w in w_clean)
    scr_d = any('跟自己比對' in w for w in collision_warnings([(1.0, draft)]))
    scr_c = any('跟自己比對' in w for w in collision_warnings([(0.35, draft)]))
    hit_f = hog_d and not hog_c and scr_d and not scr_c
    print('世界六 自撞警告①霸佔名額   ⇒ 髒的會叫 %s / 乾淨的【不叫】%s'
          % ('是' if hog_d else '否', '是' if not hog_c else '否 —— 恆真, 沒判別力'))
    print('       自撞警告②分數 >=%.1f ⇒ 1.0000 會叫 %s / 0.35 【不叫】%s'
          % (SELF_SCORE, '是' if scr_d else '否',
             '是' if not scr_c else '否 —— 恆真, 沒判別力'))

    # ---- 世界七:編號母題兄弟(丙,2026-08-28 `-c8`)。兩個世界都要表演 ----
    # 🔴 只驗「該印的印了」是恆真格:一個無條件 return 整串的假實作也會過。
    #    所以配一發【母體裡沒有編號條目】的反向對照 —— 那一發必須【不印】。
    fam_all = numbered_family(secs)
    if len(fam_all) < 2:
        print('世界七 FAIL:正本裡編號母題條目只有 %d 條 ⇒ 這道功能【沒有靶】'
              '(有人改了編號的寫法?)' % len(fam_all))
        return 1
    # 拿【最後一條】當靶:它不是第一條 ⇒「印整串」與「只印它自己」分得開
    tgt_g = fam_all[-1]
    w7 = rank(tgt_g['text'], secs, TOP_N)
    fam_pos = family_siblings(w7, secs)
    wide_seen = [x for x in secs
                 if x['source'] == '正本' and len(x['title']) > 3
                 and _numberish(x['title'][3])]
    wide = [x for x in wide_seen if not NUMBERED.match(x['title'])]
    # 🔴 M2(R3):上一版的 wide_alive 靠【寫在同一支檔裡的三個探針字】⇒ 實作可以把它們背下來
    #    (R3 實測:_numberish 改成只認 ① 與 ㊿ 兩個字 + 上界砍掉 ㊱-㊿
    #     ⇒ 13 條真條目安靜消失, 而畫面印「看到 1 條 / 看不到 0 條」、rc=0)。
    #    📌 **我補的守門本身, 就是它下一發突變的靶。**
    #    ⇒ 承重的改成【與語料掛鉤的量】:寬尺看到的必須 ⊇ 窄尺, 而且不得低於一個實測地板。
    #    WIDE_FLOOR=40 的依據:2026-08-28 當場量到 49 條, 而這一串只會長不會縮;
    #    真的掉到 40 以下 ⇒ 那份正本已經大改, 那時要來看的是這一行, 不是繞過它。
    wide_alive = (not _numberish('尺')
                  and len(wide_seen) >= WIDE_FLOOR
                  and len(wide_seen) >= len(fam_all))
    range_ok = wide_alive and not wide
    # 🔴 M1(R3 Fable,2026-08-28):上一版拿 `fam_pos` 與 `fam_all` 互比 ——
    #    而它們是【同一個函式的同一次呼叫結果】⇒ 把 numbered_family 截成 [:2]
    #    ⇒ 自檢印「整串 2 條」照樣 PASS、rc=0(當天實測),而排 451 名那個兄弟不再被印。
    #    ⇒ 期望值必須來自【另一個述詞】:寬尺走 unicodedata 的名字, 窄尺走 regex 範圍。
    #    ⚠️ 它們仍共用同一份 `secs` ⇒ 語料被動手腳時兩邊一起錯(見檔頭〈自檢的天花板〉)。
    pos_ok = (len(fam_pos) == len(wide_seen)
              and all(any(x is y for y in wide_seen) for x in fam_pos)
              and any(x is fam_all[0] for x in fam_pos))
    # 🔴 M3(R3):觸發條件是「前 N 名【任一】落在編號條上」,而上一版的靶自撞排第 1
    #    ⇒「任一」這個語意從來沒有在 >1 名的位置被演過:把觸發改成只看第 1 名, 自檢照樣 PASS。
    #    ⇒ 這裡直接構造一個【編號條排第 2】的命中清單, 它必須照樣觸發。
    non_num_first = next((x for x in secs
                          if not (x['source'] == '正本' and NUMBERED.match(x['title']))), None)
    rank2_ok = (non_num_first is not None
                and family_siblings([(0.9, non_num_first), (0.5, fam_all[0])], secs) != [])
    # 🔴 MF1(R5,2026-08-28):負對照【不可以】把編號條從母體抽掉 ——
    #    那一刀同時拿走【觸發條件】與【回傳內容】⇒ 一個無條件 `return numbered_family(secs)`
    #    的假實作也會回 []，自檢照樣 PASS(當天實測:改成假實作 ⇒ 仍 PASS、rc=0)。
    #    正確做法:母體【不動】,只讓【命中清單】裡沒有編號條 ⇒ 假實作會回整串 ⇒ 這一格才會紅。
    ranked_no_num = [(sc, x) for sc, x in rank(tgt_g['text'], secs, TOP_N * 4)
                     if not (x['source'] == '正本' and NUMBERED.match(x['title']))][:TOP_N]
    neg_ok = family_siblings(ranked_no_num, secs) == []
    # 🔴 MF2(R5):範圍退化沒有守門 —— 把上界從 ㊿ 縮小,世界七印「整串 38 條」而照樣 PASS。
    #    ⇒ 用一把【比自己寬】的尺當對照:任何 Unicode 名稱含這些關鍵字的字元都算編號候選。
    #    寬尺看得到而 NUMBERED 看不到 ⇒ 出聲(偏向多報,照板上〈寧可偏向多報〉那條)。
    # 🔴 R2(2026-08-28)抓到:上一版只數「寬尺看得到而 NUMBERED 看不到」的差集 ——
    #    而把 `_numberish` 改成 `return False`(寬尺死掉)⇒ 差集必然是 0 ⇒ 自檢 PASS。
    #    再疊上「上界縮到 ㉚」(真漏 18 條)⇒ **仍 PASS**。當天兩發都實測過。
    #    📌 **畫面上「= 0」與「這把尺死了」是同一句話** —— 與 MF1 同一個形狀, 只是高一層。
    #    ⇒ 三件一起要:①寬尺對【已知的正負靶】表演 ②印出它自己的分母 ③差集才有意義。
    hit_g = pos_ok and neg_ok and range_ok and rank2_ok
    print('世界七 編號母題兄弟(丙)   ⇒ 命中編號條【印整串 %d 條, 且含第一條】%s / '
          '命中清單裡沒有編號條【不印】%s'
          % (len(fam_all), '是' if pos_ok else '否',
             '是' if neg_ok else '否 —— 恆印, 沒判別力'))
    # 🔴 那個 0 要【帶著分母走】:單獨一個 0 分不出「沒漏」與「尺死了」。
    print('       ↳ 觸發語意「前 %d 名任一」在【第 2 名】的位置 ⇒ 照樣觸發嗎? %s'
          % (TOP_N, '是' if rank2_ok else '否 —— 那個「任一」從來沒被演過'))
    print('       ↳ 範圍退化守門  ⇒ 寬尺自身正負靶 %s · 寬尺看得到 %d 條 · 其中 NUMBERED 看不到 %d 條 %s'
          % ('通過' if wide_alive else '🔴 死了(①/㊿ 認不出, 或把「尺」當成編號)',
             len(wide_seen), len(wide), '' if range_ok else
             '🔴 漏了:' + ' / '.join(':%d %s' % (x['line'], x['title'][3:24]) for x in wide[:4])))

    # ---- 世界八:尺二關鍵字(2026-08-29 `-c8`)。三個世界, 而第三個守的是我當天連踩三次的那個病 ----
    trunk_titles = [x['title'] for x in secs if x['source'] == '正本']
    if not trunk_titles:
        print('世界八 FAIL:母體裡沒有正本標題 ⇒ 這道功能沒有靶')
        return 1
    # ① 該有:必須抽得出關鍵字。
    # 🔴🔴 **探針【不能】取自正本自己(R1 抓到, 而它量了)**:拿 479 條輪流當探針,
    #    只有 **238/479(49.7%)** 抓得到「全語料 vs 正本」那個錯 —— 而寫死的 `[0]`
    #    正好落在漏的那半 ⇒ **③ 是擲銅板, 而 M1(拿掉正本過濾)在它底下【全綠】。**
    #    📌 **一個探針與被測物同源時, 它量到的是「它們一致」, 不是「它對」。**
    #    ⇒ 改成拿【inbox 標題】當草稿:分母不同 ⇒ 若實作誤數全語料,
    #      它會挑到「inbox 有而正本沒有」的字 ⇒ ③ 必紅。
    probe_titles = [x['title'] for x in secs if x['source'].startswith('inbox/')]
    if not probe_titles:
        print('世界八 FAIL:母體裡沒有 inbox 標題 ⇒ ③ 的探針與被測物會同源, 這一格失去判別力')
        return 1
    kw_pos = ruler2_keywords(' '.join(probe_titles[:5]), secs)
    h8a = len(kw_pos) > 0
    # ② 該無:餵一段【每個 bigram 都不在正本標題裡】的字 ⇒ 必須抽不出東西
    # ⚠️ ~~原註解寫「靶要現場現造, 不寫死」~~ **那是修辭, 不是保護(R1 抓到)**:
    #    `U+9F00–U+9F7E` 是**真的 CJK 統一漢字**(含常用字「鼎」), 不是私有區,
    #    而這 40 字是**寫死的** ⇒ 有人把它抄進正本照樣安靜失效。
    #    ✅ 改用私有區 `U+E000+` —— 那一塊【不會】出現在任何正常中文檔裡。
    junk = ''.join(chr(0xE000 + (i * 7) % 0x80) for i in range(40))
    kw_neg = ruler2_keywords(junk, secs)
    h8b = (len(kw_neg) == 0)
    # ③ 🔴🔴 分母對齊:抽出來的【每一個】關鍵字, 拿去正本標題裡找都必須真的找得到
    #    這一格守的是 2026-08-29 當天連續踩到的三種錯(格式空間 / 全語料 / tf=0),
    #    **它們三次都印得出一個看起來正常的數字, 而組出來的指令都回 0。**
    h8c = all(any(w in t for t in trunk_titles) for w, _ in kw_pos) and bool(kw_pos)
    hit_h = h8a and h8b and h8c
    print('世界八 尺二關鍵字           ⇒ 【inbox】標題當草稿(刻意與被測物不同源)抽得到 %s / '
          '私有區字元(U+E000+)抽不到 %s / 每個關鍵字在【正本】標題裡真的找得到 %s'
          % ('是' if h8a else '否', '是' if h8b else '否', '是' if h8c else '否'))

    ok = (hit_a and not hit_b and hit_c and hit_d and hit_e and hit_f and hit_g
          and hit_h)
    print('⇒ 自檢 %s' % ('PASS(八個世界印出不同答案)' if ok else 'FAIL(尺沒有判別力)'))
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

    draft_path = None
    if args:
        # 🔴 nit(R3):路徑打錯 ⇒ 裸 FileNotFoundError, 而讀的人要從 traceback 裡撿檔名。
        try:
            query = io.open(args[0], encoding='utf-8').read()
        except OSError as e:
            sys.exit('🔴 草稿讀不到:%s\n   %s\n'
                     '   ⇒ 這是【路徑錯】不是【查無近親】—— 兩者的下一步完全不同。' % (args[0], e))
        except UnicodeDecodeError as e:
            sys.exit('🔴 草稿不是 UTF-8:%s\n   %s' % (args[0], e))
        draft_path = args[0]
    elif not sys.stdin.isatty():
        query = sys.stdin.read()
        # 🔴 走 stdin 時我【不知道草稿是哪一份檔】⇒ 排不掉它自己。
        #    而檔頭第六條的病在這條路上原封不動 —— 修了 file 那條卻沒修這條,
        #    等於把同一個坑留在一個【文件明列為合法】的用法裡。出聲,不要安靜。
        print('🔴 走 stdin ⇒ 我不知道草稿是哪一份檔,【排不掉它自己】。\n'
              '   草稿若已經在 traps-inbox/ 裡,改用:'
              'python3 scripts/traps-neighbours.py <草稿路徑>', file=sys.stderr)
    else:
        sys.exit('用法:traps-neighbours.py <草稿檔>  或  cat 草稿 | traps-neighbours.py')
    if not _STRIP.sub('', query):
        sys.exit('草稿是空的(剝掉格式之後沒有字)')

    secs, n_self = exclude_self(secs, draft_path)
    print('分母:正本 %d + inbox %d + memory %d = %d 則(當場切的,不是寫死的)'
          % (n_canon, n_inbox, n_mem, len(secs) + n_self))
    if n_self:
        print('🔴 已從母體剔除【草稿自己】%d 則(它就在 traps-inbox/ 裡)⇒ 實際比對 %d 則。'
              % (n_self, len(secs)))
        print('   沒有這一步的話,這 8 個名額會【全部】被你自己那份檔佔滿 —— 見檔頭第六條。')
    print('🔴 三種來源意義不同:【正本】有 ⇒ 這條不新;【inbox】有 ⇒ 寫過而還沒進正本;')
    print('   【memory】有 ⇒ 它是跨專案的行為教訓(`feedback_*` 那一族主要住這裡)')
    # 🔴 這份清單要印在【終端機】,不能只寫在檔頭 —— 跑工具的人讀的是輸出,不是原始碼。
    #    (2026-08-22:⑥ 一度只活在 docstring 裡,而那等於沒有人看得到它。)
    print('⚠️ 這是【候選】不是【判定】。本工具已知的【七】種失效(①-⑥ 量於 2026-08-22、⑦ 量於 2026-08-28):')
    print('   ① 排名低到會被放行(真正撞車的排第 5 名、分數低快三倍)')
    print('      ⤷ 2026-08-22 `-86`:真正同族的是【正本表格裡的一列】(:202,一格文字),')
    print('        它太短 ⇒ bigram 撈不到、八名之內零命中。**表格的一列天生比段落難被查到。**')
    print('        那次是【讀了表格全文】才確認同族的,不是靠排名 ⇒ 排名沒撞不代表沒撞。')
    print('   ② 完全不在名單上(兩套詞彙字元重疊極低時,最高分只有 0.1311 而那還是無關的)')
    print('   ③ 連作者本人都忘了自己幾小時前寫過(而漏掉的三方裡有一個是作者)')
    print('   ④ 道①最高只有 0.1740,而【grep 標題行】當場撈到真正那條')
    print('   ⑤ 🔴 候選住在工具看不到的抽屜裡(memory —— 本版才補上)')
    print('   ⑥ 🔴 草稿存進 traps-inbox/ 之後才跑 ⇒ 名單被草稿【自己】占滿、真候選 0 條。')
    print('      外觀是【滿滿八列、分數還特別高】—— 前五種讓你知道自己在賭,')
    print('      這一種讓你【以為你查過了】;而越照規矩做越會踩到(先寫成檔再跑檢查)。')
    print('      ✅ 給檔路徑時已自動排除;⚠️ 走 stdin 排不掉 —— 兩道後衛的漏報/誤報側見檔頭。')
    print('   ⑦ 🔴 **母題級通則撈不到, 而那是 bigram 的結構性盲區、不是參數沒調好**')
    print('      (2026-08-28 `-c8` 量:正本 `:227` 第 451 名 / `:12156` 第 921 名 —— 兩條都是真同族)。')
    print('      成因:那種條目的正文講的是 `refund-repository.ts` / `COALESCE` / `git add -N`,')
    print('      與你的草稿【字面重疊接近零, 而概念完全同族】⇒ 換成只吃標題行更糟(:227 掉到第 1340)。')
    print('      ⇒ 下面那串【編號母題兄弟】接住其中一類;沒編號的那一類, 目前只有【讀了才知道】。')
    print('🔴 ⇒ 除了讀下面這 8 條,再拿【你那條的機制關鍵字】自己 grep 一次標題行。')
    kw = ruler2_keywords(query, secs)
    if kw:
        print('   ⇒ **尺二, 已經幫你組好了**(關鍵字從你的草稿抽, 括號是它在標題母體裡出現幾次):')
        print('        %s' % ' · '.join('%s(%d)' % (w, n) for w, n in kw))
        # 🔴🔴 **第四次, 同一個母題(R1 抓到)**:上面那個次數是用 Python `w in t`【字面】數的,
        #    而這裡原本印 `grep -E`【regex】⇒ **數的世界與跑的世界又不一樣。**
        #    R1 實測:一份含 `\s` / `it.fails` 的草稿 ⇒ 印出 `\s(1) · .f(1)`,
        #    而那條指令貼下去 **479/479 全中**(字面意義只有 5)。
        #    ⇒ 一律用 `grep -F -e`(字面), 與計數那一側同一個世界。
        print("        grep -n '^## ' %s | grep -F %s"
              % (TRAPS, ' '.join("-e '%s'" % w.replace("'", "'\\''") for w, _ in kw)))
        print('        負對照:把樣式換成一個【現場現造】的字串 ⇒ 必須回 0')
        print('   ⚠️ 它【不會幫你跑】—— 只拿掉「要自己想關鍵字」那一步;'
              '而抽的是字元 bigram, 可能是半個詞。')
    print('')
    ranked = rank(query, secs)
    for i, (score, s) in enumerate(ranked, 1):
        print('%2d. %.4f  [%s] :%-6d %s' % (i, score, s['source'], s['line'], s['title'][:76]))
    # 🔴 事後偵測(第六種失效的【後衛】):不管它是怎麼混進來的 —— stdin、symlink、
    #    日後有人改壞 exclude_self —— 這兩道都還會叫。
    #    ⚠️ 它們【不是】排除的替代品,是排除失效時唯一還會叫的東西。
    # 🔴 丙:命中落在編號母題系列上 ⇒ 把整串印出來(不需要任何人想對關鍵字)
    fam = family_siblings(ranked, secs)
    if fam:
        print('\n🔴 前 %d 名裡有條目落在【編號母題系列】上 ⇒ 整串 %d 條列在這裡'
              '(兄弟關係是檔案結構,不是相似度):' % (TOP_N, len(fam)))
        for s in fam:
            print('    :%-6d %s' % (s['line'], s['title'][3:88]))
        print('    ⇒ 這一串【沒有分數】—— 它們不是被算出來的, 是被【命中那條的位置】帶出來的。')
        # 🔴 Q4(R3):殘留限制只活在原始碼註解 ⇒ 違反本檔自己 :562 那句
        #    「跑工具的人讀的是輸出, 不是原始碼」⇒ 改成常駐印出來。
        print('    ⚠️ 這一串【可能混了不只一串】—— 偵測只接得住「第二串重新起頭」那半;'
              '兩串接得上時(①-⑤ 與 ⑥-⑩)它看不見。串的邊界【行距 / `# ` 章節可判, 而本版沒做】。')
        # 🔴 編號會重複:正本裡不只一串用同一組符號(2026-08-28 量到標題為「尺自己壞掉,而它印出一個乾淨的數字」那一條
        #    (🔴 **認標題字串, 不要認行號**:同一個位置 08-28 一天內量到 24015 ⇒ 24024 ⇒ 24054,
        #     三次都是本 repo 自己的 commit 推的。行號由輸出當場算, 不寫死在註解裡)(⚠️ 原寫 `:24015`, 而【推翻它的那顆 commit `0eef771a` 是同一個人推的】——
        #    那次加了三段交叉指標共 9 行, 把它往下推 9 行。行號會漂 ⇒ 認標題字串) 的 ⑩
        #    屬於另一串)。不靜靜合併 —— 合併過的清單看起來與「一串」一模一樣。
        syms = [s['title'][3] for s in fam]
        dup = [k for k, c in Counter(syms).items() if c > 1]
        if dup:
            print('    ⚠️ 其中 %s 出現不只一次 ⇒ 這裡【不只一串】, 是同一組符號被兩串各用了一次。'
                  % '/'.join(sorted(dup)))
        # 🔴 nit(R5,2026-08-28):只抓「同符號重複」會漏掉【兩串符號不重疊】的情況
        #    (例如一串 ①-⑤、另一串 ⑥-⑩ ⇒ 零重複, 而它們是兩串)⇒ 那正是上面那段註解自己在防的形狀。
        #    改用【單調遞增】當判準:一串正常的編號碼點是遞增的;第二串重新起頭會讓它掉下來。
        # 🔴🔴 殘留限制(2026-08-28 折 R5 那條 nit 時當場兩側測出來的, **不要讀成已修好**):
        #      該叫  第二串【重新起頭】(①-⑤ 之後又出現 ①-③)⇒ 掉下來 ⇒ 會叫（實測 1 筆）
        #      該不叫 一串正常遞增                              ⇒ 0 筆（實測）
        #    ⚠️ 而 R5 點名的那一種【它看不見】:兩串符號【不重疊而且接得上】
        #      (①-⑤ 是一串、⑥-⑩ 是另一串)⇒ 碼點仍然一路遞增 ⇒ 0 筆。
        #    ⇒ **這一條只把「重新起頭」那半接住了, 另一半仍然安靜。**
        #    ~~修它需要「串的邊界」這個資訊, 而檔案裡沒有任何東西標它~~
        #    🔴 **上面那句是假的, R2 去量了(2026-08-28)**:串的邊界【標在行距裡】——
        #      49 條的行距中位數 **40**, 而那顆外來的 ⑩ 與前一條差 **21,212 行(530 倍)**。
        #      另外 `## ` 上層的 `# ` 章節也標得出來(`load_sections` 目前沒記而已)。
        #    ⇒ **行距 / 章節可判, 而本版沒做。** 這是【還沒做】, 不是【做不到】——
        #      📌 而我原本那句會【關掉下一個人的尋找動作】, 那種句子要能被證明。
        drops = [(syms[i - 1], syms[i]) for i in range(1, len(syms))
                 if ord(syms[i]) <= ord(syms[i - 1])]
        if drops and not dup:
            print('    ⚠️ 編號沒有一路遞增(%s)⇒ 這裡很可能【不只一串】, 而它們的符號不重疊。'
                  % ' / '.join('%s→%s' % d for d in drops[:3]))
        # 🔴 nit(R5):天花板 —— 序列已經走到哪裡, 離範圍上界還剩幾格
        # 🔴 nit(R2):序列長度不可以用 len(fam) —— 那把【外來的那一串】也算進去了(實測差 1)。
        #    要數的是【單調遞增那一段】,它在第二串重新起頭的地方自己停下來。
        run = 1
        for _i in range(1, len(syms)):
            if ord(syms[_i]) > ord(syms[_i - 1]):
                run += 1
            else:
                break
        last = ord(syms[run - 1])
        left = 0x32bf - last
        if left <= 4:
            print('    🔴 序列已到 %s, 而 NUMBERED 的上界是 ㊿ ⇒ 【只剩 %d 格】。'
                  '第 %d 條之後沒有對應的圓圈字 —— 那時要換編法, 不是把範圍再往上開。'
                  % (chr(last), left, run + left + 1))
    else:
        print('\n(前 %d 名沒有任何一條落在編號母題系列上 ⇒ 不印兄弟清單。'
              '這一行證明它有在判,不是恆印。)' % TOP_N)

    warns = collision_warnings(ranked, n_self)
    for w in warns:
        print('\n' + w)

    lp = write_log(root, (draft_path or '<stdin>'), (n_canon, n_inbox, n_mem),
                   n_self, ranked, bool(warns))
    if lp:
        print('\n📝 這一發已落紀錄:%s(第 %d 行)' % (LOG_REL, sum(1 for _ in io.open(lp, encoding='utf-8'))))
    print('\n貼進投稿時要寫:**我開了哪幾條、為什麼判它不同族** —— 不是只貼這張表,也不要只寫「都不像」。')


if __name__ == '__main__':
    main()
