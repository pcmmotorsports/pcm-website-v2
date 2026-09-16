import { HOME_BANNER_TEXT_MAX } from '@pcm/domain';
import type { SettingsResultMessages } from '../../components/settings/settings-result-banner';

// home-banner-constants.ts — 後台「首頁大圖」頁的欄位名、字數、結果碼與文案(DB 20260916150000;OD 稿 pcm-524f/admin-home-banners-v1.html)。
// 🔴 碼表住在這裡、不住在 actions:actions 帶 'use server',匯出只能是 async function。

export const HOME_BANNERS_PATH = '/home-banners';

export const HB_FIELD = {
  id: 'banner_id',
  expected: 'expected_updated_at',
  eyebrow: 'eyebrow',
  title1: 'title_line1',
  title2: 'title_line2',
  subtitle: 'subtitle',
  cta: 'cta_label',
  link: 'link_path',
  imgDesktop: 'image_desktop_url',
  imgMobile: 'image_mobile_url',
  kind: 'image_kind',
  rights: 'rights_confirmed',
  rightsNote: 'rights_note',
  starts: 'starts_at',
  ends: 'ends_at',
  view: 'view',
  /** 選檔上傳用的欄位(片 B/C)。有檔就用檔、沒檔就用上面那格貼的網址。 */
  imgDesktopFile: 'image_desktop_file',
} as const;

/**
 * 選檔上傳的規矩 —— 🔴 **與 migration `20260916230000` 同源,改一邊要改兩邊。**
 * 那支板在桶上設 `file_size_limit = 4194304`、`allowed_mime_types = jpeg/png/webp`;
 * 這裡是 server 端**先擋一次**,為的是給得出人話(桶那邊擋只會回一個 400)。
 * ⚠️ 兩邊都擋**不是重複**:只靠桶擋 ⇒ 員工看不懂為什麼失敗;只靠這邊擋 ⇒ 繞過 UI 就沒人擋。
 * 🔬 兩邊不一致才是真的洞 ⇒ `home-banner-image-check.test.ts` 有一格拿這裡的數字對 SQL 檔的字面。
 *
 * ══ 🔴🔴 為什麼是 4 MiB(這一節是這支上傳片最該被讀到的東西)════════════════
 * 這個上限被**改小過兩次**,兩次都是同一種病 ——
 * **我們對齊了自己看得到的每一層,而真正在生效的那一層在外面。**
 *
 *   第 1 層 畫面      「最大 N MB」(由本檔的 maxBytes 算出來)
 *   第 2 層 server    本檔 maxBytes
 *   第 3 層 桶        板 20260916230000 的 file_size_limit
 *   第 4 層 Next      apps/admin/next.config.ts 的 serverActions.bodySizeLimit(預設 1 MB)
 *   第 5 層 平台      Vercel Function 的 request body 上限
 *   ⇒ 🔴 **最小的那一層在最外面,而前四層對齊得再漂亮也不會發現它。**
 *
 * · R1 MF1 撞的是第 4 層:前三層都寫 5MB,而 Next 預設 1 MB ⇒ 1.5MB 的圖 413,碼一行都沒跑。
 * · R2 撞的是第 5 層:第 4 層修好了,而平台那層更小 ⇒ 4.5–5MB 那段圖照樣壞。
 *
 * 🔴 **而我們選 4 MiB【不是因為確定平台是 4.5MB】,是因為 4 MiB 在兩種說法下都成立:**
 *   · 若平台上限是 4.5MB ⇒ 4 MiB + multipart 信封 ≈ 4.3MB < 4.5MB  ✅
 *   · 若平台上限是 100MB ⇒ 4 MiB 當然過                              ✅
 *   ⇒ 📌 **這個數字不押注在那個爭議的結論上。** 下一個人不必先吵贏它才敢動。
 *
 * 🔬 那個爭議的兩份證據(2026-09-16 我自己抓的,留著):
 *   · 「Vercel 現在收 100MB」那篇 changelog 網址
 *     (…/changelog/vercel-functions-now-support-100mb-request-bodies)⇒ **HTTP 404,那篇不存在**
 *   · https://vercel.com/docs/functions/limitations 當天實抓,逐字:
 *     「The maximum payload size for the request body or the response body … **4.5 MB**」
 *     「… it will return an error **413: FUNCTION_PAYLOAD_TOO_LARGE**」
 *     同頁另掛一篇「How do I bypass the 4.5MB body size limit…」
 *   ⇒ ⚠️ 我先前把「100MB」當成事實往下傳過一次,而那句話影響了一次拍板。**沒查過的數字不要傳。**
 *
 * 📌 **下次要再加一層上限時,先問一句:這是不是最外面那一層?**
 */
