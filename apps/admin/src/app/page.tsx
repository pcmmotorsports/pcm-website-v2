import { selectActorAction } from '@/lib/session/actor-actions';
import { getSessionActor } from '@/lib/session/actor';
import { STAFF } from '@/lib/staff';

// M0-S1 骨架占位頁 + M0-S2 具名身分選人。骨架驗收 = pnpm dev 跑得起來、殼可見可用;
// 訂單/客戶線於後續 slice 才裝真頁面。
export default async function AdminHomePage() {
  const actor = await getSessionActor();

  return (
    <div className='mx-auto max-w-2xl space-y-4 py-10'>
      <h1 className='text-2xl font-semibold'>PCM 後台</h1>

      <div className='rounded-lg border bg-card p-6 text-card-foreground'>
        <p className='text-sm font-medium'>骨架建置完成(M-4a M0-S1)</p>
        <p className='text-muted-foreground mt-2 text-sm leading-relaxed'>
          這是後台的殼:左側導覽、上方標題列、右上淺色／深色切換皆可操作。
          訂單管理、客戶管理與登入(SSO)會在後續 slice 依 PRD 逐步接上,目前尚未接資料。
        </p>
      </div>

      <div className='rounded-lg border bg-card p-6 text-card-foreground'>
        <p className='text-sm font-medium'>具名身分(M-4a M0-S2)</p>
        <p className='text-muted-foreground mt-2 text-sm leading-relaxed'>
          目前身分:
          <span className='text-foreground font-medium'>
            {actor ? actor.label : '尚未選擇'}
          </span>
          。稽核 log 會把這個身分記成操作者。這是 SSO 上線前的臨時做法,登入完成後改由真實帳號提供。
        </p>
        <form action={selectActorAction} className='mt-4 flex items-center gap-2'>
          <label htmlFor='actorId' className='sr-only'>
            選擇具名身分
          </label>
          <select
            id='actorId'
            name='actorId'
            defaultValue={actor?.id ?? ''}
            className='border-input bg-background h-9 rounded-md border px-3 text-sm'
          >
            <option value='' disabled>
              選擇身分…
            </option>
            {STAFF.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <button
            type='submit'
            className='bg-primary text-primary-foreground h-9 rounded-md px-4 text-sm font-medium'
          >
            切換
          </button>
        </form>
      </div>
    </div>
  );
}
