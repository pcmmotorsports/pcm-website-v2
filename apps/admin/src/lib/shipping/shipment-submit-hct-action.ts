'use server';

// shipment-submit-hct-action.ts — 送新竹那一個 server action(⟦ship-SHIPFILESSPLIT⟧ 2026-09-06 從
// `shipment-actions.ts` 整段搬出來, **一個字都沒改**)。
//
// 🎯 **為什麼它自己一支檔 —— 理由與行數無關**:
//    `shipment-actions.ts` 其餘七個 export 是**同一個形狀**:
//      `authorize → audit attempt → 一次 DB 呼叫 → audit ok/fail`(audit 都 3, 只有 reset 是 5)。
//    而這一支 **audit=13**, 因為它是**唯一一個對外發不可回收請求**的(鐵則 12⑤),
//    且獨有一個不變式:**佔位列寫在 HTTP 發出去【之前】**
//    ⇒ 它的失敗分支不是「DB 沒寫成」, 是**「我們不知道新竹收到沒」**。
//    ⇒ 📌 **讀其餘七支只要問「授權對不對、稽核有沒有」;讀這一支還要問「新竹那邊現在是什麼狀態」。**
//      兩種問題混在一支檔裡, **讀的人會用錯的問題去讀它。**
//
// 🔵 那兩個 `unknown` 卡住的板列講的就是這 236 行:`⟦ship-HCTUNKNOWNSTUCK⟧`(甲型, 已解)
//    與 `⟦ship-HCTUNKNOWNREAD⟧`(乙型, 開著)。
//
// ⚠️ `auditLog` / `NO_ACTOR_MESSAGE` 從 `./shipment-action-audit` 來 —— 那支檔**沒有** `'use server'`,
//    理由寫在它自己的檔頭(`'use server'` 只能 export async function)。
import { revalidatePath } from 'next/cache';
import { authorizeAdminMutation } from '../session/authorize';
import { toMessage } from './error-message';
import { auditLog, NO_ACTOR_MESSAGE } from './shipment-action-audit';
import { getHctShipment, recordHctSubmit, recordHctUnknownReason } from './shipment-repository';
import { buildHctTransData } from './hct-trans-data';
import { runHctSubmit, type HctCurrentStatus } from './hct-submit-flow';
import { hctSubmitGateOpen } from './hct-client';

// ═══════════════════════════════════════════════════════════════════════════
// ⟦ship-HCTAPI⟧ 步驟②:把 `runHctSubmit` 接上入口(Sean 2026-09-05 拍甲批准)
// ═══════════════════════════════════════════════════════════════════════════

export type HctSubmitActionResult =
  | { ok: true; kind: 'submitted' | 'recovered'; requestId: string | null }
  | {
      ok: false;
      kind: 'needs_confirm';
      message: string;
      truncated: readonly string[];
      /** 🔴 第二次按要原樣送回來 —— 它是「你看到的就是我現在算出來的」那個證據。 */
      confirmToken: string;
    }
  /**
   * ⛔ ~~`| { ok: false; kind: 'invalid'; message: string }`~~ —— **2026-09-09 加了又刪掉的一態。**
   * 🔴 **留這個訃聞是為了擋下一個人把它加回來**:它原本是「電話違反 V15 規則 ⇒ 不准送」,
   *    而 Sean 先拍「擋」、後改拍「提醒」——**改拍的成因是一個他當時不知道的事實**:
   *    **後台今天改不動一張既有訂單的收件人電話**(改單 RPC 白名單只有出貨方式與發票欄
   *    `20260716130000_m4a_admin_update_order_item_workflow_rpc.sql:231`;作廢重建仍讀同一份
   *    訂單快照 `shipment-candidates.ts:479`;已標出貨的箱另有 DB 凍結規則
   *    `20260805170100_m4b_e10_b2_s1a2_shipments_guards.sql:130`)。
   *    ⇒ 🎯 **擋下來 = 員工連試都不能試,而又沒有地方可以修。**
   * 🛑 **⇒ 誰要把這一態加回來,先解掉那個缺口** —— 順序反了就是一道讓事情變糟的閘。
   */
  | { ok: false; kind: 'disabled' | 'failed' | 'unknown' | 'refused' | 'needs_human'; message: string };

