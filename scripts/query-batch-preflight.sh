#!/bin/bash
# 送出前自檢 —— 給 Sean 的唯讀查詢批次
#
# 🔴 這支腳本的存在理由:
#   任何一輪「這批可以給他了」的結論,在【下一次有人 append 的那一刻】就過期。
#   實錘 2026-08-19:主視窗 04:5x 宣告「五項全過、可以給他」,而 05:03 有人加了一段
#   ⇒ 那個結論【8 分鐘後失效】,而檔案上沒有任何東西會變色。
# ⇒ 所以:**送出去的那一刻,由送的人當場跑這支**,而不是引用某一輪的結論。
#
# 用法:bash scripts/query-batch-preflight.sh [檔案路徑]
#   不給路徑 ⇒ 自動找 ~/pcm-mailbox/G5-015*
set -u

F="${1:-$(ls "$HOME"/pcm-mailbox/G5-015* 2>/dev/null | head -1)}"
[ -f "$F" ] || { echo "🔴 找不到檔案:${F:-<空>}"; exit 2; }
echo "檔案:$F"
echo "此刻:$(date '+%Y-%m-%d %H:%M:%S')  /  檔案 mtime:$(ls -l "$F" | awk '{print $6,$7,$8}')"
echo

python3 - "$F" <<'PY'
import sys, re, io
p = sys.argv[1]
s = io.open(p, encoding='utf-8').read()
F = '`' * 3
fail = 0

qs = re.findall(r'^# (Q\d+) · (.+)$', s, re.M)
blocks, cur = {}, None
for line in s.split('\n'):
    m = re.match(r'^# (Q\d+) · ', line)
    if m: cur = m.group(1)
    if line.startswith(F + 'sql') and cur:
        blocks[cur] = blocks.get(cur, 0) + 1
tot = sum(blocks.values())

# ① 目錄對得上
m = re.search(r'\*\*目前共 (\d+) 段 / (\d+) 個 SQL 區塊\*\*', s)
if not m:
    print('🔴 ① 目錄:找不到「目前共 N 段 / M 個 SQL 區塊」那一行'); fail += 1
elif int(m.group(1)) != len(qs) or int(m.group(2)) != tot:
    print('🔴 ① 目錄過期:宣稱 %s 段 / %s 塊,實際 %d 段 / %d 塊'
          % (m.group(1), m.group(2), len(qs), tot)); fail += 1
else:
    print('✅ ① 目錄對得上:%d 段 / %d 塊' % (len(qs), tot))

# ② 每段五件套
# 🔴 兩把尺:2026-08-19 實錘 —— 判讀標記有兩種寫法(粗體 / ## 標題),
# 兩個人各用一把,得到【兩個方向相反的假名單】,而兩邊都只對一半。
# ⇒ 所以這一項【兩把尺都跑】,而兩把不一致本身就是要看的訊號。
RULERS = {
    'A(內容字面)': lambda b: ('看結果' in b or '代表什麼' in b or '怎麼看' in b),
    'B(## 標題)':  lambda b: bool(re.search(r'^##.*(看|結果|代表)', b, re.M)),
}
need = [('在問什麼', lambda b: '在問什麼' in b),
        ('回報句',   lambda b: '這一段貼完就回一次' in b),
        ('對照組標記', lambda b: '對照組' in b)]
secs = re.split(r'^# (Q\d+) · ', s, flags=re.M)
miss, hits = [], {k: [] for k in RULERS}
for i in range(1, len(secs), 2):
    q, b = secs[i], secs[i + 1]
    bad = [k for k, f in need if not f(b)]
    for k, f in RULERS.items():
        if f(b): hits[k].append(q)
    if not any(f(b) for f in RULERS.values()): bad.append('判讀(兩把尺都沒撈到)')
    if bad: miss.append((q, bad))
for k, v in hits.items():
    print('   尺 %s 撈到 %d/%d 段' % (k, len(v), len(qs)))
both = set.intersection(*[set(v) for v in hits.values()]) if hits else set()
diff = {k: sorted(set(v) - both) for k, v in hits.items()}
if any(diff.values()):
    print('   ⚠️ 兩把尺不一致 ⇒ 單用任一把會得到假名單:%s'
          % {k: v for k, v in diff.items() if v})
if miss:
    for q, bad in miss: print('🔴 ② %s 缺:%s' % (q, bad))
    fail += 1
else:
    print('✅ ② 每段五件套齊(%d 段,判讀=兩把尺聯集)' % len(qs))

# ③ 唯讀
bl = re.findall(r'```sql\n(.*?)```', s, re.S)
dg = r'\b(insert|update|delete|drop|alter|grant|revoke|truncate|create|comment on|refresh|call|do)\b'
bad = []
for i, b in enumerate(bl, 1):
    body = '\n'.join(l for l in b.split('\n') if not l.strip().startswith('--'))
    ls = [l.strip() for l in body.split('\n') if l.strip()]
    kw = ls[0].split()[0].lower() if ls else '(空)'
    hit = sorted(set(x.lower() for x in re.findall(dg, body, re.I)))
    if kw not in ('select', 'with') or hit: bad.append((i, kw, hit))
if bad:
    print('🔴 ③ 唯讀:', bad); fail += 1
else:
    ctl = sorted(set(re.findall(dg, "select 1; drop table t;", re.I)))
    print('✅ ③ 唯讀:%d 塊全過(負向對照 ⇒ %s ⇒ 尺會動)' % (len(bl), ctl))

# ④ 🔴 待補字面 —— **印出來給人看,不自動判定**
print()
print('④ 🔴 下面這些要【人】看一眼 —— 機器分不出【訃聞】與【殘留】:')
found = False
for i, l in enumerate(s.split('\n'), 1):
    if re.search(r'仍空著|待補|TODO|尚未|還沒補|追加中', l):
        found = True
        mark = '(在刪除線裡 ⇒ 多半是訃聞)' if '~~' in l else '🔴 ← 沒有刪除線,要開檔判'
        print('   %5d %s %s' % (i, l.strip()[:70], mark))
if not found:
    print('   (零命中)')
print('   ⚠️ 2026-08-19 實錘:有人 grep「仍空著」回 2 處而判定「還沒補」——')
print('      實際兩處都在 ~~…~~ 裡。**留痕與殘留在 grep 上長得一模一樣。**')

print()
print('=' * 60)
if fail:
    print('🔴 有 %d 項沒過 ⇒ **先別送出去**' % fail); sys.exit(1)
print('✅ 前三項全過。而 ④ 那格要你自己看過才算。')
print('🔴 而這個結論的有效期 = 【到下一次有人 append 為止】。')
PY
