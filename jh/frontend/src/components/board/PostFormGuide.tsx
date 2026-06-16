import type { Category } from '../../types/category'

type PostFormGuideProps = {
  category: Category
}

export function PostFormGuide({ category }: PostFormGuideProps) {
  return (
    <aside className="post-form-guide" aria-label="작성 안내">
      <strong>{category.label} 글쓰기 팁</strong>
      <p>{category.prompt}</p>
      <span>{category.trustHint}</span>
    </aside>
  )
}
