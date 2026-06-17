import { apiRequest } from "../../shared/api";
import { buildTagSeatReviewsPath, type TagSeatReviewsQuery } from "./tag-api-paths";
import type { TagOption, TagSeatReviewListResponse } from "./types";

export function getTags() {
  return apiRequest<TagOption[]>("/tags");
}

export function getSeatReviewsByTag(tagId: string, query: TagSeatReviewsQuery = {}) {
  return apiRequest<TagSeatReviewListResponse>(buildTagSeatReviewsPath(tagId, query));
}
