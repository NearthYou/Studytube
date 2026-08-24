import { PostgresLiveCaptionRepository } from './postgres-live-caption.repository';

describe('PostgresLiveCaptionRepository', () => {
  it('returns a previously stored chunk only through its owner context', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          ordinal: 2,
          start: 16,
          end: 24,
          sourceLanguage: 'en',
          source: 'Stored source',
          korean: '저장된 번역',
        },
      ],
    });
    const repository = new PostgresLiveCaptionRepository({ query } as never);

    await expect(
      repository.findChunk({
        userId: 7,
        contextId: '42',
        sessionId: '15ed31b7-0951-4ccb-b878-494ed3c3954f',
        ordinal: 2,
      }),
    ).resolves.toEqual({
      ordinal: 2,
      start: 16,
      end: 24,
      sourceLanguage: 'en',
      source: 'Stored source',
      korean: '저장된 번역',
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('context.user_id = $1'),
      [7, '42', '15ed31b7-0951-4ccb-b878-494ed3c3954f', 2],
    );
  });

  it('checks the bounded STT approval before new provider work', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{ approved: true }] });
    const repository = new PostgresLiveCaptionRepository({ query } as never);

    await expect(
      repository.hasActiveApproval('gpt-4o-mini-transcribe-2025-12-15'),
    ).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        "artifact.provider = 'browser-audio-transcription'",
      ),
      ['gpt-4o-mini-transcribe-2025-12-15', 50],
    );
  });
});
