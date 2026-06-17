import { RagQueryParser } from './rag-query-parser';

describe('RagQueryParser', () => {
  const makePrisma = () => ({
    theater: {
      findMany: jest.fn().mockResolvedValue([
        { id: 1n, name: '블루스퀘어 신한카드홀' },
        { id: 2n, name: '세종문화회관 대극장' },
        { id: 3n, name: 'TOM 1관' },
        { id: 4n, name: 'TOM 2관' },
      ]),
    },
    musical: {
      findMany: jest.fn().mockResolvedValue([
        { id: 10n, title: '팬텀' },
        { id: 11n, title: '웃는 남자' },
      ]),
    },
  });

  it('extracts theater, musical, seat, side, and intent from a seat question', async () => {
    const parser = new RagQueryParser(makePrisma() as never);

    await expect(
      parser.parse('블루스퀘어 팬텀 2층 중앙블록 3열 12번 표정 잘 보여?'),
    ).resolves.toMatchObject({
      theaterId: '1',
      theaterName: '블루스퀘어 신한카드홀',
      musicalId: '10',
      musicalTitle: '팬텀',
      seatFloor: '2층',
      seatSection: '중앙',
      seatRow: '3',
      seatNumber: '12',
      side: 'center',
      intent: 'expression',
    });
  });

  it('classifies comfort questions', async () => {
    const parser = new RagQueryParser(makePrisma() as never);

    await expect(
      parser.parse('세종문화회관 대극장 1층 오래 앉아 있기 편해?'),
    ).resolves.toMatchObject({
      theaterId: '2',
      intent: 'comfort',
    });
  });

  it('extracts floor and view intent from short visibility questions', async () => {
    const parser = new RagQueryParser(makePrisma() as never);

    await expect(parser.parse('1층 시야 괜찮아?')).resolves.toMatchObject({
      seatFloor: '1층',
      intent: 'view',
    });
  });

  it('does not force ambiguous side block wording into left or right', async () => {
    const parser = new RagQueryParser(makePrisma() as never);

    await expect(parser.parse('사블 시야 어때?')).resolves.toMatchObject({
      intent: 'view',
    });
    await expect(parser.parse('사블 시야 어때?')).resolves.not.toMatchObject({
      side: expect.any(String),
    });
  });

  it('understands common theater aliases', async () => {
    const parser = new RagQueryParser(makePrisma() as never);

    await expect(parser.parse('블퀘 2층 시야 어때?')).resolves.toMatchObject({
      theaterId: '1',
      theaterName: '블루스퀘어 신한카드홀',
    });
    await expect(parser.parse('신카홀 2층 시야 어때?')).resolves.toMatchObject({
      theaterId: '1',
      theaterName: '블루스퀘어 신한카드홀',
    });
    await expect(parser.parse('세종 1층 시야방해 몇열까지야?')).resolves.toMatchObject({
      theaterId: '2',
      theaterName: '세종문화회관 대극장',
      tagName: '시야방해',
      asksRange: true,
    });
    await expect(parser.parse('티오엠 2관 1층 시야 어때?')).resolves.toMatchObject({
      theaterId: '4',
      theaterName: 'TOM 2관',
    });
  });
});
