ALTER TABLE bookmarks
  ADD COLUMN IF NOT EXISTS app_stack_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS app_file_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS app_base_branch TEXT NOT NULL DEFAULT 'main',
  ADD COLUMN IF NOT EXISTS app_model_summary TEXT,
  ADD COLUMN IF NOT EXISTS app_token_count BIGINT NOT NULL DEFAULT 0;

WITH bookmark_payloads AS (
  SELECT
    b.id AS bookmark_id,
    e.payload
  FROM bookmarks b
  JOIN pr_events e ON e.id = b.latest_event_id
),
payload_entries AS (
  SELECT
    bp.bookmark_id,
    bp.payload,
    CASE
      WHEN jsonb_typeof(bp.payload->'stack') = 'array'
        AND jsonb_array_length(bp.payload->'stack') > 0
        THEN bp.payload->'stack'
      WHEN bp.payload ? 'change'
        THEN jsonb_build_array(jsonb_build_object(
          'change', bp.payload->'change',
          'branch_name', COALESCE(bp.payload->'push'->>'branch_name', bp.payload->'repo'->>'branch_name'),
          'base_branch_name', COALESCE(bp.payload->'repo'->>'default_branch', 'main')
        ))
      ELSE '[]'::jsonb
    END AS entries
  FROM bookmark_payloads bp
),
stack_summary AS (
  SELECT
    pe.bookmark_id,
    jsonb_array_length(pe.entries) AS stack_count,
    COALESCE(pe.entries->0->>'base_branch_name', pe.payload->'repo'->>'default_branch', 'main') AS base_branch
  FROM payload_entries pe
),
file_summary AS (
  SELECT
    pe.bookmark_id,
    COUNT(DISTINCT files.file)::INTEGER AS file_count
  FROM payload_entries pe
  LEFT JOIN LATERAL jsonb_array_elements(pe.entries) AS entries(entry) ON true
  LEFT JOIN LATERAL jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(entries.entry->'change'->'files') = 'array'
        THEN entries.entry->'change'->'files'
      ELSE '[]'::jsonb
    END
  ) AS files(file) ON true
  GROUP BY pe.bookmark_id
),
change_models AS (
  SELECT
    pe.bookmark_id,
    provenance.value->>'model_id' AS model,
    MIN((entry_ord.ordinality * 1000000) + provenance_ord.ordinality) AS first_seen
  FROM payload_entries pe
  CROSS JOIN LATERAL jsonb_array_elements(pe.entries) WITH ORDINALITY AS entry_ord(entry, ordinality)
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(entry_ord.entry->'change'->'review_context'->'agent_provenance') = 'array'
        THEN entry_ord.entry->'change'->'review_context'->'agent_provenance'
      ELSE '[]'::jsonb
    END
  ) WITH ORDINALITY AS provenance(value, ordinality)
  CROSS JOIN LATERAL (SELECT provenance.ordinality) AS provenance_ord(ordinality)
  WHERE NULLIF(BTRIM(provenance.value->>'model_id'), '') IS NOT NULL
  GROUP BY pe.bookmark_id, provenance.value->>'model_id'
),
session_models AS (
  SELECT
    bp.bookmark_id,
    request.value->>'model' AS model,
    MIN((session_ord.ordinality * 1000000) + request_ord.ordinality) AS first_seen
  FROM bookmark_payloads bp
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(bp.payload->'sessions') = 'array'
        THEN bp.payload->'sessions'
      ELSE '[]'::jsonb
    END
  ) WITH ORDINALITY AS session_ord(value, ordinality)
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(session_ord.value->'requests') = 'array'
        THEN session_ord.value->'requests'
      ELSE '[]'::jsonb
    END
  ) WITH ORDINALITY AS request(value, ordinality)
  CROSS JOIN LATERAL (SELECT request.ordinality) AS request_ord(ordinality)
  WHERE NULLIF(BTRIM(request.value->>'model'), '') IS NOT NULL
  GROUP BY bp.bookmark_id, request.value->>'model'
),
preferred_models AS (
  SELECT * FROM change_models
  UNION ALL
  SELECT sm.*
  FROM session_models sm
  WHERE NOT EXISTS (
    SELECT 1
    FROM change_models cm
    WHERE cm.bookmark_id = sm.bookmark_id
  )
),
ranked_models AS (
  SELECT
    pm.bookmark_id,
    pm.model,
    ROW_NUMBER() OVER (PARTITION BY pm.bookmark_id ORDER BY pm.first_seen) AS model_rank,
    COUNT(*) OVER (PARTITION BY pm.bookmark_id) AS model_count
  FROM preferred_models pm
),
model_summary AS (
  SELECT
    rm.bookmark_id,
    CASE
      WHEN MAX(rm.model_count) = 1
        THEN MAX(rm.model) FILTER (WHERE rm.model_rank = 1)
      WHEN MAX(rm.model_count) = 2
        THEN CONCAT(
          MAX(rm.model) FILTER (WHERE rm.model_rank = 1),
          ', ',
          MAX(rm.model) FILTER (WHERE rm.model_rank = 2)
        )
      ELSE CONCAT(
        MAX(rm.model) FILTER (WHERE rm.model_rank = 1),
        ', +',
        MAX(rm.model_count) - 1
      )
    END AS model_summary
  FROM ranked_models rm
  GROUP BY rm.bookmark_id
),
token_summary AS (
  SELECT
    bp.bookmark_id,
    COALESCE(SUM(
      COALESCE((response.value->>'input_tokens')::BIGINT, 0) +
      COALESCE((response.value->>'output_tokens')::BIGINT, 0) +
      COALESCE((response.value->>'cache_read_tokens')::BIGINT, 0) +
      COALESCE((response.value->>'cache_write_tokens')::BIGINT, 0)
    ), 0)::BIGINT AS token_count
  FROM bookmark_payloads bp
  LEFT JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(bp.payload->'sessions') = 'array'
        THEN bp.payload->'sessions'
      ELSE '[]'::jsonb
    END
  ) AS session(value) ON true
  LEFT JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(session.value->'requests') = 'array'
        THEN session.value->'requests'
      ELSE '[]'::jsonb
    END
  ) AS request(value) ON true
  LEFT JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(request.value->'responses') = 'array'
        THEN request.value->'responses'
      ELSE '[]'::jsonb
    END
  ) AS response(value) ON true
  GROUP BY bp.bookmark_id
)
UPDATE bookmarks b
SET
  app_stack_count = COALESCE(ss.stack_count, 0),
  app_file_count = COALESCE(fs.file_count, 0),
  app_base_branch = COALESCE(NULLIF(ss.base_branch, ''), 'main'),
  app_model_summary = ms.model_summary,
  app_token_count = COALESCE(ts.token_count, 0)
FROM stack_summary ss
LEFT JOIN file_summary fs ON fs.bookmark_id = ss.bookmark_id
LEFT JOIN model_summary ms ON ms.bookmark_id = ss.bookmark_id
LEFT JOIN token_summary ts ON ts.bookmark_id = ss.bookmark_id
WHERE b.id = ss.bookmark_id;
