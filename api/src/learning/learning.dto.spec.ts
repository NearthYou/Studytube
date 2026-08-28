import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SubmitAdaptiveQuizDto } from './learning.dto';

describe('SubmitAdaptiveQuizDto', () => {
  it('accepts deterministic UUID v5 question identifiers', async () => {
    const input = plainToInstance(SubmitAdaptiveQuizDto, {
      answers: [
        '9aecb17e-a4d9-503d-ab2e-2189b07b3502',
        '6feead8f-8a57-5201-a057-b2356439087e',
        'f8a7edfb-354c-5010-b15a-db4811c6bcdf',
        '8824d92b-4c62-5c83-9295-069b4f994326',
        '583cd662-424a-51dc-88a9-d334c391b311',
      ].map((questionId) => ({ questionId, selectedChoiceIndex: 0 })),
    });

    expect(await validate(input)).toEqual([]);
  });
});
