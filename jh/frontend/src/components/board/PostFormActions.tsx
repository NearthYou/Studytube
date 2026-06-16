import { CheckCircle2, X } from 'lucide-react'
import type { Post } from '../../types/post'
import { appPaths } from '../../utils/paths'

type PostFormActionsProps = {
  isCategoryReady: boolean
  isEditMode: boolean
  isSubmitting: boolean
  post?: Post
}

export function PostFormActions({ isCategoryReady, isEditMode, isSubmitting, post }: PostFormActionsProps) {
  return (
    <div className="form-action-row">
      <a className="ui-button ui-button--ghost ghost-action-button" href={post ? appPaths.postDetail(post.id) : appPaths.home}>
        <X size={16} aria-hidden="true" />
        <span>취소</span>
      </a>
      <button className="ui-button ui-button--primary primary-login-button" type="submit" disabled={isSubmitting || !isCategoryReady}>
        <CheckCircle2 size={16} aria-hidden="true" />
        <span>{isEditMode ? '수정 완료' : '등록하기'}</span>
      </button>
    </div>
  )
}
