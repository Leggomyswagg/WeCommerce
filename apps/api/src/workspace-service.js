import { randomUUID } from 'node:crypto';
import { createConfiguredWorkspaceStore, isProductionRuntime } from './workspace-storage.js';
import { WorkspaceError, invalid, unavailable } from './workspace-errors.js';
import {
  completeLesson, curriculumFor, onlyKeys, publicTask, scoreNiches,
  taskExplanation, taskPayloadHash, validateProfile, validateTask
} from './workspace-state.js';

const TERMINAL = new Set(['succeeded', 'blocked', 'failed']);
const RESULT_MODES = new Set(['provider_read', 'local_draft', 'reference_preparation', 'local_guidance']);
const MAX_TASKS = 100;
const MAX_RESULT_BYTES = 64 * 1024;
const SAFE_FAILURES = {
  not_configured: { status: 'blocked', summary: 'Required account credentials are not configured. No provider action was performed.' },
  unsupported_operation: { status: 'blocked', summary: 'This operation is not supported. No provider action was performed.' },
  invalid_request: { status: 'blocked', summary: 'The provider cannot accept these task inputs. No provider action completed.' },
  provider_unavailable: { status: 'failed', summary: 'The provider read could not be completed. No provider write was attempted.' }
};

function positiveDuration(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= 120000 ? number : fallback;
}

export function assertFounderBinding(env = process.env) {
  if (typeof env.WE_COMMERCE_AUTH_TOKEN !== 'string' || !env.WE_COMMERCE_AUTH_TOKEN.trim()) {
    throw new WorkspaceError(503, 'authentication_unavailable', 'The founder workspace has no server authentication binding.');
  }
}

function uncertainResult() {
  return {
    summary: 'Execution was interrupted or exceeded its deadline. Its outcome is uncertain; reconcile it before creating another task.',
    mode: 'uncertain', code: 'reconciliation_required', data: null
  };
}

function rejectSecretFields(value, depth = 0) {
  if (depth > 12) throw new Error('Unsafe result');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    if (value.length > 200) throw new Error('Unsafe result');
    value.forEach(item => rejectSecretFields(item, depth + 1));
    return;
  }
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('Unsafe result');
  for (const [key, item] of Object.entries(value)) {
    if (/token|password|secret|api.?key|authorization|credential|cookie/iu.test(key)) throw new Error('Unsafe result');
    if (item === undefined) continue;
    rejectSecretFields(item, depth + 1);
  }
}

function safeResult(result) {
  if (!result || typeof result.summary !== 'string' || !result.summary.trim() || result.summary.length > 2000 ||
      !RESULT_MODES.has(result.mode) || !Object.hasOwn(result, 'data')) throw new Error('Unsafe result');
  const stored = { summary: result.summary, data: result.data, mode: result.mode };
  rejectSecretFields(stored);
  if (Buffer.byteLength(JSON.stringify(stored)) > MAX_RESULT_BYTES) throw new Error('Unsafe result');
  return JSON.parse(JSON.stringify(stored));
}

function onboardingPlan(task) {
  const profile = task.profileSnapshot;
  return {
    summary: 'Prepared local onboarding guidance from the approved intake. No store, account, subscription, or checkout was created.',
    mode: 'local_guidance',
    data: {
      profile,
      steps: [
        { title: 'Validate the niche', detail: `Collect demand evidence for ${profile.niche} in ${profile.targetCountry}; calculate costs in ${profile.currency}.` },
        { title: 'Check suppliers', detail: 'Verify identity, samples, fulfillment times, return terms, and product claims before selecting a supplier.' },
        { title: 'Review store requirements', detail: `Review the ${profile.brandName} brand, policies, catalogue, and destination before any store setup.` },
        { title: 'Verify payment and launch readiness', detail: 'Use founder-owned accounts and separately verify checkout, legal obligations, analytics, and campaign drafts before launch.' }
      ],
      goal: profile.goal,
      limitations: ['Demand, supplier reliability, legal compliance, checkout, and revenue remain unverified.']
    }
  };
}

