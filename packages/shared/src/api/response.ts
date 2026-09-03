export type ApiResponse<T> = {
  result: T;
  success: boolean;
  errorCode: string | null;
  errorMsg: string | null;
};

export type PaginatedResult<T> = {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
  total: number;
  pageSize: number;
};
