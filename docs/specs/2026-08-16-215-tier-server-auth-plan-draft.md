# `#215` tier 改 server 端認證 · **plan 草稿(不完整,刻意的)**

> **狀態:🔴 草稿,不是可批的 plan。** 2026-08-16,A 窗寫,**未 commit**。
> **為什麼現在寫得出一半**:`#215` 的主體是「**tier 不能信 cookie**」,那一半與 (A)/(B) 兩條路無關;
> 而解法②(pricing 輸出形狀)**取決於 Sean 還沒拍的那題** ⇒ §3 刻意留白。
> **⚠️ 這份不能拿去要 Sean 批** —— 它缺的那塊正是要他先答的東西。§5 列了它現在答不了什麼。

---

## 0. 一句話

**現在 tier 是瀏覽器 cookie 說了算,要改成 server 查資料庫。**
今天不會漏經銷價(靠兩道下游副作用),但**那兩道退場的那一刻洩漏口就開了** —— 這片是在那之前先把身分釘死。

---

## 1. 解法①:tier 改 `getUser()` → DB 查(**兩條路都不影響,可以完整寫**)

### 1-1 現況(開檔查的,非引用他人)

`apps/storefront/src/lib/tier.ts:53` 逐字:
```ts
const rawTier = tierOverride ?? cookieStore.get('pcm-tier')?.value ?? 'general';
```
- 只驗字面合法性(三值),`:58` 非法 → fallback `'general'`;`:48` 的 `?tier=` 需 `PCM_DEV_TIER_OVERRIDE === '1'`。
- **唯一實呼叫端**:`apps/storefront/src/app/page.tsx:69`。
  量法:`grep -rn "resolveTierFromRequest" apps/ packages/ --include=*.ts --include=*.tsx | grep -v "\.test\."`
  ⇒ 命中 **5 行**,逐行分類(不報總數就走):
  `tier.ts:43` 宣告本體 / `page.tsx:34` import / `page.tsx:65` 註解 /
  `products/[slug]/page.tsx:11` 註解 / **`page.tsx:69` 才是實呼叫**。
  ⇒ **實呼叫恰 1 處。**

### 1-2 目標形狀

```
tier = user 未登入 ? 'general'
     : (await customerRepo.findById(user.id))?.tier ?? 'general'
```
- **未登入恆 `general`**(`#215` 條目逐字)。
- **查無 customer 也恆 `general`** —— fail-closed;🔴 **不是**「沿用 cookie」。
- cookie `pcm-tier` **降級**:要嘛整個移除,要嘛只當非金額顯示 hint。**本片建議整個移除**,理由見 1-4。

### 1-3 現成零件(都存在,開檔確認過)

| 零件 | 座標 | 備註 |
|---|---|---|
| `createServerSupabaseClient()` + `auth.getUser()` | `apps/storefront/src/app/page.tsx:99-102` | 同一支檔裡已經有這個形狀,**不必新發明** |
| `ICustomerRepository.findById(id)` | `packages/ports/src/ICustomerRepository.ts:24` | 回 `Customer \| null` |
| `Customer.tier: MemberTier` | `packages/domain/src/identity/types.ts:28` | |
| tier 寫入不在該 port | 同檔 `:18` 逐字「tier 寫入走 service_role-only、不在本 port 暴露」 | ⇒ **讀得到、寫不到**,正是我們要的方向 |

### 1-4 為什麼建議**移除** cookie 而不是留著當 hint

留著的話,`tier.ts` 會同時有兩個來源,而**「哪一個贏」要靠讀 code 才知道**。
🔴 而本片要解的病就是「身分來源不是權威」——**留一個非權威來源在同一支函式裡,下一個人會再接回去。**
⚠️ 若 Sean/主視窗要保留 hint 用途,那要**另外一支函式、另外一個名字**,不叫 tier。

### 1-5 這一半的驗收(可機械判定)

- `grep -c "pcm-tier" apps/storefront/src` ⇒ **0**(或:只剩明確標為非金額用途的那一支)
- `tier.ts` 內出現 `getUser` 與 `findById`,且**未登入路徑回 `'general'`** 有測試釘住
- 🔴 `resolveTierFromRequest` 的簽章改變 ⇒ **`page.tsx:69` 必須同 commit 改**,否則 typecheck 紅(那是好事)

---

## 2. 解法③:偽造場景 + 不變式測試(**兩條路都不影響,可以完整寫**)

`#215` 條目逐字要求兩格:**「tier 偽造場景」+「非 general tier 的價格輸出必經身分驗證」不變式測試**。

| 格 | 測什麼 | 🔴 判別力來自哪 |
|---|---|---|
| **G1 偽造** | 帶 `pcm-tier=store` 的 cookie + **未登入** ⇒ 解析結果必須是 `general` | 突變:把 cookie 分支加回去 ⇒ **只有這格紅** |
| **G2 未登入** | 沒有 cookie、沒有 user ⇒ `general` | 正向對照,防 G1 恆綠 |
| **G3 登入但查無 customer** | `getUser()` 有 user、`findById` 回 `null` ⇒ `general`(fail-closed) | 這格最容易被寫成 `?? cookie`,要釘死 |
| **G4 登入且 tier=store** | ⇒ `store` | **正向格** —— 沒有它,前三格全回 `general` 是恆真的 |
| **G5 不變式** | 非 `general` 的價格輸出必經身分驗證 | 🔴 **形狀未定,見 §3** |

🔴 **G5 現在寫不出來** —— 它要斷言的是「價格輸出」,而**價格輸出長什麼樣是解法②的內容**。
⚠️ **不要先寫一個版本再說之後改**:那會變成一格**釘住錯形狀**的測試,而它會綠。

