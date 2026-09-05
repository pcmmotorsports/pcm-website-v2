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
    // 🔴 `amended` 與 `submitted` 分開 —— `R` 代表新竹那邊【本來就有一張】,
  //    那是狀態不同步的訊號, 不是一次乾淨的新增。
  | { kind: 'amended'; edelno: string; raw: unknown }
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
/**
 * 🔴🔴 **把那道閘【也】暴露成一個可以先問的述詞 —— code-reviewer 2026-09-05 MF1。**
 *
 * 病:呼叫端在送出【之前】先寫一列 `unknown` 佔位(擋重送), 而閘關著時
 *    `submitTransData` 走到一半才回 `disabled` ⇒ **零 HTTP, 而 `hct_status` 已經被推成 unknown**
 *    ⇒ 下一次 `admin_record_hct_submit` 對 old=unknown,new=unknown **RAISE**
 *      (`20260904170000:163-169` 逐字)⇒ 🛑 **那一箱卡死, 要人工改 DB 才救得回來。**
 * ⇒ 📌 **「閘在建依賴之前」這個性質, 對【呼叫端在閘之前做的事】完全無效** ——
 *   它保護的是這支檔裡的東西, 而佔位那一步發生在這支檔之外。
 * ⇒ ✅ 讓呼叫端問得到, 它才能把閘判定排在自己的副作用之前。
 * 🔵 它與 `gateOpen` 共用同一支函式 ⇒ **不會有兩份判定漂開。**
 */
export function hctSubmitGateOpen(): boolean {
  return gateOpen(readSubmitGate);
}

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

// ══════════════════════════════════════════════════════════════════════════
// 🔴🔴 SOAP —— 而【那個服務只講 SOAP】, 這是 2026-09-05 打出來的, 不是讀來的
// ══════════════════════════════════════════════════════════════════════════
// ⛔ ~~原本這支檔送純 JSON POST(`Content-Type: application/json`)~~ —— **三處都錯**:
//    ①協定(服務描述的協定計數:SOAP 1.1 ×2 · SOAP 1.2 ×2 · **HTTP POST 0 · application/json 0**)
//    ②外層鍵 `data` ③參數名大寫 `Company`(服務描述逐字是小寫 `company`)
//
// 🎯 **外層形狀是打出來的 —— 四發, 而它們互為對照**(⟦ship-HCTAPI⟧, 正式環境, Sean 本人授權):
//    ```
//    密碼留空          ⇒ ErrMsg「公司名稱或密碼錯誤」 ⇒ 信封對
//    {"data":[{…}]}    ⇒ ErrMsg「資料錯誤請確認」     ⇒ 舊碼送的就是這個
//    [{…}]             ⇒ ErrMsg「件數錯誤」           ⇒ 🎯 它讀進去了, 在驗欄位
//    {…}               ⇒ ErrMsg「資料錯誤請確認」
//    ```
//    ⇒ 📌 **①③ 回同一句泛用拒絕、② 回欄位層的錯 ⇒ 純陣列是【最有力的候選】。**
// 🛑🛑 **而它【不是】「完整外層已證實」—— codex must-fix ①, 我把原本的字面改窄了**:
//    那三發**只送了 `epino` 一欄** ⇒ 它證到的是「**這個外層沒有在解析階段被拒**」,
//    而「件數錯誤」也可能來自**驗證順序**、缺 `ejamt`、或**陣列筆數**, 不只來自「外層讀懂了」。
//    ⇒ 🔴 **完整 20 欄下會不會 `success=Y`, 今天沒有測到。**
//    ⇒ ⇒ 📌 **第一次真的送一張單的時候, 要有人看著它回什麼** —— 不要把這段註解讀成「已經驗過」。
//      而那三發**互相就是彼此的對照** —— 少了它們, 「② 對」只是我挑的一個答案。
//    ✅ 四發全部 `success=N` · `edelno=null` ⇒ **零建單**。
//
// 🛑 **而失敗的形狀最毒, 這是不改它的代價**:新竹回 **HTTP 200**, 而舊碼只把**非 2xx** 當 unknown
//    ⇒ 走 `success=N` ⇒ 回 `rejected` ⇒ **員工看到「新竹回了失敗」而不知道是我們自己包錯。**
const SOAP_NS = 'http://tempuri.org/';

