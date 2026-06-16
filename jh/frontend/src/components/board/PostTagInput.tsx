import { X } from 'lucide-react'
import { usePostTagInput } from '../../hooks/usePostTagInput'

type PostTagInputProps = {
  tagNames: string[]
  onChange: (tagNames: string[]) => void
}

export function PostTagInput({ tagNames, onChange }: PostTagInputProps) {
  const {
    draft,
    handleDraftBlur,
    handleDraftChange,
    handleDraftCompositionEnd,
    handleDraftCompositionStart,
    handleDraftKeyDown,
    removeTag,
    status,
  } = usePostTagInput({
    onChange,
    tagNames,
  })

  return (
    <div className="field-group post-tag-field">
      <label htmlFor="post-tags">태그</label>
      <div className="post-tag-input-shell">
        <div className="post-tag-list">
          {tagNames.map((tagName) => (
            <button
              className="post-tag-chip post-tag-chip--button"
              type="button"
              key={tagName}
              onClick={() => removeTag(tagName)}
            >
              <span>#{tagName}</span>
              <X size={13} aria-hidden="true" />
            </button>
          ))}
        </div>
        <input
          id="post-tags"
          type="text"
          value={draft}
          placeholder="태그 입력"
          onBlur={handleDraftBlur}
          onChange={handleDraftChange}
          onCompositionEnd={handleDraftCompositionEnd}
          onCompositionStart={handleDraftCompositionStart}
          onKeyDown={handleDraftKeyDown}
        />
      </div>
      {status && (
        <small className="post-tag-status" role="status">
          {status}
        </small>
      )}
    </div>
  )
}
