// 🔴 **相對路徑,不用 `@/`** —— vitest 的 `@` alias 指向 `apps/storefront/src`
//    (`vitest.config.ts:28`)⇒ 用 `@/` 寫,`page.test.tsx` 就 resolve 不到本檔的依賴,
//    而那道「直接打網址會不會被擋」的負測就**跑不起來**(症狀是整族解析失敗,不是紅一格)。
//    形狀照抄同層既有前例 `app/settings/suppliers/page.tsx:2-9`(該頁檔頭寫了同一個理由)。
// ⚠️ #612 更新(2026-08-17):上述 alias 限制已由 #606 修除(vitest projects、admin 自帶 @ alias)⇒ 新 code 可用 @/;既有相對 import 保留、不回改。
import { toAuditListRow } from '../../../lib/audit/audit-list-view';
import { diffAuditPayload, type AuditFieldChange } from '../../../lib/audit/audit-diff';
import { getAdminAuditLogReader } from '../../../lib/orders/order-repository';
import { isActiveManager, listAllStaff } from '../../../lib/staff';
import { getSessionActor } from '../../../lib/session/actor';
import { loadBrandNames } from '../../../lib/customers/brand-discount-repository';
import { AuditLogTable, type AuditTableRow } from '../../../components/audit/audit-log-table';

export const dynamic = 'force-dynamic';

