import type { SeatLocationDraft, TheaterSeatLayout } from "../types"

type SeatLocationFieldsProps = {
  value: SeatLocationDraft
  layout: TheaterSeatLayout
  disabled?: boolean
  onChange: (value: SeatLocationDraft) => void
}

function getToggleStyle(isSelected: boolean, isDisabled: boolean) {
  return {
    marginRight: 8,
    marginBottom: 8,
    padding: "8px 12px",
    border: "1px solid #111827",
    borderRadius: 6,
    background: isSelected ? "#111827" : "#ffffff",
    color: isSelected ? "#ffffff" : "#111827",
    cursor: isDisabled ? "not-allowed" : "pointer",
    opacity: isDisabled ? 0.5 : 1,
  }
}

function hasOfficialSections(layout: TheaterSeatLayout) {
  return Object.values(layout.sectionsByFloor).some((sections) => sections.length > 0)
}

export default function SeatLocationFields({
  value,
  layout,
  disabled = false,
  onChange,
}: SeatLocationFieldsProps) {
  const sections = value.seatFloor ? layout.sectionsByFloor[value.seatFloor] ?? [] : []
  const shouldShowOfficialSections = hasOfficialSections(layout)

  return (
    <section>
      <fieldset style={{ marginBottom: 16 }}>
        <legend>층</legend>
        {layout.floors.map((floor) => (
          <button
            key={floor.value}
            type="button"
            aria-pressed={value.seatFloor === floor.value}
            disabled={disabled}
            style={getToggleStyle(value.seatFloor === floor.value, disabled)}
            onClick={() => onChange({ ...value, seatFloor: floor.value, seatSection: "" })}
          >
            {floor.label}
          </button>
        ))}
      </fieldset>

      {shouldShowOfficialSections ? (
        <fieldset style={{ marginBottom: 16 }}>
          <legend>구역</legend>
          {sections.length > 0 ? (
            sections.map((section) => (
              <button
                key={section.value}
                type="button"
                aria-pressed={value.seatSection === section.value}
                disabled={disabled}
                style={getToggleStyle(value.seatSection === section.value, disabled)}
                onClick={() => onChange({ ...value, seatSection: section.value })}
              >
                {section.label}
              </button>
            ))
          ) : disabled ? (
            <p>공연장을 먼저 선택하세요.</p>
          ) : (
            <p>층을 먼저 선택하세요.</p>
          )}
        </fieldset>
      ) : (
        <p>공식 구역 정보가 없는 공연장입니다.</p>
      )}

      <label>
        열
        <input
          value={value.seatRow}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, seatRow: event.target.value })}
          placeholder="F 또는 1"
        />
      </label>

      <label>
        번호
        <input
          value={value.seatNumber}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, seatNumber: event.target.value })}
          placeholder="18"
        />
      </label>
    </section>
  )
}
