import { createHash } from 'node:crypto';
import { parseVerificationToken } from './auth-token';

export type VerificationEmailRenderInput = {
  pendingRegistrationId: string;
  verificationToken: string;
  recipient: string;
  sender: string;
  publicOrigin: string;
  templateVersion: string;
  locale: string;
  subject: string;
};

export type RenderedVerificationEmail = Readonly<{
  recipient: string;
  sender: string;
  subject: string;
  text: string;
  html: string;
  verificationUrl: string;
  canonicalPayload: string;
  payloadHash: Buffer;
}>;

export function renderVerificationEmail(
  input: VerificationEmailRenderInput,
): RenderedVerificationEmail {
  if (!['v1', 'v2'].includes(input.templateVersion)) {
    throw new RangeError('Unsupported verification email template');
  }
  const parsedToken = parseVerificationToken(input.verificationToken);
  if (
    !parsedToken ||
    parsedToken.pendingRegistrationId !== input.pendingRegistrationId
  ) {
    throw new RangeError('Verification token does not match the email intent');
  }
  const publicOrigin = exactPublicOrigin(input.publicOrigin);
  const verificationUrl = `${publicOrigin}/signup/verify#verification=${input.verificationToken}`;
  const usesGenericExpiry = input.templateVersion === 'v2';
  const text =
    input.locale === 'ko'
      ? `StudyTube 가입을 계속하려면 다음 링크를 여세요:\n\n${verificationUrl}\n\n${
          usesGenericExpiry
            ? '보안을 위해 이 링크는 짧은 시간 동안만 사용할 수 있습니다. 만료되었다면 새 링크를 요청하세요.'
            : '이 링크는 15분 후 만료됩니다.'
        }`
      : `Open this link to continue your StudyTube signup:\n\n${verificationUrl}\n\n${
          usesGenericExpiry
            ? 'For security, this link is available only for a short time. Request a new link if it has expired.'
            : 'This link expires in 15 minutes.'
        }`;
  const html = [
    '<!doctype html>',
    '<html><body>',
    input.locale === 'ko'
      ? '<p>StudyTube 가입을 계속하려면 아래 링크를 여세요.</p>'
      : '<p>Open the link below to continue your StudyTube signup.</p>',
    `<p><a href="${escapeHtml(verificationUrl)}">Verify email</a></p>`,
    input.locale === 'ko'
      ? usesGenericExpiry
        ? '<p>보안을 위해 이 링크는 짧은 시간 동안만 사용할 수 있습니다. 만료되었다면 새 링크를 요청하세요.</p>'
        : '<p>이 링크는 15분 후 만료됩니다.</p>'
      : usesGenericExpiry
        ? '<p>For security, this link is available only for a short time. Request a new link if it has expired.</p>'
        : '<p>This link expires in 15 minutes.</p>',
    '</body></html>',
  ].join('');
  const canonicalPayload = JSON.stringify({
    sender: input.sender,
    recipient: input.recipient,
    subject: input.subject,
    text,
    html,
  });

  return Object.freeze({
    recipient: input.recipient,
    sender: input.sender,
    subject: input.subject,
    text,
    html,
    verificationUrl,
    canonicalPayload,
    payloadHash: createHash('sha256').update(canonicalPayload, 'utf8').digest(),
  });
}

function exactPublicOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RangeError('Verification email public origin is invalid');
  }
  if (
    url.origin !== value ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new RangeError('Verification email public origin must be an origin');
  }
  return url.origin;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
