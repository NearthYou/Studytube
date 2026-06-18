export type PublicComment = {
  id: string;
  seatReviewId: string;
  author: {
    id: string;
    nickname: string;
  };
  content: string;
  parentId: string | null;
  mentions: string[];
  replyCount: number;
  likeCount: number;
  likedByMe: boolean;
  replies: PublicComment[];
  createdAt: string;
  updatedAt: string;
};

export type CommentListResponse = {
  items: PublicComment[];
  total: number;
  sort: "oldest" | "latest";
};
