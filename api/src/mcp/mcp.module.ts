import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiProxyService } from '../ai-proxy.service';
import { AuthModule } from '../auth/auth.module';
import { LearningModule } from '../learning/learning.module';
import { McpServiceAssertionGuard } from './mcp-service-assertion.guard';
import { McpServiceAssertionVerifier } from './mcp-service-assertion';
import { McpController } from './mcp.controller';

@Module({
  imports: [ConfigModule, HttpModule, AuthModule, LearningModule],
  controllers: [McpController],
  providers: [
    AiProxyService,
    McpServiceAssertionVerifier,
    McpServiceAssertionGuard,
  ],
})
export class McpModule {}