function soapEnvelope(method: string, account: string, password: string, json: string): string {
  // 🔴 三個參數名**全小寫** —— 服務描述逐字 `<company>` `<password>` `<json>`。
  //    ⚠️ 2022 版 PDF 寫的是大寫 `Company`, 而**那份是舊的**(2026-09-05 抓線上服務描述訂正)。
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <${method} xmlns="${SOAP_NS}">
      <company>${xmlEscape(account)}</company>
      <password>${xmlEscape(password)}</password>
      <json>${xmlEscape(json)}</json>
    </${method}>
  </soap:Body>
</soap:Envelope>`;
}

/** 🔴 一定要跳脫 —— 地址/收件人裡的 `&` 或 `<` 會讓整個信封變成 not-well-formed XML。 */
function xmlEscape(v: string): string {
  // 🔴 codex must-fix ③:**XML 1.0 收不下的字元**(C0 控制字元、U+FFFE/U+FFFF)——
  //    它們穿得過 `JSON.stringify`, 而送出去會產生一個 not-well-formed 的信封
  //    ⇒ 新竹回 `soap:Fault` 或直接斷 ⇒ 📌 **那一箱卡成 `unknown`, 而出口還沒做。**
  //    ⇒ 丟掉它們比送出去好:它們在託運單上本來就印不出東西。
  //    ⚠️ 而 `\t\n\r` 是合法的, 不能一起丟。
  return v
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xmlUnescape(v: string): string {
  return v
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    // 🔴 codex must-fix ②b:**數字實體**(`&#34;` / `&#x22;`)—— 舊版漏了,
    //    而 .NET 的 XmlWriter 對某些字元就是輸出數字實體 ⇒ 漏了會讓 JSON.parse 失敗 ⇒ 整包變 unknown。
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&'); // 🔴 `&amp;` 一定要**最後**還原, 否則 `&amp;lt;` 會被還原成 `<`
}

/**
 * 把 `<方法名Result>` 裡那段 **JSON 字串**挖出來並 parse。
 * 🛑 **不是 XML parser** —— 它只認一個已知形狀的元素;認不得就回 null 讓呼叫端走 `unknown`。
 *    📌 **那是刻意的**:一個「盡力猜」的 parser 會把一個我們看不懂的回應變成一個看起來懂的結果。
 */
