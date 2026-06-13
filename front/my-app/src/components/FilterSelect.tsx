import type { LookupOption } from '../types/community'
import '../styles/components/FilterSelect.css'

type FilterSelectProps = {
  label: string
  options: LookupOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

export function FilterSelect({
  label,
  options,
  value,
  onChange,
  placeholder = 'All',
}: FilterSelectProps) {
  return (
    <label className="filter-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}
