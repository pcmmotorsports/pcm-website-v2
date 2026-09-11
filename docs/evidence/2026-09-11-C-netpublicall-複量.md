# ⟦tidy-NETPUBLICALL⟧ 複量 · 2026-09-11 · 窗 C

> 依 `docs/handoff/CURRENT.md`「每一列的做法」第 2 步:**對正式庫唯讀量一次,確認今天還成立。**
> 🟢 唯讀 · `pcm_readonly` @ 正式庫 · `bash scripts/readonly-prod-sql.sh` · **rc=0 · 真錯誤 0 格**
> (掃法 `grep -nE '^psql:.*ERROR|^ERROR:'`,不用裸 grep —— 見腳本 `:30-45`)
> 量測現場:DB 自報 `2026-09-10 16:45:16 UTC`(= 台北 09-11 00:45)· `current_user = pcm_readonly`

---

## 一、結論一句話

🔴 **那一列今天【仍然成立】,逐格與 2026-09-08 的讀數相同。而它【不是我們修得動的】。**

---

## 二、逐格讀數

```
(a) 表級 relacl(不用角色名過濾 —— PUBLIC 的 grantee 是 0)  38 筆
    net._http_response       × PUBLIC ⇒ SELECT INSERT UPDATE DELETE TRUNCATE
                                        + REFERENCES TRIGGER MAINTAIN   (is_grantable 全 f)
    net.http_request_queue   × PUBLIC ⇒ 同形
    net.http_request_queue_id_seq × PUBLIC ⇒ SELECT UPDATE USAGE
    🔴 表級【沒有】任何具名 anon / authenticated —— 只有 PUBLIC 與 supabase_admin
    grantor 全部 = supabase_admin · 一個星號都沒有(= 沒傳下 GRANT OPTION)

(b) 有效權限 has_table_privilege × 5 種
    anon          × 兩表 ⇒ S t / I t / U t / D t / TRUNCATE t
    authenticated × 兩表 ⇒ 全 t

(c) schema USAGE
    🟢 正對照 public × anon ⇒ t
    ⚪ 負對照 cron   × anon ⇒ f          ← 尺會動
    🔴 net          × anon ⇒ t · × authenticated ⇒ t

(d) RLS
    _http_response / http_request_queue ⇒ rls=f · forced=f · policies=0

(e) 我們修得動嗎
    net 底下 6 個物件 owner 全部 = supabase_admin
    postgres rolsuper = f · pcm_readonly rolsuper = f · supabase_admin rolsuper = t
    pg_has_role('postgres','supabase_admin','MEMBER') ⇒ f

(e2) GRANT OPTION(這一格直接回答「REVOKE 會不會生效」)
    net._http_response     × postgres ⇒ SELECT plain t / grantable f · TRUNCATE t / f
    net.http_request_queue × postgres ⇒ 同形
    🟢 正對照 public.orders × postgres ⇒ SELECT t / **t** · TRUNCATE t / **t**
    ⇒ 📌 尺分得出【我們擁有的】與【平台的】

(f) 負對照 現造名字 ⇒ to_regclass NULL · to_regnamespace NULL · pg_roles 0 筆
```

⇒ **與板上 2026-09-08 的讀數逐格相同。三天下來平台側沒有動過它。**

---

## 三、🔴 而我這一發多量到一格 —— **板上末格那句修法,對【schema 那層】是不夠的**

板上逐字:
> 🛑 **所以修法要收的是 PUBLIC, 不是逐個角色收** —— 逐個收會漏掉下一個新角色。

而 `net` 的 `nspacl` 逐筆展開是:

```
supabase_admin           USAGE
supabase_admin           CREATE
PUBLIC                   USAGE      ← 板上點名的那一條
supabase_functions_admin USAGE
postgres                 USAGE
anon                     USAGE      ← 🔴 具名, 不是 PUBLIC
authenticated            USAGE      ← 🔴 具名
service_role             USAGE      ← 🔴 具名
```

🎯 **⇒ 兩層的形狀【相反】,而板上那句只描述了其中一層:**

| 層 | 授權來源 | 只收 PUBLIC 夠不夠 |
|---|---|---|
| **表**(兩表 + seq) | 只有 PUBLIC | ✅ 夠 |
| **schema USAGE** | PUBLIC **加上** 具名 anon / authenticated / service_role / postgres | 🔴 **不夠** —— 收完 PUBLIC,`anon` 靠自己那條具名的仍然進得去 |

📌 **而板上「兩條路都通」那句本來就寫對了** —— 錯的是末格那句**單獨拿出來讀**的修法指示。
🛑 **⇒ 端 Sean 或寫那支 migration 的人若照末格那一句做,schema 那層會漏。**

> ## 🎯 這一格的形狀 = 昨晚那一句的同族
> **「收 PUBLIC」是一個【真的修法】,它完美地解釋了表那層 —— 而它蓋不住 schema 那把尺。**

---

## 四、🛑 我證不到什麼(不要讀成沒事)

1. **PostgREST 有沒有把 `net` 暴露出去,我今天【沒有量】** —— 唯一答得出來的路是打一發 HTTP,
   而那條路是禁的(主視窗 A 2026-09-08 裁,三個理由)。
   ⇒ 今天的「對外沒有出口」靠的是 **Sean 2026-09-10 唸面板** 那一格,**不是我這一發**。
   🔴 而那是一個**設定**不是一道閘 —— 有人為別的需求把 `net` 加進 Exposed schemas 那天,洞就開。
2. **那些 PUBLIC 授權是不是 pg_net 擴充自己需要的、收掉會不會弄壞它** —— 板上自標【沒有查】,**我也沒有查**。
3. **平台可能有別的提權路徑**(儀表板 SQL Editor 用別的角色連線)⇒ 那一格我看不到。
4. 讀數是**這一發**的。平台側的授權會被平台自己改,而改了不會通知任何人。

---

## 五、⚠️ 過程中我自己踩到一次(留著,它是分母)

第一發我跑 `... 2>&1 | tee 檔 | head -120`。
`head` 讀滿 120 行就關掉管線 ⇒ **`tee` 吃到 SIGPIPE 被砍** ⇒ 檔案停在 127 行,
**(e2) 印了標題沒有內容、(f) 整格不見、腳本結尾的 `rc=` 也不見**。

🔴 而那份輸出**看起來就像「查詢炸掉了」** —— 而 `grep -nE '^psql:.*ERROR|^ERROR:'` 印 **0**。
📌 **一個 0 錯誤 + 一個半截的輸出,合起來讀像「跑完了而沒事」。**
✅ 分辨它的方法:**看有沒有跑到最後一格與 `rc=`**,不是看錯誤數。
拿掉 `head` 重跑 ⇒ 147 行,(e2)(f)`rc=0` 全在。

---

## 六、要誰做什麼

```
🛑 不修 —— 鐵則 8/12, 而且我們【本來就修不動】(e2 那一格:REVOKE 會 rc=0 而 ACL 原封不動)
🔴 給 Sean 的一格(只有他做得到):Supabase → API → Exposed schemas 有沒有 net
   (2026-09-10 他唸過 = 沒有。這是一個【會被改而沒有人會知道】的設定 ⇒ 值得排成定期複唸)
🔵 給板檔的一格(只有主視窗 59 能改):末格那句修法要補「schema USAGE 那層 anon 是具名的」
```

態:**不動,仍 `open` · ⟨記著⟩ 不變。** 本份沒有動任何權限、沒有寫入正式庫。
