import type { ImgHTMLAttributes, SyntheticEvent } from 'react'
import tailTalkLogo from '../../assets/tail_talk_logo.png'

type SafeImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  fallbackAlt?: string
  src?: string | null
}

export function SafeImage({
  alt = '',
  className = '',
  fallbackAlt = 'Tail Talk 기본 이미지',
  onError,
  src,
  ...props
}: SafeImageProps) {
  const imageSrc = src || tailTalkLogo
  const imageAlt = src ? alt : fallbackAlt

  const handleError = (event: SyntheticEvent<HTMLImageElement>) => {
    onError?.(event)

    const image = event.currentTarget

    if (image.dataset.fallbackApplied === 'true') return

    image.dataset.fallbackApplied = 'true'
    image.classList.add('safe-image--fallback')
    image.src = tailTalkLogo
    image.alt = fallbackAlt
  }

  return <img className={className} src={imageSrc} alt={imageAlt} onError={handleError} {...props} />
}
