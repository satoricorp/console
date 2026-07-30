-- Rename the gx-era columns to tx. Part of the gx→tx rebrand; there is no
-- production data that needs a compatibility window.
ALTER TABLE pr_events RENAME COLUMN gx_version TO tx_version;
ALTER TABLE reported_logs RENAME COLUMN gx_version TO tx_version;
ALTER TABLE pr_comments RENAME COLUMN is_gx_mention TO is_tx_mention;
