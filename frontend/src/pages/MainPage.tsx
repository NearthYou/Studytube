import { PostGrid } from '../components/feed/PostGrid'
import { FeedHeader } from '../components/feed/FeedHeader'
import { Pagination } from '../components/feed/Pagination'
import { FeedbackModal } from '../components/common/FeedbackModal'
import { AppLayout } from '../components/layout/AppLayout'
import { useFeedbackModal } from '../hooks/useFeedbackModal'
import { useFeed } from '../hooks/useFeed'

export function MainPage() {
  const { closeModal, modalMessage, openErrorModal } = useFeedbackModal()
  const {
    currentPage,
    feedHeaderCopy,
    feedTitle,
    getPageHref,
    getSortHref,
    pageCount,
    posts,
    sort,
    status,
    totalCount,
  } = useFeed({ onError: openErrorModal })

  return (
    <AppLayout variant="feed">
      <FeedHeader
        copy={feedHeaderCopy}
        title={feedTitle}
        count={totalCount}
        sort={sort}
        getSortHref={getSortHref}
      />
      {status ? (
        <section className="feed-empty-state" aria-live="polite">
          <p>{status}</p>
        </section>
      ) : (
        <>
          <PostGrid
            emptyPrompt={feedHeaderCopy.prompt}
            emptyTitle={feedTitle}
            posts={posts}
          />
          {posts.length > 0 && <Pagination currentPage={currentPage} getPageHref={getPageHref} pageCount={pageCount} />}
        </>
      )}
      {modalMessage && <FeedbackModal message={modalMessage} onClose={closeModal} />}
    </AppLayout>
  )
}
