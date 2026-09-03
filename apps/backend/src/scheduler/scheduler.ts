/**
 * 轻量进程内调度器 — 基于 cron 表达式触发定时任务。
 */

interface ScheduledJob {
  name: string;
  cron: string;
  task: () => Promise<void>;
  timer?: ReturnType<typeof setInterval>;
}

export class Scheduler {
  private jobs: ScheduledJob[] = [];

  register(name: string, cron: string, task: () => Promise<void>) {
    this.jobs.push({ name, cron, task });
  }

  start() {
    for (const job of this.jobs) {
      const intervalMs = this.cronToMs(job.cron);
      job.timer = setInterval(async () => {
        try {
          console.log(`[scheduler] running: ${job.name}`);
          await job.task();
        } catch (err) {
          console.error(`[scheduler] error in ${job.name}:`, err);
        }
      }, intervalMs);
      console.log(`[scheduler] registered: ${job.name} (every ${intervalMs / 1000}s)`);
    }
  }

  stop() {
    for (const job of this.jobs) {
      if (job.timer) clearInterval(job.timer);
    }
    this.jobs = [];
  }

  /** 简易 cron 解析，仅支持分钟级间隔 */
  private cronToMs(cron: string): number {
    const parts = cron.split(" ");
    if (parts[0].startsWith("*/")) {
      const minutes = parseInt(parts[0].slice(2), 10);
      return minutes * 60 * 1000;
    }
    return 5 * 60 * 1000; // default 5 minutes
  }
}
