import { Controller, Get } from '@nestjs/common';
import { LookupsService } from './lookups.service';

@Controller('lookups')
export class LookupsController {
  constructor(private readonly lookupsService: LookupsService) {}

  @Get('post-filters')
  async getPostFilters() {
    return this.lookupsService.getPostFilters();
  }

  @Get('regions')
  async getRegions() {
    return this.lookupsService.getRegions();
  }

  @Get('themes')
  async getThemes() {
    return this.lookupsService.getThemes();
  }

  @Get('budget-ranges')
  async getBudgetRanges() {
    return this.lookupsService.getBudgetRanges();
  }
}
