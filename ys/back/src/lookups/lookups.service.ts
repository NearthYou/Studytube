import { Injectable } from '@nestjs/common';
import {
  LookupOption,
  LookupsRepository,
} from './repositories/lookups.repository';

const SEASONS: LookupOption[] = [
  { value: '봄', label: '봄' },
  { value: '여름', label: '여름' },
  { value: '가을', label: '가을' },
  { value: '겨울', label: '겨울' },
];

const COMPANIONS: LookupOption[] = [
  { value: '혼자', label: '혼자' },
  { value: '친구', label: '친구' },
  { value: '연인', label: '연인' },
  { value: '가족', label: '가족' },
];

@Injectable()
export class LookupsService {
  constructor(private readonly lookupsRepository: LookupsRepository) {}

  async getPostFilters() {
    const [regions, themes, budgetRanges] = await Promise.all([
      this.lookupsRepository.findRegions(),
      this.lookupsRepository.findThemes(),
      this.lookupsRepository.findBudgetRanges(),
    ]);

    return {
      regions,
      themes,
      budgetRanges,
      seasons: SEASONS,
      companions: COMPANIONS,
    };
  }

  async getRegions() {
    return this.lookupsRepository.findRegions();
  }

  async getThemes() {
    return this.lookupsRepository.findThemes();
  }

  async getBudgetRanges() {
    return this.lookupsRepository.findBudgetRanges();
  }
}
