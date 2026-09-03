/** 创建 Record 服务 */
import type { RecordRepository, CreateRecordInput } from "../modules/record/record.repository.js";

export async function createRecord(recordRepo: RecordRepository, input: CreateRecordInput) {
  const record = await recordRepo.create(input);
  return record;
}
