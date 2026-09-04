import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';
import { isUuid } from './note-action-state';
import type { ManualOrderValues } from './manual-order-form';

// manual-order-repository.ts — M12-A1:`admin_create_manual_order`(#858)的**唯一呼叫端**。
//
// 體例逐字沿用同目錄 `cancel-repository.ts`(同一支 owner-RPC 形狀):
//   · **永不 throw**,所有失敗收斂成 `ok: false` 的碼
//   · 逐欄具名送、不 spread
//   · 只把 `message` 前 200 字遞出去,**不碰 `details` / `hint`**(PG 的 DETAIL 會把整列內容
//     帶進 Vercel log,而手動單那一列含客人姓名 / 電話 / 地址)
//   · 稽核由 RPC 同交易寫(`G9`),本層不碰 `admin_audit_log`
//
// 🔴 **本層不接受外部傳入的 actor 以外的任何身分欄** —— actor 由呼叫端(server action)
//    自 `authorizeAdminMutation().actorId` 取得後傳入。本層不去猜、也不從表單值裡撈。
//
// 🔴 **`p_actor` 不進內容指紋**(RPC COMMENT 逐字):誰按送出不改變那張單
//    ⇒ 同事拿同一顆 `manualRequestId` 重送同一包內容,應得 `idempotent: true`。

/**
 * 送出這次建單需要的全部東西。
 * `values` 直接吃 `parseManualOrderForm()` 的產物 —— 本層**不再驗一次形狀**,
 * 那是表單層的工作(`manual-order-form.ts`),而 RPC 的十道守門是最終防線。
 */
export interface CreateManualOrderArgs {
  values: ManualOrderValues;
  /** 🔴 必來自 `authorizeAdminMutation().actorId`,**不得來自表單**。 */
  actor: string;
}

/**
 * 失敗碼。**三個是 `#858` 的合約碼,而它們的下一步互不相同**(RPC COMMENT 逐字):
 *
 * | 碼 | 機器該做 | 為什麼不能混 |
 * |---|---|---|
 * | `concurrent` | **保留同一顆 `manualRequestId` 原樣重送** | 那一刻很可能已建好一張單;換新 id 會建出**第二張真訂單** |
 * | `mismatch`   | **不要重送** | 這顆鍵已經建過一張單,而內容不一樣 |
 * | `exhausted`  | **不要重送** + 告警 | 系統產不出單號,重按不會好 |
 */
export type ManualOrderSentCode =
  | 'concurrent'
  | 'mismatch'
  | 'exhausted'
  | 'rejected'
  | 'bug'
  | 'error';

export type CreateManualOrderOutcome =
  | {
      ok: true;
      orderId: string;
      displayId: string;
      /** true = 這次沒有新寫入,RPC 認出同鍵同內容而吸收掉了(**不是**建了第二張)。 */
      idempotent: boolean;
    }
  | {
      ok: false;
      code: ManualOrderSentCode;
      /** PostgREST 回的 SQLSTATE;拋出型失敗與形狀漂移沒有這個值。 */
      sqlstate: string | null;
      /**
       * RPC `RAISE … USING CONSTRAINT = …` 帶的 token。
       *
       * 🔴 **未確認:PostgREST 到底有沒有把 `constraint` 放進錯誤物件,我沒有真的打過一發。**
       *    缺的那一道檢查 = 對正式庫(或拋棄式 PG + PostgREST)真的觸發一次 `P858A`,
       *    看回來的 JSON 有沒有這個欄位。
       * ⇒ **所以分類【不依賴它】**(看 `SQLSTATE_CLASSIFICATION`);它只是遞出去給人看的。
       *    它是 `null` 不代表 RPC 沒帶,可能只是這一層拿不到。
       */
      constraint: string | null;
      /** 已截到 200 字、確定不含 `details`/`hint` 的字串,呼叫端直接記 log。 */
      logMessage: string;
    };

/**
 * SQLSTATE → 失敗碼。
 *
 * 🔴 **用 `Map` 不用物件字面**(同 `cancel-repository.ts`):`obj[code]` 在 code 剛好是
 * `constructor` / `toString` 時會取到原型鏈上的函式,那是 truthy ⇒ `?? 'error'` 接不住。
 *
 * 🔴 `P0001` **不在這張表裡** —— 它同時是「員工輸入被逐格拒絕」與「產號用盡」兩件事,
 *    要看訊息才分得出來(見 `classifyP0001`)。放進表裡會把後者靜靜歸成前者。
 */
