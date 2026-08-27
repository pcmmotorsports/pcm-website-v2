# `docs/launch-todo.md` 態序列快照 · T1(第一個量測時點)· 2026-08-27

> 產出:複量窗 9e(Fable)。主視窗 `-5b` 2026-08-27 批准新增本檔(只新增、不改既有檔;commit 由主視窗做)。
> **用途在未來**:本檔是「板子是待辦清單還是墳場」那題的**第一個量測點**。那題的判別句(複量窗 9e 2026-08-27 立,主視窗收):
> **open 列裡「態 N 天沒動」的比例隨天數下降 ⇒ 板子在流;不隨天數下降 ⇒ 墳場。** 它需要 ≥2 個時點;T2 用同一把尺重量、與本檔逐列比 `seq` / `last_change_date`。
> 🔴 **不挑 N**:板子 08-23 才出生,T1 時每列年齡值域 {2,3,4},任何 N 都是在挑答案(複量-9e-板子年齡-20260827 §判)。

## 量測時點與尺(數字離開現場要帶著走)
- `snapshot_at` 見下方 TSV 第一行(`2026-08-27T11:15+0800`);HEAD `b1a4fa99`;板子最後一顆 commit `ae68e6c4`;動過板子的 commit 共 **61**;工作樹板子 dirty=no。
- 分母(現檔四態,當場數):**open 52 / doing 9 / parked 13 / done 33 = 107 列**;TSV 收全部 107 列(`--all`)。
- 尺 = 本檔尾的 `board-snapshot.py`(逐字內嵌;重跑指令見下)。每列取「事」欄正規化字面做識別,走 61 個版本讀態欄 ⇒ `seq`;`first_*` = 板子上首見,`last_change_*` = 最後一次態變(`-` = 自首見未變)。
- 🔴 已修的盲區:08-24~08-25 的 26 個行版本把態寫成 `| ~~open~~ **done** |` / `| ~~open~~ **半關** |`,舊 regex 整行不認 ⇒ 那些版本隱形、fuse 列曾被讀成 SSO 列的態。本尺接受三種形狀,只配「事」欄不配整行。
- 已知盲區:標題改字超過 6 字層仍對不上的列會少算早期版本(`versions_found` < 61 就是訊號;T1 最低 46);`ambig` > 0 = 該列有版本與別列撞字面、那些版本不計。**態變只代表有人改了那格字,不代表事情做完**(推動 vs 登記見 `~/pcm-mailbox/複量-9e-done推動或登記-20260827.md`)。

## T2 怎麼量(用同一把尺,否則兩個時點不可比)
```bash
awk '/^```python$/{f=1;next} /^```$/{f=0} f' docs/audits/2026-08-27-launch-todo-state-snapshot-t1.md > /tmp/board-snapshot.py && python3 /tmp/board-snapshot.py --all > /tmp/board-snapshot-t2.tsv
```
然後以 `literal` 欄(不是 `line`,列會搬)對齊 T1/T2,看 open 列的 `last_change_date` 有沒有動、`seq` 有沒有長。T1 自檢:抽出後重跑,除第一行(時點/HEAD)外 107 列逐字相同(產本檔時已驗一次,見 `~/pcm-mailbox/複量-9e-板子流出率-20260827.md` 之後的交件訊息)。

