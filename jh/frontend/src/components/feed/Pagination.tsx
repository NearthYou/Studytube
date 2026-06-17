type PaginationProps = {
  currentPage: number
  getPageHref: (page: number) => string
  pageCount: number
}

export function Pagination({ currentPage, getPageHref, pageCount }: PaginationProps) {
  const pages = Array.from({ length: pageCount }, (_, index) => index + 1)
  const previousPage = Math.max(1, currentPage - 1)
  const nextPage = Math.min(pageCount, currentPage + 1)

  return (
    <nav className="pagination" aria-label="게시글 페이지">
      {currentPage === 1 ? (
        <span className="ui-button ui-button--subtle pagination-button is-disabled" aria-disabled="true">
          ‹
        </span>
      ) : (
        <a className="ui-button ui-button--subtle pagination-button" href={getPageHref(previousPage)} aria-label="이전 페이지">
          ‹
        </a>
      )}
      {pages.map((page) => (
        page === currentPage ? (
          <span
            className="ui-button ui-button--subtle pagination-button is-active"
            aria-label={`${page}페이지`}
            aria-current="page"
            key={page}
          >
            {page}
          </span>
        ) : (
          <a className="ui-button ui-button--subtle pagination-button" href={getPageHref(page)} aria-label={`${page}페이지`} key={page}>
            {page}
          </a>
        )
      ))}
      {currentPage === pageCount ? (
        <span className="ui-button ui-button--subtle pagination-button is-disabled" aria-disabled="true">
          ›
        </span>
      ) : (
        <a className="ui-button ui-button--subtle pagination-button" href={getPageHref(nextPage)} aria-label="다음 페이지">
          ›
        </a>
      )}
    </nav>
  )
}
