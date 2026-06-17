import type { ReviewDraftPayload } from "../types"

type DraftPayloadPreviewProps = {
  payload: ReviewDraftPayload | null
}

export default function DraftPayloadPreview({ payload }: DraftPayloadPreviewProps) {
  if (!payload) {
    return null
  }

  return (
    <section>
      <h2>나중에 API로 보낼 값</h2>
      <pre>{JSON.stringify(payload, null, 2)}</pre>
    </section>
  )
}