const SQLSTATE_CLASSIFICATION = new Map<string, ManualOrderSentCode>([
  ['P858A', 'concurrent'], // pcm_858_manual_order_concurrent_request
  ['P858B', 'mismatch'], // pcm_858_manual_order_payload_mismatch
  ['55P03', 'error'], // lock_timeout
  ['40P01', 'error'], // 死結
  ['23514', 'bug'], // 表上的 CHECK(白名單鍵 / 金額)
  ['23505', 'bug'], // UNIQUE:建表檔明訂「任何 23505 = 真異常 fail-loud」
  ['22003', 'bug'], // 數值溢位
  ['42501', 'bug'], // ACL 被撤
  ['PGRST202', 'bug'], // 簽章漂移 / 找不到函式(PostgREST schema cache)
]);

/**
 * 🔴 產號用盡的把手**只是訊息裡的一個字串**,不是機器讀得懂的碼。
 *
 * 座標:`supabase/migrations/20260824020000_m4b_858_admin_create_manual_order.sql:565`
 * 逐字 `' (pcm_display_id_exhausted)' USING ERRCODE = 'P0001'`
 * ⇒ 它的 SQLSTATE 是**通用的 `P0001`**,`CONSTRAINT` 是空的
 *   (同一支函式的 `P858A` / `P858B` 兩個都有專用 SQLSTATE + token,**而這個守的事更嚴重**)。
 *
 * ✅ 裁定(主視窗 2026-08-24,M12-A plan §1-b F-a):**不補 `P858C`,本片用字串比對**。
 * 🔴 **失效條件**:那支 RPC 若因別的原因需要再開一輪審查 ⇒ 補 `P858C` 當場變成對的、順手補。
 * ⚠️ **本常數必須有一格測試釘住** —— RPC 那句訊息一被改,這裡就**靜靜地**改走 `rejected`,
 *    而 `rejected` 的畫面會叫員工「看訊息自己改」,他改不動(那不是他的輸入的問題)。
 */
export const DISPLAY_ID_EXHAUSTED_TOKEN = 'pcm_display_id_exhausted';

/** `P0001` 兩義:訊息含產號用盡的 token ⇒ `exhausted`,其餘 ⇒ `rejected`(員工看得懂的逐格拒絕)。 */
function classifyP0001(message: string): ManualOrderSentCode {
  return message.includes(DISPLAY_ID_EXHAUSTED_TOKEN) ? 'exhausted' : 'rejected';
}

/** 成功 payload 的鍵集合,排序後逐字比對用(RPC `:491` 與 `:629` 兩處 RETURN 皆為這三鍵)。 */
const SUCCESS_PAYLOAD_KEYS = 'display_id,idempotent,order_id';

/**
 * 成功 payload 形狀全集。不符 → null,呼叫端翻成 `bug`。
 *
 * 🔴 「鍵集合**恰等**」不是「包含」:RPC 日後加鍵要**轉紅讓人來看**,不是靜默忽略。
 *    而這一支是 `bug` 裡唯一**真的可能已經寫進去**的 —— 它發生在 RPC 成功 RETURN 之後。
 */
function parseSuccessPayload(
  data: unknown,
): { orderId: string; displayId: string; idempotent: boolean } | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  if (Object.keys(data).sort().join(',') !== SUCCESS_PAYLOAD_KEYS) return null;
  const row = data as Record<string, unknown>;
  if (typeof row.order_id !== 'string' || !isUuid(row.order_id)) return null;
  if (typeof row.display_id !== 'string' || row.display_id === '') return null;
  if (typeof row.idempotent !== 'boolean') return null;
  return { orderId: row.order_id, displayId: row.display_id, idempotent: row.idempotent };
}

/** 把未知形狀描述成「鍵名 + 型別」,**不含任何值**(值可能就是客人的姓名地址)。 */
function describeShape(data: unknown): string {
  if (typeof data !== 'object' || data === null) return `<${data === null ? 'null' : typeof data}>`;
  if (Array.isArray(data)) return `<array len=${data.length}>`;
  const entries = Object.entries(data)
    .map(([key, value]) => `${key}:${value === null ? 'null' : typeof value}`)
    .sort();
  return `{${entries.join(',')}}`.slice(0, 200);
}

/** 只取 `message` 前 200 字。🔴 不碰 `details`/`hint`。 */
function summarize(value: unknown): string {
  return String((value as { message?: unknown } | null)?.message ?? '').slice(0, 200);
}

