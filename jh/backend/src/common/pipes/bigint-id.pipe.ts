import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

@Injectable()
export class BigIntIdPipe implements PipeTransform<string, string> {
  transform(value: string) {
    if (!/^[1-9]\d*$/.test(value)) {
      throw new BadRequestException('유효한 숫자 ID를 입력해주세요.');
    }

    return value;
  }
}
