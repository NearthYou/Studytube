/* eslint-disable camelcase */

exports.up = (pgm) => {
  pgm.sql(String.raw`
    SET LOCAL lock_timeout = '5s';
    SET LOCAL statement_timeout = '30s';

    ALTER TABLE work_outbox_events
      ADD COLUMN trace_context JSONB NOT NULL DEFAULT '{}'::jsonb;

    ALTER TABLE work_outbox_events
      ADD CONSTRAINT work_outbox_trace_context_object
      CHECK (jsonb_typeof(trace_context) = 'object') NOT VALID;

    ALTER TABLE work_outbox_events
      VALIDATE CONSTRAINT work_outbox_trace_context_object;
  `);
};

exports.down = (pgm) => {
  pgm.sql(String.raw`
    ALTER TABLE work_outbox_events
      DROP CONSTRAINT IF EXISTS work_outbox_trace_context_object,
      DROP COLUMN IF EXISTS trace_context;
  `);
};
