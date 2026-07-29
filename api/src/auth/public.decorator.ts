import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiExtension } from '@nestjs/swagger';

export const IS_PUBLIC_ROUTE = 'studytube:is-public-route';

export const Public = () =>
  applyDecorators(
    SetMetadata(IS_PUBLIC_ROUTE, true),
    ApiExtension('x-studytube-public', true),
  );
