import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { DatabaseModule } from 'src/database/database.module';

// 사용자 관련 서비스가 존재한다고 모듈에 등록
@Module({
  imports: [DatabaseModule],
  providers: [UsersService], // 해당 모듈 안에서 사용할 서비스 목록
  exports: [UsersService], // 다른 모듈에서 쓸 수 있도록 공개하는 서비스 목록
})
export class UsersModule {}