function extractSoapJson(xml: string, method: string): unknown {
  // 🔴 codex must-fix ②:上限先擋 —— 一個超大 body 會讓下面的 regex 變成一個 CPU 洞。
  if (xml.length > 256 * 1024) return null;
  // 🔴 DOCTYPE 一律拒 —— 我們不做 entity 展開, 而一個帶 DOCTYPE 的回應不是我們認得的形狀。
  if (/<!DOCTYPE/i.test(xml)) return null;
  // 🔴 **允許 namespace prefix 與屬性**(`<ns:XResult xsi:type="...">`)—— 舊版只認裸標籤 ⇒ 會漏掉合法回應。
  //    而 `g` 旗標讓我們數得出【有幾個】—— 📌 **多於一個就拒**:
  //    我們不知道該取哪一個, 而「取第一個」是在猜。
  const re = new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${method}Result\\b[^>]*>([\\s\\S]*?)</(?:[A-Za-z0-9_.-]+:)?${method}Result>`, 'g');
  const hits = [...xml.matchAll(re)];
  if (hits.length !== 1) return null;
  try {
    return JSON.parse(xmlUnescape(hits[0]![1] ?? ''));
  } catch {
    return null;
  }
}

/** 發一發 SOAP。回 `{ ok:true, raw }` 或一個 `unknown` 的理由。 */
async function soapCall(
  deps: HctClientDeps,
  method: string,
  json: string,
): Promise<{ ok: true; raw: unknown } | { ok: false; reason: string }> {
  let res: Response;
  try {
    res = await deps.fetchImpl(deps.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: `"${SOAP_NS}${method}"`,
      },
      body: soapEnvelope(method, deps.account, deps.password, json),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    // 🔴 網路層炸掉 = **我們不知道那張單有沒有進去** ⇒ 由呼叫端判成 `unknown`。
    return { ok: false, reason: `network: ${err instanceof Error ? err.name : 'unknown'}` };
  }
  if (!res.ok) return { ok: false, reason: `http_${res.status}` };
  // 🔴🔴 **`res.text()` 也要包在 try 裡** —— codex must-fix ⑥, 我開檔複驗成立:
  //    headers 回來之後 body 才逾時/斷線 ⇒ 這一行會**丟例外**
  //    ⇒ 而本 client 的契約是「**不確定就回 `unknown`, 絕不丟**」
  //    ⇒ 📌 一個丟出去的例外會讓呼叫端走它自己的 catch, 而**那條路不知道「它可能收了」**。
  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    return { ok: false, reason: `body_read: ${err instanceof Error ? err.name : 'unknown'}` };
  }
  // 🔴 `soap:Fault` = **信封層**的錯(參數名打錯、SOAPAction 錯)⇒ 與業務失敗**不是同一件事**,
  //    而它們都回 200。⇒ 分開報, 否則「我們包錯了」會被讀成「新竹拒絕了」。
  if (text.includes('<soap:Fault>') || text.includes('<soap:Fault ')) {
    return { ok: false, reason: 'soap_fault' };
  }
  const raw = extractSoapJson(text, method);
  if (raw === null) return { ok: false, reason: 'body_not_soap_json' };
  return { ok: true, raw };
}


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

  // 🔴 `json` 參數是**一段 JSON 字串**(不是物件)⇒ 要 `JSON.stringify`。
  //    而外層是**純陣列** —— 那是 2026-09-05 三發打出來的(見上面那段)。
  const out = await soapCall(deps, 'TransData_Json', JSON.stringify([fields]));
  // 🔴 任何一種「沒拿到看得懂的回應」都是 `unknown`, 不是 `failed` —— 它可能收了。
  if (!out.ok) return { kind: 'unknown', reason: out.reason };
  const raw = out.raw;

  // 🔴🔴 codex must-fix ④:**先驗「這包回應是在講【我們這一箱】」, 再讀它的成敗。**
  //    舊版直接 `firstRow(raw)` 取第一列 ⇒ 一個**多列**或**講別張單**的回應,
  //    可以把我們這一箱標成 `submitted` ⇒ 📌 **那是把別人的成功記在我們頭上, 而它不可回收。**
  if (Array.isArray(raw) && raw.length !== 1) {
    return { kind: 'unknown', reason: `row_count_${raw.length}` };
  }
  const row = firstRow(raw);
  // 規格第 11 頁回傳值表:`success`(新增 Y / 修改 R / 失敗 N)· `edelno` 新竹貨號 · `ErrMsg`。
  const success = pick(row, 'success');
  const edelno = pick(row, 'edelno');
  // 🔴 回傳的 `epino` 要等於我們送的那一張 —— 它有回才比;沒回就不比(規格沒保證一定回)。
  const echoed = pick(row, 'epino');
  if (echoed !== '' && echoed !== fields.epino) {
    return { kind: 'unknown', reason: 'epino_mismatch' };
  }
  // 🔴 codex must-fix ④b:**`R` 是【修改成功】不是【新增成功】** ——
  //    規格第 8 頁逐字「當日重複上傳, 視同【更正】資料內容」
  //    ⇒ 收到 `R` 代表**新竹那邊本來就有一張**, 而我們以為自己是第一次送
  //    ⇒ 📌 **那是一個「我們的狀態與新竹不同步」的訊號, 不是一個成功。**
  //    ⇒ 它仍然要記下貨號(那張單是真的), 而**要有人看一眼** ⇒ 交給呼叫端分開處理。
  if (success === 'R' && edelno !== '') {
    return { kind: 'amended', edelno, raw };
  }
  if (success === 'Y' && edelno !== '') {
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

  // 🔴🔴 **這一支的 `json` 參數要放什麼, 我【沒有量過】。**
  //    2026-09-05 那四發打的全是 `TransData_Json`, **一發都沒有打 `QueryEDELNO_Json`**
  //    ⇒ 📌 **信封那一半是量到的(同一個 `.asmx`、同一組參數名), 而 payload 那一半是【推的】。**
  //    ⇒ 這裡沿用送單那邊被證實的慣例(純陣列 + 欄位物件), 而**它可能是錯的**。
  //    ⚠️ 錯的症狀:回 `success=N` + 一句我們沒見過的 `ErrMsg` ⇒ 會被讀成 `not_found`
  //      ⇒ 🔴 **那是【最毒的一種錯】** —— 「查無此單」正是我們用來判定「沒送出去」的依據,
  //        而一個包錯的請求也印同一個答案。
  //    ⇒ ⇒ 🛑 **所以在打過一發之前, 不要拿這支的 `not_found` 當作「新竹沒收到」的證據。**
  //      板列 ⟦ship-HCTAPI⟧ 記著這一格未量。
  const out = await soapCall(deps, 'QueryEDELNO_Json', JSON.stringify([{ epino }]));
  if (!out.ok) return { kind: 'unknown', reason: out.reason };
  const raw = out.raw;
  const row = firstRow(raw);
  const edelno = pick(row, 'edelno');
  if (pick(row, 'success') === 'Y' && edelno !== '') return { kind: 'found', edelno, raw };
  // 🔴🔴 codex must-fix ⑤:**只有【認得出來的查無】才叫 `not_found`, 其餘一律 `unknown`。**
  //    ⛔ ~~舊版把「不是明確找到」一律當 not_found~~ —— 而那一句在這條路上特別毒:
  //    📌 **「查無此單」正是我們用來判定「新竹沒收到」的依據**
  //      ⇒ 而一個【帳密錯】、【我們包錯】、【空回應】也會走到同一個分支
  //      ⇒ ⇒ 🛑 **一個我們自己的錯, 會被讀成一張可以放回去重送的單 ⇒ 客人收到兩箱。**
  //    ⚠️ 而這支的 payload 形狀**一發都沒打過** ⇒ 包錯的機率不是理論值。
  const err = pick(row, 'ErrMsg');
  if (err.includes('查無')) return { kind: 'not_found', raw };
  return { kind: 'unknown', reason: `unrecognised_query_${err || 'empty'}` };
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
