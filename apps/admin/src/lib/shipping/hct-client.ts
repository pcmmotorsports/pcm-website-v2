// hct-client.ts — 把片 A 的欄位送到新竹 / 問新竹一張單的貨號(⟦ship-HCTAPI⟧ 片 B)。
//
// 🛑🛑 **這一片交付的時候, 那條路是【關著】的。**
//    📌 **「碼寫好了」與「它會送出東西」是兩件事** —— 片 B 只做第一件。
//
// 🔴 **本檔【不寫 DB】。** 它回一個結果, 落庫是片 C ——
//    而片 C **不得在那支 `unknown` 的 migration 貼進正式庫之前開工**
//    (`shipments_hct_status_domain` 值域只有 `draft/submitted/failed`, 會退件)。
//    ⇒ 那條順序釘在板列 `⟦ship-HCTAPI⟧`, 不是只在 plan 裡。
//
// 📎 規格 = Sean 2026-09-04 給的 `新竹物流API服務說明 V1`(內頁 2022/12/30 ver 2.0)。

import type { HctTransDataFields } from './hct-trans-data';

/**
 * 🔴🔴 **三態, 而第三態才是這一片的重點。**
 *
 * ⛔ **不是** `success | failed` —— 那是一個**只有兩個世界**的模型, 而真實有第三個:
 *    **我們送出去了, 而我們沒收到回應**(逾時 / 斷線 / HTTP 5xx)。
 *
 * 🔵 **而這個形狀不是我發明的, 這個 repo 已經有一個被接受的前例**:
 *    `packages/adapters/src/tappay/TapPayChargeAdapter.ts:132-135` 逐字 ——
 *    「HTTP 層失敗(auth/infra)= **扣款狀態未知** → throw(use-case `charge_unknown`、**不誤判未扣款**)」
 *    ⇒ 📌 **金流那條路已經這樣做而且上線了** ⇒ 下一個人可以去讀那支檔, 而它一直在那裡。
 *
 * 🛑 **為什麼不能把 `unknown` 併進 `failed`**:
 *    `failed` 會讓下一個人**重送**, 而規格第 8 頁逐字
 *    「新竹貨號+訂單編號 ⇒ 當日重複上傳, **視同更正資料內容**」
 *    ⇒ 🔴 **重送不是重送。** 而更正要帶新竹貨號, 那只有第一次送成功才拿得到。
 *    ⇒ 🎯 **一個回 `failed` 的 client 比一個會 throw 的更危險 ——**
 *      **它主動說一句假話, 而那句假話會引導出一個破壞性動作。**
 */
export type HctSubmitOutcome =
  | { kind: 'submitted'; edelno: string; raw: unknown }
  | { kind: 'rejected'; errMsg: string; raw: unknown }
  /** 🔴 送出去了而不知道結果 ⇒ **不得重送, 先用 `queryEdelno` 問**。 */
  | { kind: 'unknown'; reason: string }
  /** 閘關著 ⇒ 一發請求都沒打。這是**預期的安全態**, 不是錯誤。 */
  | { kind: 'disabled' };

/**
 * 🔴 **兩顆 env, 而它們【不共用】—— 唯讀與送出是兩個授權。**
 *
 * 用同一顆會讓「我想查一下」變成「順便可以送出」——
 * 而這條線今天在帳密那格用過同一句(Sean 只給了唯讀正式庫, 而唯讀與 apply 是兩個授權)。
 * 🔵 **多一顆要設的東西那個代價是【一次性的】, 而混用的代價是【每一次】。**
 */
/**
 * 🔴 **兩顆各自【靜態】讀, 不用 `process.env[變數]`。**
 * 那不是風格 —— repo 有一道 eslint 閘擋動態存取(`no-restricted-syntax`),
 * 理由逐字:「Next.js 不 inline → client bundle 取 undefined → runtime throw」。
 * 🎯 **而它今天當場抓到我**:我第一版寫 `process.env[envName]` ⇒ lint 紅。
 * 📌 **一道我不知道存在的閘, 在我把一個「看起來很乾淨的抽象」寫下去的那一刻叫了** ——
 *    而那個抽象的代價(bundle 裡變成 undefined)**在測試裡看不到**。
 * 🛑 **所以不 `eslint-disable`** —— 那會把一個真的風險換成一行豁免。
 */
