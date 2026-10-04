/** Calls `onIdle` once `seconds` pass without a touch(). touch() only postpones a running timer. */
export class IdleTimer {
  private handle: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly seconds: number,
    private readonly onIdle: () => void,
  ) {}

  touch(): void {
    if (this.handle !== null) this.start();
  }

  start(): void {
    this.stop();
    this.handle = setTimeout(() => {
      this.handle = null;
      this.onIdle();
    }, this.seconds * 1000);
  }

  stop(): void {
    if (this.handle === null) return;
    clearTimeout(this.handle);
    this.handle = null;
  }
}
