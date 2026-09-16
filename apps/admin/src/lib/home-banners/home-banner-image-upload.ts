import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';
import { HB_UPLOAD } from './home-banner-constants';
import { bannerObjectPath, checkBannerUpload, type UploadReject } from './home-banner-image-check';

// home-banner-image-upload.ts — 首頁大圖「選檔上傳」真的碰 Storage 的那一段(桶 = 板 20260916230000)。
//
// 🔴 client 完全不碰 Storage:檔案經 server action 進來、在這裡傳、由 service_role 寫進桶。
//    理由不是偏好 —— anon 在 `storage.objects` 上的 table GRANT 是【開的】(Supabase 預設;
//    ⚠️ 這一格要用看得到 storage schema 的身分才查得到,唯讀帳號回的 0 是【查不到】不是【沒有】),
//    擋住它的是「RLS 開著而且一條 policy 都沒有」。那道防線我們**不加東西**就有;
//    而讓瀏覽器直接傳 = 要為它開一條 policy = 親手把那道防線放寬。
//
// 🔵 驗的邏輯住在 `home-banner-image-check.ts`(純函式、有測試);這裡只負責把它接到桶上。

export type UploadOutcome =
  | { ok: true; publicUrl: string }
  | { ok: false; reject: UploadReject | 'uploadfail' };

/**
 * 傳一張圖進 `home-banners` 桶,回它的公開網址。
 * 🔴 `upsert: false` —— 檔名是新產的 uuid,撞名代表出事了,要出聲而不是默默蓋掉別人的圖。
 */
export async function uploadBannerImage(file: File): Promise<UploadOutcome> {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const check = checkBannerUpload(file.size, head);
  if (!check.ok) return { ok: false, reject: check.reject };

  const path = bannerObjectPath(crypto.randomUUID(), check.ext);
  const storage = createSupabaseServiceClient().storage.from(HB_UPLOAD.bucket);

  const { error } = await storage.upload(path, file, {
    contentType: check.contentType, // 🔴 用嗅探到的,不用 file.type
    upsert: false,
    cacheControl: '31536000',
  });
  if (error) return { ok: false, reject: 'uploadfail' };

  const { data } = storage.getPublicUrl(path);
  // 公開網址必須是 https —— DB 那邊的 CHECK 也會再擋一次,這裡先擋是為了給得出人話
  if (!data.publicUrl.startsWith('https://')) return { ok: false, reject: 'uploadfail' };
  return { ok: true, publicUrl: data.publicUrl };
}
