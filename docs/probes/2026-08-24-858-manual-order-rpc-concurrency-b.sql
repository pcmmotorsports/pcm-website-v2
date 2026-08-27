-- ci-self-contained: no — 需外部 provision 的庫、psql -f 對 $DSN 手動跑(見檔頭跑法),非 CI 自給自足。
DO $$
DECLARE r jsonb; v_state text; v_con text;
BEGIN
  r := public.admin_create_manual_order(
    '11111111-1111-1111-1111-111111111111'::uuid,
    'cccc0001-0000-0000-0000-000000000001'::uuid,
    'probe_alice',
    'manual_phone','bank_transfer','home',
    '{"name":"王小明","phone":"0912000111","line":"台北市測試路1號"}'::jsonb,
    '{"type":"personal"}'::jsonb, 100,
    '[{"sku":"Z1","title":"併發測試品","qty":1,"unit_price":100,"spec":{}}]'::jsonb);
  RAISE WARNING '🔴 併發竟然成功了 => 守門沒開火';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_con = CONSTRAINT_NAME;
  RAISE WARNING '併發結果 SQLSTATE=% constraint=%', v_state, COALESCE(v_con,'(空)');
END $$;
