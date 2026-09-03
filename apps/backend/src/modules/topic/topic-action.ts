/** TopicAction */
export type TopicActionType = "merge_insight" | "correct" | "reorganize";

export interface TopicAction {
  type: TopicActionType;
  content: string;
}
