type PetPlaceSearchFormProps = {
  contentTypeId: string
  isLoading: boolean
  onChangeContentTypeId: (value: string) => void
  onChangeRadius: (value: number) => void
  radius: number
}

const contentTypes = [
  { label: '전체', value: '' },
  { label: '관광지', value: '12' },
  { label: '문화시설', value: '14' },
  { label: '레포츠', value: '28' },
  { label: '숙박', value: '32' },
  { label: '쇼핑', value: '38' },
  { label: '음식점', value: '39' },
]

const radiusOptions = [
  { label: '1km', value: 1000 },
  { label: '3km', value: 3000 },
  { label: '5km', value: 5000 },
  { label: '10km', value: 10000 },
]

export function PetPlaceSearchForm({
  contentTypeId,
  isLoading,
  onChangeContentTypeId,
  onChangeRadius,
  radius,
}: PetPlaceSearchFormProps) {
  return (
    <div className="pet-place-search" aria-label="동반 장소 검색 조건">
      <label className="field-group" htmlFor="pet-place-content-type">
        <span>유형</span>
        <select
          id="pet-place-content-type"
          value={contentTypeId}
          onChange={(event) => onChangeContentTypeId(event.target.value)}
          disabled={isLoading}
        >
          {contentTypes.map((type) => (
            <option value={type.value} key={type.value}>
              {type.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field-group" htmlFor="pet-place-radius">
        <span>검색 반경</span>
        <select
          id="pet-place-radius"
          value={radius}
          onChange={(event) => onChangeRadius(Number(event.target.value))}
          disabled={isLoading}
        >
          {radiusOptions.map((option) => (
            <option value={option.value} key={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