// page.tsx — `#27` D1c-1:稽核紀錄檢視的**頁殼 + 第二道閘**。
//
// ── 🔴 為什麼頁本體也要擋(這是本片唯一的 must)────────────────────────
//   **只擋側欄 = 擋的是「看得到入口」,不是「進得去」。** 側欄那一項不渲染時,
//   **直接在網址列打 `/settings/audit` 照樣進得來** ⇒ 那不是「到不了」。
//   ⇒ 兩處都要接,而且**兩道閘必須各自獨立紅**:
//     刪掉本檔這行 `notFound()`,側欄那側的守門**一格都不會紅**(它量的是清單,不是可達性)。
//   守門在 `page.test.tsx`,它**不經過側欄任何一行 code**。
//   (`audit-ui-flag.ts:22-23` 檔頭逐字寫了同一件事;主視窗 2026-08-15 派工信再釘一次。)
//
// ── 為什麼是 `notFound()` 而不是導回首頁 ────────────────────────────
//   語意是「這頁在旗標關閉時**不該存在**」,與 `app/customers/[id]/page.tsx:24` 同族(既有前例)。
//   ⚠️ **本頁是獨立路由、不在 `@panel` 平行路由槽裡** —— 槽裡呼叫 `notFound()` 炸掉的是
//   **整個頁面**(`app/@panel/orders/page.tsx:51-53` 記過,主視窗 2026-08-10 裁⑤)。不吃這個坑。
//
// 🔴 **路徑 `/settings/audit` = 主視窗 2026-08-15 裁定,不是 Sean 拍板**
//   (後台內部路由、不對外、不影響 SEO)。**改起來成本低,別當釘死的。**
//
// ── 🔴🔴 2026-08-15:`20260815020000` 檔頭的正當性,前半段已被 Sean 推翻 ────────────
//   **被推翻的原句**(逐字,留痕不刪):
//     > 本片開放 SELECT 的正當性建立在「後台目前只有 Sean 一人測試、員工未上工」。
//     > **員工真正上工之前,真認證必須先落地** —— 否則自選身分的人讀得到經銷價 / 成本 / PII。
//   **Sean 2026-08-15 原話**(經主視窗轉達):
//     > **「是可以甲, 但是成本、客戶客人資料 **員工是可以看的**」**
//   ⇒ **前半段(員工未上工所以還安全)是錯的前提** —— **不是因為員工還沒上工才安全,
//     是因為員工本來就該看得到這些。** 內容本身不是風險。
//   ✅ **後半段仍然成立,而且現在是唯一的理由**:
//     🔴 **真認證要的不是「擋員工」,是「確認進來的人真的是員工」。**
//     🔴🔴 **這兩處原本寫的是 `#26`,而那是【錯號】**(2026-08-18 E 窗查、C 窗複驗):
//        backlog 的 `#26`(`docs/phase-1-backlog.md:829`)是
//        「**✅ 已收 · `partiallyRefunded` transition 評估**」—— **與真認證毫無關係,而且是已收的**。
//        ⇒ **任何人照 `#26` 去查會看到一個 ✅,然後結論是「這件做完了」** ——
//        **而它一行都沒做,而這段講的是經銷價 / 成本 / PII 讀得到。**
//        ⇒ 🔴 **指到一個【已收的錯號】,比指不到還糟:它給的是【錯的安心】。**
//     **改指到查得到的東西(逐一核過,不挑一個最像的)**:
//        · **`E8-B`** = 真登入線的既有代號(`grep -rn 'E8-B' docs/` ⇒ **77 命中**,不是 `#NNN` 號)
//        · **`#215`** 🔴 `pcm-tier` cookie **非身分權威** ⇒ **經銷價洩漏** —— 與本段的「讀得到」同一面
//        · **`#436`** 🎭 admin RPC 的 `p_actor` 是**存在性驗證不是身分驗證** ⇒ 稽核痕跡可被冒名
//          ⚠️ **`#436` 與本段【不是同一件】** —— 它管「帳本上的誰做的可不可信」,
//             本段管「誰讀得到」。**兩個都列是因為單一號涵蓋不了,不是因為分不出來。**
//     🔴🔴 **而【授權】那一面是另一個號**(2026-08-18 T① 提報、本窗複驗並落檔):
//        · **`#635`** 後台寫入**沒有 per-resource 授權** —— **任何登入者能動任一單**。
//          `authorizeAdminMutation`(`lib/session/authorize.ts`)驗 session + Origin + 具名 actor,
//          **不驗這個人能不能碰這一張單**;而 `lib/orders/payment-actions.ts:51-54` 與
//          `lib/orders/payment-reverse-actions.ts:26-28` 是 **code 自己招的**
//          (逐字「做這種檢查只是**假的安心**」)。
//        🔴 **`E8-B` 解【你是誰】,解不了【你能不能動這一張單】** ——
//           而那兩支檔的註解把授權 **defer 給 `E8-B`**,那是【誤 defer】:
//           **`E8-B` 上線後這個缺口不會自動關,而會有人以為身分做完就覆蓋了 ⇒ 靜默遺留。**
//        ⇒ **身分那面與授權那面【不要合成一個號】** ——
//          **合了之後,其中一面做完會讓另一面消失在視野裡。**
//     Sean 說的是**員工**可以看,**不是任何登入的人**都可以看。
//   ⇒ **風險的形狀變了:不是「內容太敏感」,是「身分沒驗過」。兩者要防的東西不同。**
//   ⚠️ **那支 migration 已 apply、不得回頭改** ⇒ 更正只能寫在這裡。引用該檔頭前先讀本段。
//
// ⚠️ **D1c-2a = 表格 + 三狀態**;展開檢視(顯示 `before`/`after`)是 **D1c-2b**,已批准、尚未做。
/** 與 `20260914010000_m4b_order_item_costs.sql` 的 action 字面一致(那支 RPC 每列寫一筆)。 */
const COST_AUDIT_ACTION = 'orders.item.costs.set';
const MASKED = '(老闆才看得到)';
/**
 * 換商品(20260922100000):before 帶被刪掉那一列的成本 ⇒ 非 manager 要拿掉那一格;請求指紋只給防重送用, 不顯示。
 * 數量、單價只記在 before(換商品不會改它們)⇒ 直接比會顯示成「2 → (無)」, 員工會以為數量被清掉 ⇒ 顯示時拿掉。
 * 下單時的庫存狀態同理只在 before。資料庫裡的紀錄一格都沒少。
 */
const SWAP_AUDIT_ACTION = 'order.item.swap';
/**
 * 經銷品牌折扣(20260925030000;B2B 計畫 §10.4)。折扣本身大家都看得到;
 * 🔴 `below_cost_reason` 與頂層「為什麼」是成本相關 ⇒ 非 manager 遮掉(Codex E1 R1)。
 */
const DEALER_DISCOUNT_AUDIT_ACTION = 'dealer.brand_discount.change';

/** 折扣那一筆:before / after 帶的是同一個品牌編號(差異比對會把它省略)⇒ 另外放一列「品牌」, 印名稱不印編號。 */
function brandRow(log: { before: unknown; after: unknown }, names: ReadonlyMap<string, string>): AuditFieldChange[] {
  const pick = (p: unknown) =>
    p !== null && typeof p === 'object' && typeof (p as { brand_id?: unknown }).brand_id === 'string' ? (p as { brand_id: string }).brand_id : null;
  const id = pick(log.after) ?? pick(log.before);
  if (id === null) return [];
  const name = names.get(id) ?? id;
  return [{ key: 'brand_id', from: name, to: name }];
}

