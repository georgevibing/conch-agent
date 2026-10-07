import { taskWorth, type Task } from '@conch/protocol';
import { TASK_STATUS_LABELS, TASK_WORTH_A_LOOK } from '@conch/nacre';

/** A task's state in a word or two, the way its card says it: "Done", "Worth a look". */
export function taskStatusWords(task: Task): string {
  return taskWorth(task) ? TASK_WORTH_A_LOOK : TASK_STATUS_LABELS[task.status];
}
