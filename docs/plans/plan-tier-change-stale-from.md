# plan — 換等級的「從 X」要送給 RPC 比對(backlog #954,`docs/phase-1-backlog.md:35890`)

> 2026-09-14 · A 窗寫 · **唯讀查完,碼零改動。**
> 🛑 動 `admin_set_customer_tier` RPC(SECURITY DEFINER、管會員 tier = 錢那類)⇒ 鐵則 8(先 plan 等批)+ 鐵則 12②(codex 唯讀審)。
> 修法本身 2026-08-28 主視窗已裁「丙」(送 from 給 RPC 比對、不同就拒),本 plan 只是把它落到檔案:行號與貼板順序。

---

## 1. 今天會發生什麼(逐字重現步驟,2026-09-14 開檔核過,不是抄板子)

```
1. 甲開 /customers/<id>(server render 時 tier = general)
   apps/admin/src/components/customers/customer-detail.tsx:197   currentTier 由 server 帶下來
2. 乙在另一台把同一位客人改成 premiumStore(RPC 成功)
3. 甲按「變更等級」選 store ⇒ 確認句 confirmSentence(currentTier, target)
   apps/admin/src/components/customers/tier-edit-submit.tsx:90    `會員等級:一般會員 → 店家會員`
4. 甲按確認 ⇒ form 送 customerId / tier / note / returnTo(沒有 from)
   apps/admin/src/lib/customers/tier-form.ts:58-77
5. server action ⇒ setCustomerTier ⇒ rpc('admin_set_customer_tier', 5 個參數)
   apps/admin/src/lib/customers/tier-actions.ts        apps/admin/src/lib/customers/customer-repository.ts:134
6. RPC FOR UPDATE 現讀 v_before = premiumStore ≠ store ⇒ UPDATE ⇒ 回 'UPDATED'
   supabase/migrations/20260717010000_m4a_admin_set_customer_tier_rpc.sql:118-152
⇒ 實際發生 premiumStore → store = 降級;甲看到的是 ?r=saved「已儲存」。
⇒ 稽核列 before={tier:premiumStore} 是對的,事後查得到;當下零訊號。
```

客人看到什麼:經銷價上線後 tier 決定價格 ⇒ 一位 premiumStore 客人突然看到店家價,而後台三個人都說「我沒改過他」。

## 2. 改什麼(丙,主視窗 08-28 裁)

### 2a. migration `20260914130000_m4b_admin_set_customer_tier_expected_before.sql`(版本號 09-14 掃過沒人用)
```
DROP FUNCTION public.admin_set_customer_tier(uuid, text, text, text, text);
CREATE FUNCTION public.admin_set_customer_tier(
  p_customer_user_id uuid, p_tier text, p_note text, p_actor text, p_request_id text,
  p_expected_before text DEFAULT NULL           -- 新
) … 1d 之後、1e 之前加:
  IF p_expected_before IS NOT NULL THEN
    IF p_expected_before NOT IN ('general','store','premiumStore') THEN RAISE 'expected_before 非法';
    IF v_before <> p_expected_before::public.member_tier THEN RETURN 'STALE'; END IF;
  END IF;
其餘逐字不動(v_ws 自檢、白名單、note 規則、稽核 INSERT)。
COMMENT / REVOKE / GRANT / DO 自檢 全部改成 6 參簽章重貼一遍(CREATE OR REPLACE 換簽章 = 新函式,ACL 不會跟過來)。
```
**為什麼 `DEFAULT NULL` 而不是必填**:貼板與 push dev(= 後台上線)是兩個人兩個時間。
必填 ⇒ 先貼板那段時間舊後台 5 參叫不到函式,員工改不了等級;先 push 那段時間新後台 6 參叫不到舊函式,同樣改不了。
`DEFAULT NULL` ⇒ 兩種順序都能動;而 NULL = 今天的行為(不比對)。**後台碼永遠送 from,由測試守**(§2b),所以「NULL 不比對」只在部署間隙存在。
⚠️ 這是一個刻意留的 fail-open,標在 RPC 註解裡;要收成必填 = 第二支 migration,等兩邊都上線後貼。