function withoutBelowCostReason(payload: unknown): unknown {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const { below_cost_reason: _dropped, ...rest } = payload as Record<string, unknown>;
  return rest;
}

/**
 * 換商品一律顯示前後的料號與品名 —— 同款換規格時品名前後相同, 一般的差異比對會把它濾掉,
 * 而「把哪個料號品名換成哪個」正是這筆紀錄要回答的事(plan §5)。其餘欄位照一般差異顯示。
 */
function swapChanges(before: unknown, after: unknown) {
  const changes = diffAuditPayload(before, after);
  const pick = (v: unknown, k: string) =>
    typeof v === 'object' && v !== null && typeof (v as Record<string, unknown>)[k] === 'string'
      ? ((v as Record<string, unknown>)[k] as string)
      : null;
  const always = ['sku', 'title']
    .filter((k) => !changes.some((c) => c.key === k))
    .map((k) => ({ key: k, from: pick(before, k), to: pick(after, k) }));
  return [...always, ...changes];
}

function swapPayloadForDisplay(payload: unknown, manager: boolean): unknown {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return payload;
  const {
    request: _request,
    catalog_price: _catalogPrice,
    quantity: _quantity,
    unit_price: _unitPrice,
    availability: _availability,
    item_cost: itemCost,
    ...rest
  } = payload as Record<string, unknown>;
  if (itemCost === undefined || itemCost === null) return rest;
  return { ...rest, item_cost: manager ? itemCost : MASKED };
}

