/**
 * Serializes async file operations (sync + shell-based) issued from the UI, so e.g. a
 * double-clicked download and an in-flight directory refresh never run concurrently.
 */
export class SyncQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const runTask = () => task();
    const result = this.tail.then(runTask, runTask);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
