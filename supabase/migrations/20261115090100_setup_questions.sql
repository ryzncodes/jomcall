-- The interview's question list is frozen on the session when it starts, so
-- answering does not pull further questions in. Re-runnable.
alter table app.setup_session add column if not exists question_ids text[] not null default '{}';
alter table app.setup_session drop constraint if exists setup_session_question_ids_max;
alter table app.setup_session add constraint setup_session_question_ids_max check (cardinality(question_ids) <= 8);
