/* eslint-disable camelcase */

exports.up = (pgm) => {
  pgm.sql(String.raw`
    SET LOCAL lock_timeout = '5s';
    SET LOCAL statement_timeout = '45s';

    ALTER TABLE work_outbox_events
      ADD COLUMN owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE;

    CREATE INDEX work_outbox_events_owner_idx
      ON work_outbox_events (owner_id, occurred_at, id)
      WHERE owner_id IS NOT NULL;

    ALTER TABLE work_job_results
      DROP CONSTRAINT work_job_results_event_id_fkey,
      ADD CONSTRAINT work_job_results_event_id_fkey
        FOREIGN KEY (event_id) REFERENCES work_outbox_events(id) ON DELETE CASCADE;

    ALTER TABLE work_job_claims
      DROP CONSTRAINT work_job_claims_event_id_fkey,
      ADD CONSTRAINT work_job_claims_event_id_fkey
        FOREIGN KEY (event_id) REFERENCES work_outbox_events(id) ON DELETE CASCADE;

    ALTER TABLE work_dead_letters
      DROP CONSTRAINT work_dead_letters_event_id_fkey,
      ADD CONSTRAINT work_dead_letters_event_id_fkey
        FOREIGN KEY (event_id) REFERENCES work_outbox_events(id) ON DELETE CASCADE;

    ALTER TABLE work_replay_audits
      DROP CONSTRAINT work_replay_audits_dead_letter_id_fkey,
      DROP CONSTRAINT work_replay_audits_replay_event_id_fkey,
      DROP CONSTRAINT work_replay_audits_actor_id_fkey,
      ADD CONSTRAINT work_replay_audits_dead_letter_id_fkey
        FOREIGN KEY (dead_letter_id) REFERENCES work_dead_letters(id) ON DELETE CASCADE,
      ADD CONSTRAINT work_replay_audits_replay_event_id_fkey
        FOREIGN KEY (replay_event_id) REFERENCES work_outbox_events(id) ON DELETE CASCADE,
      ADD CONSTRAINT work_replay_audits_actor_id_fkey
        FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE CASCADE;

    ALTER TABLE learning_context_summaries
      DROP CONSTRAINT learning_context_summaries_event_id_fkey,
      ADD CONSTRAINT learning_context_summaries_event_id_fkey
        FOREIGN KEY (event_id) REFERENCES work_outbox_events(id)
        ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;
  `);
};

exports.down = () => {
  throw new Error(
    'user-owned work event rollback refused: restore the verified pre-expand backup or roll forward',
  );
};