## T1 快照(TSV;107 列)
```tsv
# snapshot_at=2026-08-27T11:15+0800	head=b1a4fa99	board_last_commit=ae68e6c4	board_commits=61	ruler=board-snapshot.py
line	state	ref	literal	first_commit	first_date	last_change_commit	last_change_date	seq	versions_found	ambig
120	parked	—	贈品(0 元)上不了架 —— 供應商匯入那道閘擋著	52b94490	2026-08-25	-	-	parked	24	0
121	parked	—	贈品結帳被擋時客人看到的文案是誤導的	52b94490	2026-08-25	-	-	parked	24	0
122	doing	—	B5-a 後台去讀票上的身分	2dc77054	2026-08-23	52b94490	2026-08-25	open→doing	61	0
128	parked	—	B5-b 讀取閘去查員工名單	2dc77054	2026-08-23	-	-	parked	61	0
129	open	—	B7 端到端負向驗收 +	2dc77054	2026-08-23	-	-	open	61	0
151	done	⑦	客人可偽造 cookie	2dc77054	2026-08-23	f5d5d325	2026-08-25	open→done	61	0
152	open	⑪	用 LINE 的客人拿不到出貨通知	2dc77054	2026-08-23	-	-	open	61	0
153	open	③	新表出生自帶對外權限	2dc77054	2026-08-23	-	-	open	61	0
158	open	⑤	結算程式死了沒人知道	2dc77054	2026-08-23	-	-	open	61	0
159	open	①	TapPay 通知端點沒有限流	2dc77054	2026-08-23	-	-	open	61	0
160	parked	②	有人可灌爆通知信箱	2dc77054	2026-08-23	-	-	parked	61	0
161	open	④	`net` 兩表對外全開	2dc77054	2026-08-23	-	-	open	61	0
162	open	⑥	錢真的記成「已付」那步沒被走過	2dc77054	2026-08-23	-	-	open	61	0
163	done	⑧	三個排程開關現值沒人親眼看過	2dc77054	2026-08-23	7307b0f7	2026-08-23	open→done	61	0
164	parked	⑫	LINE token 洩漏可冒用官方帳號發訊	2dc77054	2026-08-23	7307b0f7	2026-08-23	open→parked	61	0
165	open	⑯b	報價單那邊 2FA 現值要重量	2dc77054	2026-08-23	-	-	open	61	0
166	done	⑳	員工分權那題只是沒結案	2dc77054	2026-08-23	8a21e69b	2026-08-26	parked→done	61	0
167	open	總帳無號	三個要【回來看】的數字 —— 沒人看就等於沒開	5ef02b10	2026-08-23	-	-	open	57	0
168	open	總帳無號	改 Bot Protection 為 `Challenge` 的【前置】—— 不是它的旁邊	5ef02b10	2026-08-23	-	-	open	57	0
169	parked	總帳無號	OWASP Core Ruleset 拿不到 —— Enterprise 專屬	7307b0f7	2026-08-23	-	-	parked	58	0
170	open	總帳無號	merge/deploy 前的安全閘 —— 腳本寫好了、沒有人呼叫它	572ecb53	2026-08-23	-	-	open	59	0
171	open	總帳無號	註冊那道門是【公開端點】, 而信箱驗證是關的	572ecb53	2026-08-23	-	-	open	59	0
172	parked	總帳無號	最終全站滲透測試 —— 屆時把 strix 當第二把尺	572ecb53	2026-08-23	-	-	parked	59	0
173	open	總帳無號	兩支登入回呼「被打過沒有」查不到,而其中一支【什麼痕跡都沒有】	9be50e20	2026-08-25	-	-	open	25	0
183	doing	#858	手動建訂單(客人匯款那條路)—— 2026-08-26 拆號:本列是【觀察條目】,實作那一片在 `#939`(本檔 `:350`)。—— 不是手動建商品,兩條線	858b10e1	2026-08-26	-	-	doing	9	0
186	doing	—	訂單確認信改版(HTML + 金額 + PDF)	2dc77054	2026-08-23	-	-	doing	61	0
187	doing	#841	登錄匯款後單子從畫面消失	2dc77054	2026-08-23	-	-	doing	61	0
188	open	—	寄信額度會爆, 而【沒有任何東西在看它】	74b0240c	2026-08-25	-	-	open	39	0
189	open	—	`scripts-whitelist-gate` 的名字比它的分母寬十倍	74b0240c	2026-08-25	-	-	open	39	0
190	open	—	出貨文件 PDF(一鍵出圖傳客人)	2dc77054	2026-08-23	-	-	open	61	0
191	done	#806	解除退款封印	2dc77054	2026-08-23	7f326ddf	2026-08-23	open→done	61	0
199	open	—	總帳狀態欄加封閉集欄位	2dc77054	2026-08-23	-	-	open	61	0
200	open	#838	traps-inbox 收割停了而堆積翻倍	2dc77054	2026-08-23	-	-	open	61	0
201	done	—	三顆「等事件」觸發器記成一張清單	2dc77054	2026-08-23	7dc1616b	2026-08-25	open→done	61	0
202	parked	—	33 項「員工的一天」6 格重量	2dc77054	2026-08-23	8a21e69b	2026-08-26	doing→parked	61	0
203	parked	—	刷新 `docs/progress-roadmap.html`	2dc77054	2026-08-23	-	-	parked	61	0
211	open	—	新品牌上架後客人看到 404	0ab8fbaa	2026-08-23	-	-	open	60	0
212	open	—	品牌牆撈不到就整面全灰,而且不說話	0ab8fbaa	2026-08-23	-	-	open	60	0
213	open	#64	客人拿不到發票	0ab8fbaa	2026-08-23	-	-	open	60	0
214	open	#35 #183 #821	全站沒有搜尋	0ab8fbaa	2026-08-23	-	-	open	60	0
215	open	#136	頁尾「聯絡客服」灰掉按不動	0ab8fbaa	2026-08-23	5f7f19b6	2026-08-25	open→parked→open	60	0
216	parked	—	`dev`→`main` 部署(顧客站上線)—— 先不 merge,解封條件具名	ae68e6c4	2026-08-27	-	-	parked	1	0
224	open	#892	CI 已經連紅約 74 小時	0ab8fbaa	2026-08-23	ae68e6c4	2026-08-27	open→doing→done→open	60	0
225	done	#315	`brand-products.test.ts` 紅 —— 釘住清單過期	0ab8fbaa	2026-08-23	7307b0f7	2026-08-23	open→done	60	0
226	done	#701	`procurement-wiring` 3 個 unhandled error	0ab8fbaa	2026-08-23	7307b0f7	2026-08-23	open→done	60	0
227	done	—	沒有任何東西對【新增的 	0ab8fbaa	2026-08-23	750eb005	2026-08-24	open→done	60	0
228	done	—	`migration-p	0ab8fbaa	2026-08-23	750eb005	2026-08-24	open→done	60	0
230	done	—	`20260823030000` 那支 SQL 沒有被 `git add`	0ab8fbaa	2026-08-23	7307b0f7	2026-08-23	open→done	60	0
231	done	—	放寬推 dev 的閘 —— Sean 2026-08-24 答「放寬」	0ab8fbaa	2026-08-23	a1e30bb6	2026-08-25	open→done	60	0
232	done	—	放寬那道閘的第三格驗收(最容易被跳過的)	0ab8fbaa	2026-08-23	a1e30bb6	2026-08-25	open→done	60	0
233	done	—	`20260822010000`(出貨信 view)到底套了沒	0ab8fbaa	2026-08-23	3c3efdee	2026-08-25	open→done	60	0
234	open	#299	整張正式資料表不在版控裡 —— 用 repo 從零重建資料庫這條路是斷的	b9e51b82	2026-08-25	-	-	open	45	0
242	open	—	優惠券／折扣碼 —— Sean 逐字「開發啊,去做啊」	0ab8fbaa	2026-08-23	-	-	open	60	0
243	open	—	客戶篩選多軸 + 註冊表單加性別 —— 他逐字「當然要做啊......... 性別、生日這個在客戶註冊時候也要有」	0ab8fbaa	2026-08-23	-	-	open	60	0
244	open	#660 #390	商品編輯後台 —— Sean 2026-08-24 已定義範圍	0ab8fbaa	2026-08-23	-	-	open	60	0
245	open	—	商品編輯的真正難題:每天會被覆蓋一次	0ab8fbaa	2026-08-23	-	-	open	60	0
246	parked	#236	安裝預約／合作店家「即將上線」	0ab8fbaa	2026-08-23	-	-	parked	60	0
247	parked	#202	儲值金分頁空白	0ab8fbaa	2026-08-23	-	-	parked	60	0
253	done	—	`MEMORY.md` 超過精簡線	0ab8fbaa	2026-08-23	7dc1616b	2026-08-25	open→done	60	0
267	done	—	網路抖一下,客人整車商品消失 督導窗自驗	572ecb53	2026-08-23	3c3efdee	2026-08-25	open→done	59	0
268	done	—	購物車不綁帳號,換人登入前一個人的車還在 督導窗自驗	572ecb53	2026-08-23	3c3efdee	2026-08-25	open→done	59	0
269	open	—	正式站躺著一張收不掉的空單 + 一個測試帳號 督導窗自驗	572ecb53	2026-08-23	-	-	open	59	0
270	done	—	桌機按「加入購物車」零回	572ecb53	2026-08-23	3c3efdee	2026-08-25	open→done	59	0
271	open	—	有些商品的顏色／尺寸選不到	572ecb53	2026-08-23	-	-	open	59	0
272	open	—	離島運費沒有概念	572ecb53	2026-08-23	-	-	open	59	0
273	done	—	購物車圖片載不到就破圖	572ecb53	2026-08-23	3c3efdee	2026-08-25	open→done	59	0
274	done	—	數量合併靜默夾到 99	572ecb53	2026-08-23	041c6cea	2026-08-24	open→done	59	0
275	open	—	客人刷不出卡,我們這邊不會響	572ecb53	2026-08-23	-	-	open	59	0
276	open	—	`capture-recheck` 是唯一 route 級零測試的那支	572ecb53	2026-08-23	-	-	open	59	0
277	done	—	結帳第 2 步地址不見了,整區靜默消失	572ecb53	2026-08-23	3c3efdee	2026-08-25	open→done	59	0
278	open	—	補一支購物車 e2e(器材已架好)	572ecb53	2026-08-23	-	-	open	59	0
301	doing	—	DNA 這家不在每日同步	572ecb53	2026-08-23	ae68e6c4	2026-08-27	open→doing	59	0
302	open	—	`supplie	572ecb53	2026-08-23	ae68e6c4	2026-08-27	open→AMBIG	58	1
303	open	—	`supplier_slug` 預設 `'rpm'` 是活的 —— 這是商品編輯那片的地雷	572ecb53	2026-08-23	-	-	open	59	0
304	open	—	未確認 停產品會不會自動從店裡下架	572ecb53	2026-08-23	-	-	open	59	0
305	done	—	SSO 的 `sub` 被丟掉,兩本帳對不起來	572ecb53	2026-08-23	7dc1616b	2026-08-25	open→done	59	0
306	done	—	那兩顆 fuse 守不到上游	572ecb53	2026-08-23	858b10e1	2026-08-26	open→半關→doing→done	59	0
307	open	—	死人偵測的表建好了	572ecb53	2026-08-23	-	-	open	59	0
308	doing	等主視窗派 codex	這一格的傷害模型【原本是錯的】—— 它不是雙扣, 而真題是【零訊號】	94746f90	2026-08-24	-	-	doing	55	0
309	done	`c4`	卡住的單,客人在自己帳號裡看不到 —— 已做完並 commit(Sean 拍【甲】)	94746f90	2026-08-24	6d524075	2026-08-25	doing→done	55	0
310	open	—	那條「每天中午寫進正式庫」的線,不在 Sean 這台機器上	572ecb53	2026-08-23	-	-	open	59	0
327	open	—	33 支後台 API 沒有自己的門鎖,全靠一道 middleware	572ecb53	2026-08-23	-	-	open	59	0
328	open	—	新開的 API 出生就是不用登入可打,而零測試在看	572ecb53	2026-08-23	-	-	open	59	0
329	open	—	防灌水自己掛掉時安靜地放行	572ecb53	2026-08-23	-	-	open	59	0
330	open	—	2FA 蓋好了,但沒有「這支手機是誰的」	572ecb53	2026-08-23	-	-	open	59	0
331	open	BL-37	部件講錯／方向講反	572ecb53	2026-08-23	-	-	open	59	0
332	parked	BL-47	寫入路徑缺交易與 CAS	572ecb53	2026-08-23	b601076b	2026-08-27	open→parked	59	0
333	open	—	那棵樹沒有 husky 閘,而現在兩個窗共用一個 git index 督導窗自驗	572ecb53	2026-08-23	-	-	open	59	0
334	done	—	那棵樹 4 顆未推,其中兩顆修的是客人看得到的 督導窗自驗	572ecb53	2026-08-23	7dc1616b	2026-08-25	open→done	59	0
351	doing	#866	人工退款可以超過實際收到的錢	7307b0f7	2026-08-23	-	-	doing	58	0
352	doing	#939	員工手動建單	7307b0f7	2026-08-23	-	-	doing	58	0
353	open	#870	金流 RPC 的歸屬只到「某個有後台密碼的人」	7307b0f7	2026-08-23	-	-	open	58	0
354	done	#873	DB 多一個會員等級 ⇒ 那位客人的結帳頁掛掉,他結不了帳	7307b0f7	2026-08-23	3c3efdee	2026-08-25	open→done	58	0
355	done	#215 / ⑦	客人可偽造 `pcm-tier` cookie 假裝經銷商	7307b0f7	2026-08-23	3c3efdee	2026-08-25	doing→done	58	0
356	doing	#530 / #872	那道 migration 守門寫好了、沒接線,而且從來沒有正確過	7307b0f7	2026-08-23	-	-	doing	58	0
357	open	#868	一句「A8a3 還沒 apply」過期了	7307b0f7	2026-08-23	-	-	open	58	0
358	open	#869 / #523	`it.fails` 是本 repo 已驗證的「過期即紅」機制,而只有一條線在用	7307b0f7	2026-08-23	-	-	open	58	0
375	open	#907	`supabase/migrations/` 從零 apply 重現不了正式庫	94746f90	2026-08-24	-	-	open	55	0
376	done	#908	actor cookie	94746f90	2026-08-24	93326e86	2026-08-26	open→parked→done	55	0
377	done	—	`20260824020000` 已 apply 而帳本沒記,退場動作欠著	94746f90	2026-08-24	c07e5378	2026-08-24	open→done	55	0
378	open	#906	退款 ID 在傳遞途中被丟掉	94746f90	2026-08-24	-	-	open	55	0
379	done	—	退款告警的分母不含退款表	94746f90	2026-08-24	3c3efdee	2026-08-25	open→done	55	0
380	done	—	那封每日告警叫的是一件後台做不到的事,已叫 15 天	94746f90	2026-08-24	6d524075	2026-08-25	open→done	55	0
381	done	#904	數量輸入的分母是 5 處	94746f90	2026-08-24	f5d5d325	2026-08-25	open→done	55	0
382	done	#905	出貨數量欄可以清空	94746f90	2026-08-24	-	-	done	55	0
383	open	#903	B5-a 的 rollback 是紙上約束	94746f90	2026-08-24	-	-	open	55	0
384	done	—	B5-a 的 `20260824030000` 仍未 apply	94746f90	2026-08-24	a31bf037	2026-08-24	open→done	55	0
```

## 尺(逐字;抽出即可跑)
```python
#!/usr/bin/env python3
# board-snapshot.py · docs/launch-todo.md 每列【態序列】快照尺 · 複量窗 9e · 2026-08-27
# 用法(在 repo 根):python3 board-snapshot.py [--all] > snapshot.tsv
#   預設只印 open/doing;--all 印四態全部。stderr 印分母與對照。
# 尺:對每一列取「事」欄正規化字面(去 ** 與 ~~ 記號保留文字、去 emoji、壓空白),候選由長到短
#     (整格 / 第一個分隔符前 / 12 / 8 / 6 字),取在最多歷史版本命中的那個;走動過板子的每一顆 commit,
#     每版讀該列態欄 ⇒ 態序列。態欄接受 `| open |`、`| ~~open~~ **done** |`、`| **done** |` 三種形狀,取最後那個
#     (08-24~08-25 有 26 個行版本用劃線形狀;不認它們 ⇒ 那些版本隱形、fuse 列會被讀成 SSO 列的態 —— 已修)。
#     同一版本候選命中 ≥2 列 ⇒ 記 AMBIG,不猜。只配「事」欄,不配整行(別列的「卡什麼」欄會提到本列標題)。
# 已知盲區:標題改字超過 6 字層仍對不上的列會少算早期版本(印在 versions 欄:小於總 commit 數就是訊號);
#           態變只代表有人改了那格字,不代表事情本身做完。
import re, subprocess, sys, datetime
BOARD = 'docs/launch-todo.md'
ROW = re.compile(r'^\|\s*(?:~~(?:open|doing|parked|done)~~\s*)?\**(open|doing|parked|done|半關)\**\s*\|')
WANT = ('open', 'doing', 'parked', 'done') if '--all' in sys.argv else ('open', 'doing')

