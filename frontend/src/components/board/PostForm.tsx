import { usePostForm } from '../../hooks/usePostForm'
import type { Post } from '../../types/post'
import { PostFormActions } from './PostFormActions'
import { PostFormFields } from './PostFormFields'
import { PostFormGuide } from './PostFormGuide'
import { PostImageUploader } from './PostImageUploader'
import { PostTagInput } from './PostTagInput'

type PostFormProps = {
  mode: 'create' | 'edit'
  onError?: (message: string) => void
  post?: Post
}

export function PostForm({ mode, onError, post }: PostFormProps) {
  const isEditMode = mode === 'edit'
  const {
    categoryOptions,
    content,
    existingImages,
    formStatus,
    guideCategory,
    isCategoryReady,
    isSubmitting,
    pendingImages,
    selectedCategoryId,
    tagNames,
    title,
    handleImageSelect,
    handleSubmit,
    removeExistingImage,
    removePendingImage,
    setContent,
    setSelectedCategoryId,
    setTagNames,
    setTitle,
  } = usePostForm({ mode, onError, post })

  return (
    <section className="board-panel post-form-panel" aria-labelledby="post-form-title">
      <div className="board-panel-heading">
        <p className="feed-kicker">{isEditMode ? '게시글 수정' : '새 게시글 작성'}</p>
        <h1 id="post-form-title">{isEditMode ? '사진과 이야기를 다듬기' : '오늘의 동물 일상 남기기'}</h1>
      </div>

      <form className="post-editor-form" onSubmit={handleSubmit}>
        <PostImageUploader
          existingImages={existingImages}
          pendingImages={pendingImages}
          onFileSelect={handleImageSelect}
          onRemoveExistingImage={removeExistingImage}
          onRemovePendingImage={removePendingImage}
        />

        <PostFormFields
          categoryOptions={categoryOptions}
          content={content}
          selectedCategoryId={selectedCategoryId}
          title={title}
          onCategoryChange={setSelectedCategoryId}
          onContentChange={setContent}
          onTitleChange={setTitle}
        />

        <PostTagInput tagNames={tagNames} onChange={setTagNames} />

        <PostFormGuide category={guideCategory} />

        <PostFormActions
          isCategoryReady={isCategoryReady}
          isEditMode={isEditMode}
          isSubmitting={isSubmitting}
          post={post}
        />
        {formStatus && (
          <p className="form-status" role="status">
            {formStatus}
          </p>
        )}
      </form>
    </section>
  )
}
