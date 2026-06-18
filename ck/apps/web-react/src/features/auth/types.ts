export type PublicUser = {
  id: string
  email: string
  nickname: string
}

export type LoginResponse = {
  user: PublicUser
}

export type CheckEmailResponse = {
  available: boolean
}
