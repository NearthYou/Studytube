import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { AgentService } from './agent.service';
import { ChatAgentDto } from './dto/chat-agent.dto';

@Controller('agent')
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  @Post('chat')
  @UseGuards(JwtAuthGuard)
  chat(@Body() dto: ChatAgentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.agentService.chat(dto, user);
  }
}
