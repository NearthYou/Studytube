process.env.NODE_ENV ??= 'test';
process.env.WEB_ORIGIN ??= 'https://app.studytube.example.test';
process.env.AUTH_VERIFICATION_PEPPER ??=
  'studytube-e2e-verification-pepper-32-bytes';
process.env.AUTH_RATE_LIMIT_PEPPER ??=
  'studytube-e2e-rate-limit-pepper-32-bytes';
process.env.AUTH_RATE_LIMIT_MAX_ATTEMPTS ??= '100';