---

## 3. 解法②:pricing 輸出形狀 —— 🔴 **本節刻意留白**

`#215` 條目逐字要求:
> pricing endpoint/RPC **不收 tier**(由 server 查),輸出到 client 僅「單一已算好的 effective price number」,
> **絕不序列化 `priceByTier` 結構**給 client。

**寫不出來的原因不是資訊不足,是【上游有一個沒拍的板】**:

| | `unit_price` | `discount_total` | 紙上折扣 |
|---|---|---|---|
| **(A) schema 最順的路** | `price_store` | `0` | **0 —— 經銷商拿了折扣,紙上完全看不出來** |
| **(B) Sean 的意圖(`#513`)** | `price_general` | `(general − store) × 數量` | 看得到 |

🔴 **兩條路都滿足「只輸出單一 effective price」** ——
**那個詞問的是「送幾個數字」,而岔路問的是「那個數字怎麼算出來的」。**
⇒ **不是會答錯,是根本不會被問到。** 照條目字面做,兩條都過,而 code 沒擋 (A)、(A) 又更好寫。

📌 `#513` 逐字:**「這是生意判斷,要 Sean 拍,不是工程師在實作當下順手決定的。」**
📌 `#513` 也逐字列了三個**不能下的結論**:不能說 Sean 錯了 / 不能說一定會做成 `price_store` / 兩者可以並存。

⇒ **本節在 Sean 拍板前不填。填了就是替他決定。**

---

## 4. 鐵則 8 / 12 逐字對硬清單

| 鐵則 | 中不中 | 逐字理由 |
|---|---|---|
| **8**(跨 3+ 檔)| ✅ **中** | 見 §4-1,至少 4 支 + 測試 |
| **8**(動共用元件)| ✅ **中** | `packages/adapters` 的 mapper 在影響面內 |
| **12①**(錢)| ✅ **中** | 鐵則 12 逐字含 **經銷價** |
| **12②**(權限)| ✅ **中** | 逐字含 **auth・server/client 邊界** —— 這是本片的**主題**,不是副作用 |
| **12③**(DB 結構)| ❓ **未定** | 取決於 (A)/(B);走 (B) 可能要讓某層讀得到 `price_store` ⇒ 會動 view / RLS / GRANT |
| 12⑥(`packages/ui`)| ❌ 不中 | 本片不碰 |

⇒ **要 plan + Sean 批 + 對抗審查。** 而 12③ 那格**在 §3 填好之前不會有答案**。

### 4-1 影響面(**估**,附座標)

| 檔 | 為什麼 |
|---|---|
| `apps/storefront/src/lib/tier.ts`(60 行) | 換掉 `:53`、改走 `getUser()` |
| `apps/storefront/src/app/page.tsx:69` | 唯一呼叫端,簽章變 |
| `packages/adapters/src/supabase/mappers/product.ts:216` | `store` 恆 dummy 0 的那行 —— **它退場那一刻洩漏口才開** |
| `apps/storefront/src/lib/products.ts:63-65, 203-212` | `priceByTier` strip 那層 |
| 測試 | G1-G4 可估;**G5 估不出來**(見 §2) |

⚠️ **`mappers/product.ts` 與 `products.ts` 兩支是否真的要動,取決於 §3。** 本表是**估**,不是清單。

---

## 5. 🔴🔴 這份 plan 現在**不能**做什麼

1. **不能拿去要 Sean 批。** 缺的 §3 正是要他先答的東西 —— 拿一份缺主要決定的 plan 去問「批不批」,
   他會批到一個**還沒被決定的形狀**。
2. **(A)/(B) 未拍** ⇒ §3 空白、§2 的 G5 寫不出來、§4 的 12③ 未定、§4-1 的後兩支檔是估的。
3. **`M-2-08` 的定義本身過期** —— `docs/PHASE-1-MILESTONES.md:323` 逐字寫 **Medusa Price List**,
   而本專案已去 Medusa(`packages/ports/src/IOrderRepository.ts:31` 逐字)。
   🔴 而 `#215` 的**觸發條件**綁在它身上 ⇒ **「什麼時候該做這片」目前沒有可信的判準。**
   ⚠️ 我**沒有**判它作廢:「Medusa Price List」沒了,但「雙 tier pricing」這件事還在。**需要重新定義,那不是我能拍的。**
   📌 該檔檔頭日期 **2026-04-30**、狀態仍寫「待 M-0 第一個 slice 動工」⇒ **整份的新鮮度要另判。**
4. **報價單那邊的實際形狀沒人驗過** —— `#513` 逐字「本 repo 無法驗證」,正本在 mac mini。
5. **`#513` 那條「零賦值 / 分母 173 支 migration」的數字我沒複跑** —— 我核的是**形狀**
   (`orders_total_balances` CHECK 存在、`create_order` 是唯一寫入者,與 `#13` 片1a 的結論一致),**不是那兩個數。**

## 6. ✅ 一件從「repo 字面」升級成「正式庫事實」的(主視窗代查)

`information_schema.columns` 對 `public.products_public` 實查:
`price_store` / `price_by_tier` / `metadata` 各 **0 欄**、`price_general` **1 欄**(正向對照)、總欄數 **20**;
`pg_class.reloptions` ⇒ `["security_invoker=true"]`。
⇒ **「view 物理排除經銷價」現在是正式庫事實,不再是我引 mapper 註解。**
⚠️ 但它證的是**今天的 view**;`mappers/product.ts:215` 逐字寫著接真 pricing 時「本 dummy 退場」
⇒ **這個事實的有效期到那一刻為止。**

— END(草稿,§3 未填)—
