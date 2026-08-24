import { LiveCaptionService } from './live-caption.service';

describe('LiveCaptionService', () => {
  const request = {
    contextId: '42',
    sessionId: '15ed31b7-0951-4ccb-b878-494ed3c3954f',
    ordinal: 0,
    startSeconds: 12,
    endSeconds: 20,
    mimeType: 'audio/webm;codecs=opus',
    audioBase64: 'dGVzdA==',
  };

  it('transcribes and stores one authorized browser audio chunk', async () => {
    const transcribe = jest.fn().mockResolvedValue({
      sourceLanguage: 'en',
      source: 'Containers share the host kernel.',
      korean: '컨테이너는 호스트 커널을 공유합니다.',
    });
    const appendChunk = jest.fn().mockResolvedValue(undefined);
    const service = new LiveCaptionService(
      { transcribeLiveCaptionChunk: transcribe },
      {
        hasActiveApproval: jest.fn().mockResolvedValue(true),
        findChunk: jest.fn().mockResolvedValue(null),
        appendChunk,
        finalize: jest.fn(),
      },
    );

    await expect(service.capture(7, request)).resolves.toMatchObject({
      ordinal: 0,
      source: 'Containers share the host kernel.',
      korean: '컨테이너는 호스트 커널을 공유합니다.',
    });
    expect(appendChunk).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7, ordinal: 0 }),
    );
  });

  it('rejects a chunk outside the ten minute session window', async () => {
    const service = new LiveCaptionService({} as never, {} as never);

    await expect(
      service.capture(7, {
        ...request,
        startSeconds: 598,
        endSeconds: 606,
      }),
    ).rejects.toThrow('자막은 영상 앞부분 10분까지 만들 수 있습니다.');
  });

  it('returns a stored chunk without charging for the same ordinal twice', async () => {
    const stored = {
      ordinal: 0,
      start: 12,
      end: 20,
      sourceLanguage: 'en',
      source: 'Stored source',
      korean: '저장된 번역',
    };
    const transcribe = jest.fn();
    const service = new LiveCaptionService(
      { transcribeLiveCaptionChunk: transcribe },
      {
        hasActiveApproval: jest.fn().mockResolvedValue(true),
        findChunk: jest.fn().mockResolvedValue(stored),
        appendChunk: jest.fn(),
        finalize: jest.fn(),
      },
    );

    await expect(service.capture(7, request)).resolves.toEqual(stored);
    expect(transcribe).not.toHaveBeenCalled();
  });
});
