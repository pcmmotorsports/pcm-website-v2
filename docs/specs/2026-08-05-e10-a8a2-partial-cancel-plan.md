# A8a2 片級 plan:`admin_cancel_order` 品項部分取消擴充(v3)

> **v3(關卡2 R1 雙線折入;code-reviewer opus 5 Important+5 Minor、codex xhigh 5MF+1nit)**:
> ①canonical 全面 `::uuid::text` 正規化(生 JSON 文字排序/去重會讓大寫 uuid 生第二 hash+繞過
> 重複檢查;PG1 加大寫變體同鍵重放=idempotent 實證)②冪等⑥升「真·全欄相符」(before 整顆
> 等值/after.payment_status/closed 型別必 boolean/closed=true ⇒ cancelled_at 非空交叉核對)
> ③I11(reason 殘值重放)+M16、I12(④ partial 竄改重放)+M17 判別格 ④N5(A8a1 md5 閘負向
> =同批順序強制點)⑤前置閘補 helper md5×3(§0 字面補實)⑥prosecdef assert+SR1 service_role
> 實呼活體格 ⑦步 5 健康閘順序錨+三道筆數守「註解+碼綁定」錨 ⑧輸入驗兩段式(SQL OR 不保證
> 短路)⑨遮蔽認列與判別力終局(v3b codex R2 校正):M9 **復活**——單 header 情境被「closed
> 交叉核對」「closing audit 計數」遮蔽(I10/I11 在 M9 下照紅=認列),但 **I13 多 header 竄改
> (A 部分+B 關單、刪 A 明細、重放 B)= ③ 唯一防線 ⇒ M9 恰殺 I13**(codex 構造、打回我的
> 撤除判定);縱深認列名單=M11 零品項守門/M15 hash-IF actor 分句(⑥ 遮蔽,雙拔判別)/
> I10 單欄清(配對分句遮蔽,雙欄清判別)/②硬不變式(被④遮蔽)/④-full 分支(無獨立判別格)
> /⑥ before·payment_status·鍵集合·同形四分句(承重=⑥/③ 既有分句+PI3b/I13 間接覆蓋,無專屬格)。
> ⑩v3b 補:⑥ 加 after 恰 4 鍵(閉鍵集)+`after.cancelled_at` 與 closed 同形(codex R2 MF2);
> M7/M8/MD3 紅集+PG1、MD3 紅集+I13(重放/關單分支的合法連動,實跑釘死)。
> harness 74/74(55 格×基線+22 突變+M6×3+MD1 示範+CCP1-6+COMPAT/PCT/SR1/N1-N5/剝殼)雙跑。

> **v2b(關卡1 R2 折入)**:MF04=closed 態 reason 恰=closing audit 對應 header 的映射文字;
> MF07=收尾集合等式存在性條件化(rem=0 ⇒ 恰無列);MF10=CCP5/CCP6 confirm 雙向+CCP2 兩序
> header 數釘死;new-issue=A8a1-era audit 無 closed 鍵 fallback(PI3)+PR2 精確化(消 PS5
> 衝突);MF15=視窗自決維持單片、誠實認列入檔頭+收工信(未自宣豁免)。

