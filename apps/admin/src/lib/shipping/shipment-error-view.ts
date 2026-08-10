// shipment-error-view.ts — #351 ①:出貨線 DB 拒因 → **員工看得懂的一句話**。
//
// 🔴 **來源是 Sean 08-09 正式站實測**:他真的按了建箱,DB 的拒因全文(P2B27 掛品項超量)
//    整段吐進彈窗,他逐字說「這個文字太難懂,精簡一點」。
//
// ══════════════════════════════════════════════════════════════════════════════
// 🔴🔴 **為什麼這張表只有一個碼 —— 這是本檔最重要的一段,改它之前先讀完**
//
// 我第一版寫了 11 個碼的文案,code-reviewer(2026-08-10)逐碼去讀它們的**實際觸發條件**,
// 抓出 8 條 must-fix。**每一條都成立**,而病根只有一個:
// **我沒有逐碼讀 migration 就照著碼名想像文案** —— 而這張表是要給員工照著操作的。
//
// 具體錯到什麼程度(留著當教訓,不是自我檢討):
// · **P2B26 是共用碼**:實查 **24 個** 不同 constraint 用它(包裹已作廢 / 沒有品項 / 未作廢 /
//   品項不是這位客人的 / 缺追蹤號…)。我寫成「選到的物流方式系統不認得」⇒ 對 20+ 個成因是錯的。
// · **P2B22 我叫員工「關掉視窗重開」= DB 逐字禁止的動作**:冪等鍵開窗時產一次,關窗重開 = 換新鍵,
//   而換新鍵重送**真的會多出一箱貨**。同一支彈窗裡我自己另一段話正好寫著這件事 —— 兩句話互相打架。
// · **P2B29 的 message 本身就已經是人話**(DB 的 `pcm_b2_shipping_human_error` 產的,含編號步驟
//   「①先作廢這個包裹 ②去採購頁改到貨數量 ③再重開一張」)。我用一句廢話蓋掉它,
//   再叫員工去看標著「給工程師看」的摺疊 —— 把唯一寫對的指示藏起來。
// · **P2B20 / P2B21 的文案是憑空編的**(前者執行期已不可達、後者產號器根本沒有「今天的額度」)。
//
// ⇒ **設計改了**:白話層只覆蓋**我能證明「一碼一義且文案正確」**的碼,其餘一律**原文照吐**
//   (= 維持現況,不比今天差)。少講一句話,比講錯話讓員工做錯動作好。
//
// 🔴 **要擴充這張表的人**:SQLSTATE **不是正確的粒度** —— P2B26 那 24 個 constraint 就是證據。
//   正確的 key 是 **constraint 名**(DB 已經在 `USING … CONSTRAINT = …` 給了)。
//   ⚠️ **前提未驗**:PostgREST 的錯誤 JSON 到底帶不帶 constraint 名,我**沒有實測**
//   (本機是 vanilla PG、沒有 PostgREST)。⇒ 擴充前**先驗這件事**,別假設拿得到。
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 白話層覆蓋的碼。**目前只有一個,而且是刻意的**(理由見檔頭)。
 *
 * `P2B27` 的兩個 constraint(`pcm_b2_w3b2_exceeds_instock` / `pcm_b2_w3c2_unvoid_exceeds_instock`)
 * **語意相同**(都是「超過可出貨數量」)⇒ 一句文案蓋得住,不會像 P2B26 那樣一碼多義。
 */
export const SHIPMENT_BLOCK_CODES = ['P2B27'] as const;

export type ShipmentBlockCode = (typeof SHIPMENT_BLOCK_CODES)[number];

/** 一句人話 + 一句「該怎麼辦」。兩句都寫給**倉庫員工**看,不是寫給工程師看。 */
export type ShipmentBlockCopy = {
  /** 發生了什麼(一句,不含代碼、不含表名)。 */
  readonly what: string;
  /** 現在該做什麼。 */
  readonly next: string;
};

/**
 * 🔴 `Record<ShipmentBlockCode, …>`:少一條就 typecheck 紅。
 *
 * 文案原則:①不出現代碼/表名/欄名 ②說得出下一步 ③**不承諾我們做不到的事**
 * (P2B27 不寫「請按補記到貨鈕」——那顆鈕是 #352,還沒做)。
 */
export const SHIPMENT_BLOCK_COPY: Record<ShipmentBlockCode, ShipmentBlockCopy> = {
  P2B27: {
    // 🔴 公式字面與 `20260807180000_…w3b2_add_shipment_items.sql:230` 逐字對齊
    //    (`instock − shipped − pending`;pending = 已裝箱未出貨、**含本箱**)。
    what: '有品項裝超過「可出貨數量」了 —— 可出貨 = 已到貨 − 已出貨 − 已裝在其他還沒出貨的箱裡。',
    // 🔴 下一步刻意指向「詳細」:DB 的原文帶**逐品項的實際數字**(可出幾件、你要出幾件),
    //    那正是「該調成多少」的答案。摺疊的標題因此是「詳細」而不是「給工程師看」
    //    (code-reviewer nit:標成給工程師看 = 明示員工不用看,而那裡才有他要的數字)。
    next: '請看下方「詳細」裡每個品項可出幾件,把數量調到那個數以內再送一次。',
  },
};

/** 解析結果:`code` 為 `null` = 白話層不覆蓋這個碼 ⇒ 呼叫端**原文照吐**。 */
export type ParsedShipmentError = {
  readonly code: ShipmentBlockCode | null;
  readonly copy: ShipmentBlockCopy | null;
  /** 原始訊息(**一律保留**;白話層蓋不住時它就是唯一的資訊)。 */
  readonly raw: string;
};

const CODE_SET = new Set<string>(SHIPMENT_BLOCK_CODES);

/**
 * 依 SQLSTATE 取白話文案。
 *
 * 🔴 **只認 `code`,不從訊息文字裡撈碼**:訊息是給人看的、會改,而且用正規式在訊息裡找 `P2B\d\d`
 * 會把「說明裡剛好提到某個碼」誤判成那個碼。
 *
 * 🔴 簽章收成 `string | null` 而不是 `unknown`(code-reviewer nit):`code` 在 server action
 * 就已經被抽成 `string | null` 過邊界了 ⇒ 收 `unknown` 是在防一個沒有人會走的形狀,
 * 而那會讓「只讀 code 欄」停留在註解上的承諾,而不是型別上的事實。
 */
export function parseShipmentError(code: string | null, raw: string): ParsedShipmentError {
  if (code !== null && CODE_SET.has(code)) {
    const c = code as ShipmentBlockCode;
    return { code: c, copy: SHIPMENT_BLOCK_COPY[c], raw };
  }
  return { code: null, copy: null, raw };
}