const readSubmitGate = (): string | undefined => process.env.HCT_SUBMIT_ENABLED;
const readQueryGate = (): string | undefined => process.env.HCT_QUERY_ENABLED;

/**
 * 🔴🔴 **那道閘的三個性質 —— 抄 `settle-sweep/route.ts:161-166`, 不重新發明。**
 *
 * 1. **嚴格 opt-in, 只認字面 `'true'`** ⇒ 未設 / `'false'` / `'1'` / `'TRUE'` **全部視為關**
 *    ⇒ 🎯 **一個打錯的值不會變成開。**
 * 2. **閘在【建依賴之前】** ⇒ 關著的時候, 那條路**連帳密都沒讀**
 *    (settle-sweep 逐字:「deps/env 在此 gate『後』才建 → disabled 路徑零 DB env 依賴」)。
 * 3. **關著回一個成功的 no-op, 不是錯誤** ⇒ 它是**預期的安全態**;
 *    回錯誤會吵, 而**吵到最後會被關掉**。
 *
 * ➕ **第四條(主視窗 2026-09-04 批准, 而它改了我的理由)**:
 *    **`development` 一律當關, 不看值。**
 *    ⛔ ~~理由不是「本機沒有值」~~ ⇒ ✅ **理由是【本機不該有能力送出真的託運單】。**
 *    📌 **一個安全性質若建立在「某個東西剛好不存在」上,**
 *      **它的失效條件是【有人做了一件方便的事】** —— 而那件事沒有人會覺得自己在冒險。
 */
function gateOpen(read: () => string | undefined): boolean {
  if (process.env.NODE_ENV === 'development') return false;
  return read() === 'true';
}

/**
 * 打錯環境 —— 而規格讓這件事**在網址上分不出來**。
 *
 * 🔬 規格第 8、10 頁:測試與正式**共用同一支 URL**
 * (`https://Hctrt.hct.com.tw/EDI_WebService2/Service1.asmx`), 靠帳密區分
 * (規格逐字給了 `公司名稱[test] 密碼[test1]`)。
 * ⇒ 🔴 **「打錯環境」與「打對環境」在網址上印同一個東西。**
 *
 * ✅ **所以唯一的判別式是帳號本身** —— 而**我不讀值**, 由碼在執行期判。
 * 🛑 **刻意不用第二顆 env 宣告環境**:兩顆 env 會不一致, 而**不一致時沒有東西會叫**。
 */
export function hctMode(account: string): 'test' | 'live' {
  return account === 'test' ? 'test' : 'live';
}

export type HctClientDeps = {
  /** 注入 —— 讓測試不必碰網路。正式路徑由呼叫端傳 `globalThis.fetch`。 */
  fetchImpl: typeof fetch;
  endpoint: string;
  account: string;
  password: string;
};

/** 逾時 —— 沒有它, 一個掛住的連線會讓員工以為畫面壞了而重按。 */
const TIMEOUT_MS = 20_000;

/**
 * 送出一張託運單。**成功回貨號;而不確定時回 `unknown`, 絕不回 `failed`。**
 *
 * 🔴 **`raw` 整包留著 —— 而它是一個【還沒出錯時看起來多餘】的欄位。**
 *    規格第 26-27 頁**只有錯誤訊息【文字】、沒有數字錯誤碼**, 而部分項目連原因欄都是空的
 *    ⇒ 接線只能**字串比對**, 而**字串會被對方改**。
 *    ⇒ 🎯 **解析錯的那一刻, 這一包是唯一能回頭看的東西。**
 *    🛑 **而這種欄位最容易在 code review 被拿掉**(「這個沒人讀」)——
 *      📌 **所以這段註解寫的是【它為什麼在】, 不是【它是什麼】**:後者看得出來, 前者看不出來。
 */