export const HB_UPLOAD = {
  bucket: 'home-banners',
  maxBytes: 4_194_304, // 4 MiB —— 改這個數字要同時改板 20260916230000 的 file_size_limit
  types: ['image/jpeg', 'image/png', 'image/webp'],
} as const;

/** DB CHECK 的上限(20260916150000)—— 解析器照這個擋,超過就是 invalid。 */
export const HB_DB_MAX = {
  eyebrow: 40,
  title: 60,
  subtitle: 60,
  cta: 20,
  link: 500,
  url: 2000,
  rightsNote: 500,
} as const;

/** OD 稿的建議字數(`10 / 12` 那種計數)—— 只提示、不擋(系統草稿可能超過,員工自己縮)。
 *  數字住在 @pcm/domain `HOME_BANNER_TEXT_MAX`(首頁版面同一份);model = 英文車款小字層那一行。 */
export const HB_SOFT_MAX = {
  title: HOME_BANNER_TEXT_MAX.titleLine,
  model: HOME_BANNER_TEXT_MAX.modelLine,
  subtitle: HOME_BANNER_TEXT_MAX.subtitle,
  cta: HOME_BANNER_TEXT_MAX.cta,
} as const;

export type HomeBannerResultCode =
  | 'created'
  | 'saved'
  | 'published'
  | 'archived'
  | 'nochange'
  | 'denied'
  | 'invalid'
  | 'stale'
  | 'rights'
  | 'incomplete'
  | 'nomatch'
  | 'linkscope'
  | 'window'
  | 'notdraft'
  | 'notfound'
  | 'toobig'
  | 'badtype'
  | 'uploadfail'
  | 'error';

export const HOME_BANNER_RESULT_MESSAGES = {
  created: { text: '已存成草稿。', tone: 'ok' },
  saved: { text: '草稿已儲存。', tone: 'ok' },
  published: { text: '已發布,約 1 分鐘內出現在首頁。', tone: 'ok' },
  archived: { text: '已下架。', tone: 'ok' },
  nochange: { text: '這張本來就已經封存了。', tone: 'ok' },
  // 🔴 Sean 09-16 Q5 乙 + 主視窗「發得出去要收得回來」⇒ 三個動作都是在職員工都能做 ⇒ 到這裡幾乎一定是登入失效
  denied: { text: '沒有權限,或登入已失效,請重新登入再試一次。', tone: 'error' },
  invalid: { text: '有欄位格式不對(連結要是站內路徑、圖片要 https、字數不能超過),沒有存進去。', tone: 'warn' },
  stale: { text: '草稿剛被改過,請看過最新內容再發布。', tone: 'warn' },
  rights: { text: '還沒勾「我確認這家廠商的圖與文字可以用」,不能發布。', tone: 'warn' },
  incomplete: { text: '缺標題第一行、連結或桌機圖,不能發布。', tone: 'warn' },
  // 🔴 這兩句對應 20260916180000 的兩道發布閘。鈕平常就擋著 ⇒ 會走到這裡的是繞過或競態那一發,
  //    那時要說「規則不合」而不是「系統出錯」(不然員工會以為是當機)。
  nomatch: { text: '這張還沒配到商品,配到商品才能發布。廠商信來的大圖一定要對到我們站上的商品。', tone: 'warn' },
  linkscope: { text: '連結不能發布:要指到商品或品牌頁(/products… 或 /brands…);廠商信來的大圖要指到 /products…。', tone: 'warn' },
  window: { text: '上下架時間不對:下架要晚於上架,而且不能已經過了。', tone: 'warn' },
  notdraft: { text: '這張已經不是草稿,請重新整理。', tone: 'warn' },
  notfound: { text: '找不到這張大圖,請重新整理。', tone: 'warn' },
  // 🔴 上傳被擋的三句 —— 要說得出【是哪一件不合】,不要混成一句「上傳失敗」
  toobig: { text: '這張圖太大(超過 5 MB),請縮小之後再傳一次。其他欄位沒有存進去。', tone: 'warn' },
  badtype: { text: '這個檔不是 JPG / PNG / WebP 圖片。⚠️ 我們看的是檔案內容不是副檔名 —— 把別的檔改名成 .jpg 一樣不會過。其他欄位沒有存進去。', tone: 'warn' },
  uploadfail: { text: '圖片上傳失敗,其他欄位沒有存進去。請重新整理再試一次。', tone: 'error' },
  error: { text: '系統出錯,沒有完成。請重新整理確認之後再試。', tone: 'error' },
} as const satisfies Record<HomeBannerResultCode, SettingsResultMessages[string]>;
