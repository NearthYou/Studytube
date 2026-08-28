import { isFullVideoCaptionCoverage } from './caption-track-coverage';

describe('full video caption coverage', () => {
  const fullTrack = { startSeconds: 0, endSeconds: 1_000 };

  it('accepts a ready YouTube caption track that covers the ending', () => {
    expect(
      isFullVideoCaptionCoverage('youtube_caption', fullTrack, {
        startSeconds: 0,
        endSeconds: 970,
      }),
    ).toBe(true);
  });

  it('does not treat the last five percent of a long video as optional', () => {
    expect(
      isFullVideoCaptionCoverage('youtube_caption', fullTrack, {
        startSeconds: 0,
        endSeconds: 950,
      }),
    ).toBe(false);
  });

  it('rejects an opening-only range even when it starts at zero', () => {
    expect(
      isFullVideoCaptionCoverage('youtube_caption', fullTrack, {
        startSeconds: 0,
        endSeconds: 100,
      }),
    ).toBe(false);
  });

  it('rejects a partial transcription even when its timestamps look complete', () => {
    expect(
      isFullVideoCaptionCoverage('transcription', fullTrack, fullTrack),
    ).toBe(false);
  });

  it('rejects ranges that miss the beginning of the track', () => {
    expect(
      isFullVideoCaptionCoverage('youtube_caption', fullTrack, {
        startSeconds: 20,
        endSeconds: 1_000,
      }),
    ).toBe(false);
  });
});