export default async function AuditLogPage() {
  // ⛔ ~~`if (!isAuditUiEnabled()) notFound();`~~ —— 2026-09-14 Sean 拍 Q2 乙:這一頁要上線、常開;旗標檔一起刪。
  //    員工才看得到仍由登入(proxy.ts)守;頁面上「2026-08-25 之前的操作人是自己挑的」那句警語保留。

  // 🔴 **`50` 寫在這裡是刻意的**:`AuditLogReader.listRecent(limit)` **沒有預設值**
  //    (`lib/audit/repository.ts:73-75` 逐字:預設值會讓「這頁一次抓幾筆」藏在最底層,
  //     而那是頁面層的決定)。⇒ 這個數字要看得見。
  //    ⚠️ **50 是我(C 窗)定的,不是拍板** —— 一頁看得完、又不會讓人覺得「只有幾筆」。改起來一行。
  const LIMIT = 50;

  // ── 🔴🔴 「讀取失敗」與「沒有資料」必須走兩條路,而這是機制不是文案 ────────────
  //   `SupabaseAuditLogReader.listRecent()` 出錯時**是 throw、不是回 `[]`**(D1a-2 刻意如此)。
  //   ⇒ 若這裡寫成 `catch { rows = [] }`,畫面會顯示「目前沒有操作紀錄」——
  //     **那就是「壞掉但看起來完全正常」**,而且是**親手把 D1a-2 的設計意圖丟掉**。
  //   🔴 同形狀已在同一天的訂單線獨立踩過一次(「拿不到值 ≠ 0」,換一個資料型別)
  //     ⇒ 主視窗裁定:守門那格 **must,不准降級**。負測在 `page.test.tsx`。
  let rows: AuditTableRow[] = [];
  let loadFailed = false;
  try {
    const [logs, staff, manager] = await Promise.all([
      getAdminAuditLogReader().listRecent(LIMIT),
      // 🆕 2026-09-14:含停用(歷史列的人可能已停用);第一順位是列上的快照, 這份只是快照 NULL 時的退路。
      listAllStaff(),
      // 身分讀不到(沒票 / 不在 request scope)⇒ 當非 manager(fail-closed 遮數字), 不讓整頁倒。
      getSessionActor().then((a) => isActiveManager(a?.id), () => false),
    ]);
    // 🔴 成本紀錄(`orders.item.costs.set`, 20260914010000)的 before / after 是老闆才能看的數字(成本欄老闆才看)。
    //    本頁對所有登入員工開放 ⇒ 非 manager 看得到「誰 / 何時 / 哪一項改了成本」, 但**數字遮掉**(codex 2026-09-14 must-fix ①:
    //    稽核頁是成本的第二條外洩路)。整筆留著不砍:稽核要完整, 遮的是值不是事件。actor 拿不到 = 非 manager(fail-closed)。
    // 🔴 差異在**頁面層**算,不塞進 `toAuditListRow` —— 那支是 D1b 的顯示層,
    //    檔頭逐字寫著 `before`/`after` 不在它的輸出裡(plan 驗收 6)。
    // 品牌名稱只在有折扣紀錄時才讀;讀不到不擋頁面, 退回顯示編號
    const brandNames = logs.some((l) => l.action === DEALER_DISCOUNT_AUDIT_ACTION)
      ? await loadBrandNames().catch((err: unknown) => {
          console.error('[admin/settings/audit] 品牌名稱讀取失敗, 改顯示編號', err);
          return new Map<string, string>();
        })
      : new Map<string, string>();
    rows = logs.map((log) => {
      // 🔴🔴 **成本那一筆的遮罩【也要套到「為什麼」那一欄】(2026-09-17 加「為什麼」時一起)。**
      //    ⚠️ 只遮 `changes` 而放 `reason` 過去 ⇒ 員工把數字打在原因裡(「改成 3200」)
      //       就**從旁邊那一欄漏出去** —— 而畫面看起來「有遮」。
      //    📌 **一道遮罩的射程止於它遮的那一欄** —— 新增欄位的人要自己把它加進來,
      //       而沒有東西會提醒他。(同 2026-09-16 那道 Markdown 星號守門的分母漏掉新常數。)
      //    🛑 `reason` 是自由文字 ⇒ 我們**無法**判斷它裡面有沒有數字 ⇒ 只能整欄遮。
      const maskCost = !manager && log.action === COST_AUDIT_ACTION;
      const maskDiscountReason = !manager && log.action === DEALER_DISCOUNT_AUDIT_ACTION;
      const base = toAuditListRow(log, staff);
      return {
        ...base,
        // 🔴 折扣那一筆:有沒有原因本身就洩漏「是不是低於成本」⇒ 非管理者一律印遮罩, 不分有沒有原因(Codex E4 R1)
        reason: maskDiscountReason ? MASKED : maskCost && base.reason !== null ? MASKED : base.reason,
        changes: maskCost
          ? [{ key: '(成本)', from: MASKED, to: MASKED }]
          : log.action === DEALER_DISCOUNT_AUDIT_ACTION
            ? [
                ...brandRow(log, brandNames),
                ...(maskDiscountReason
                  ? diffAuditPayload(withoutBelowCostReason(log.before), withoutBelowCostReason(log.after))
                  : diffAuditPayload(log.before, log.after)),
              ]
          : log.action === SWAP_AUDIT_ACTION
            ? swapChanges(swapPayloadForDisplay(log.before, manager), swapPayloadForDisplay(log.after, manager))
            : diffAuditPayload(log.before, log.after),
      };
    });
  } catch (error) {
    console.error('[admin/settings/audit] 操作紀錄載入失敗', error);
    loadFailed = true;
  }

  return (
    <div className='mx-auto space-y-4'>
      <div className='space-y-1'>
        <h1 className='text-2xl font-semibold'>操作紀錄</h1>
        {/* 🔴🔴 **第二句(2026-09-17)是為了擋一個很具體的誤會:那一欄多半是「—」。**
            🔬 接「為什麼」那一欄之前實查正式庫:690 筆裡 538 筆有值 ——
               **而其中 513 筆是同一句**(某次批次下架的備註),相異值只有 1 種;
               **最近 15 筆裡只有 3 筆有原因。**
            ⇒ 📌 **「538」單獨拿出來會讓人以為這一頁很豐富, 而第一眼看到的是一排「—」。**
            ⇒ 🎯 **沒有這一句, 他的第一個念頭是「壞了」—— 而它沒壞。**
            🔵 **這不是加功能, 是把我們已經知道的事實放到看得到的地方。**
            ⚠️ **放在三元式【外面】** —— 同這一頁既有的那條紀律(下面那段警語逐字:
               「警語在三種狀態都要在 —— 有資料 / 空的 / 讀取失敗」):
               這一句講的是**這一欄是什麼**, 不是「這次有沒有撈到」。 */}
        <p className='text-muted-foreground text-sm'>
          後台每一筆異動的紀錄:誰、什麼時候、對哪張單、做了什麼。
          <br />
          {/* 🔴 **這一行我第一版寫成 `**選填**`** —— JSX 是純文字渲染, 會印出實體星號。
              📌 **那是 2026-09-16 才修過的同一個病**(cancel-result-panel 那組), 而那道守門
                 只掃它自己那幾個匯出常數 ⇒ **對這一頁零判別力**。
              ⇒ 🎯 **一道守門的射程止於它掃的那個常數** —— 同一個病換一支檔就能重來, 今天第三次。 */}
          「為什麼」為<b>選填</b>欄位。顯示「—」代表<b>未填寫</b>，舊紀錄可能沒有這項資料。
        </p>
      </div>

      {/* 🔴🔴 **「操作人」那一欄未經驗證 —— 而這一頁長得像一份可信的稽核。**
          `staff.ts` 檔頭(2026-08-29 `-c8` 訂正:~~原寫 `:4-5`~~ —— 引文前半在 `:3`、`:5` 是空行;
          而該檔頭本身同日已改寫成帶限定詞的版本 ⇒ **這裡不再引行號, 改引【內容】**):
          **操作者是使用者自行選擇, 而那只在 `ADMIN_REQUIRE_REAL_IDENTITY` 關著時成立**。
          ⇒ 這一欄印的是**那個人自己說他是誰**,不是系統確認過的身分。
          🔴 **不寫出來的代價很具體**:一頁四欄、有時間有對象、排版像帳本
             ⇒ 員工(和 Sean)會拿它當「誰做的」的憑據,**而它答不了那件事**。
             這就是 `#436` 逐字記的「存在性驗證不是身分驗證 ⇒ 稽核痕跡可被冒名」。
             **一份沉默的稽核比沒有稽核危險** —— 它讓人停止查證。

          ⚠️ **警語在三種狀態都要在** —— 有資料 / 空的 / 讀取失敗。
             這一句講的是**這一頁的資料是什麼**,不是「這次有沒有撈到」;
             只在有資料時印,等於在空的那天悄悄變成一份沒有但書的稽核。
             (同形狀既有前例:`app/products/[id]/page.test.tsx:353` 逐字
              「空的時候警語仍要在 —— 『沒有圖片』不代表『同步不會蓋』。三段都要在」。)

          📌 **三段式照退款區那句**(`order-detail.tsx:662-666` 的
             「這是系統設定,不是這張單的問題…請通知系統維護」):
             ① 現況是什麼 ② 不是你的錯 ③ 下一步找誰。**不自創新語彙。**
          🔴 **講「沒有驗證他是誰」而不是「僅供參考」** —— 後者聽起來像**精確度**問題
             (數字可能不準),前者講的是**可信度**問題(這個名字可能不是他)。
             員工的下一步不同:一個是「大概看看」,一個是「別拿它當憑據」。

          🔴🔴 **⟦b4-MGR0⟧ 2026-08-28:這句改成【兩個時期】,而那不是文案潤飾。**
             ~~原本整句是「操作人是自己在畫面上選的,系統還沒有驗證他是誰」~~
             ⚠️ **那句話 2026-08-25 就已經假了**(B5-a 起 `ADMIN_REQUIRE_REAL_IDENTITY=1`
             ⇒ actor 來自簽章過的票,自選 cookie 一個字都不讀)—— **不是本片弄假的。**
             🔴 而本片讓它【更危險】:那個名字現在還決定「誰能改權限」
             ⇒ 一句「未經驗證」擺在一頁記錄著權限變更的畫面上,會讓人以為**權限紀錄也不可信**。
             🔴 **而修法不是刪掉它** —— 它對【08-25 之前的紀錄】仍然為真,
             而那正是 2026-08-15 那筆管理者提升追不出是誰做的的原因。⇒ 拆兩個時期,兩半都留。

          🔴 文案是**可見文字**,不是 `title` / `aria-label`:`title` 由 OS 畫、不進 paint tree
             ⇒ 截圖與 DOM 都抓不到、**零守門可能**(理由全文在 `item-name-cell.tsx` 檔頭)。
             守門在 `page.test.tsx`,而它**釘的是字面**(改一個字就紅)—— 因為
             「沒有驗證他是誰」被改軟(例如改成「僅供參考」)之後,**畫面看起來一樣正常**。 */}
      <p className='rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs text-amber-700'>
        2026-08-25 起，「操作人」來自已驗證的登入身分。在此日期之前，操作人由使用者自行選擇，
        系統未驗證是否為本人，因此舊紀錄只能作為查核線索，不能單憑姓名認定實際操作人。
      </p>

      {loadFailed ? (
        // 🔴 **文案與空狀態必須讀起來完全不同** —— 這一塊的存在意義就是讓員工分得出
        //    「沒人動過東西」和「這頁讀不到資料」。長得像的話,這道分流等於沒做。
        <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-6 text-sm'>
          操作紀錄載入失敗,請稍後再試或聯絡系統維護。
        </div>
      ) : (
        <AuditLogTable rows={rows} />
      )}
    </div>
  );
}
