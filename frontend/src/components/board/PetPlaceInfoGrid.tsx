import type { PetPlaceDetail } from '../../api/petPlaces'

type PetPlaceInfoGridProps = {
  petInfo: PetPlaceDetail['petInfo']
}

const petInfoItems: Array<{
  key: keyof PetPlaceDetail['petInfo']
  label: string
}> = [
  { key: 'acmpyPsblCpam', label: '동반 가능 동물' },
  { key: 'acmpyTypeCd', label: '동반 유형' },
  { key: 'acmpyNeedMtr', label: '필요 사항' },
  { key: 'relaAcdntRiskMtr', label: '주의 사항' },
  { key: 'relaPosesFclty', label: '구비 시설' },
  { key: 'etcAcmpyInfo', label: '기타 정보' },
]

export function PetPlaceInfoGrid({ petInfo }: PetPlaceInfoGridProps) {
  return (
    <div className="pet-info-grid">
      {petInfoItems.map(({ key, label }) => (
        <PetPlaceInfoItem key={key} label={label} value={petInfo[key]} />
      ))}
    </div>
  )
}

function PetPlaceInfoItem({ label, value }: { label: string; value: string }) {
  if (!value) return null

  return (
    <article className="pet-info-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  )
}