> 2026-08-05 視窗A。高風險(鐵則 12①③)走全 9 步自驅 SOP。母計畫 row 37(:384)+§5.1b/c/d;
> 同一支 RPC 的第二施工片(A8a1=`20260804180000`、dev 已收割 `7c9305c`)。**不 apply**(⛔)。
> **v2**:關卡1 R1 FAIL(codex 15MF+2nit,`/tmp/a8a2-k1-codex-r1.txt`)全折——PN1 改 fail-closed
> 正解(真相算額+摘要在場一致閘)/冪等改逐品項 `0≤Σci≤quantity` 硬不變式/新鍵也過帳本健康閘
> (PS4 回歸拒絕格)/closed 重放取 audit 不重算/audit 恰一列全欄相符/收尾 header=雙向集合等式/
> PS5 增量公式判別格/併發 barrier 格族(部分×部分/×整單/×begin 雙向)/輸入畸形矩陣具名/
> hash 量值正規化(拒非整數字面)/int 邊界+bigint 承接/5 參相容格+pronargs 斷言/同批中斷態
> 處置/估時補列/pg_depend 停點/jsonb last-key-wins 誠實邊界。
> **估時(鐵則 4;v2 補、v2b 誠實認列)**:migration ~40 分+harness ~60-80 分,**超過 45 分
> 字面**。R2 MF15 主張「超過→拆」無例外;**視窗自決(流程題;memory
> `feedback_decide-process-questions-yourself`)=維持單片**,理由:①本線既例=A8c1/A8c2/A8a1
> 三片同型同量級皆單 commit(`6408373`/`83a8ff0`/`c55dc66`),主視窗+Sean 逐片收割無異議=
> 線內既成慣例 ②拆=「migration 未經 harness 驗證先落 commit」或「雙倍 codex 關卡2」兩害
> ③可中斷檢查點照列(migration 綠/基線綠/突變綠)。**此決定列入收工信供 Sean 過目;Sean 若
> 拍拆,下片起照拆**——不自宣豁免、殘餘=規則字面與線內慣例的衝突未裁。

## §0 位置與部署合約

- 前置閘:①begin=A8c1 md5 ②confirm=A8c2 md5 ③**`admin_cancel_order` 恰 1 個 overload 且
  md5=A8a1 版 `39173e33698e282cf7e5b35aae73d009`**(部署鏈:A8a1 未落地不得套本片)
  ④A7-t/A4a trigger 三元組×5+helper md5×3(A8a1 同款)。
- 🔴 **同批鐵律(row 36/37;Sean 2026-07-30 Q2=A)**:`20260804180000`+本片 `20260805100000`
  **同批 apply**(佇列現況=120000→150000 兩支;本兩支收工後一起排第三、四位,順序強制)。
- 🔴 **簽名變更=換函式**:5 參數版 DROP、6 參數版 CREATE(`p_items jsonb DEFAULT NULL`)——
  加 default 參數走 CREATE OR REPLACE 會產生**第二個 overload**(PG 事實),故本片=同交易
  DROP+CREATE;零 overload 不變量由 assert 維持(恰 1)。呼叫端連動=零(A9d2 cancel 接線
  未建;service_role 5 參數呼叫式因 default 照常解析)。
- 🔴 **harness 繼承**:`scripts/a8a1-verify.sh` 的身分閘 pin A8a1 md5 ⇒ 本片 apply 後它
  **合法失效**(部署態不同)——其檔頭加一行繼任註記(見 §3.1);`a8a2-verify.sh` =
  全繼承超集(A8a1 全部格改打 6 參數版+部分取消新格)。
- 綠燈:不宣稱。

## §1 目標

同一支 `admin_cancel_order` 長出品項層部分取消:`p_items` 指定品項與**增量**、可取消量守門
`增量 ≤ quantity − instock − cancelled`(Q17=B;shipped 欄不存在=完整式退化,第 2 批包裹片
改式)、多次部分取消累積至全量時補寫對客欄;**整單路徑(`p_items` NULL)升級=部分取消歷史單
的整單收尾**(A8a1 步 5 的「有 header 一律拒」讓位)。append-only(不觸 A7-t 合約債)。

## §2 親讀契約(差異項;A8a1 plan v4 全承接)

