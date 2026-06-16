import { CircleHelp, Footprints, HeartPulse, Home, MapPinned, PawPrint } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Category, CategoryValue } from '../../types/category'
import { appPaths } from '../../utils/paths'
import { AssistantLauncher } from './AssistantLauncher'

type SidebarProps = {
  activeCategoryId: string | null
  activeCategoryValue: CategoryValue
  layoutVariant: 'feed' | 'board'
  menuItems: Category[]
}

const categoryIcons: Record<CategoryValue, LucideIcon> = {
  all: Home,
  daily: PawPrint,
  walk: Footprints,
  care: HeartPulse,
  question: CircleHelp,
}

export function Sidebar({ activeCategoryId, activeCategoryValue, layoutVariant, menuItems }: SidebarProps) {
  const isHomeRoute = window.location.pathname === appPaths.home
  const isPetPlacesActive = window.location.pathname.startsWith(appPaths.petPlaces)

  return (
    <aside className="sidebar" aria-label="주요 메뉴">
      <nav className="sidebar-nav">
        {menuItems.map((item) => {
          const Icon = categoryIcons[item.value]
          const isActive =
            isHomeRoute &&
            (activeCategoryId ? item.id === activeCategoryId : item.value === activeCategoryValue)

          return (
            <a
              className={isActive ? 'sidebar-link is-active' : 'sidebar-link'}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              key={item.value}
            >
              <Icon className="sidebar-link-icon" size={18} strokeWidth={2.2} aria-hidden="true" />
              <span className="sidebar-label-full">{item.label}</span>
              <span className="sidebar-label-mobile">{item.mobileLabel}</span>
            </a>
          )
        })}
        <a
          className={isPetPlacesActive ? 'sidebar-link is-active' : 'sidebar-link'}
          href={appPaths.petPlaces}
          aria-current={isPetPlacesActive ? 'page' : undefined}
        >
          <MapPinned className="sidebar-link-icon" size={18} strokeWidth={2.2} aria-hidden="true" />
          <span className="sidebar-label-full">동반 장소</span>
          <span className="sidebar-label-mobile">장소</span>
        </a>
      </nav>
      <AssistantLauncher layoutVariant={layoutVariant} />
    </aside>
  )
}
