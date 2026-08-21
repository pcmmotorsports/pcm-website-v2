// order-search-dimensions.ts — 訂單關鍵字搜尋「可以搜什麼」的權威清單(UI 側)。
//
// 🔴 **權威在 DB,不在這裡**:真正決定搜得到什麼的是
//    `supabase/migrations/20260812130000_m4b_347_fuzzy_admin_search_orders.sql`
//    裡 `admin_search_orders` 的 UNION 分支。本陣列只是把它們翻成員工看得懂的字。
//
// 🔴 **這個檔存在的理由**:2026-08-21 實查,能力有 12 維、畫面的 placeholder 只說了 4 個
//    ⇒ 員工手上拿著供應商單號 / 品牌 / 舊單號,不會去試 —— 而它們都搜得到。
//    **能力有、文案沒有**:它不會讓任何測試變紅,只會讓功能沒有人用。
//
// 🔴🔴 **反方向一樣危險(MF-2)**:寫上去卻搜不到的詞,會讓員工搜一次得到零筆、
//    然後學到「這框不準」。**多報比少報更快摧毀信任。**
//
// 🔴🔴 **`sql` 欄不是註解,是【資料】——而它是 R2-2/R2-3 的修法本體。**
//    第一版把欄位路徑寫在**行尾註解**裡。審查線(`-04`)證明那份清單再正確也沒有用:
//    ```
//    N3 把 #11 的比對欄位換成別欄  ⇒ 分支數仍 12  🟢 該紅沒紅
//    N4 把 #3 從電話改成別的欄位   ⇒ 分支數仍 12  🟢 該紅沒紅
//    ```
//    「數幾條分支」看得到**有幾條**,看不到**每條在搜什麼** ⇒ 分支被改去搜別的東西、
//    而畫面標籤沒跟著改 ⇒ 員工照標籤打字、零筆。**與 MF-2 同族,只是發生在既有分支上。**
//    ⇒ 把路徑升成資料之後,測試才讀得到它。
//    📌 而這正是那條「**東西存在 ≠ 東西會被取用**」:我寫了一份正確的清單,然後沒有人讀它。
export const ORDER_SEARCH_DIMENSIONS = [
  { label: '訂單編號', sql: 'o.display_id' }, //          #1
  { label: '舊單號', sql: 'legacy_display_id' }, //            #12(改過號的單、客人拿舊單號來問)
  { label: '會員姓名', sql: 'c.name' }, //                     #2
  { label: '會員電話', sql: 'c.phone' }, //                    #3
  { label: '收件人', sql: "'name'" }, //                       #4  shipping_address_snapshot ->> 'name'
  { label: '收件電話', sql: "'phone'" }, //                    #5
  { label: '收件地址', sql: "'line'" }, //                     #6
  { label: '料號', sql: 'variant_sku' }, //                    #7
  { label: '品名', sql: "'title'" }, //                        #8  product_snapshot ->> 'title'
  { label: '規格', sql: 'pcm_spec_text' }, //                  #9
  { label: '品牌', sql: 'br.name' }, //                        #10 唯一走活的商品表的分支
  // 🔴 #11 只比對 `order_item_procurement.supplier_order_no` —— **供應商【名字】搜不到**
  //    (片 B-2 才重建,migration `:365-367` 逐字)⇒ **這個詞不可以簡寫成「供應商」。**
  { label: '供應商單號', sql: 'supplier_order_no' }, //         #11
] as const;

/** 給畫面用的字串陣列(元件只需要 label)。 */
export const ORDER_SEARCH_LABELS = ORDER_SEARCH_DIMENSIONS.map((d) => d.label);

/**
 * 🔴 **畫面必須標明的限定** —— 不是貼心話,是權威 COMMENT 逐字要求的:
 * `20260812130000_*.sql:501`:「品牌語意 = 搜**現在的**品牌(Sean Q2=A),**畫面須標明**。」
 *
 * 品牌分支是 12 條裡**唯一**走活的商品表(variant → product → brand)。
 * 商品換過品牌之後,拿**舊**品牌搜歷史訂單會找不到 —— 畫面不說的話,
 * 員工得到的是「查無此單」,不是「你搜的是現在的品牌」。
 */
export const ORDER_SEARCH_CAVEAT = '品牌搜的是商品「現在的」品牌,換過品牌的舊訂單要用別的欄位找。';

/** 權威檔路徑;測試與註解共用同一個字面,免得兩邊各寫一份然後其中一份過期。 */
export const ORDER_SEARCH_RPC_MIGRATION =
  'supabase/migrations/20260812130000_m4b_347_fuzzy_admin_search_orders.sql';
