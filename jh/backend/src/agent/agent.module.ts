import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PetPlacesModule } from '../pet-places/pet-places.module';
import { PostsModule } from '../posts/posts.module';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';

@Module({
  imports: [AuthModule, PostsModule, PetPlacesModule],
  controllers: [AgentController],
  providers: [AgentService],
})
export class AgentModule {}
