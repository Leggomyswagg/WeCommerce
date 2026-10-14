import { fileURLToPath } from 'node:url';
import { createWorkspaceService } from '../apps/api/src/workspace-service.js';

function pause(milliseconds, signal) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, milliseconds);
    signal?.addEventListener('abort', finish, { once: true });
  });
}

export function createTaskWorker({ service = createWorkspaceService(), intervalMs = 1000, onOutcome = () => {} } = {}) {
  if (!Number.isInteger(intervalMs) || intervalMs < 10 || intervalMs > 60000) throw new Error('Invalid worker interval');
  return {
    async drainOnce({ maxTasks = 100 } = {}) {
      let processed = 0;
      while (processed < maxTasks) {
        const outcome = await service.executeNextTask();
        if (!outcome) break;
        processed += 1;
        await onOutcome(outcome);
      }
      return processed;
    },
    async run({ signal } = {}) {
      await service.ready();
      while (!signal?.aborted) {
        const outcome = await service.executeNextTask();
        if (outcome) await onOutcome(outcome);
        else await pause(intervalMs, signal);
      }
    }
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const service = createWorkspaceService();
  const abort = new AbortController();
  process.once('SIGINT', () => abort.abort());
  process.once('SIGTERM', () => abort.abort());
  const requestedInterval = Number(process.env.WE_COMMERCE_WORKER_INTERVAL_MS ?? 1000);
  try {
    const worker = createTaskWorker({
      service, intervalMs: requestedInterval,
      onOutcome: outcome => console.log(`Approved task processed: ${outcome.status} (${outcome.mode}).`)
    });
    if (process.argv.includes('--once')) {
      await service.ready();
      const processed = await worker.drainOnce();
      console.log(`Approved queue processed: ${processed} task(s).`);
    } else await worker.run({ signal: abort.signal });
  } catch {
    console.error('Worker stopped because workspace configuration, storage, or execution is unavailable.');
    process.exitCode = 1;
  } finally { await service.close().catch(() => {}); }
}
