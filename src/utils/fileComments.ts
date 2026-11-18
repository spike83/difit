// A comment on a whole file rather than on lines of it sits on line 0.
export const FILE_COMMENT_LINE = 0;

export const isFileCommentLine = (line: unknown): boolean => line === FILE_COMMENT_LINE;