function readConstraint(value: unknown): string | null {
  const raw = (value as { constraint?: unknown } | null)?.constraint;
  return typeof raw === 'string' && raw !== '' ? raw : null;
}

/**
 * 建一張手動單。**永不 throw**。
 *
 * 🔴 **拋出型失敗一律歸 `error`**:supabase-js 對 PostgREST 的錯誤是**回傳**的,會拋的是
 * 傳輸層 / 環境層失敗(網路斷、fetch abort、建 client 時 env 缺)—— 那正是
 * 「請求可能已經到 PG 並 commit,只是回應斷在路上」。
 * ⇒ 拋出物件**即使帶 `code` 也不查表**:查了會把「回應遺失」講成「你的輸入有問題」。
 * ⇒ 而這條路上的正確下一步與 `concurrent` 相同 —— **保留同一顆 id 重送**,由 RPC 的
 *   冪等格去分辨那一發到底寫進去了沒有。**這正是那顆 id 存在的理由。**
 */
/**
 * 🔴🔴 **「乙」:規格由 server 依 `variant_id` 取【權威值】,不信畫面送上來的。**
 *
 * ## 為什麼一定要有這一步(不是 nice-to-have)
 * RPC 把送進去的 `spec` **直接寫成不可變的** `product_snapshot.spec`
 * (`20260824020000` 的 `jsonb_build_object('title',…,'sku',…,'spec', v_spec)`)。
 * 而 A3-c 的品項列**沒有規格輸入欄** ⇒ 一律送空 ⇒
 * **有顏色/尺寸的既有 variant,手動建單之後那份快照永遠是 `{}` 且補不回來。**
 * 快照存在的理由正是「variant 之後會變」⇒ 空掉之後**沒有任何地方查得回來**。
 *
 * ## 形狀照【正常下單那條路】,不是我發明的
 * `create_order`(`20260604130000`)逐字:
 * `'product_snapshot', jsonb_build_object('title', v_variant.title, 'sku', v_variant.sku, 'spec', v_variant.spec)`
 * ⇒ **顧客站那條路,`spec` 從來不由 client 提供,是 RPC 自己從 variant 讀的。**
 * ⇒ 本函式做的是同一件事,只是**做在 server 的 TS 這一層**而不是 RPC 裡。
 * ⚠️ **兩者不等價的那一格要講明**:RPC 內讀 = client 沒有機會提供;本層讀 = client 仍然送了一份,
 *    只是**被我們覆蓋掉**。對「畫面沒有輸入欄」與「構造的 POST」兩種來源,覆蓋都成立;
 *    而**真正對齊 `create_order` 的做法是把它搬進 RPC**(那要一支 migration + 一次 apply)。
 *    ⇒ 本層是**今天做得到而且擋得住的那一版**,不是終局。已交回主視窗記為後續。
 *
 * ## 三條刻意的取捨
 * 1. **代購品項(`variant_id` 為 null)保持 `{}`** —— 它不在型錄裡,沒有權威值可取。
 *    這**不是**缺口:員工手打的品項本來就沒有 catalog 規格。
 * 2. **查不到那個 variant ⇒ 不動那一列**(維持 `{}`),讓 RPC 的 FK 去拒。
 *    ⚠️ 那條路今天的訊息很差(歸 `error`、叫他原樣重送)—— 那是 F5,另一片。
 *    這裡**刻意不自己判「商品不存在」**:兩層各判一次會漂移。
 * 3. **值原樣送、不做型別轉換** —— `create_order` 也是原樣送。
 *    ⚠️ 若某個 variant 的 spec 帶了非字串值,RPC 的 `m3_jsonb_values_all_string` 會拒**整張單**。
 *    那與顧客站那條路**同一個曝險面**(它靠的是同一個「spec 值全為字串」的不變式)。
 *    ⇒ 這裡不偷偷 coerce:coerce 會讓快照與型錄**不一致**,而那正是快照要避免的事。
 *
 * ## 🔴 一個真的連帶,寫在這裡免得下一個人踩
 * RPC 的冪等指紋**含 `spec`**(`20260824020000` 把 `v_spec::text` 併進指紋)。
 * ⇒ 兩次送同一顆 `manualRequestId` 之間,若**有人編輯了那個商品的規格**,
 *   第二發的指紋會不同 ⇒ 回 `P858B`「內容不一樣」⇒ **一次合法的重送被判成撞鍵**。
 * ⛔ ~~罕見~~ —— 🔴 **那個「罕見」是我加上去的,我沒有量過它**(codex R1 must-fix)。
 *   codex 指出視窗比我寫的寬:
 *   · 不只「兩次送出之間」—— **第一次 select 之後、RPC 之前**若同步程序改了 spec,
 *     第一單就凍結了舊值;此時回應遺失、員工**立即**合法重送 ⇒ 第二發讀到新值 ⇒ `P858B`。
 *   · **多品項單:任一 variant 變動都會觸發** ⇒ 機率隨品項數放大。
 *   ⇒ 正確的寫法是「**視窗多寬未量,而它隨品項數放大**」,不是「罕見」。
 *   📌 頻率副詞是一個沒有來源的數字。
 *
 * ## 🔴🔴 這一層**結構上**擋不住的兩件(codex R1;兩件都指向同一個結論)
 * 1. **兩發分開的往返,沒有一致性時點。** select 與 RPC 之間 variant 被 UPDATE ⇒ 凍結過期值;
 *    被 DELETE ⇒ RPC 在 FK 那步整單回滾;先讀到合法值、隨後 DB 被改成非法值 ⇒ 仍用舊值成功建單。
 *    **本層只保證「select 當下」,不保證「建單當下」。**
 * 2. **RPC 自己仍然信任 `p_lines.spec`** —— 它只驗形狀。任何持 service role 的
 *    script / 另一個 server 呼叫端 / 事故重送工具都繞得過這支 TS。
 *    「唯一呼叫端」是一句**註解**,不是 DB 約束。
 * ⇒ **兩件都只有把它搬進 RPC 才解得掉**(那要一支 migration + 一次 apply)。已交回主視窗立條目。
 */
