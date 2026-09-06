-- 🔴🔴 這是【replay 失敗的補丁】, 不是 bootstrap;來源 = 正式庫唯讀 catalog 於 2026-09-07 06:13:40 CST
--    產生方式:catalog 拼(pg_attribute / pg_attrdef / pg_constraint)—— **沒有用 pg_dump**。
--    🛑 **不要把本檔的內容搬進 runbook §2 的 bootstrap** —— `pcm_incident` 是
--      `20260905290000` 自己會建的東西, 它不見是因為那支 migration replay 失敗了。
--
-- ⚠️⚠️ **它答不出什麼(比函式那一份更該讀)**:catalog 拼出來的 DDL **只含**
--    欄位 / 預設值 / NOT NULL / 約束。**下面這些【沒有】**:
--      · RLS 是否啟用、policy 一條都沒有
--      · trigger 一支都沒有
--      · GRANT / REVOKE 一句都沒有(⇒ 在拋棄式庫裡它的權限是【出廠預設】, 比正式庫寬)
--      · 索引(主鍵以外)、COMMENT、序列的 OWNED BY
--    ⇒ 📌 **拿它驗「權限 / RLS / trigger」等於量錯世界。它只夠讓【引用這張表的東西】建得起來。**
--
-- 🔵 序列要先建 —— 上面那個 DEFAULT 引用 `pcm_incident_id_seq`。
CREATE SEQUENCE IF NOT EXISTS public.pcm_incident_id_seq;

CREATE TABLE IF NOT EXISTS public.pcm_incident (
  id bigint DEFAULT nextval('pcm_incident_id_seq'::regclass) NOT NULL,
  kind text NOT NULL,
  subject_id uuid,
  detail text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  resolved_at timestamp with time zone,
  CONSTRAINT pcm_incident_kind_check CHECK ((kind = ANY (ARRAY['pending_refund_open_failed'::text, 'refund_over_total'::text]))),
  CONSTRAINT pcm_incident_pkey PRIMARY KEY (id)
);

ALTER SEQUENCE public.pcm_incident_id_seq OWNED BY public.pcm_incident.id;
