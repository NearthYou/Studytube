export type SortOption = 'latest' | 'popular' | 'comments'

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
  budget: string
  theme: string
  season: string
  companion: string
  createdAt: string
  travelDate: string
  views: number
  imageUrl: string
  tags: string[]
  authorId: number
}

export type Reply = {
  id: number
  authorId: number
  content: string
  createdAt: string
}

export type Comment = {
  id: number
  authorId: number
  content: string
  createdAt: string
  replies: Reply[]
}

export type PostWithMeta = Post & {
  discussionCount: number
  author: User
}