export async function resolveAuthoritativeSpecs(
  lines: ManualOrderValues['lines'],
): Promise<{ ok: true; lines: ManualOrderValues['lines'] } | { ok: false; logMessage: string }> {
  const ids = [...new Set(lines.map((l) => l.variant_id).filter((v): v is string => v !== null))];
  if (ids.length === 0) return { ok: true, lines };

  let data: unknown;
  let error: unknown;
  // 🔴 **這一段【必須】包在 try 裡**(codex R1 must-fix):本檔的合約是「永不 throw」,
  //    而會拋的是傳輸層 / 環境層(網路斷、fetch abort、`createSupabaseServiceClient()` 缺 env)。
  //    ⚠️ 我第一版把它放在 try 外面 ⇒ **那一發直接擊破本檔最上面那句合約**,
  //       現場員工看到的是 server error 而不是一句話。
  try {
    ({ data, error } = await createSupabaseServiceClient()
      .from('product_variants')
      .select('id, spec')
      .in('id', ids));
  } catch (thrown) {
    return { ok: false, logMessage: `resolveAuthoritativeSpecs 拋出: ${summarize(thrown)}` };
  }

  // 🔴 **查詢失敗 ⇒ 整發放棄, 不得「就用空的先建起來」** ——
  //    那會把一次基礎設施失敗變成一張永久缺規格的真訂單。
  if (error) return { ok: false, logMessage: `resolveAuthoritativeSpecs 失敗: ${summarize(error)}` };

  // 🔴🔴 **鍵一律小寫**(codex R1 must-fix):`manual-order-form.ts` 的 `UUID_RE` 帶 `/i`
  //    ⇒ **表單接受大寫 uuid**,而 PostgREST 回來的 `id` 一律小寫。
  //    我第一版用原字面當 Map 鍵 ⇒ 大寫 variant_id **查得到資料卻 miss**
  //    ⇒ `?? l.spec` 讓 client 送的假規格原樣進 RPC,而 RPC 對大寫 uuid cast 成功
  //    ⇒ **一份假規格被永久寫進不可變快照**,每一格都合法。
  const norm = (v: string) => v.toLowerCase();
  const bySpec = new Map<string, Record<string, string>>();
  for (const row of (data ?? []) as Array<{ id: string; spec: unknown }>) {
    if (typeof row.spec === 'object' && row.spec !== null && !Array.isArray(row.spec)) {
      bySpec.set(norm(row.id), row.spec as Record<string, string>);
    }
  }

  return {
    ok: true,
    // 🔴 逐列重建、**不原地改** `lines` —— 呼叫端(server action)手上那份是解析器的產物,
    //    就地改會讓「送出去的」與「解析器驗過的」變成同一個物件的兩個時點, 而 log 上分不出來。
    // ⚠️ **誠實邊界**(codex R1 nit):`variant_id` 為 null 的那些列**沿用原物件**(淺層共享),
    //    而全部都是 null 時**直接回原陣列**。今天沒有原地修改 ⇒ 沒壞;
    //    但日後若有人在送 RPC 前正規化代購列的 `spec`,**會反向改到呼叫端手上那份**。
    lines: lines.map((l) => (l.variant_id === null ? l : { ...l, spec: bySpec.get(norm(l.variant_id)) ?? l.spec })),
  };
}

