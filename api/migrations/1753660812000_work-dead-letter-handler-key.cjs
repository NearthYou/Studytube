/* eslint-disable camelcase */

exports.up = (pgm) => {
  pgm.sql(String.raw`
    SET LOCAL lock_timeout = '5s';
    SET LOCAL statement_timeout = '30s';

    ALTER TABLE work_dead_letters
      DROP CONSTRAINT work_dead_letters_event_id_key;

    ALTER TABLE work_dead_letters
      ADD CONSTRAINT work_dead_letters_event_handler_key
      UNIQUE (event_id, handler_version);
  `);
};

exports.down = () => {
  throw new Error(
    'work dead-letter handler key rollback refused: preserve handler-specific audit history',
  );
};
