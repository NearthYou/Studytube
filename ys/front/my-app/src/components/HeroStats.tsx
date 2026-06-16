import type { ReactNode } from 'react'

export type HeroStatItem = {
  label: string
  value: ReactNode
}

type HeroStatsProps = {
  items: HeroStatItem[]
  className: string
  itemClassName: string
}

export function HeroStats({ items, className, itemClassName }: HeroStatsProps) {
  return (
    <div className={className}>
      {items.map((item) => (
        <article className={itemClassName} key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </article>
      ))}
    </div>
  )
}