| 契約 | 出處 | 約束 |
|---|---|---|
| 片規格 | row 37 `:384` | ci 寫入;守門增量式;**守門禁讀 summary(惰性非權威快取;COALESCE 成 0=放行超量)——鎖 parent 後真相表重算、「真相非零但摘要缺列」fail-closed;負測必含刪摘要列**;累積全量補寫對客欄;誠實邊界=部分取消後 A8c 封鎖收款、付款回路=第 3 批 |
| Q17=B | `:452` | 已到貨不可取消(走第 3 批退貨);summary CHECK `instock+cancelled≤quantity`=第二道網 |
| §5.1d | `:479-492` | **部分取消不寫 `orders.cancelled_reason`**;other 文字落 `reason_detail`;整單(含收尾)才映射對客欄 |
| A7-t 合約債 | row 37 末段 | DELETE/UPDATE ci 既有列=禁區(要先補 trigger 鎖 parent+隔離閘);**本片 append-only=不觸發**,plan 字面釘住 |
| 鎖原語 | A2b1 COMMENT `20260803130000:164` | 「A4a/A8a2 必須同原語 FOR NO KEY UPDATE」;orders FU 第一觸表(§5.0 四片同鎖序)不變 |
| lock_timeout | A2b1 `:107,:234` | **函式級 `SET lock_timeout='5s'` 入 proconfig+migration assert**(A8a1 未釘;本片換函式時補上=對齊 A2b1 慣例;隔離閘沿用本 RPC 既有 P8C01、不改 P2B02——同函式錯碼一致性優先) |
| 允許集合 | row 36 | unpaid+attempts 全 failed 或零筆(部分/整單同一集合) |
| hash 域 | A8a1 §3.2 | 整單=`…:full` 不變;部分=`…:partial:` + 依 `(order_item_id::uuid)::text` 正規化升冪(v3)的 `id=qty` 逗號串(canonical、重複 id=輸入錯) |
| ci CHECK | 54331 實查 | `cancelled_quantity > 0` 唯一 CHECK(無上界)⇒ 上界承重=本守門+summary CHECK;**大量級 probe**:增量=100000 之類仍只被守門/CHECK 擋、不得溢位或靜默截斷(int 域) |

TS 連動面:零(接線=A9d2)。

## §3 設計

### 3.1 產物(=allowlist 恰 4 路徑)

migration `20260805100000_m4b_e10_a8a2_partial_cancel.sql` / `scripts/a8a2-verify.sh` /
本 plan / **`scripts/a8a1-verify.sh` 檔頭繼任註記一行**(apply A8a2 後身分閘合法失效、改跑 a8a2-verify)。

### 3.2 RPC 全序(6 參數版;A8a1 十步骨架不動,標 Δ 處)

`admin_cancel_order(p_order_id uuid, p_idempotency_key uuid, p_actor text, p_reason_code text,
p_reason_detail text, p_items jsonb DEFAULT NULL) RETURNS jsonb {cancelled, cancellation_id,
idempotent, closed}`(Δ 回傳加 `closed`=本次後是否全量;SECDEF、`search_path=''`、
Δ `lock_timeout='5s'`)。

1. 隔離閘 P8C01(不變)。
2. 輸入驗(不變+Δ):key/code/detail 同 A8a1;**Δ p_items 非 NULL 時具名矩陣全拒**(v2 R1):
   JSON `null`/scalar/object 非 array/空 array/元素非 object/缺鍵/多鍵/uuid 不可解析/quantity
   非數字/字串/boolean/null/**非整數字面(`1.0` 直接拒——jsonb 數字文字保留尾零 ⇒ 不拒則同
   語意雙 hash)**/≤0/**>2147483647(int 上限,超界=輸入拒非溢位)**/重複 `order_item_id`——
   全部輸入類具體訊息。**誠實邊界(v2 nit):jsonb 同 object 內重複 key=last-key-wins,函式
   收到前已丟失、無從拒;以「恰兩鍵」+型別驗收斂**。quantity 經驗證後以 int 持有、
   canonical 串用該值 `::text`(單一產生式=零雙 hash 面);**所有 Σ/減法以 bigint 承接**。
