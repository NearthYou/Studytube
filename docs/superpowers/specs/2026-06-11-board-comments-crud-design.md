# Board Comments CRUD Design

## Context

The board already supports post CRUD through the NestJS API and the React `/board` screen. A board should also feel like a discussion surface: users need to read comments, add comments to public board posts, and delete comments when they own them or own the post.

## Approved Direction

All logged-in users can comment on public board posts. A comment can be deleted by either the comment author or the post author. Anonymous comments are out of scope.

## Scope

- Keep existing post CRUD behavior intact.
- Add comment creation to the visible board UI.
- Add comment deletion across API, repository implementations, and UI.
- Refresh the selected post after comment changes so the comment list stays current.
- Preserve private owner-only editing and deletion for posts.

## API Design

- `POST /posts/:id/comments` creates a comment for any authenticated user if the post exists.
- `DELETE /posts/:postId/comments/:commentId` deletes a comment when the authenticated user is the comment author or the post author.
- Failed authorization returns `Forbidden`.
- Missing post or comment returns `NotFound`.

## Data Flow

The React board loads posts with embedded comments. When a user submits a comment, the UI calls the create endpoint, reloads the current page, and keeps the same selected post active. When a user deletes a comment, the UI calls the delete endpoint and reloads the selected post data through the existing list refresh.

## UI Design

The selected post detail panel gains a compact comments section below the post actions. It shows comment author, date, body, an input form, and a delete button only when the current user can delete that comment. Empty state copy invites the user to start the discussion.

## Tests

- Service test: a different logged-in user can comment on another user's public post.
- Service test: comment author can delete their comment.
- Service test: post author can delete a comment on their post.
- Service test: unrelated users cannot delete a comment.
- Existing post CRUD tests should continue to pass.
