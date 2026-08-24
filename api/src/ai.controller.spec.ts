import { AiController } from './ai.controller';

describe('AiController live captions', () => {
  it('binds captured audio to the authenticated user', async () => {
    const capture = jest.fn().mockResolvedValue({ source: 'hello' });
    const controller = new AiController(
      {} as never,
      {
        capture,
        finalize: jest.fn(),
      } as never,
    );
    const body = {
      contextId: '42',
      sessionId: '15ed31b7-0951-4ccb-b878-494ed3c3954f',
      ordinal: 0,
      startSeconds: 0,
      endSeconds: 8,
      mimeType: 'audio/webm',
      audioBase64: 'dGVzdA==',
    };

    await controller.captureLiveCaptionChunk(
      { principal: { userId: 7 } } as never,
      body,
    );

    expect(capture).toHaveBeenCalledWith(7, body);
  });
});
