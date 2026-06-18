import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PetPlaceAreaQueryDto } from './dto/pet-place-area-query.dto';
import { PetPlaceNearbyQueryDto } from './dto/pet-place-nearby-query.dto';
import { PetPlaceSearchQueryDto } from './dto/pet-place-search-query.dto';

type TourApiItem = Record<string, unknown>;
type TourApiBody = Record<string, unknown> & {
  items?: unknown;
  numOfRows?: unknown;
  pageNo?: unknown;
  totalCount?: unknown;
};
type TourApiEnvelope = {
  response?: {
    body?: TourApiBody;
    header?: {
      resultCode?: unknown;
      resultMsg?: unknown;
    };
  };
};

interface TourApiResult {
  items: TourApiItem[];
  page: number;
  limit: number;
  totalCount: number;
}

@Injectable()
export class PetPlacesService {
  private readonly baseUrl: string;
  private readonly mobileOs: string;
  private readonly mobileApp: string;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = this.configService.get<string>(
      'TOUR_API_BASE_URL',
      'https://apis.data.go.kr/B551011/KorPetTourService2',
    );
    this.mobileOs = this.configService.get<string>('TOUR_API_MOBILE_OS', 'ETC');
    this.mobileApp = this.configService.get<string>(
      'TOUR_API_MOBILE_APP',
      'TailTalk',
    );
  }

  async findByArea(dto: PetPlaceAreaQueryDto) {
    const result = await this.request('areaBasedList2', {
      areaCode: dto.areaCode,
      sigunguCode: dto.sigunguCode,
      contentTypeId: dto.contentTypeId,
      pageNo: String(dto.page ?? 1),
      numOfRows: String(dto.limit ?? 12),
      arrange: 'C',
    });

    return this.toListResponse(result, '지역 기반 장소 목록을 조회했습니다.');
  }

  async findNearby(dto: PetPlaceNearbyQueryDto) {
    const result = await this.request('locationBasedList2', {
      mapX: dto.lng,
      mapY: dto.lat,
      radius: String(dto.radius ?? 3000),
      contentTypeId: dto.contentTypeId,
      pageNo: String(dto.page ?? 1),
      numOfRows: String(dto.limit ?? 12),
      arrange: 'E',
    });

    return this.toListResponse(result, '위치 기반 장소 목록을 조회했습니다.');
  }

  async search(dto: PetPlaceSearchQueryDto) {
    const result = await this.request('searchKeyword2', {
      keyword: dto.keyword.trim(),
      contentTypeId: dto.contentTypeId,
      pageNo: String(dto.page ?? 1),
      numOfRows: String(dto.limit ?? 12),
      arrange: 'C',
    });

    return this.toListResponse(result, '장소 검색 결과를 조회했습니다.');
  }

  async findOne(contentId: string) {
    const [common, images, petInfo] = await Promise.all([
      this.request('detailCommon2', {
        contentId,
        pageNo: '1',
        numOfRows: '1',
      }),
      this.request('detailImage2', {
        contentId,
        pageNo: '1',
        numOfRows: '10',
      }),
      this.request('detailPetTour2', {
        contentId,
        pageNo: '1',
        numOfRows: '1',
      }),
    ]);
    const commonItem = common.items[0] ?? {};
    const petInfoItem = petInfo.items[0] ?? {};

    return {
      message: '장소 상세 정보를 조회했습니다.',
      place: {
        ...this.normalizePlace(commonItem),
        overview: this.getString(commonItem.overview),
        homepage: this.getString(commonItem.homepage),
        images: images.items.map((image) => ({
          originUrl: this.normalizeExternalAssetUrl(image.originimgurl),
          thumbnailUrl: this.normalizeExternalAssetUrl(image.smallimageurl),
          imageName: this.getString(image.imgname),
          serialNumber: this.getString(image.serialnum),
        })),
        petInfo: {
          acmpyTypeCd: this.getString(petInfoItem.acmpyTypeCd),
          acmpyPsblCpam: this.getString(petInfoItem.acmpyPsblCpam),
          acmpyNeedMtr: this.getString(petInfoItem.acmpyNeedMtr),
          relaAcdntRiskMtr: this.getString(petInfoItem.relaAcdntRiskMtr),
          relaPosesFclty: this.getString(petInfoItem.relaPosesFclty),
          relaFrnshPrdlst: this.getString(petInfoItem.relaFrnshPrdlst),
          relaPurcPrdlst: this.getString(petInfoItem.relaPurcPrdlst),
          relaRntlPrdlst: this.getString(petInfoItem.relaRntlPrdlst),
          etcAcmpyInfo: this.getString(petInfoItem.etcAcmpyInfo),
        },
      },
    };
  }

  private async request(
    endpoint: string,
    params: Record<string, string | undefined>,
  ): Promise<TourApiResult> {
    const serviceKey = this.configService.get<string>('TOUR_API_SERVICE_KEY');

    if (!serviceKey) {
      throw new ServiceUnavailableException(
        'TOUR_API_SERVICE_KEY가 설정되어 있지 않습니다.',
      );
    }

    const searchParams = new URLSearchParams({
      MobileOS: this.mobileOs,
      MobileApp: this.mobileApp,
      _type: 'json',
    });

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') {
        searchParams.set(key, value);
      }
    }

    const url = `${this.baseUrl.replace(/\/$/, '')}/${endpoint}?serviceKey=${serviceKey}&${searchParams.toString()}`;
    let response: Response;

    try {
      response = await fetch(url, {
        signal: AbortSignal.timeout(this.getTourApiTimeoutMs()),
      });
    } catch {
      throw new BadGatewayException(
        'TourAPI 호출 시간이 초과되었거나 실패했습니다.',
      );
    }

    const text = await response.text();

    if (!response.ok) {
      throw new BadGatewayException('TourAPI 호출에 실패했습니다.');
    }

    const payload = this.parseJson(text);
    const body = this.extractBody(payload);
    const resultCode = this.getString(payload.response?.header?.resultCode);
    const resultMessage = this.getString(payload.response?.header?.resultMsg);

    if (resultCode && !['0000', '00'].includes(resultCode)) {
      if (resultCode === '03') {
        return {
          items: [],
          page: Number(body?.pageNo ?? params.pageNo ?? 1),
          limit: Number(body?.numOfRows ?? params.numOfRows ?? 10),
          totalCount: 0,
        };
      }

      throw new BadGatewayException(
        `TourAPI 오류: ${resultMessage || resultCode}`,
      );
    }

    return {
      items: this.extractItems(body),
      page: Number(body?.pageNo ?? params.pageNo ?? 1),
      limit: Number(body?.numOfRows ?? params.numOfRows ?? 10),
      totalCount: Number(body?.totalCount ?? 0),
    };
  }

  private toListResponse(result: TourApiResult, message: string) {
    return {
      message,
      items: result.items.map((item) => this.normalizePlace(item)),
      page: result.page,
      limit: result.limit,
      totalCount: result.totalCount,
      totalPages: Math.ceil(result.totalCount / result.limit),
    };
  }

  private normalizePlace(item: TourApiItem) {
    return {
      contentId: this.getString(item.contentid),
      contentTypeId: this.getString(item.contenttypeid),
      title: this.getString(item.title),
      address: [this.getString(item.addr1), this.getString(item.addr2)]
        .filter(Boolean)
        .join(' '),
      addr1: this.getString(item.addr1),
      addr2: this.getString(item.addr2),
      zipcode: this.getString(item.zipcode),
      tel: this.getString(item.tel),
      mapX: this.getString(item.mapx),
      mapY: this.getString(item.mapy),
      distance: this.getString(item.dist),
      firstImage: this.normalizeExternalAssetUrl(item.firstimage),
      firstImage2: this.normalizeExternalAssetUrl(item.firstimage2),
      copyrightType: this.getString(item.cpyrhtDivCd),
      areaCode: this.getString(item.areacode),
      sigunguCode: this.getString(item.sigungucode),
      lDongRegnCd: this.getString(item.lDongRegnCd),
      lDongSignguCd: this.getString(item.lDongSignguCd),
      lclsSystm1: this.getString(item.lclsSystm1),
      lclsSystm2: this.getString(item.lclsSystm2),
      lclsSystm3: this.getString(item.lclsSystm3),
    };
  }

  private parseJson(text: string): TourApiEnvelope {
    try {
      const parsed = JSON.parse(text) as unknown;

      if (!this.isRecord(parsed)) {
        throw new BadGatewayException('TourAPI 응답을 해석할 수 없습니다.');
      }

      return parsed;
    } catch {
      throw new BadGatewayException('TourAPI 응답을 해석할 수 없습니다.');
    }
  }

  private extractBody(payload: TourApiEnvelope): TourApiBody {
    return payload.response?.body ?? {};
  }

  private extractItems(body: TourApiBody): TourApiItem[] {
    const items = body.items;

    if (!this.isRecord(items)) {
      return [];
    }

    const item = items.item;

    if (!item) {
      return [];
    }

    if (Array.isArray(item)) {
      return item.filter((entry): entry is TourApiItem => this.isRecord(entry));
    }

    return this.isRecord(item) ? [item] : [];
  }

  private getString(value: unknown): string {
    if (value === undefined || value === null) {
      return '';
    }

    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint'
    ) {
      return String(value);
    }

    return '';
  }

  private normalizeExternalAssetUrl(value: unknown): string {
    const url = this.getString(value);

    if (url.startsWith('http://tong.visitkorea.or.kr/')) {
      return url.replace('http://', 'https://');
    }

    return url;
  }

  private getTourApiTimeoutMs() {
    const timeoutMs = Number(
      this.configService.get<string>('TOUR_API_TIMEOUT_MS'),
    );

    return Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 10000;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }
}
