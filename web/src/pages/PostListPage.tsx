import { Link } from 'react-router'
import { posts } from '../data/posts'

export function PostListPage() {
    return (
        <main>
            <h1>글 목록</h1>
            <Link to = "/posts/new">글 작성</Link>

            <ul>
                {posts.map((post) => (
                    <li key={post.id}>
                        <Link to={`/posts/${post.id}`}>{post.title}</Link>
                        <p>
                            {post.author} · {post.createdAt}
                        </p>
                    </li>
                ))}
            </ul>
        </main>
    )
}