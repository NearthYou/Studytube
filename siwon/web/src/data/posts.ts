export type Post = {
    id: number
    title: string
    content: string
    author: string
    createdAt: string
}

export const posts: Post[] = [
    {
        id: 1,
        title: 'React 컴포넌트 질문',
        content: '컴포넌트를 어떻게 나누면 좋을지 연습 중입니다.',
        author: 'student',
        createdAt: '2026-06-06'
    },
    {
        id: 2,
        title: 'NestJS Controller 정리',
        content: 'Controller는 HTTP 요청을 받는 입구입니다.',
        author: 'student',
        createdAt: '2026-06-06'
    },
]