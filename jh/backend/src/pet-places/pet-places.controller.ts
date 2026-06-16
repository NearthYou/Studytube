import { Controller, Get, Param, Query } from '@nestjs/common';
import { BigIntIdPipe } from '../common/pipes/bigint-id.pipe';
import { PetPlaceAreaQueryDto } from './dto/pet-place-area-query.dto';
import { PetPlaceNearbyQueryDto } from './dto/pet-place-nearby-query.dto';
import { PetPlaceSearchQueryDto } from './dto/pet-place-search-query.dto';
import { PetPlacesService } from './pet-places.service';

@Controller('pet-places')
export class PetPlacesController {
  constructor(private readonly petPlacesService: PetPlacesService) {}

  @Get('area')
  findByArea(@Query() dto: PetPlaceAreaQueryDto) {
    return this.petPlacesService.findByArea(dto);
  }

  @Get('nearby')
  findNearby(@Query() dto: PetPlaceNearbyQueryDto) {
    return this.petPlacesService.findNearby(dto);
  }

  @Get('search')
  search(@Query() dto: PetPlaceSearchQueryDto) {
    return this.petPlacesService.search(dto);
  }

  @Get(':contentId')
  findOne(@Param('contentId', BigIntIdPipe) contentId: string) {
    return this.petPlacesService.findOne(contentId);
  }
}
