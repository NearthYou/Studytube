import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseService } from '../database.service';
import { AccountDeletionController } from './account-deletion.controller';
import { AccountErasureService } from './account-erasure.service';

@Module({
  imports: [AuthModule],
  controllers: [AccountDeletionController],
  providers: [
    {
      provide: AccountErasureService,
      useFactory: (database: DatabaseService) =>
        new AccountErasureService(database.getAccountErasureRepository()),
      inject: [DatabaseService],
    },
  ],
  exports: [AccountErasureService],
})
export class AccountModule {}
