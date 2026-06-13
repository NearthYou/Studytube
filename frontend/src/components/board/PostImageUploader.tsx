import { useEffect, useState } from 'react'
import { ImagePlus, X } from 'lucide-react'
import type { Post } from '../../types/post'
import { SafeImage } from '../common/SafeImage'

type PostImageUploaderProps = {
  existingImages: Post['images']
  pendingImages: File[]
  onFileSelect: (files: File[]) => void
  onRemoveExistingImage: (imageId: string) => void
  onRemovePendingImage: (imageIndex: number) => void
}

export function PostImageUploader({
  existingImages,
  pendingImages,
  onFileSelect,
  onRemoveExistingImage,
  onRemovePendingImage,
}: PostImageUploaderProps) {
  const hasPreviewImages = existingImages.length > 0 || pendingImages.length > 0

  return (
    <div className="image-upload-frame">
      <ImagePlus size={36} strokeWidth={1.8} aria-hidden="true" />
      <span>사진 업로드</span>
      <p>jpg, png, webp 이미지를 1장만 첨부할 수 있습니다.</p>
      <label className="ui-button ui-button--secondary secondary-action-button image-picker-button">
        <span>사진 선택</span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(event) => {
            onFileSelect(Array.from(event.target.files ?? []))
            event.target.value = ''
          }}
        />
      </label>

      {hasPreviewImages && (
        <div className="post-image-preview-list">
          {existingImages.map((image) => (
            <button
              className="post-image-preview"
              type="button"
              key={image.id}
              onClick={() => onRemoveExistingImage(image.id)}
              aria-label={`${image.originalFilename} 제거`}
            >
              <SafeImage src={image.url} alt="" fallbackAlt="Tail Talk 기본 게시글 이미지" />
              <X size={14} aria-hidden="true" />
            </button>
          ))}
          {pendingImages.map((image, index) => (
            <PendingImagePreview
              image={image}
              imageIndex={index}
              key={`${image.name}-${image.lastModified}-${image.size}`}
              onRemove={onRemovePendingImage}
            />
          ))}
        </div>
      )}
    </div>
  )
}

type PendingImagePreviewProps = {
  image: File
  imageIndex: number
  onRemove: (imageIndex: number) => void
}

function PendingImagePreview({ image, imageIndex, onRemove }: PendingImagePreviewProps) {
  const previewUrl = useObjectUrl(image)

  return (
    <button
      className="post-image-preview"
      type="button"
      onClick={() => onRemove(imageIndex)}
      aria-label={`${image.name} 제거`}
    >
      {previewUrl && <SafeImage src={previewUrl} alt="" fallbackAlt="Tail Talk 기본 게시글 이미지" />}
      <X size={14} aria-hidden="true" />
    </button>
  )
}

function useObjectUrl(file: File) {
  const [objectUrl] = useState(() => URL.createObjectURL(file))

  useEffect(() => {
    return () => {
      URL.revokeObjectURL(objectUrl)
    }
  }, [objectUrl])

  return objectUrl
}
