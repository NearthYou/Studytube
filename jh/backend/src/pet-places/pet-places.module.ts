import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PetPlacesController } from './pet-places.controller';
import { PetPlacesService } from './pet-places.service';

@Module({
  imports: [ConfigModule],
  controllers: [PetPlacesController],
  providers: [PetPlacesService],
  exports: [PetPlacesService],
})
export class PetPlacesModule {}
