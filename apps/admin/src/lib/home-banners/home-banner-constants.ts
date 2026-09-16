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
  error: { text: '系統出錯,沒有完成。請重新整理確認之後再試。', tone: 'error' },
} as const satisfies Record<HomeBannerResultCode, SettingsResultMessages[string]>;
