type PostCategoryOption = {
  key: string
  label: string
  value: string
}

type PostFormFieldsProps = {
  categoryOptions: PostCategoryOption[]
  content: string
  selectedCategoryId: string
  title: string
  onCategoryChange: (value: string) => void
  onContentChange: (value: string) => void
  onTitleChange: (value: string) => void
}

export function PostFormFields({
  categoryOptions,
  content,
  selectedCategoryId,
  title,
  onCategoryChange,
  onContentChange,
  onTitleChange,
}: PostFormFieldsProps) {
  return (
    <>
      <label className="field-group" htmlFor="post-title">
        <span>제목</span>
        <input
          id="post-title"
          type="text"
          value={title}
          placeholder="게시글 제목 입력"
          onChange={(event) => onTitleChange(event.target.value)}
        />
      </label>

      <label className="field-group" htmlFor="post-body">
        <span>본문</span>
        <textarea
          id="post-body"
          value={content}
          placeholder="동물 친구의 오늘 이야기를 적어주세요."
          rows={8}
          onChange={(event) => onContentChange(event.target.value)}
        />
      </label>

      <label className="field-group" htmlFor="post-category">
        <span>카테고리</span>
        <select id="post-category" value={selectedCategoryId} onChange={(event) => onCategoryChange(event.target.value)}>
          {categoryOptions.map((category) => (
            <option value={category.value} key={category.key}>
              {category.label}
            </option>
          ))}
        </select>
      </label>
    </>
  )
}
