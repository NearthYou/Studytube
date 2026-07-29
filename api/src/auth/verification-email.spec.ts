import { createHash } from 'node:crypto';
import { renderVerificationEmail } from './verification-email';

const TOKEN =
  'v1.11111111-1111-4111-8111-111111111111.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

describe('verification email rendering', () => {
  it('puts the reconstructable verification token only in a URL fragment', () => {
    const rendered = renderVerificationEmail({
      pendingRegistrationId: '11111111-1111-4111-8111-111111111111',
      verificationToken: TOKEN,
      recipient: 'ada@example.com',
      sender: 'StudyTube <no-reply@example.com>',
      publicOrigin: 'https://studytube.example',
      templateVersion: 'v2',
      locale: 'ko',
      subject: 'StudyTube 이메일을 인증해 주세요',
    });

    expect(rendered.verificationUrl).toBe(
      `https://studytube.example/signup/verify#verification=${TOKEN}`,
    );
    const parsed = new URL(rendered.verificationUrl);
    expect(parsed.search).toBe('');
    expect(parsed.pathname).toBe('/signup/verify');
    expect(rendered.text).toContain(rendered.verificationUrl);
    expect(rendered.html).toContain(rendered.verificationUrl);
    expect(rendered.text).toContain('짧은 시간 동안만');
    expect(rendered.html).toContain('짧은 시간 동안만');
    expect(rendered.canonicalPayload).not.toContain('15분');
  });

  it('does not promise a fresh fixed lifetime when an existing token is resent', () => {
    const rendered = renderVerificationEmail({
      pendingRegistrationId: '11111111-1111-4111-8111-111111111111',
      verificationToken: TOKEN,
      recipient: 'ada@example.com',
      sender: 'StudyTube <no-reply@example.com>',
      publicOrigin: 'https://studytube.example',
      templateVersion: 'v2',
      locale: 'en',
      subject: 'Verify your StudyTube email',
    });

    expect(rendered.text).toContain('only for a short time');
    expect(rendered.html).toContain('only for a short time');
    expect(rendered.canonicalPayload).not.toContain('15 minutes');
  });

  it('hashes the exact immutable provider payload without persisting raw content', () => {
    const base = {
      pendingRegistrationId: '11111111-1111-4111-8111-111111111111',
      verificationToken: TOKEN,
      recipient: 'ada@example.com',
      sender: 'StudyTube <no-reply@example.com>',
      publicOrigin: 'https://studytube.example',
      templateVersion: 'v1',
      locale: 'en',
      subject: 'Verify your StudyTube email',
    } as const;
    const first = renderVerificationEmail(base);
    const second = renderVerificationEmail(base);
    const changed = renderVerificationEmail({
      ...base,
      subject: 'A changed subject',
    });

    expect(first.payloadHash).toEqual(second.payloadHash);
    expect(first.payloadHash).not.toEqual(changed.payloadHash);
    expect(first.payloadHash).toHaveLength(32);
    expect(first.payloadHash).toEqual(
      createHash('sha256').update(first.canonicalPayload, 'utf8').digest(),
    );
    expect(first.canonicalPayload).toContain(TOKEN);
  });

  it('preserves the queued v1 payload while v2 changes only expiry guidance', () => {
    const base = {
      pendingRegistrationId: '11111111-1111-4111-8111-111111111111',
      verificationToken: TOKEN,
      recipient: 'ada@example.com',
      sender: 'StudyTube <no-reply@example.com>',
      publicOrigin: 'https://studytube.example',
      locale: 'en',
      subject: 'Verify your StudyTube email',
    } as const;

    const legacy = renderVerificationEmail({ ...base, templateVersion: 'v1' });
    const current = renderVerificationEmail({ ...base, templateVersion: 'v2' });
    const legacyText = `Open this link to continue your StudyTube signup:\n\n${legacy.verificationUrl}\n\nThis link expires in 15 minutes.`;
    const legacyHtml = [
      '<!doctype html>',
      '<html><body>',
      '<p>Open the link below to continue your StudyTube signup.</p>',
      `<p><a href="${legacy.verificationUrl}">Verify email</a></p>`,
      '<p>This link expires in 15 minutes.</p>',
      '</body></html>',
    ].join('');

    expect(legacy.text).toBe(legacyText);
    expect(legacy.html).toBe(legacyHtml);
    expect(legacy.canonicalPayload).toBe(
      JSON.stringify({
        sender: base.sender,
        recipient: base.recipient,
        subject: base.subject,
        text: legacyText,
        html: legacyHtml,
      }),
    );
    expect(current.text).toContain('only for a short time');
    expect(current.payloadHash).not.toEqual(legacy.payloadHash);
  });

  it('rejects unsupported templates and non-origin public URLs', () => {
    const base = {
      pendingRegistrationId: '11111111-1111-4111-8111-111111111111',
      verificationToken: TOKEN,
      recipient: 'ada@example.com',
      sender: 'StudyTube <no-reply@example.com>',
      publicOrigin: 'https://studytube.example',
      templateVersion: 'v1',
      locale: 'en',
      subject: 'Verify your StudyTube email',
    };

    expect(() =>
      renderVerificationEmail({ ...base, templateVersion: 'unknown' }),
    ).toThrow(/template/i);
    expect(() =>
      renderVerificationEmail({
        ...base,
        publicOrigin: 'https://studytube.example/untrusted-path',
      }),
    ).toThrow(/origin/i);
  });
});