def git(*a):
    return subprocess.run(['git', *a], capture_output=True, text=True).stdout

def norm(s):
    s = s.replace('**', '').replace('~~', '')
    s = re.sub(r'[\U0001F300-\U0001FAFF☀-➿⭐️✅❌⏸⚠️]', '', s)
    return re.sub(r'\s+', ' ', s).strip()

def cell3(l):
    return norm(l.split('|')[3]) if l.count('|') >= 4 else ''

head = git('rev-parse', '--short', 'HEAD').strip()
board_sha = git('log', '-n1', '--format=%h', '--', BOARD).strip()
commits = [l.split() for l in git('log', '--reverse', '--format=%h %ad', '--date=short', '--', BOARD).strip().splitlines()]
versions = []
for h, d in commits:
    txt = git('show', f'{h}:{BOARD}')
    versions.append((h, d, [(ROW.match(l).group(1), cell3(l)) for l in txt.split('\n') if ROW.match(l)]))

cur = open(BOARD, encoding='utf-8').read().split('\n')
now = datetime.datetime.now().astimezone().strftime('%Y-%m-%dT%H:%M%z')
print(f'# snapshot_at={now}\thead={head}\tboard_last_commit={board_sha}\tboard_commits={len(versions)}\truler=board-snapshot.py')
print('line\tstate\tref\tliteral\tfirst_commit\tfirst_date\tlast_change_commit\tlast_change_date\tseq\tversions_found\tambig')
dirty = git('status', '--porcelain', '--', BOARD).strip()
counts = {}
for i, l in enumerate(cur, 1):
    m = ROW.match(l)
    if not m:
        continue
    st = m.group(1)
    counts[st] = counts.get(st, 0) + 1
    if st not in WANT:
        continue
    cells = [c.strip() for c in l.split('|')]
    thing = cell3(l)
    l2 = re.split(r'——|—|[(（:：,，、;；]', thing)[0].strip()
    cands = [c for c in (thing, l2, l2[:12], l2[:8], l2[:6]) if len(c) >= 6]
    best, bestseq, bestfound = None, [], -1
    for c in cands:
        seq = []
        for h, d, rows in versions:
            hits = [s for s, t in rows if c in t]
            seq.append((h, d, hits[0] if len(hits) == 1 else ('AMBIG' if hits else None)))
        found = sum(1 for _, _, s in seq if s and s != 'AMBIG')
        if found > bestfound:
            best, bestseq, bestfound = c, seq, found
    first = next(((h, d) for h, d, s in bestseq if s), ('', ''))
    last, prev, comp = ('', ''), None, []
    for h, d, s in bestseq:
        if not s:
            continue
        if prev is not None and s != prev:
            last = (h, d)
        if s != prev:
            comp.append(s)
        prev = s
    ambig = sum(1 for _, _, s in bestseq if s == 'AMBIG')
    print('\t'.join([str(i), st, cells[2], best or '', first[0], first[1], last[0] or '-', last[1] or '-',
                     '→'.join(comp), str(bestfound), str(ambig)]))
print(f'# 分母(現檔四態)={counts}  工作樹板子 dirty={"yes" if dirty else "no"}', file=sys.stderr)
```
