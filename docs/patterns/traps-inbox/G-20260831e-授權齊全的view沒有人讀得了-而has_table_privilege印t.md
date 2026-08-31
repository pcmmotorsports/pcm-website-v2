# 一支「授權齊全」的 view 可以沒有人讀得了 —— 而 `has_table_privilege` 對它印 `t`

> 量到 **2026-08-31 11:2x–11:5x CST** · 線【出貨】`-1e` · 樹 `/Users/sean_1/pcm-wt-ship` · HEAD `137fc150`
> 🛑 **量測地點 = 網站庫的正式庫**(唯讀連線 `pcm_readonly`)。**用表指紋認,不用連線字串裡的 ref**:
> `shipments`/`email_outbox`/`orders` 三個都在、`model_dictionary`/`product_groups_v` 兩個都不在。
> ⚠️ 這個艦隊同時在動兩個 Supabase ⇒ **這些值換一個庫量會不一樣。**

## 母題

**權限尺答的是【那個物件自己的 ACL】,而讀取會失敗在【它裡面呼叫的東西】。**
兩個世界(讀得到 / 讀不到)在那把尺底下印**同一個 `t`**。

## 兩個世界並排(量到的,不是推的)

```
指令 psql "$PCM_READONLY_DATABASE_URL" -tAc "select has_table_privilege('public.<v>','SELECT')"
     psql "$PCM_READONLY_DATABASE_URL" -tAc "select count(*) from public.<v>"

public.pcm_shipped_email_pending       尺說 t   實際讀 ⇒ ERROR: permission denied for
                                                        function pcm_shipped_email_dedup_key
public.order_refund_effective_verdict  尺說 t   實際讀 ⇒ 6
```
📌 **同一把尺、同一個 `t`,而一個讀得到、一個讀不到。**
🔴 **那個 `t` 不是錯的** —— view 自己的 SELECT ACL 確實給了。
**它只是答了一個比你以為的窄的問題,而【窄在哪裡沒有寫在輸出裡】。**

成因:該 view 的 body 呼叫 `public.pcm_shipped_email_dedup_key(uuid,uuid)`,
其 ACL = `postgres=X/postgres,service_role=X/postgres` ⇒ `pcm_readonly` 沒有 EXECUTE。
**`has_table_privilege` 不追那一跳。**

## 🔴 與正本既有兩條的關係(查重跑過,結論是【開新條】)

```
查重 python3 scripts/traps-neighbours.py <草稿>   分母 正本 505 + inbox 768 + memory 1081 = 2354
     --selftest 九個世界 PASS
```
**鄰居① 正本 `:692`「Supabase 新建 view/table 一出生就被授權給 anon/authenticated」**
⇒ 那是 **default ACL** 的機制,講的是「授權多給了」。**不同族。**

**鄰居② 正本 `:4141`「`has_table_privilege` 看不到欄級授權 ⇒ 少報」**
⇒ 🔴 **同一把尺,而【失效方向相反】**:
```
:4141  少報(false negative)⇒ 尺說 f, 而其實讀得到  ⇒ 後果 = 白擔心 / 多做一道
本條   多報(false positive)⇒ 尺說 t, 而其實讀不到  ⇒ 後果 = 以為驗過了, 而那道保護是空的
```
📌 **⇒ 兩條要並存、互相指**。只記其中一條的人,會以為自己知道這把尺的限制,
而他知道的是**另一個方向**。**「我讀過那條」正是這個坑最好的掩護。**
⚠️ 而 `:4141` 自己就記著「當事人讀著那份檔、踩了它記載的那個坑」—— 見下一節,我又演了一次。

## 🔴🔴 而我寫這則條目時,我的偵測器犯了它正在記錄的那個病

第一版我用字面掃 view body 找函式呼叫:
```
正則  pg_get_viewdef(c.oid) ~ 'public\.[a-z_]+\('
輸出  pcm_shipped_email_pending ⇒ ✅ 沒有
```
🛑 **而我【親手】在那支 view 上撞過 `permission denied for function` —— 十分鐘前。**

