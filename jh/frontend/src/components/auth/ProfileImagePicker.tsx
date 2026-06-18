import { useEffect, useState } from 'react'
import type { ChangeEvent } from 'react'
import { ImagePlus, X } from 'lucide-react'

type ProfileImagePickerProps = {
  image: File | null
  onChange: (image: File | null) => void
  onStatusChange: (message: string) => void
}

const maxProfileImageSize = 5 * 1024 * 1024

export function ProfileImagePicker({ image, onChange, onStatusChange }: ProfileImagePickerProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl)
      }
    }
  }, [previewUrl])

  const handleImageChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    if (!file.type.startsWith('image/')) {
      onStatusChange('이미지 파일만 첨부할 수 있습니다.')
      event.target.value = ''
      return
    }

    if (file.size > maxProfileImageSize) {
      onStatusChange('프로필 사진은 5MB 이하만 첨부할 수 있습니다.')
      event.target.value = ''
      return
    }

    setPreviewUrl(URL.createObjectURL(file))
    onChange(file)
    onStatusChange('')
  }

  const handleImageRemove = () => {
    setPreviewUrl(null)
    onChange(null)
    onStatusChange('')
  }

  return (
    <div className="profile-frame-box">
      <div className="profile-frame">
        {previewUrl ? <img src={previewUrl} alt="" /> : <span>사진</span>}
      </div>
      <div className="profile-upload-copy">
        <strong>프로필 사진</strong>
        <p>가입 후에도 변경할 수 있는 임시 이미지 자리입니다.</p>
        <div className="profile-upload-actions">
          <label className="profile-upload-button">
            <ImagePlus size={15} aria-hidden="true" />
            <span>{image ? '사진 변경' : '사진 선택'}</span>
            <input type="file" accept="image/*" onChange={handleImageChange} />
          </label>
          {image && (
            <button className="profile-remove-button" type="button" onClick={handleImageRemove}>
              <X size={14} aria-hidden="true" />
              <span>삭제</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