export async function submitTransData(
  deps: HctClientDeps,
  fields: HctTransDataFields,
): Promise<HctSubmitOutcome> {
  // 🔴 閘在最前面 —— 這一行【之前】沒有讀 deps 的任何一格。
  if (!gateOpen(readSubmitGate)) return { kind: 'disabled' };

  let res: Response;
  try {
    res = await deps.fetchImpl(deps.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Company: deps.account, password: deps.password, data: [fields] }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    // 🔴 網路層炸掉 = **我們不知道那張單有沒有進去** ⇒ `unknown`, 不是 `failed`。
    return { kind: 'unknown', reason: `network: ${err instanceof Error ? err.name : 'unknown'}` };
  }

  // 🔴 HTTP 非 2xx 同理 —— 5xx 尤其可能是「它收了而回應掉了」。
  if (!res.ok) return { kind: 'unknown', reason: `http_${res.status}` };

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    // ⚠️ 200 而 body 不是 JSON ⇒ 仍然是 `unknown`:它可能收了。
    return { kind: 'unknown', reason: 'body_not_json' };
  }

  const row = firstRow(raw);
  // 規格第 11 頁回傳值表:`success`(新增 Y / 修改 R / 失敗 N)· `edelno` 新竹貨號 · `ErrMsg`。
  const success = pick(row, 'success');
  const edelno = pick(row, 'edelno');
  if ((success === 'Y' || success === 'R') && edelno !== '') {
    return { kind: 'submitted', edelno, raw };
  }
  if (success === 'N') return { kind: 'rejected', errMsg: pick(row, 'ErrMsg'), raw };
  // 🔴 認不得的 success 值 ⇒ **不猜**。它可能成功了。
  return { kind: 'unknown', reason: `unrecognised_success_${success || 'empty'}` };
}

export type HctQueryOutcome =
  | { kind: 'found'; edelno: string; raw: unknown }
  | { kind: 'not_found'; raw: unknown }
  | { kind: 'unknown'; reason: string }
  | { kind: 'disabled' };

/**
 * 用訂單編號問新竹「那張單的貨號是多少」(`QueryEDELNO`,規格第 21 頁)。
 *
 * 🎯 **它存在的理由只有一個**:`submitTransData` 回 `unknown` 的時候,
 *    **先問, 不要重送。**
 *
 * 🔴 **fail-closed:`epino` 空就拒。** 抄 `TapPayChargeAdapter.recordQuery:522` 的形狀 ——
 *    它逐字寫著「三把識別鍵全空 → 拒(**絕不送無 filter 全表查 → 防誤命中他單**)」。
 *    ⇒ 📌 這裡的等價物:空的訂單編號等於問新竹**「隨便給我一張單」**。
 */
export async function queryEdelno(
  deps: HctClientDeps,
  epino: string,
): Promise<HctQueryOutcome> {
  if (epino.trim() === '') {
    throw new Error('queryEdelno: 訂單編號不得為空 —— 空的識別鍵等於問新竹「隨便給我一張單」。');
  }
  // 🔴 另一顆 env:唯讀與送出是兩個授權。
  if (!gateOpen(readQueryGate)) return { kind: 'disabled' };

  let res: Response;
  try {
    res = await deps.fetchImpl(deps.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company: deps.account, password: deps.password, data: epino }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return { kind: 'unknown', reason: `network: ${err instanceof Error ? err.name : 'unknown'}` };
  }
  if (!res.ok) return { kind: 'unknown', reason: `http_${res.status}` };

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return { kind: 'unknown', reason: 'body_not_json' };
  }
  const row = firstRow(raw);
  const edelno = pick(row, 'edelno');
  if (pick(row, 'success') === 'Y' && edelno !== '') return { kind: 'found', edelno, raw };
  // ⚠️ 規格範例只給了一個 `"查無資料"` 字串, **沒有完整錯誤清單**
  //    ⇒ 這裡把「不是明確找到」一律當 `not_found`, 而 `raw` 留著讓人回頭看。
  return { kind: 'not_found', raw };
}

/** 回傳可能是陣列或單一物件 —— 兩種都吃,取第一列。 */
function firstRow(raw: unknown): Record<string, unknown> {
  if (Array.isArray(raw)) return isRecord(raw[0]) ? raw[0] : {};
  return isRecord(raw) ? raw : {};
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** 取一個字串欄位;缺 / 非字串 ⇒ `''`(呼叫端一律以空字串判「沒有」)。 */
function pick(row: Record<string, unknown>, key: string): string {
  const v = row[key];
  return typeof v === 'string' ? v : '';
}
