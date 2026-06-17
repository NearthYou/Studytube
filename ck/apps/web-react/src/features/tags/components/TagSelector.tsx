import type { TagOption } from "../types";
import "./tag-selector.css";

type TagSelectorProps = {
  tags: TagOption[];
  selectedTagIds: string[];
  isLoading?: boolean;
  error?: string;
  onChange: (tagIds: string[]) => void;
};

export default function TagSelector({
  tags,
  selectedTagIds,
  isLoading = false,
  error = "",
  onChange,
}: TagSelectorProps) {
  const selectedTagIdSet = new Set(selectedTagIds);

  function toggleTag(tagId: string) {
    if (selectedTagIdSet.has(tagId)) {
      onChange(selectedTagIds.filter((selectedTagId) => selectedTagId !== tagId));
      return;
    }

    onChange([...selectedTagIds, tagId]);
  }

  return (
    <div className="tag-selector">
      {isLoading ? <p className="tag-selector-message">태그를 불러오는 중입니다.</p> : null}
      {error ? <p className="tag-selector-message tag-selector-message--error">{error}</p> : null}
      {!isLoading && !error && tags.length === 0 ? (
        <p className="tag-selector-message">선택할 수 있는 태그가 없습니다.</p>
      ) : null}
      <div className="tag-selector-options">
        {tags.map((tag) => (
          <button
            key={tag.id}
            className="tag-selector-chip"
            type="button"
            aria-pressed={selectedTagIdSet.has(tag.id)}
            onClick={() => toggleTag(tag.id)}
          >
            <span>{tag.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