/**
 * 🔴🔴 **`HCT_API_ENDPOINT` 是本片【新引進】的 env 名 —— 而它今天不存在。**
 *    量到的(2026-09-05, 只列名稱不印值):`pcm-admin` 上有 `HCT_API_ACCOUNT` / `HCT_API_PASSWORD`,
 *    **沒有 endpoint**;而 `hct-client.ts` 的 `HctClientDeps.endpoint` 是**呼叫端傳進去的**
 *    ⇒ 📌 **這一格在 repo 裡沒有任何來源, 而我不會編一個網址** ——
 *      廠商檔列的那幾個 URL(`hct-logistics-api-reference.md:77` 等)**分測試/正式、也分服務**,
 *      挑哪一個是 Sean 與新竹之間的事, 不是我讀文件推得出來的。
 * ✅ **fail-closed**:三顆任一缺 ⇒ 回 `disabled`(與開關關著同一條路)⇒ **不會打任何外部端點**。
 * 🔵 而它與開關的 `disabled` **給不同的訊息** —— 否則「還沒開通」與「設定漏了一顆」印同一句話。
 */
function readHctDeps(): { fetchImpl: typeof fetch; endpoint: string; account: string; password: string } | null {
  // 🔴 **codex 2026-09-05:`=== undefined` 讓【空字串】過關** ——
  //    `HCT_API_ENDPOINT=''` 之後 fetch 會因無效 URL 失敗, 而**佔位列已經寫了**
  //    ⇒ 📌 **「根本沒送」被記成 unknown。** 空白也一樣(一顆貼歪的 env 常常是空白)。
  const endpoint = (process.env.HCT_API_ENDPOINT ?? '').trim();
  const account = (process.env.HCT_API_ACCOUNT ?? '').trim();
  const password = (process.env.HCT_API_PASSWORD ?? '').trim();
  if (endpoint === '' || account === '' || password === '') return null;
  return { fetchImpl: fetch, endpoint, account, password };
}

/**
 * 從新竹回來的原始回應裡撈一句人看得懂的。
 * 🔵 **撈不到就說撈不到** —— 一句編出來的「未知錯誤」比一句「回應裡沒有錯誤訊息」沒用。
 */
function hctErrHint(raw: unknown): string {
  if (typeof raw === 'string') return raw.slice(0, 200);
  if (raw !== null && typeof raw === 'object') {
    for (const k of ['ErrMsg', 'errMsg', 'message', 'msg']) {
      const v = (raw as Record<string, unknown>)[k];
      if (typeof v === 'string' && v.trim() !== '') return v.slice(0, 200);
    }
  }
  return '(它的回應裡沒有可讀的錯誤訊息)';
}

const HCT_STATUSES = ['draft', 'submitted', 'failed', 'unknown'] as const;

function toCurrent(raw: string): HctCurrentStatus {
  // 🔴 DB 的值域由 CHECK 約束保證, 而**保證是別人給的** ⇒ 這裡自己再收一次。
  //    收不到 ⇒ 當 'unknown'(最保守的那一格:它會先去查, 不會直接送)。
  return (HCT_STATUSES as readonly string[]).includes(raw) ? (raw as HctCurrentStatus) : 'unknown';
}