### 2b. 後台碼(admin)
```
tier-edit-submit.tsx     確認句旁邊多一個 hidden input name=TIER_FROM_FIELD value=currentTier
tier-form.ts             parse 多一個 from(白名單 TIER_VALUES,缺 = invalid ⇒ fail-closed,不送 NULL)
customer-repository.ts   rpc 多帶 p_expected_before: args.from;回 'STALE' 加進結果碼
tier-actions.ts          ResultCode 加 'stale';STALE ⇒ redirect ?r=stale(不 revalidatePath 也可以,但要讓頁重畫出新 tier ⇒ 還是 revalidate)
customer-detail.tsx      r=stale 的那句:「這位客人的等級剛剛被別人改過,請重新確認」(既有 r= 訊息那張表加一列)
```
測試:tier-form(缺 from ⇒ invalid;from 不在白名單 ⇒ invalid)、customer-repository(STALE 映射)、tier-actions(stale ⇒ ?r=stale)。
拋棄式 PG(admin-probe)實跑:兩個 session 重現 §1 步驟 ⇒ 第 6 步回 STALE、tier 仍是 premiumStore、audit 零列。

## 3. 影響
- 只有後台換等級這一條路。顧客站零改動。
- 貼板前後任一順序都不會擋住員工(§2a 理由)。
- ACL:6 參簽章重做 REVOKE/GRANT + DO 自檢;`customers` 表級/欄級 UPDATE 那四條自檢照舊留著(它們守的是「唯一路」)。

## 4. Rollback
- 碼:revert 那顆 commit(hidden input 拿掉、parse 不再要 from)⇒ 舊碼 5 參打新函式仍可用(DEFAULT NULL)。
- DB:`supabase/rollbacks/20260914130000_down.sql` = DROP 6 參 + 重貼 20260717010000 那一支的 CREATE + ACL 段(逐字抄)。

## 4b. codex 兩輪之後補的(2026-09-14)
- R1 must-fix:`DEFAULT NULL` 只救「舊後台 + 新庫」;「新後台 + 舊庫」PostgREST 六個參數名配不到 ⇒ PGRST202。⇒ `customer-repository.ts` 只在 PGRST202 退回五參打一次(= 舊行為)。
- R2 must-fix:DB 回滾而 PostgREST cache 還記得六參 ⇒ PG 回 42883。⇒ 同一條退回路也認「42883 且訊息點名 `admin_set_customer_tier(`」;點名別的函式的 42883 照舊炸。
- ⚠️ 副作用要知道:「六參在 DB、cache 只有五參」也走退回 ⇒ **貼板成功 ≠ #954 生效**,要 PostgREST cache 刷過(`NOTIFY pgrst, 'reload schema'` 或自刷)。所以 §5 最後一步是真的撞一次。
- 沒做 R3(同一件事最多兩輪);R2 剩下的 must-fix 已修、有測試,主視窗判要不要再審。

## 5. 貼板順序(建議)
1. 貼 migration(Sean)⇒ `bash scripts/is-migration-applied.sh 20260914130000`
2. 主視窗 `pcm_acl_approve_latest`(0914 拍甲)
3. 合 admin 碼進 dev、push(後台上線)
4. 拋棄式 PG 重現 §1 ⇒ STALE;正式站 Sean 自己走一次(開兩個分頁改同一人)。

## 6. 給主視窗的題
```
Q1: p_expected_before 要不要 DEFAULT NULL(部署間隙不擋員工)還是必填(嚴格 fail-closed、但貼板/推之間員工改不了等級)?
A:  甲 DEFAULT NULL + 後台永遠送 + 第二支收成必填(推薦)| 乙 直接必填,貼板與 push 同一小時內做
Q2: 碼與 migration 一片做完再 codex 一輪,還是 migration 先審?
A:  甲 一片一輪(推薦,總共 ~4 檔 + 1 migration)| 乙 分兩輪
```
