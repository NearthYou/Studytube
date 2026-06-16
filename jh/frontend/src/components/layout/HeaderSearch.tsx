import { Search } from 'lucide-react'
import type { FormEvent } from 'react'
import { navigate } from '../../utils/navigation'
import { appPaths } from '../../utils/paths'

export function HeaderSearch() {
  const currentKeyword = new URLSearchParams(window.location.search).get('q') ?? ''

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const keyword = String(formData.get('keyword') ?? '').trim()
    const nextParams = new URLSearchParams(window.location.search)

    nextParams.delete('page')

    if (!keyword) {
      nextParams.delete('q')
      const queryString = nextParams.toString()
      navigate(queryString ? `${appPaths.home}?${queryString}` : appPaths.home)
      return
    }

    nextParams.set('q', keyword)
    navigate(`${appPaths.home}?${nextParams.toString()}`)
  }

  return (
    <form className="header-search" role="search" onSubmit={handleSearch}>
      <label className="search-label" htmlFor="header-search">
        게시글 검색
      </label>
      <Search className="search-icon" size={18} aria-hidden="true" />
      <input
        className="search-field"
        defaultValue={currentKeyword}
        id="header-search"
        name="keyword"
        placeholder="동물 이름이나 게시글 검색"
        type="search"
      />
    </form>
  )
}
