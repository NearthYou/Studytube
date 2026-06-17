import TagSelector from "../../tags/components/TagSelector"
import type { TagOption } from "../../tags/types"

type ReviewTagPanelProps = {
  error: string
  isLoading: boolean
  onChange: (tagIds: string[]) => void
  selectedTagIds: string[]
  tags: TagOption[]
}

export default function ReviewTagPanel({
  error,
  isLoading,
  onChange,
  selectedTagIds,
  tags,
}: ReviewTagPanelProps) {
  return (
    <section className="review-create-panel">
      <h2 className="review-create-section-title">태그</h2>
      <TagSelector
        error={error}
        isLoading={isLoading}
        onChange={onChange}
        selectedTagIds={selectedTagIds}
        tags={tags}
      />
    </section>
  )
}