3. orders FOR UPDATE 第一觸表+NOT FOUND(不變)。
4. 冪等格(Δ 不變式改全域硬式;v2 R1 重寫):hash 欄+actor 同 A8a1;不變式=
   ①header reason 欄位對輸入 ②**逐品項硬不變式 `0 ≤ Σci ≤ quantity`(bigint;>quantity=
   病理必炸——雙條件式抓不到超量,v2 改硬式)** ③**關單等價:`cancelled_at IS NOT NULL` ⟺
   每品項 Σci = quantity;open 態兩對客欄皆 NULL;closed 態(v2b MF04):恰一筆
   `after.closed=true` 的 audit,且 `orders.cancelled_reason` **恰=該 closing audit 對應
   header 的映射文字**(§5.1d CASE 套該 header 的 reason_code/reason_detail;任意殘值不再
   能過)** ④**本 header 集合等式(雙向;v2b MF07 排除 remaining=0)**:部分 op=本 header 的
   {item,qty} 恰=請求集合;整單 op=對每品項令 `rem := quantity − 其他 headers 的 Σci`:
   **rem>0 ⇒ 本 header 恰一列且 qty=rem;rem=0 ⇒ 本 header 恰無該品項列**(CHECK 禁 qty=0
   列 ⇒ 等式必須存在性條件化,否則合法收尾(某品項先前已全取消)重放反被誤拒)
   ⑤payment unpaid+零在途 attempts ⑥**audit 恰一列且全欄相符**(request_id 非
   UNIQUE(`20260712210000` 實查)⇒ 必數恰 1+actor/reason/source_app/`after.cancellation_id`
   /`after.closed`/快照全比)。任一不符 fail-loud;**回傳 `closed` 取自本 op 的
   `audit.after.closed`(不可變來源)——重算現況會把「當時 false」錯答成 true(v2 R1)**。
   **v2c(R3 打回無條件 fallback 後重寫):A8a1-era audit 無 `closed` 鍵的判形 fallback**——
   A8a1 關單 audit 形狀=after **恰 {payment_status, cancelled_at, cancellation_id} 三鍵且
   `after->>'cancelled_at'` 非空**(A8a1 恆整取關單)⇒ 唯此形狀 fallback `closed:=true`;
   `closed` 鍵在 ⇒ 取其值;**兩者皆非(如被剝鍵的 A8a2 部分 audit:三鍵但 cancelled_at
   NULL)= 病理、RAISE fail-loud**——無條件 COALESCE 會把剝鍵部分重放錯答 true(R3 抓)。
   ③ 的 closing audit 同步判形:closing := `after.closed=true` **或** A8a1 三鍵關單形。
   ⑥ 對 closed 鍵條件比。判別格=PI3(A8a1 形 → true)+PI3b(剝鍵部分形 → RAISE)。
5. 已取消守門+**Δ 帳本健康閘(v2 R1:新鍵也要驗、不是只有重放)**:擋 `cancelled_at IS NOT
   NULL`(已關單);**健康閘=①逐品項 Σci ≤ quantity ②對客欄配對一致(cancelled_at NULL ⇒
   cancelled_reason NULL)③零品項 header 不存在**——任一破=帳本病理、通用 RAISE 拒收新單
   (fail-loud;PS4 的 header-only 合成態由③擋=回歸拒絕格)。
6. actor is_active(不變)。
7. 允許集合(不變)。
8. 品項守門(Δ 核心):鎖全部 order_items NKU 按 id 序 → 零品項拒 →
   **逐品項真相重算**(instock=Σ receipts(>0 過濾同 A8a1)、cancelled=Σ ci;皆 bigint、
   COALESCE 0——這裡 COALESCE 是「真相表無列=真 0」,與 row 37 禁的「摘要缺列翻 0」不同物)
   +**摘要在場一致閘(v2 R1 正解 row 37「真相非零但摘要缺列 fail-closed」)**:凡真相
   (instock>0 或 cancelled>0)非零的品項,`order_item_quantity_summary` 列**必須存在**,
   缺列=摘要毀損、通用 RAISE(額度**只由真相算**,摘要只驗在場、不讀值)→
   - 整單路徑:每品項 `增量 := quantity − cancelled`;**任一品項 instock>0 ⇒ RAISE**(Q17=B:
     到貨品項連收尾也不可,走退貨);全部增量=0 ⇒ RAISE(已無可取消=已取消守門的補集,
     防 cancelled_at 因故未寫的殘態重呼);寫入=僅增量>0 的品項。
   - Δ 部分路徑:請求品項必屬本單(不屬=拒);每請求品項 `增量 ≤ quantity − instock − cancelled`
     (bigint 運算)否則 RAISE(通用訊息;超量=業務拒絕不洩量);寫入=請求全集(增量皆 ≥1)。
