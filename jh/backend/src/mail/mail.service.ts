import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly transporter: nodemailer.Transporter;
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly configService: ConfigService) {
    const port = Number(this.configService.getOrThrow<string>('MAIL_PORT'));
    const secure = this.getMailSecure(port);

    this.transporter = nodemailer.createTransport({
      host: this.configService.getOrThrow<string>('MAIL_HOST'),
      port,
      secure,
      auth: {
        user: this.configService.getOrThrow<string>('MAIL_USER'),
        pass: this.configService.getOrThrow<string>('MAIL_PASSWORD'),
      },
    });
  }

  async sendEmailVerificationCode(
    email: string,
    code: string,
    expiresAt: Date,
  ): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.configService.getOrThrow<string>('MAIL_FROM'),
        to: email,
        subject: '[TailTalk] 이메일 인증번호',
        text: `이메일 인증번호는 ${code}입니다. 5분 안에 입력해주세요.`,
        html: `
          <p>이메일 인증번호는 <strong>${code}</strong>입니다.</p>
          <p>5분 안에 입력해주세요.</p>
          <p>만료 시간: ${expiresAt.toLocaleString('ko-KR', {
            timeZone: 'Asia/Seoul',
          })}</p>
        `,
      });
    } catch (error) {
      this.logger.error('이메일 인증번호 발송 실패', error);

      throw new ServiceUnavailableException(
        '인증 이메일 발송에 실패했습니다. 잠시 후 다시 시도해주세요.',
      );
    }
  }

  private getMailSecure(port: number) {
    const value = this.configService.get<string>('MAIL_SECURE', '').trim();

    if (!value) {
      return port === 465;
    }

    return value === 'true';
  }
}
