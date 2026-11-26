SET LOCAL search_path = app, pg_catalog;

ALTER TABLE profiles ADD COLUMN setup_stage TEXT CHECK (setup_stage IN ('add', 'confirm', 'style', 'ready'));
ALTER TABLE outfit_requests ADD COLUMN resume_stage TEXT
  CHECK (resume_stage IN ('occasion', 'style', 'photo', 'compare', 'refine', 'closed'));
ALTER TABLE outfit_requests ADD COLUMN resume_version TEXT;
ALTER TABLE outfit_requests ADD COLUMN resume_option_id BIGINT;
ALTER TABLE outfit_requests ADD COLUMN resume_after_run BIGINT NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX one_active_planner_draft ON outfit_requests(user_id)
  WHERE resume_stage IS NOT NULL AND resume_stage <> 'closed';