9. 寫入(Δ):header(hash 域含 partial 串)→ ci(按 order_item_id 序、筆數守=預期筆數)→
   **Δ 關單判定:寫後全域重算「是否每品項 Σci=quantity」**——是 ⇒ 補寫 orders 對客欄
   (本 op 的映射文字)+row_count 守;否 ⇒ **不碰 orders**(§5.1d)——audit(不變形狀+
   Δ after 加 `closed`=關單判定結果;此值即步 4 重放的權威來源)+筆數守。
10. 回傳(Δ 加 `closed`)。零全函式 EXCEPTION handler 不變。

### 3.3 鎖面與誠實邊界

- 併發部分×部分/部分×整單:orders FU 序列化 ⇒ 逐一執行、後到重算真相=無超量窗口。
- 部分×begin/confirm:同 A8c 守門(存在 header 即拒付款)⇒ **部分取消後單子收不到款=已知
  誠實邊界(row 37;付款回路=第 3 批,A13a 明示)**,本片不試圖解。
- append-only:本片對 ci 零 UPDATE/DELETE ⇒ A7-t 合約債不觸發。
- lock_timeout 5s:NKU 顯式等待逾時=55P03 fail-closed 可重試(A2b1 同款)。
- 收尾整單的 reason=收尾 op 的映射(歷史各 op 的 reason 留在各自 header;對客欄只有一格=
  最後蓋章者,§5.1d 語意)。

## §4 harness(a8a2-verify.sh;A8a1 全繼承+Δ 格;慣例全套同 a8a1-verify)

### 4.1 格(繼承 36 格,Δ 標示)

- S/I/R/C9/PC 全繼承,呼叫式帶 6 參數(整單=`p_items=NULL`);md5 pins 換新;
  **Δ 相容格 COMPAT(v2 R1)**:5 參數 positional 與 named 兩種呼叫式實呼成功(default 解析)
  +migration assert `pronargs=6`、`pronargdefaults=1`。
- **Δ 語意調整(v2 R1:PS4 撤銷翻轉)**:R9b(header-only 合成態)**維持拒絕**——判定者從
  步 5「有 header 即拒」換成**帳本健康閘③(零品項 header=病理)**;A7-t presence 讓該態
  無法 committed 存在,健康閘=防禦縱深+RPC 層 fail-loud。R9c 照拒。R9(全量後異鍵重呼)→
  「全部增量=0」拒(遮蔽認列更新)。收尾正向格=PS3(合法部分歷史,非合成)。
