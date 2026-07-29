import { LearningDatabase } from './learning.database';

describe('LearningDatabase production configuration', () => {
  it('refuses to construct a production pool without DATABASE_URL', () => {
    const previousEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(
        () => new LearningDatabase({ get: () => undefined } as never),
      ).toThrow('DATABASE_URL must be explicitly configured in production');
    } finally {
      if (previousEnvironment === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousEnvironment;
      }
    }
  });
});
