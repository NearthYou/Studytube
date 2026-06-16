import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

type LookupRow = {
  code: string;
  name: string;
};

type BudgetRangeRow = {
  code: string;
  label: string;
};

export type LookupOption = {
  value: string;
  label: string;
};

@Injectable()
export class LookupsRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async findRegions(): Promise<LookupOption[]> {
    const result = await this.databaseService.query<LookupRow>(
      `
        SELECT code, name
        FROM regions
        WHERE is_active = TRUE
        ORDER BY sort_order ASC, id ASC
      `,
    );

    return result.rows.map((row) => ({
      value: row.code,
      label: row.name,
    }));
  }

  async findThemes(): Promise<LookupOption[]> {
    const result = await this.databaseService.query<LookupRow>(
      `
        SELECT code, name
        FROM themes
        WHERE is_active = TRUE
        ORDER BY sort_order ASC, id ASC
      `,
    );

    return result.rows.map((row) => ({
      value: row.code,
      label: row.name,
    }));
  }

  async findBudgetRanges(): Promise<LookupOption[]> {
    const result = await this.databaseService.query<BudgetRangeRow>(
      `
        SELECT code, label
        FROM budget_ranges
        WHERE is_active = TRUE
        ORDER BY sort_order ASC, id ASC
      `,
    );

    return result.rows.map((row) => ({
      value: row.code,
      label: row.label,
    }));
  }
}
