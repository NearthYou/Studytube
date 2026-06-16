import type { ReactNode } from 'react'
import { AuthModalHost } from '../auth/AuthModalHost'
import { categories, getActiveCategory } from '../../data/categories'
import { useCategories } from '../../hooks/useCategories'
import { Header } from './Header'
import { Sidebar } from './Sidebar'

type AppLayoutProps = {
  children: ReactNode
  mainClassName?: string
  variant?: 'feed' | 'board' | 'auth'
}

export function AppLayout({ children, mainClassName = '', variant = 'feed' }: AppLayoutProps) {
  const mainClassNames = ['main-content', `main-content--${variant}`, mainClassName].filter(Boolean).join(' ')
  const { categories: menuItems } = useCategories({ enabled: variant !== 'auth', includeHome: true })
  const searchParams = new URLSearchParams(window.location.search)
  const activeCategoryId = searchParams.get('categoryId')
  const activeCategory = activeCategoryId
    ? menuItems.find((category) => category.id === activeCategoryId) ?? categories[0]
    : getActiveCategory(searchParams.get('category'))

  return (
    <div className={`app-shell app-shell--${variant}`}>
      <a className="skip-link" href="#main-content">
        본문으로 건너뛰기
      </a>
      <Header variant={variant} />
      {variant !== 'auth' && (
        <Sidebar
          activeCategoryId={activeCategoryId}
          activeCategoryValue={activeCategory.value}
          menuItems={menuItems}
          layoutVariant={variant}
        />
      )}

      <main className={mainClassNames} id="main-content" tabIndex={-1}>
        {children}
      </main>
      <AuthModalHost />
    </div>
  )
}
