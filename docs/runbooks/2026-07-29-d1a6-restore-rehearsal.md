# D1a6 還原演練 —— Sean 操作包

> **這一步要證明的事:那包備份真的救得回來。**
>
> 目前只證明了「解得開」。**還沒證明「塞得回去」** —— 而 Fable 抓到的那個 BLOCKER
> (父表驗證查錯資料表、四種組合全滅)正好就是只讀腳本文字驗不到、必須實跑才會現形的那一類。
>
> 🔴 全程**不碰正式站**。演練跑在一個獨立的 Supabase 分支上,腳本本身也有守門:
> 演練版一旦連到正式站會當場中止。

---

## 這一步的成本

Supabase preview branch = **每小時 US$0.01344**(約 NT$0.44)。演練跑完就刪,總花費不到 NT$2。

---

## 你需要準備

**① 分支的連線字串** —— 我建好分支之後,你到
Supabase → 專案 **pcm-website-v2** → **Branches** → 點那個分支 → **Connect** → **Session pooler** 複製。

🔴 那是**分支自己的**連線字串,跟正式站那條不一樣。別用錯。

**② 解開備份**

```bash
cd ~ && age -d -o /tmp/d1.tar.gz d1-backup-20260729-v2.tar.gz.age && \
mkdir -p /tmp/d1r && tar xzf /tmp/d1.tar.gz -C /tmp/d1r --strip-components=1 && \
ls /tmp/d1r | wc -l
```

**要看到 `17`**(16 份 CSV + checksums.txt)。

---

## 執行

### 第 1 步:指向分支

```bash
export D1_DB_URL='分支的連線字串'
echo "長度=${#D1_DB_URL} / 尾段=${D1_DB_URL##*@}"
```

🔴 **尾段必須跟正式站不一樣**(專案代號不同)。如果尾段跟正式站那條長得一樣,**立刻停下來** ——
那代表複製到錯的地方了。

### 第 2 步:補帳號替身

```bash
cd /Users/sean_1/pcm-website-v2 && npx tsx scripts/d1-restore.ts --seed-rehearsal /tmp/d1r > /tmp/d1-seed.sql && test -s /tmp/d1-seed.sql && psql "$D1_DB_URL" -f /tmp/d1-seed.sql
```

**為什麼要這一步**:備份裡的客戶掛在 Supabase 帳號底下,而帳號表我們**刻意沒備份**(你拍的 Q3=A,
那張表有密碼雜湊)。全新的分支帳號表是空的,不補的話連第一張表都插不進去。

補的只有 **2 個 UUID,沒有任何個資** —— 帳號表唯一必填的欄位就是 id。

> 這一步本身也是那條殘餘風險的實證:**帳號一旦不見,那筆訂單就是救不回來**,
> 演練也得靠替身才跑得動。不是紙上推論。

### 第 3 步:真的還原

```bash
cd /Users/sean_1/pcm-website-v2 && scripts/d1-restore.sh pre rehearsal /tmp/d1r
```

會依序印出 5 個步驟。**任何一步紅了就整批 `ROLLBACK`,分支不會留下半套資料。**

---

## 跑完貼什麼給我

1. 第 2 步與第 3 步的**完整畫面輸出**(不含連線字串那行)
2. 這個:

```bash
psql "$D1_DB_URL" -c "SELECT (SELECT count(*) FROM orders) AS orders, (SELECT count(*) FROM order_items) AS items, (SELECT count(*) FROM payment_charge_attempts) AS attempts, (SELECT count(*) FROM customers) AS customers;"
```

**應該是 orders 26 / items 36 / attempts 24 / customers 2。**

---

## 🔴 炸了怎麼辦(這才是演練的重點)

**炸掉是好事,不是壞事** —— 現在炸,總比真的需要還原那天才炸好。把訊息貼回來就好,不要自己想辦法繞過。

特別是這幾種,**都不要動腦筋修**,直接貼給我:

- `column name mismatch in header line` —— 備份的欄位跟分支的 schema 對不上
- `violates foreign key constraint` —— 有父列不在
- 任何 `D1:...拒繼續` 開頭的訊息 —— 那是我們自己的守門在講話,它擋下來一定有原因

🔴 **絕對不要做的事**:把腳本裡的 `HEADER MATCH` 改成 `HEADER`、或把任何 assert 註解掉。
那不是修好,那是把演練要驗的東西關掉。

---

## 收尾

演練通過之後告訴我,我把分支刪掉(停止計費),並清掉解壓出來的明文:

```bash
rm -rf /tmp/d1r /tmp/d1.tar.gz /tmp/d1-seed.sql
```