- **Δ 新格(P 家族)**:PS1 部分成功(2+3 兩品項、切 1:header+ci=請求集+**orders 對客欄
  未動(兩欄皆 NULL)**+audit `after.closed=false`+summary cancelled 對應);PS2 兩次部分
  累積至全量 ⇒ 第二次 `closed=true`+對客欄補寫(映射=第二次的 code、第一次重放仍回
  `closed=false`=audit 權威實證);PS3 部分後整單收尾(remaining 全切+closed+header 集合
  等式);**PS5 增量公式判別(v2 R1;v3 字面對實作)**:quantity=5、instock=2 ⇒ 取消 3 成功、再取消 1 拒(判別力等價:MD1/MD2 下皆紅)
  (「曾到貨全鎖」的錯誤實作會在此紅);PG1 部分 hash 黃金(python 獨立常數+**請求亂序 →
  hash 同**=canonical 實證);PI1 部分同鍵重放 idempotent:true+`closed` 取 audit;PI2 同鍵
  異 items 拒;**PI3(v2b)A8a1-era 重放**:合成 A8a1 三鍵關單形 audit+已關資料
  → 同鍵重放 idempotent:true+`closed=true`;**PI3b(v2c)剝鍵病理**:A8a2 部分 audit 移除
  `closed` 鍵(三鍵但 after.cancelled_at NULL)→ 同鍵重放 RAISE(判形 fallback 實證);PR1 超量拒;**PR2(v2b 精確化,
  消與 PS5 衝突)=增量因 instock 超過剩餘才拒**:quantity=2 全到貨(instock=2)取消 1 → 拒;
  部分到貨且增量 ≤ 剩餘=合法(即 PS5);PR3 非本單品項拒;PR4 重複品項拒;
  **PR5 輸入畸形矩陣(v2 R1 具名子格)**:JSON null/scalar/object 非 array/空 array/元素非
  object/缺鍵/多鍵/壞 uuid/quantity 字串·boolean·null·`1.0`·0·負;**PR7 int 邊界
  (v2 R1)**:`2147483647` 過輸入驗、被超量守門拒(bigint 零溢位);`2147483648` 輸入拒;
  **PN1 摘要 fail-closed(v2 R1 正解)**:superuser DELETE 真相非零品項的 summary 列 ⇒
  **合法增量也拒**(摘要在場閘);對照組=真相全零品項無 summary 列 ⇒ 合法照過;
  PC 家族沿用+**PCT lock_timeout 格**(佔鎖 → 55P03,proconfig 生效實證)。
- **Δ 併發 barrier 格族(v2 R1+v2b MF10;pg_blocking_pids+唯一 app name,committed+清理)**:
  CCP1 部分×部分同品項剩 1:恰一成一敗、終態 Σci≤quantity、無多餘 header;CCP2 部分先/
  整單先兩序:**部分先→整單=2 headers 且關單;整單先→部分=1 header 且部分被拒(v2b 釘死
  兩序各自 header 數)**;CCP3 部分 cancel 先持鎖 → begin 醒來拒;CCP4 begin 先取得 pending
  → 部分 cancel 醒來允許集合拒;**CCP5(v2b)部分 cancel 先持鎖 → confirm 醒來取消守門拒;
  CCP6(v2b)confirm 先翻 paid → 部分 cancel 醒來允許集合拒**(CC1/CC2 整單格不代證部分)。
