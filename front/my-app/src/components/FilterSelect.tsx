type FilterSelectProps = {
  label: string
  options: string[]
  value: string
  onChange: (value: string) => void
}

import '../styles/components/FilterSelect.css'

export function FilterSelect({
  label,
  options,
  value,
  onChange,
}: FilterSelectProps) {
  return (
    <label className="filter-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">전체</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  )
}