成因:`pg_get_viewdef` 渲染成 `pcm_shipped_email_dedup_key(s.id, o.id)`,
**沒有 `public.` 前綴**(該 schema 在 `search_path` 上)⇒ 我的正則一個都掃不到。

📌 **那一發輸出是「乾淨、具體、完全錯」的那一種 —— 它不可疑。**
🔴 **而抓到它的是:我剛好有一個【已知答案】的世界可以對。**
⚠️ ~~原句寫「**唯一**抓到它的原因」~~ —— **那是一個我沒有數過的全稱句**:
我舉不出別的路徑, 而「我舉不出」與「不存在」是兩件事。**改寫,原句留著。**
**⇒ 如果我先掃全庫、再撞那個錯,我會先寫下「全庫零命中」,而它讀起來完整。**

改用不靠字面的 `pg_depend`(view → `pg_rewrite` → `pg_depend` → `pg_proc`)重掃:
```
pcm_shipped_email_pending     ⇒ pcm_shipped_email_dedup_key
pcm_shipped_email_unsendable  ⇒ pcm_shipped_email_dedup_key
```
✅ **正對照:它抓到我親手撞到的那一支 ⇒ 這把尺會動。**

## 現在咬到幾個(三個數答三個不同問題,不要混用)

```
public 底下 view + matview 總數                              14
  其中 body 依賴 public 函式的(pg_depend)                     2   ← 本坑今天的分子
supabase/migrations/*.sql 總檔數                            238
  用到 has_*_privilege 的                                   146
  用到 has_table_privilege 的                                60
  那 60 支點名的 public 關聯(去重)                            33
    對正式庫核 relkind ⇒ view 3 / 表 30
負對照 git grep -l 'has_zzz_nonexistent_privilege' -- 'supabase/migrations/*.sql' ⇒ 0
```
✅ **那 3 支被斷言點名的 view,今天 body 都不依賴函式 ⇒ 今天損害為零。**
🔴 **而「今天為零」不是「不會發生」** —— 往任何一支 view body 加一個函式呼叫就成立,
**而那個改動不會紅、三綠不會動、斷言照樣印 `t`。**

## ⚠️ 射程 —— 這則條目【答不出】什麼

```
· 🔴 我【沒有】逐支去讀那 60 支 migration 的斷言、看它們的【期望值是什麼】——
     一支期望 false 的斷言,這個假綠不咬它。**未數。**
· 我只用 `pcm_readonly` 一個角色量。**換一個角色,咬到的集合會不一樣。** 未量。
· `pg_depend` 那一掃只看 view body 直接依賴的函式,**沒追多層 view 疊 view**。未驗。
· 我沒有量「別的 repo / 報價單庫」有沒有同樣形狀。未查。
```

## 判別句

```
1. 一把權限尺答的是【那個物件自己的 ACL】, 不是【你讀不讀得到】。
   問句:這個檢查失敗的路徑, 與實際讀取失敗的路徑, 是同一條嗎?
2. 用字面掃 SQL 找函式呼叫 ⇒ schema 前綴會被 search_path 省掉 ⇒ 掃不到。
   要問依賴就查 pg_depend, 不要 grep viewdef。
3. 🔴 同一把尺的【少報】與【多報】是兩條教訓, 後果相反:
   少報 = 多做一道;多報 = 以為驗過了而那道保護是空的。
   **只讀過其中一條的人, 會以為自己知道它的限制。**
4. 🔴 我抓到自己偵測器壞掉, 靠的是【我先有一個已知答案的世界】(有沒有別的路徑, 未數)。
   ⇒ **正對照要排在全庫掃描【之前】, 不是之後。**
   ⇒ 先掃再驗 ⇒ 你會先寫下一個乾淨的零, 而零沒有形狀。
```
