export type WritableCategoryValue = 'daily' | 'walk' | 'care' | 'question'

export type CategoryValue = 'all' | WritableCategoryValue

export type Category = {
  id?: string
  value: CategoryValue
  label: string
  mobileLabel: string
  description: string
  prompt: string
  trustHint: string
  href: string
  isWritable: boolean
}
