export type BackendPetPlace = {
  contentId: string
  contentTypeId: string
  title: string
  address?: string
  addr1?: string
  addr2?: string
  zipcode?: string
  tel?: string
  mapX?: string
  mapY?: string
  distance?: string
  firstImage?: string
  firstImage2?: string
  copyrightType?: string
}

export type BackendPetPlaceDetail = BackendPetPlace & {
  overview?: string
  homepage?: string
  images?: Array<{
    originUrl: string
    thumbnailUrl: string
    imageName: string
    serialNumber: string
  }>
  petInfo?: {
    acmpyTypeCd?: string
    acmpyPsblCpam?: string
    acmpyNeedMtr?: string
    relaAcdntRiskMtr?: string
    relaPosesFclty?: string
    relaFrnshPrdlst?: string
    relaPurcPrdlst?: string
    relaRntlPrdlst?: string
    etcAcmpyInfo?: string
  }
}

export type PetPlace = {
  contentId: string
  contentTypeId: string
  title: string
  address: string
  addr1: string
  addr2: string
  zipcode: string
  tel: string
  mapX: string
  mapY: string
  distance: string
  firstImage: string
  firstImage2: string
  copyrightType: string
}

export type PetPlaceDetail = PetPlace & {
  overview: string
  homepage: string
  images: Array<{
    originUrl: string
    thumbnailUrl: string
    imageName: string
    serialNumber: string
  }>
  petInfo: {
    acmpyTypeCd: string
    acmpyPsblCpam: string
    acmpyNeedMtr: string
    relaAcdntRiskMtr: string
    relaPosesFclty: string
    relaFrnshPrdlst: string
    relaPurcPrdlst: string
    relaRntlPrdlst: string
    etcAcmpyInfo: string
  }
}

export function toPetPlace(place: BackendPetPlace): PetPlace {
  return {
    contentId: place.contentId,
    contentTypeId: place.contentTypeId,
    title: place.title,
    address: place.address ?? place.addr1 ?? '',
    addr1: place.addr1 ?? '',
    addr2: place.addr2 ?? '',
    zipcode: place.zipcode ?? '',
    tel: place.tel ?? '',
    mapX: place.mapX ?? '',
    mapY: place.mapY ?? '',
    distance: place.distance ?? '',
    firstImage: place.firstImage ?? '',
    firstImage2: place.firstImage2 ?? '',
    copyrightType: place.copyrightType ?? '',
  }
}

export function toPetPlaceDetail(place: BackendPetPlaceDetail): PetPlaceDetail {
  const petInfo = place.petInfo ?? {}

  return {
    ...toPetPlace(place),
    overview: place.overview ?? '',
    homepage: place.homepage ?? '',
    images: place.images ?? [],
    petInfo: {
      acmpyTypeCd: petInfo.acmpyTypeCd ?? '',
      acmpyPsblCpam: petInfo.acmpyPsblCpam ?? '',
      acmpyNeedMtr: petInfo.acmpyNeedMtr ?? '',
      relaAcdntRiskMtr: petInfo.relaAcdntRiskMtr ?? '',
      relaPosesFclty: petInfo.relaPosesFclty ?? '',
      relaFrnshPrdlst: petInfo.relaFrnshPrdlst ?? '',
      relaPurcPrdlst: petInfo.relaPurcPrdlst ?? '',
      relaRntlPrdlst: petInfo.relaRntlPrdlst ?? '',
      etcAcmpyInfo: petInfo.etcAcmpyInfo ?? '',
    },
  }
}