- 前置閘負向×5:N1 begin 漂移/N2 confirm 漂移/N3 六參態重跑拒(to_regprocedure 判空)/N4 trigger 面/**N5 A8a1 md5 漂移(v3;同批順序強制點的專屬負向格)**。

### 4.2 突變(EXPECT 實跑釘死;A8a1 14 條全繼承重算+Δ)

**v2d 實跑釘死紅集(逐格語意驗證後 pin;與 v2 預測的差異=實作層事實)**:
MD1 拿部分守門 → {PS5,PR1,PR2,PR7};MD2 拿增量式 instock 項 → {PS5,PR2};MD3 拿關單判定
(`v_closed:=false`)→ {S1,S2,S3,I1,PC1,PS2,PS3,PI3}(=與 M7 同集;閉單通路壞掉的全下游);
MD4 拿 canonical 排序 → {PG1};MD5 拿屬本單 → {PR3};MD6 拿摘要在場閘 → {PN1};MD7 拿帳本
健康閘 → {R9b}。繼承族(v3b 實跑終局):M7 → {S1,S2,S3,I1,PC1,PS2,PS3,PG1,PI3};
M8 → {S1,I1,PC3,PS1,PS2,PG1,PI1,PI3};MD3 → M7 集+{I13};**M9(關單等價)→ {I13}**(I6 被④
雙重覆蓋、I10/I11 被交叉核對/closing 計數遮蔽=認列;多 header 竄改=③ 唯一防線);
M16 → {I11};M17 → {I12};M10 → {R9b,R9c};其餘同 A8a1。
**三處遮蔽誠實認列(v2d;負測構造不出=no-op 判別教訓)**:①**M11 撤除**——零品項守門被
「整單 v_expect=0」與「部分屬本單」雙重遮蔽、R13 在 M11 下照紅=零判別力;守門保留=fail-fast
縱深。②**M15 改雙分句同拔**(hash-IF actor 分句+⑥ audit-actor 分句)——⑥ 遮蔽前者,單拔
=零紅;雙拔 → {I3}。③I10 改清雙欄(cancelled_at+cancelled_reason)——單清 cancelled_at 被
「open 態配對」分句遮蔽,雙清才專屬打中關單等價式。
結構錨:三處 ORDER BY(M6a/b/c)+partial 串產生式碼錨;MD1 示範格=部分超量 → 23514+
`oiqs_instock_cancelled_le_quantity` 釘名+全回滾。**前置閘 v2d**:5 參 pin 用 `to_regprocedure`
判空(6 參態下 regprocedure cast 直接 42883、訊息失控 ⇒ 判空=可控 false-stop;N3 負向格驗)。

### 4.3 oracle

A8a1 §4.3 全套(碼錨/順序錨/md5 封條/COMMENT pin/ACL 窮舉+有效權閘/SECDEF 八物件/剝殼/
十二表零留痕/計數閘)+Δ:**proconfig 斷言含 `lock_timeout=5s` 與 `search_path=""`**、
恰 1 overload、6 參數簽名字面。

## §5 驗收(yes/no)

1. 繼承格全綠+P 家族全綠+突變逐格吻合;2. PG1/G1 雙黃金綠;3. migration asserts 全過;
4. 三綠;5. 剝殼+零留痕+雙跑穩;6. allowlist 恰 4;7. PN1 證守門不讀摘要;8. append-only
(全檔零 `UPDATE order_cancellation_items`/`DELETE FROM order_cancellation_items` 於 RPC 內);
9. reviewer-gate 標記檔於 commit 前寫入。

## §6 apply 前置與 rollback

⛔ 停點+同批鐵律(§0)。apply 佇列=120000→150000→**180000+本片(同批、順序強制)**。
apply 前:四組 pin+A8a1 md5+**pg_depend 相依清點(v2 nit:DROP FUNCTION 預設 RESTRICT,
存在 view/trigger 相依=安全失敗、人工對齊停點;現況 repo 零呼叫端≠DB 零相依,實查為準)**;
apply 後 read-back=新 md5+proconfig(`lock_timeout=5s`+`search_path=""`)+`pronargs=6`/
`pronargdefaults=1`+恰 1 overload。
**同批中斷態處置(v2 R1:同批≠原子——兩支各自 COMMIT)**:180000 成功、本片失敗 ⇒ 停在
「A8a1-only」態——**非資料危險態**(A8a1 整單自寫全部 items,2026-07-30 憂慮的零明細 header
不會發生;只是部分取消尚不可用)⇒ 處置=**不回退 A8a1**、修本片重套(前置閘 A8a1 md5 仍成立
=可直接重跑);**禁止整批重跑**(180000 的 N3 閘會擋、屬預期 false-stop);中斷態 read-back
=A8a1 md5+恰 1 overload(5 參數)。
rollback=a7-rollback v4 步 1(DROP 全部 overload,枚舉閘不變);若只回退本片=重放
`20260804180000` 的函式段恢復 5 參數版(其 md5 閘可驗)。

## §7 已定非決策項

- 部分取消不寫對客欄=§5.1d 既有字面;收尾 reason=最後蓋章者=同節語意;錯碼沿用 P8C01=
  同函式一致性;lock_timeout=A2b1 慣例照抄。**零 Sean 決策題**(全部有既有拍板/字面出處)。
