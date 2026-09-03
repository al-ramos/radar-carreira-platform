CREATE INDEX `triage_history_current_version_idx`
ON `triage_history` (`user_id`, `job_id`, `profile_revision`, `rules_revision`, `instructions_revision`);
