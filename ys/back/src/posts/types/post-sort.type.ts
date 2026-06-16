export const POST_SORT_VALUES = ['latest', 'popular', 'comments'] as const;

export type PostSort = (typeof POST_SORT_VALUES)[number];
