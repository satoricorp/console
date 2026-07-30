-- WP-4 smoke test: ledger joins, raw_line lookup, org-scoped review_usage count.
-- Run after migrations 001-012 + 013-016.
-- Expect: no errors; raises on assertion failure.

BEGIN;

-- Seed bootstrap org (may already exist from 014)
INSERT INTO orgs (plan, created_at_ms)
SELECT 'free', 1700000000000
WHERE NOT EXISTS (SELECT 1 FROM orgs LIMIT 1);

DO $$
DECLARE
  v_org_id       UUID;
  v_bookmark_id  UUID;
  v_event_id     UUID;
  v_comment_id   UUID;
  v_raw_id       UUID;
  v_join_count   INTEGER;
  v_event_text   TEXT;
  v_usage_count  INTEGER;
BEGIN
  SELECT id INTO v_org_id FROM orgs ORDER BY created_at_ms LIMIT 1;

  -- Seed pr_event + bookmark
  INSERT INTO pr_events (
    created_at_ms, tx_version, head_commit_id, payload, org_id, user_id
  ) VALUES (
    1700000000000, '0.1.0', 'abc123', '{}'::jsonb, v_org_id, 'test-user'
  ) RETURNING id INTO v_event_id;

  INSERT INTO bookmarks (
    user_id, repo_full_name, branch_name, published_at_ms, updated_at_ms, org_id, latest_event_id
  ) VALUES (
    'test-user', 'acme/widget', 'feat/test', 1700000000000, 1700000000000, v_org_id, v_event_id
  ) RETURNING id INTO v_bookmark_id;

  -- Seed ledger facts
  INSERT INTO pr_comments (
    org_id, bookmark_id, github_comment_id, author, body, is_gx_mention, created_at_ms
  ) VALUES (
    v_org_id, v_bookmark_id, 42, 'reviewer1', 'Please add tests', true, 1700000001000
  ) RETURNING id INTO v_comment_id;

  INSERT INTO decisions (
    org_id, bookmark_id, reviewer, action, source_comment_id, extracted_reason, created_at_ms
  ) VALUES (
    v_org_id, v_bookmark_id, 'reviewer1', 'request_changes', v_comment_id, 'missing tests', 1700000002000
  );

  INSERT INTO rules (
    org_id, repo_scope, rule_text, strength, status, source_comment_id, created_at_ms
  ) VALUES (
    v_org_id, 'acme/widget', 'All PRs must include tests', 'binding', 'inferred', v_comment_id, 1700000003000
  );

  INSERT INTO outcomes (
    org_id, bookmark_id, kind, evidence_sha, detected_at_ms
  ) VALUES (
    v_org_id, v_bookmark_id, 'clean', 'abc123', 1700000004000
  );

  -- Assert join on (org_id, bookmark_id) returns coherent row
  SELECT COUNT(*) INTO v_join_count
  FROM pr_comments pc
  JOIN decisions d
    ON d.org_id = pc.org_id AND d.bookmark_id = pc.bookmark_id
  JOIN rules r
    ON r.org_id = pc.org_id
  JOIN outcomes o
    ON o.org_id = pc.org_id AND o.bookmark_id = pc.bookmark_id
  WHERE pc.org_id = v_org_id AND pc.bookmark_id = v_bookmark_id;

  IF v_join_count <> 1 THEN
    RAISE EXCEPTION 'ledger join expected 1 row, got %', v_join_count;
  END IF;

  -- Seed sessions_raw + session_events with raw_line pointer
  INSERT INTO sessions_raw (
    org_id, session_id, tool, model, content, captured_at_ms
  ) VALUES (
    v_org_id,
    'cursor-test-session',
    'cursor',
    'claude-4',
    E'line1: metadata\nline2: old_text payload\nline3: new_text payload',
    1700000005000
  ) RETURNING id INTO v_raw_id;

  INSERT INTO session_events (
    org_id, session_id, tool, model, ts, event_type, file_path,
    content_hash, raw_id, raw_line
  ) VALUES (
    v_org_id, 'cursor-test-session', 'cursor', 'claude-4',
    1700000005000, 'edit', 'src/foo.ts', 'hash-abc', v_raw_id, 2
  );

  -- Assert raw_line text lookup
  SELECT split_part(sr.content, E'\n', se.raw_line) INTO v_event_text
  FROM session_events se
  JOIN sessions_raw sr ON sr.id = se.raw_id
  WHERE se.raw_id = v_raw_id AND se.raw_line = 2;

  IF v_event_text <> 'line2: old_text payload' THEN
    RAISE EXCEPTION 'raw_line lookup expected line2, got: %', v_event_text;
  END IF;

  -- Seed review_usage and assert org-scoped COUNT
  INSERT INTO review_usage (org_id, user_id, bookmark_id, counted_at_ms)
  VALUES (v_org_id, 'test-user', v_bookmark_id, 1700000006000)
  ON CONFLICT (org_id, bookmark_id) DO NOTHING;

  SELECT COUNT(*)::INTEGER INTO v_usage_count
  FROM review_usage
  WHERE org_id = v_org_id
  GROUP BY org_id;

  IF v_usage_count < 1 THEN
    RAISE EXCEPTION 'review_usage org count expected >= 1, got %', v_usage_count;
  END IF;

  RAISE NOTICE 'WP-4 ledger_joins_test: all assertions passed';
END $$;

ROLLBACK;
