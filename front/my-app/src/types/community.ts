export type SortOption = 'latest' | 'popular' | 'comments'

export type LookupOption = {
  value: string
  label: string
}

export type Filters = {
  region: string
  budget: string
  theme: string
  season: string
  companion: string
}

export type User = {
  id: number
  userId: string
  password: string
  name: string
  email: string
  nickname: string
  bio: string
  location: string
}

export type Post = {
  id: number
  title: string
  summary: string
  content: string
  region: string
  regionCode?: string
  budget: string
  budgetCode?: string
  theme: string
  themeCode?: string
  season: string
  companion: string
  createdAt: string
  updatedAt?: string
  travelDate: string
  views: number
  discussionCount?: number
  imageUrl: string
  tags: string[]
  authorId: number
}

export type PostAuthor = {
  id: number
  name: string
  nickname: string
  bio: string
  location: string
}

export type Reply = {
  id: number
  authorId: number
  content: string
  createdAt: string
  updatedAt?: string
  author?: PostAuthor
}

export type Comment = {
  id: number
  authorId: number
  content: string
  createdAt: string
  updatedAt?: string
  author?: PostAuthor
  replies: Reply[]
}

export type PostWithMeta = Post & {
  discussionCount: number
  author: PostAuthor
}