export async function createManualOrder(
  args: CreateManualOrderArgs,
): Promise<CreateManualOrderOutcome> {
  const { values, actor } = args;

  // 🔴 規格權威化(見 `resolveAuthoritativeSpecs`)。**在 RPC 之前**, 而且失敗就整發放棄。
  const resolved = await resolveAuthoritativeSpecs(values.lines);
  if (!resolved.ok) {
    return { ok: false, code: 'error', sqlstate: null, constraint: null, logMessage: resolved.logMessage };
  }

  let data: unknown;
  let error: unknown;
  try {
    ({ data, error } = await createSupabaseServiceClient().rpc('admin_create_manual_order', {
      p_customer_user_id: values.customerUserId,
      p_manual_request_id: values.manualRequestId,
      p_actor: actor,
      p_order_source: values.orderSource,
      p_payment_channel: values.paymentChannel,
      p_shipping_method: values.shippingMethod,
      p_ship_to: values.shipTo,
      // 🔴🔴 **`requested` 搭 `p_invoice` 的順風車, 【不另開參數】**
      //   (2026-09-04 `⟦b4-INVOICE5PCT⟧` 第 2 步)
      //   🛑 理由**不是**它跟抬頭是同一件事(它不是 —— 抬頭講「開的話寫誰」, 它講「開不開」),
      //      而是**不動簽名就不會有 overload 的問題**:jsonb 多一個 key, 函式簽名一個字沒變。
      //   ⛔ ~~原本這裡寫「多一個參數 = 必然 `PGRST203`」~~ —— **那句話是錯的**(codex R1 查
      //      PostgREST 官方文件打掉):PostgREST **支援**參數數量不同的 overload,
      //      `PGRST203` 講的是**同名參數型別歧義**那一種。⇒ 保留舊字面加刪除線, 讓搜它的人撞到訂正。
      //   🔴 **而這個 key 必須與 migration `20260904251500` 成對** —— 沒貼那支的時候,
      //      函式用 `jsonb_build_object` 只挑五個鍵重建 ⇒ 這個 key 被丟掉 ⇒ 🔴 **沒勾的單會
      //      靠 DB DEFAULT 落成 `true`(= 要開發票)** ⇒ 那不是良性降級, 是**與他勾的相反**。
      //      ⇒ 📌 判別法只有一個:**去 DB 看那一張單的 `invoice_requested`**。
      p_invoice: { ...values.invoice, requested: values.invoiceRequested },
      p_shipping_fee: values.shippingFee,
      p_lines: resolved.lines,
    }));
  } catch (thrown) {
    return {
      ok: false,
      code: 'error',
      sqlstate: null,
      constraint: null,
      logMessage: summarize(thrown),
    };
  }

  if (error) {
    const raw = (error as { code?: unknown }).code;
    const sqlstate = typeof raw === 'string' ? raw : null;
    const logMessage = summarize(error);
    // 🔴 查無 = `error`(**不是** `rejected`):走到這裡代表我們不知道它是什麼,
    //    而 `error` 的畫面最保守 —— 叫員工去確認那張單建出來了沒有再決定。
    //    已知該 fail-loud 的碼要進上面那張表,不准靠這個 fallback 兜。
    const code: ManualOrderSentCode =
      sqlstate === 'P0001'
        ? classifyP0001(logMessage)
        : (sqlstate !== null && SQLSTATE_CLASSIFICATION.get(sqlstate)) || 'error';
    return { ok: false, code, sqlstate, constraint: readConstraint(error), logMessage };
  }

  const payload = parseSuccessPayload(data);
  if (payload === null) {
    return {
      ok: false,
      code: 'bug',
      sqlstate: null,
      constraint: null,
      // 🔴 只記鍵名與型別、不記值:走到這裡的前提就是「形狀未知」,
      //    而「未知的東西不含客人資料」是一句自打嘴巴的斷言。
      logMessage: `admin_create_manual_order 回傳形狀漂移:${describeShape(data)}`,
    };
  }

  return { ok: true, ...payload };
}
