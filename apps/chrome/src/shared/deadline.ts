/** Bound a wait without replaying the operation or treating its outcome as success. */
export async function withDeadline<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new DOMException(message, "TimeoutError")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