export async function submitShipmentToHctAction(args: {
  shipmentId: string;
  /** 員工看過「哪幾欄會被截」之後再按一次 ⇒ 把上一次拿到的 `confirmToken` 原樣帶回來。 */
  confirmTruncated?: string;
}): Promise<HctSubmitActionResult> {
  const auth = await authorizeAdminMutation();
  if (auth === null) return { ok: false, kind: 'needs_human', message: NO_ACTOR_MESSAGE };
  auditLog('shipment.hct_submit', auth, 'attempt', { shipment_id: args.shipmentId });

  const deps = readHctDeps();
  if (deps === null) {
    auditLog('shipment.hct_submit', auth, 'fail', { shipment_id: args.shipmentId });
    return {
      ok: false,
      kind: 'disabled',
      message: '新竹未開通(缺 HCT_API_ENDPOINT / HCT_API_ACCOUNT / HCT_API_PASSWORD 其中之一)',
    };
  }

  try {
    const row = await getHctShipment(args.shipmentId);
    // 🔵 codex:這幾條早退路徑原本【沒有終局稽核】⇒ log 上看起來像「按了然後執行中斷」。
    if (row === null) {
      auditLog('shipment.hct_submit', auth, 'fail', { shipment_id: args.shipmentId });
      return { ok: false, kind: 'needs_human', message: '找不到這一箱' };
    }
    if (row.voidedAt !== null) {
      auditLog('shipment.hct_submit', auth, 'fail', { shipment_id: args.shipmentId });
      return { ok: false, kind: 'refused', message: '這一箱已作廢,不能送新竹' };
    }

    const built = buildHctTransData({
      shipmentReference: row.shipmentReference,
      recipient: row.recipientSnapshot,
      // ⚠️ **`itemCount: 1` 是一個【假設】, 不是量到的**(code-reviewer nit⑤):
      //    它是新竹的「件數」= **幾個包裹**, 不是幾件商品。今天後台一次建一箱
      //    ⇒ 1 是對的;而**多箱合寄那天這裡會靜靜報錯的件數**。
      //    🔵 修法不是在這裡猜, 是等那個功能出現時把箱數傳進來。
      itemCount: 1,
      ...(row.carrierNote === null ? {} : { note: row.carrierNote }),
    });

    // 🔴🔴 **閘判定必須排在【任何副作用之前】—— code-reviewer 2026-09-05 MF1。**
    //    `gateOpen` 住在 `hct-client.ts` 裡, 而它是在 `submitTransData` 走到一半才判的
    //    ⇒ 舊版:閘關著 ⇒ **零 HTTP, 而佔位已經把 hct_status 推成 unknown**
    //    ⇒ 下次 `admin_record_hct_submit` 對 old=unknown,new=unknown **RAISE**
    //    ⇒ 🛑 **那一箱卡死, 要人工改 DB。** 📌 一個為了「不重送」而做的保護, 把單子鎖死了。
    if (!hctSubmitGateOpen()) {
      auditLog('shipment.hct_submit', auth, 'fail', { shipment_id: args.shipmentId });
      return { ok: false, kind: 'disabled', message: '新竹未開通(HCT_SUBMIT_ENABLED 未設為 true)' };
    }

    // 🔴🔴 **截斷要被看見 —— code-reviewer MF3。**
    //    `hct-trans-data.ts` 的契約逐字:「呼叫端要把它**印在員工按下去之前看得到的地方**」。
    //    舊版只取 `built.fields`, `truncated` 零讀取 ⇒ **姓名/電話/地址超長時靜默截斷送出去。**
    //    ✅ 而不能改成「太長就拒絕」—— 同一段契約逐字說**拒絕的代價落在客人身上**。
    //    ⇒ 改成:第一次按 ⇒ **不送**, 回哪幾欄會被截;員工看過再按第二次才送。
    // 🔴🔴 **codex 2026-09-05:`confirmTruncated: true` 是一張【空白支票】** ——
    //    第一次顯示 A 版、資料改成 B 版後第二次只帶 true;甚至可以**第一次就直接帶 true**
    //    ⇒ 📌 **server 證明不了員工看過【這一次】的內容。**
    //    ✅ 改成帶【那一次看到的清單】, 而 server 拿它與**現在算出來的**比對。
    // 🔴🔴 **欄位規則檢查 —— Sean 2026-09-09【改拍甲:降成提醒,不擋】。**
    //    規則逐字出自 V15 第 11 頁,判準與「為什麼一律不擋」寫在
    //    `hct-trans-data.ts` 的 `advisories` 那段 docstring。
    //    ⛔ ~~第一版做成一道會擋的閘(`kind: 'invalid'`)~~ —— **那個 kind 已整支刪除**,
    //       因為擋下來的員工**無事可做**:後台今天改不動一張既有訂單的收件人電話
    //       (改單 RPC 白名單只有出貨方式與發票欄;作廢重建仍讀同一份訂單快照)。
    //       ⇒ 📌 不擋的話那支電話會被新竹拒、單子回 `failed`、**他看得到也還能再按**。
    //       ⇒ ⇒ **一道讓事情變糟的閘。** 端回去之後他改拍「提醒」。
    //
    // 🟡 **所以電話、地址、截短三種【共用同一個「看過再按一次」的殼】** ——
    //    三者都是「放行但要你看一眼」,做成三道會讓員工按四次。
    // 🔴 **只在 `willSubmit` 才問** —— `unknown` 的箱走的是 `QueryEDELNO_Json` 查詢,
    //    而查詢只吃 `epino`(V15 第 22 頁「必要欄位」只有它一個)⇒ **收貨人電話與它無關**
    //    ⇒ 拿電話或地址去攔一條救援路,是純粹的誤傷。
    //    (codex 2026-09-09 R1 must-fix ①:我第一版擋在狀態分流之前 ⇒ 卡在 `unknown` 的箱
    //     連查都不查,而我同一天才把「最壞情況的出口」寫成本片重點。)
    // ⚠️ **token 綁的是【截短欄位名 + 提醒句】,不是資料內容**(codex nit,實測複現):
    //    甲大樓換成乙大樓 ⇒ 提醒句相同 ⇒ 帶舊 token 直接送出。
    //    ⇒ 📌 它答的是「你看過這一類問題了嗎」,**不是**「你看過這一份收件資料了嗎」。
    //      要後者得把資料版本放進 token —— 那是另一片,而本片不假裝已經做到。
    const willSubmit = toCurrent(row.hctStatus) === 'draft' || toCurrent(row.hctStatus) === 'failed';
    const looks = willSubmit ? [...built.truncated, ...built.advisories] : [];
    const truncatedNow = [...looks].sort().join(',');
    if (looks.length > 0 && (args.confirmTruncated ?? '') !== truncatedNow) {
      auditLog('shipment.hct_submit', auth, 'fail', { shipment_id: args.shipmentId });
      const parts: string[] = [];
      if (built.truncated.length > 0) {
        parts.push(`這幾欄超長、送出去會被截掉:${built.truncated.join(' / ')}`);
      }
      if (built.advisories.length > 0) parts.push(built.advisories.join(' · '));
      return {
        ok: false,
        kind: 'needs_confirm',
        message: `${parts.join(' —— ')} —— 看過再按一次就送`,
        truncated: built.truncated,
        confirmToken: truncatedNow,
      };
    }

    // 🔴🔴 **佔位列 —— plan 第 3 節那個單向門的緩解(Sean 拍甲時一起批的)。**
    //    送出成功而寫 DB 之前行程死掉 ⇒ 新竹收到了而我們沒紀錄 ⇒ 下次 `current` 還是 draft ⇒ **重送**。
    //    ⇒ 送出【之前】先把狀態推成 `unknown`:那一格的語意逐字是「送出去了而不知道結果 ⇒ 不得重送」。
    //    🛑 **佔位不得帶 request_id** —— `hct_request_id` 是 write-once(`20260904170000:81`),
    //      帶了之後真正的 id 就覆寫不進去。
    // 🛑🛑 **codex 2026-09-05 must-fix,而我【沒有修掉它】—— 因為它是這個設計的代價本身。**
    //    寫完佔位、HTTP 發出去【之前】行程被砍 ⇒ **新竹從來沒收到, 而 DB 永久是 unknown。**
    //    ⇒ 📌 **這不是 bug, 是「寧可誤判成送過了」那個選擇的另一面** ——
    //      反過來的設計(送完才寫)會在**新竹已經收到**時漏記, 而那一面的代價是**重送一張真的託運單**。
    //    ⇒ 🎯 **兩種都會錯, 而它們錯的方向不同:一種讓單子卡住(要人救), 一種讓客人收到兩箱。**
    //      Sean 拍甲批的 plan 選了前者。
    // 🔴 **而「要人救」目前【沒有那個人可以按的東西】** —— 那才是真的缺口:
    //    `queryEdelno` 查到「查無此單」就證明沒送出去, 而**今天沒有任何 UI 把 unknown 推回 draft**
    //    ⇒ 已開板列 `⟦ship-HCTUNKNOWNSTUCK⟧`。**在那之前, 卡住的箱要 Sean 手動改 DB。**
    const current = toCurrent(row.hctStatus);
    if (current === 'draft' || current === 'failed') {
      await recordHctSubmit({
        shipmentReference: row.shipmentReference,
        status: 'unknown',
        requestId: null,
        raw: { placeholder: true, at: new Date().toISOString() },
      });
    }

    const result = await runHctSubmit({
      deps,
      current,
      fields: built.fields,
      // 🔵 `epino` 這個參數 2026-09-06 已刪 —— 查詢改用 `fields.epino`(⟦ship-EPINOUNIQUE⟧)。
    });

    switch (result.kind) {
      case 'recorded':
        // 🔴🔴 **`unknown` 走【窄門】, 其餘走 writer** —— ⟦ship-UNKNOWNREASONLOST⟧。
        //    佔位(`:176`)已經把狀態推成 `unknown`, 而 writer 逐字擋 `unknown ⇒ unknown`
        //    ⇒ 📌 **這裡若照舊呼叫 writer, 它會 RAISE, 而下面那個 catch 會把 SQL 錯誤
        //      當成給值班看的訊息印出去** —— `:222` 那句「不要重按」永遠印不出來。
        //    🔬 那是量到的(2026-09-08 拋棄式 PG 17.10):第二發寫入 ERROR、
        //      庫裡仍是 `{"placeholder": true}`、`flowReason` 一個字都沒進去。
        //    🛑 **而 writer 那道擋是對的, 不去動它** —— 窄門只寫 raw, 一個狀態欄都不碰。
        //    ⚠️ `failed` **不走窄門**:`unknown ⇒ failed` 在 writer 那邊是**允許**的,
        //      而它要真的把狀態翻成 `failed` ⇒ 走窄門的話狀態會停在 `unknown`。
        if (result.status === 'unknown') {
          // 🔴🔴 **[codex `gpt-6-astra` R1 must-fix ②]** 窄門自己失敗時, 安全提示**又會消失**。
          //    🔬 codex 實跑重現(記憶體探針, 把窄門換成會 throw 的假貨):
          //      回傳 `{ok:false, kind:'needs_human', message:'PGRST202: RPC missing'}`
          //      ⇒ 📌 **沒有「不要重按」那句。** 而那正是本片要修的病, 只是換了一個觸發點。
          //    ⚠️ 它**會**發生:①`20260908020000` 還沒貼(那時就是 PGRST202)②逾時
          //      ③另一個人並發把狀態改掉 ⇒ 窄門的「只吃 unknown」拒絕。
          //    ✅ 所以這裡自己接住 —— **而不是讓它掉進外層 catch**。
          //    🛑 **不吞掉**:照樣寫稽核、照樣把原因附在訊息裡給人看;
          //      吞掉的話「原因沒記下來」這件事就沒有人知道了。
          try {
            await recordHctUnknownReason({
              shipmentReference: row.shipmentReference,
              reason: result.raw,
            });
          } catch (reasonErr) {
            // 🔴 **先把要回的東西組好, 再做任何可能自己炸掉的事** ——
            //    **[codex `gpt-6-astra` R2 must-fix ①]**:我上一版先呼叫 `auditLog` 再組訊息,
            //    而 codex 實跑證明 **`auditLog` 自己 throw ⇒ 掉進外層 catch ⇒
            //    回 `needs_human / audit sink failed`, 而「不要重按」又消失了**。
            //    ⇒ 📌 **同一個病的第三個觸發點** —— 前兩個是 writer RAISE 與窄門 throw。
            //    🎯 **形狀:一句安全提示的存活率, 等於它後面那串副作用【全部】不出事的機率。**
            //      ⇒ 所以把它從那串副作用底下**搬出來**, 不是替每個副作用各加一個 catch。
            const out: HctSubmitActionResult = {
              ok: false,
              kind: 'unknown',
              // 🔴 **安全提示排在最前面** —— 它是這一刻唯一會改變人行為的那句話。
              //    技術細節放後面, 而**不是**取代它(那正是舊版做錯的事)。
              message:
                '送出去了而不知道結果 —— 不要重按,請用查詢補問新竹貨號。' +
                `(而這次連原因都沒能記進資料庫:${toMessage(reasonErr)} —— 請回報這行字)`,
            };
            // 🛑 副作用各自包起來 —— 它們**不得**改變上面那句話回不回得去。
            try {
              auditLog('shipment.hct_submit_reason_lost', auth, 'fail', {
                shipment_id: args.shipmentId,
              });
            } catch {
              // 🔵 稽核寫不進去是另一件事, 而它不該把值班的提示一起帶走。
            }
            try {
              revalidatePath('/orders');
            } catch {
              // 🔵 同上:畫面沒刷新 < 值班看不到「不要重按」。
            }
            return out;
          }
        } else {
          await recordHctSubmit({
            shipmentReference: row.shipmentReference,
            status: result.status,
            requestId: result.requestId,
            raw: result.raw,
          });
        }
        // 🔴 **[R3 換角度審查 F5]** 窄門【成功】那條路的副作用**也要各自包起來** ——
        //    它與 codex R2① 是**同一個形狀的第四個觸發點**:`revalidatePath` 在這裡 throw
        //    ⇒ 掉進外層 catch ⇒ 回 `needs_human` + 原始錯誤, 而下面那句安全提示又沒印出來。
        //    ⚠️ **而我上一輪只包了失敗那條路** ⇒ 📌 **修一個位置的人不會自動回頭問
        //      「同一個形狀還在哪裡」** —— 這是今晚第二次踩(前一次是閘③/④b 只修了④b)。
        //    🔵 誠實記:`auditLog` 實作是 `console.info`(`shipment-action-audit.ts:46`)
        //      ⇒ 它實務上不會 throw ⇒ 這兩道 catch 與 R2① 一樣**是理論值**。
        //      **而我選擇兩邊都包, 不要一半信一半不信** —— 不一致比兩者任一個都糟。
        try {
          revalidatePath('/orders');
        } catch {
          // 🔵 畫面沒刷新 < 下面那句話回不去。
        }
        try {
          // 🔴🔴 **codex must-fix:舊版三種 status 都記 `ok`** ——
          //    而 action 隨後回 failed / unknown ⇒ 📌 **稽核把失敗寫成成功。**
          auditLog('shipment.hct_submit', auth, result.status === 'submitted' ? 'ok' : 'fail', {
            shipment_id: args.shipmentId,
          });
        } catch {
          // 🔵 稽核寫不進去是另一件事, 而它不該把回給值班的那句話一起帶走。
        }
        if (result.status === 'submitted') {
          return { ok: true, kind: 'submitted', requestId: result.requestId };
        }
        return result.status === 'failed'
          ? {
              ok: false,
              kind: 'failed',
              // 🔴 **codex must-fix:新竹拒絕的【原因】原本被吞掉了。**
              //    「公司名稱或密碼錯誤」與「地址格式不合」都印同一句「可以再按一次」
              //    ⇒ 員工會一直按, 而按幾次都不會變。
              message: `新竹回了失敗:${hctErrHint(result.raw)} —— 修好再按一次`,
            }
          : {
              ok: false,
              kind: 'unknown',
              message: '送出去了而不知道結果 —— 不要重按,請用查詢補問新竹貨號',
            };
      case 'recovered':
        await recordHctSubmit({
          shipmentReference: row.shipmentReference,
          status: 'submitted',
          requestId: result.requestId,
          raw: result.raw,
        });
        revalidatePath('/orders');
        auditLog('shipment.hct_submit', auth, 'ok', { shipment_id: args.shipmentId });
        return { ok: true, kind: 'recovered', requestId: result.requestId };
      case 'amended':
        // 🔴🔴 `R`(修改成功)—— 新竹那邊**本來就有一張**這個訂單編號的單。
        //    ✅ 貨號照記(那張單是真的, 不記才是錯的);
        //    🔴 而稽核記 `fail` 不是 `ok` —— **它不是一次乾淨的成功, 它是一個要人看的訊號**
        //      ⇒ 📌 記成 `ok` 會讓它混進「今天送成功幾張」裡, 而那正是它最需要被看見的地方。
        await recordHctSubmit({
          shipmentReference: row.shipmentReference,
          status: 'submitted',
          requestId: result.requestId,
          raw: result.raw,
        });
        revalidatePath('/orders');
        auditLog('shipment.hct_submit', auth, 'fail', { shipment_id: args.shipmentId });
        return { ok: false, kind: 'needs_human', message: result.reason };
      // 🔵 nit②:這三種也要留稽核 —— 少了它, 「有人按了而沒送成」在 log 上是**一片空白**,
      //    而空白與「沒有人按過」是同一個東西。
      case 'disabled':
        auditLog('shipment.hct_submit', auth, 'fail', { shipment_id: args.shipmentId });
        return { ok: false, kind: 'disabled', message: '新竹未開通' };
      case 'refused':
        auditLog('shipment.hct_submit', auth, 'fail', { shipment_id: args.shipmentId });
        return { ok: false, kind: 'refused', message: result.reason };
      case 'needs_human':
        auditLog('shipment.hct_submit', auth, 'fail', { shipment_id: args.shipmentId });
        return { ok: false, kind: 'needs_human', message: result.reason };
    }
  } catch (e) {
    auditLog('shipment.hct_submit', auth, 'fail', { shipment_id: args.shipmentId });
    return { ok: false, kind: 'needs_human', message: toMessage(e) };
  }
}