export function createWorkspaceService({
  store, env = process.env, now = () => new Date(),
  runConnectorTask, connectorStatus, fetchImpl = globalThis.fetch,
  taskTimeoutMs = positiveDuration(env.WE_COMMERCE_TASK_TIMEOUT_MS, 30000)
} = {}) {
  let storePromise;
  let registryPromise;
  const registry = () => registryPromise ??= import('../../../packages/connectors/registry.js');
  const getStore = async () => {
    assertFounderBinding(env);
    if (store) {
      if (isProductionRuntime(env) && store.description?.type !== 'postgres') throw unavailable();
      return store;
    }
    storePromise ??= createConfiguredWorkspaceStore(env).catch(error => { storePromise = undefined; throw error; });
    return storePromise;
  };
  const timestamp = () => now().toISOString();
  const getStatus = async () => {
    try {
      const status = await (connectorStatus ?? (await registry()).connectorStatus)(env);
      rejectSecretFields(status);
      return structuredClone(status);
    } catch {
      throw new WorkspaceError(503, 'connectors_unavailable', 'Connector capability information is unavailable.');
    }
  };

  function reconcile(state) {
    const current = now().getTime();
    for (const task of state.tasks) {
      const expiry = Date.parse(task.leaseExpiresAt);
      if (task.status === 'running' && (!Number.isFinite(expiry) || expiry <= current)) {
        task.status = 'blocked';
        task.result = uncertainResult();
        task.finishedAt = timestamp();
        delete task.claimToken;
        delete task.leaseExpiresAt;
      }
    }
  }

  const transact = async mutator => (await getStore()).transact(state => {
    reconcile(state);
    return mutator(state);
  });

  async function workspace() {
    const backing = await getStore();
    const state = await transact(value => structuredClone(value));
    return {
      profile: state.profile, tasks: state.tasks.map(publicTask), niches: state.niches,
      connectors: await getStatus(), curriculum: curriculumFor(state), storage: structuredClone(backing.description)
    };
  }

  async function claimTask(taskId) {
    return transact(state => {
      const task = taskId ? state.tasks.find(item => item.id === taskId) : state.tasks.find(item => item.status === 'approved');
      if (!task) {
        if (taskId) throw new WorkspaceError(404, 'task_not_found', 'The task does not exist.');
        return null;
      }
      if (TERMINAL.has(task.status)) return { task: structuredClone(task), claimed: false };
      if (task.status === 'running') throw new WorkspaceError(409, 'task_running', 'The task is already running; it will not be executed again.');
      if (task.status !== 'approved') throw new WorkspaceError(409, 'task_not_approved', 'Approve the proposed task before execution.');
      if (taskPayloadHash(task) !== task.payloadHash || task.approvedPayloadHash !== task.payloadHash) {
        throw new WorkspaceError(409, 'approval_mismatch', 'The stored payload no longer matches its approval. Create a new task.');
      }
      task.status = 'running';
      task.startedAt = timestamp();
      task.claimToken = randomUUID();
      task.leaseExpiresAt = new Date(now().getTime() + taskTimeoutMs + 60000).toISOString();
      return { task: structuredClone(task), claimed: true };
    });
  }

  async function runClaim(claim) {
    if (!claim?.claimed) return claim?.task ?? null;
    const task = claim.task;
    let status;
    let result;
    let timer;
    try {
      const runner = runConnectorTask ?? (task.kind === 'onboarding_plan' ? null : (await registry()).runConnectorTask);
      const execution = Promise.resolve().then(() => task.kind === 'onboarding_plan' ? onboardingPlan(task) : runner(structuredClone(task), { env, fetchImpl }));
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('Execution deadline'), { code: 'execution_deadline' })), taskTimeoutMs);
      });
      result = safeResult(await Promise.race([execution, deadline]));
      status = 'succeeded';
    } catch (error) {
      if (error?.code === 'execution_deadline') {
        status = 'blocked'; result = uncertainResult();
      } else {
        const failure = SAFE_FAILURES[error?.code];
        status = failure?.status ?? 'failed';
        result = {
          summary: failure?.summary ?? 'The task could not be completed. Provider details have been withheld.',
          mode: status === 'blocked' ? 'blocked' : 'failed',
          code: failure ? error.code : 'execution_failed', data: null
        };
      }
    } finally { clearTimeout(timer); }
    return transact(state => {
      const current = state.tasks.find(item => item.id === task.id);
      if (!current) throw new WorkspaceError(404, 'task_not_found', 'The task does not exist.');
      // A lease may already have been marked uncertain by another process.
      // Never replace that reconciliation requirement with a late success.
      if (current.status === 'running' && current.claimToken === task.claimToken) {
        current.status = status;
        current.result = result;
        current.finishedAt = timestamp();
        delete current.claimToken;
        delete current.leaseExpiresAt;
      }
      return structuredClone(current);
    });
  }

  async function mutate(request, { idempotencyKey } = {}) {
    if (!request || typeof request.action !== 'string') throw invalid('Provide a workspace action.');
    switch (request.action) {
      case 'save_profile': {
        onlyKeys(request, ['action', 'profile']);
        const profile = validateProfile(request.profile);
        await transact(state => { state.profile = profile; });
        break;
      }
      case 'score_niches': {
        onlyKeys(request, ['action', 'observations']);
        const scores = scoreNiches(request.observations);
        await transact(state => { state.niches = scores; });
        return { ...await workspace(), scores };
      }
      case 'create_task': {
        const proposal = validateTask(request);
        if (idempotencyKey !== undefined && (typeof idempotencyKey !== 'string' || !/^[a-z0-9._:-]{1,100}$/iu.test(idempotencyKey))) throw invalid('The idempotency key is invalid.');
        await transact(state => {
          if (!state.profile) throw new WorkspaceError(409, 'profile_required', 'Save the founder intake before proposing a task.');
          if (!curriculumFor(state).unlockedControls.includes(proposal.kind)) throw new WorkspaceError(409, 'control_locked', 'Complete the prerequisite lessons to unlock this task kind.');
          const task = { ...proposal, profileSnapshot: structuredClone(state.profile) };
          task.payloadHash = taskPayloadHash(task);
          if (idempotencyKey && Object.hasOwn(state.requestKeys, idempotencyKey)) {
            if (state.requestKeys[idempotencyKey].payloadHash !== task.payloadHash) throw new WorkspaceError(409, 'idempotency_conflict', 'This idempotency key belongs to a different task payload.');
            return;
          }
          if (state.tasks.length >= MAX_TASKS) throw new WorkspaceError(409, 'task_limit', 'The workspace task limit has been reached.');
          Object.assign(task, {
            id: randomUUID(), status: 'proposed', explanation: taskExplanation(task), result: null,
            createdAt: timestamp(), approvedAt: null, approvedPayloadHash: null, startedAt: null, finishedAt: null
          });
          state.tasks.push(task);
          if (idempotencyKey) Object.defineProperty(state.requestKeys, idempotencyKey, {
            value: { payloadHash: task.payloadHash, taskId: task.id }, enumerable: true, writable: true, configurable: true
          });
        });
        break;
      }
      case 'approve_task': {
        onlyKeys(request, ['action', 'taskId']);
        validateTaskId(request.taskId);
        await transact(state => {
          const task = state.tasks.find(item => item.id === request.taskId);
          if (!task) throw new WorkspaceError(404, 'task_not_found', 'The task does not exist.');
          if (task.status === 'approved' && task.approvedPayloadHash === task.payloadHash && task.payloadHash === taskPayloadHash(task)) return;
          if (task.status !== 'proposed') throw new WorkspaceError(409, 'task_not_proposed', 'Only a proposed task can receive approval.');
          if (taskPayloadHash(task) !== task.payloadHash) throw new WorkspaceError(409, 'approval_mismatch', 'The stored task payload changed. Create a new task.');
          task.status = 'approved'; task.approvedAt = timestamp(); task.approvedPayloadHash = task.payloadHash;
        });
        break;
      }
      case 'execute_task':
        onlyKeys(request, ['action', 'taskId']);
        validateTaskId(request.taskId);
        await runClaim(await claimTask(request.taskId));
        break;
      case 'complete_lesson':
        onlyKeys(request, ['action', 'lessonId', 'exercise']);
        if (typeof request.lessonId !== 'string' || request.lessonId.length > 80) throw invalid('The lesson ID is invalid.');
        await transact(state => { completeLesson(state, request.lessonId, request.exercise, timestamp()); });
        break;
      default: throw invalid('The workspace action is not supported.');
    }
    return workspace();
  }

  return {
    workspace, mutate,
    async executeNextTask() {
      const claimed = await claimTask();
      if (!claimed) return null;
      const completed = await runClaim(claimed);
      return { taskId: completed.id, status: completed.status, mode: completed.result?.mode ?? null };
    },
    async ready() { await getStore(); },
    async close() { if (store) await store.close?.(); else if (storePromise) await (await storePromise).close?.(); }
  };
}

function validateTaskId(value) {
  if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/iu.test(value)) throw invalid('The task ID is invalid.');
}
