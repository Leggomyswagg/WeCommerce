import { createHash } from 'node:crypto';
import { WorkspaceError, invalid } from './workspace-errors.js';

const MONEY_FIELDS = ['retailPrice', 'productCost', 'shippingCost', 'fees', 'acquisitionCost'];
const TASK_PROVIDERS = {
  connector_sync: ['shopify', 'woocommerce', 'cj', 'google_ads', 'meta_ads', 'tiktok_ads'],
  supplier_reference: ['alibaba', 'made_in_china', '1688', 'temu', 'zendrop', 'direct'],
  ad_draft: ['google_ads', 'meta_ads', 'tiktok_ads'],
  onboarding_plan: []
};
const LESSONS = [
  {
    id: 'margin_basics', title: 'Calculate a contribution margin',
    description: 'Subtract product, shipping, transaction, and acquisition costs from the selling price.',
    prerequisites: [],
    exercise: {
      instructions: 'Provide a selling price, total costs, and the resulting contribution margin. Use the same currency and up to two decimal places.',
      fields: [
        { name: 'retailPrice', type: 'number', label: 'Selling price' },
        { name: 'totalCosts', type: 'number', label: 'Total costs' },
        { name: 'margin', type: 'number', label: 'Contribution margin' }
      ]
    },
    completionOutcome: 'Completed a contribution-margin arithmetic exercise; demand and real business profitability remain unverified.'
  },
  {
    id: 'supplier_checks', title: 'Identify missing validation evidence',
    description: 'A positive estimated margin does not establish customer demand or reliable fulfillment.',
    prerequisites: ['margin_basics'],
    exercise: {
      instructions: 'Identify both types of evidence that a margin score cannot establish.',
      fields: [{ name: 'evidenceNeeded', type: 'string_array', label: 'Evidence still needed', options: ['demand', 'supplier_reliability'] }]
    },
    completionOutcome: 'Identified two evidence gaps; no supplier has been verified or approved.'
  },
  {
    id: 'approval_safety', title: 'Review the exact task before approval',
    description: 'An approval authorizes the stored task payload. New inputs need a new proposal and approval.',
    prerequisites: ['supplier_checks'],
    exercise: {
      instructions: 'Acknowledge that approval binds the exact proposed payload. This unlocks local ad draft preparation.',
      fields: [{ name: 'acknowledgement', type: 'literal', label: 'Approval acknowledgement', value: 'approve_exact_payload' }]
    },
    completionOutcome: 'Acknowledged approval of a fixed payload and unlocked local ad drafts; this does not establish professional proficiency.'
  }
];

export function initialWorkspaceState() {
  return { schemaVersion: 1, profile: null, niches: [], tasks: [], completedLessons: {}, requestKeys: {} };
}

export function assertState(state) {
  if (!state || state.schemaVersion !== 1 || !Array.isArray(state.tasks) || !Array.isArray(state.niches) ||
      !isObject(state.completedLessons) || !isObject(state.requestKeys) || (state.profile !== null && !isObject(state.profile))) {
    throw new Error('Invalid stored workspace state');
  }
  return state;
}

export function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function onlyKeys(value, allowed, label = 'request') {
  if (!isObject(value) || Object.keys(value).some(key => !allowed.includes(key))) {
    throw invalid(`The ${label} contains unsupported fields.`);
  }
}

function text(value, name, max, optional = false, multiline = false) {
  if (optional && value === undefined) return undefined;
  const controls = multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u : /[\u0000-\u001f\u007f]/u;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || controls.test(value)) {
    throw invalid(`${name} must be a nonempty text value of at most ${max} characters.`);
  }
  return value.trim();
}

function amount(value, name, { positive = false, signed = false } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1_000_000 ||
      (!signed && value < 0) || (positive && value <= 0) || Math.abs(value * 100 - Math.round(value * 100)) > 0.000001) {
    throw invalid(`${name} must be a valid amount with at most two decimal places.`);
  }
  return value;
}

function currency(value) {
  if (typeof value !== 'string' || !/^[a-z]{3}$/iu.test(value)) throw invalid('Currency must be a three-letter code.');
  return value.toUpperCase();
}

function httpsUrl(value, name) {
  const raw = text(value, name, 2048);
  let parsed;
  try { parsed = new URL(raw); } catch { throw invalid(`${name} must be an HTTPS URL.`); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !parsed.hostname || parsed.port && parsed.port !== '443') {
    throw invalid(`${name} must be an HTTPS URL without embedded credentials.`);
  }
  if ([...parsed.searchParams.keys()].some(key => /token|password|secret|api.?key|authorization|credential/iu.test(key))) throw invalid(`${name} must not contain provider credentials.`);
  return parsed.href;
}

export function validateProfile(value) {
  onlyKeys(value, ['brandName', 'niche', 'targetCountry', 'currency', 'goal'], 'profile');
  return {
    brandName: text(value.brandName, 'Brand name', 80),
    niche: text(value.niche, 'Niche', 100),
    targetCountry: text(value.targetCountry, 'Target country', 80),
    currency: currency(value.currency),
    goal: text(value.goal, 'Goal', 500, false, true)
  };
}

export function scoreNiches(observations) {
  if (!Array.isArray(observations) || observations.length < 1 || observations.length > 10) {
    throw invalid('Provide between one and ten niche observations.');
  }
  const scores = observations.map(observation => {
    onlyKeys(observation, ['niche', ...MONEY_FIELDS], 'observation');
    const score = { niche: text(observation.niche, 'Niche', 100) };
    const missingInputs = [];
    for (const name of MONEY_FIELDS) {
      if (observation[name] === undefined || observation[name] === null) {
        score[name] = null;
        missingInputs.push(name);
      } else score[name] = amount(observation[name], name, { positive: name === 'retailPrice' });
    }
    const complete = missingInputs.length === 0;
    const costCents = complete ? MONEY_FIELDS.slice(1).reduce((sum, name) => sum + Math.round(score[name] * 100), 0) : null;
    const marginCents = complete ? Math.round(score.retailPrice * 100) - costCents : null;
    return {
      ...score,
      totalCosts: complete ? costCents / 100 : null,
      contributionMargin: complete ? marginCents / 100 : null,
      marginPercent: complete ? Math.round((marginCents / Math.round(score.retailPrice * 100)) * 10000) / 100 : null,
      missingInputs, missingEvidence: ['demand', 'supplier_reliability'], rank: null,
      evidenceBasis: 'founder_supplied_estimates', rankingBasis: 'contribution_margin_percent'
    };
  });
  const ranked = scores.filter(score => score.marginPercent !== null).sort((a, b) => b.marginPercent - a.marginPercent);
  ranked.forEach((score, index) => { score.rank = index + 1; });
  return scores;
}

function integer(value, name, max) {
  if (!Number.isInteger(value) || value < 1 || value > max) throw invalid(`${name} must be an integer between one and ${max}.`);
  return value;
}

export function validateTask(value) {
  onlyKeys(value, ['action', 'kind', 'provider', 'params'], 'task proposal');
  if (!Object.hasOwn(TASK_PROVIDERS, value.kind)) throw invalid('Task kind is not supported.');
  const provider = value.provider ?? null;
  if (value.kind === 'onboarding_plan' ? provider !== null : !TASK_PROVIDERS[value.kind].includes(provider)) {
    throw invalid('The provider does not support this task kind.');
  }
  const raw = value.params ?? {};
  let params = {};
  switch (value.kind) {
    case 'onboarding_plan':
      onlyKeys(raw, [], 'onboarding plan');
      break;
    case 'connector_sync':
      onlyKeys(raw, ['limit', 'page', 'query', 'productId'], 'connector parameters');
      if (raw.limit !== undefined) params.limit = integer(raw.limit, 'Limit', 50);
      if (raw.page !== undefined) params.page = integer(raw.page, 'Page', 20);
      if (raw.query !== undefined) params.query = text(raw.query, 'Query', 100);
      if (raw.productId !== undefined) {
        if (typeof raw.productId !== 'string' || !/^[a-z0-9-]{1,80}$/iu.test(raw.productId)) throw invalid('Product ID is invalid.');
        params.productId = raw.productId;
      }
      if (provider !== 'cj' && (params.query !== undefined || params.productId !== undefined)) throw invalid('Search and product ID parameters are supported only for CJ.');
      break;
    case 'supplier_reference':
      onlyKeys(raw, ['url', 'title', 'notes'], 'supplier reference');
      params.url = httpsUrl(raw.url, 'Supplier URL');
      if (raw.title !== undefined) params.title = text(raw.title, 'Title', 160);
      if (raw.notes !== undefined) params.notes = text(raw.notes, 'Notes', 1000, false, true);
      break;
    case 'ad_draft':
      onlyKeys(raw, ['headline', 'description', 'destinationUrl', 'budgetDaily', 'currency'], 'ad draft');
      params = {
        headline: text(raw.headline, 'Headline', 80), description: text(raw.description, 'Description', 500, false, true),
        destinationUrl: httpsUrl(raw.destinationUrl, 'Destination URL'),
        budgetDaily: amount(raw.budgetDaily, 'Daily budget', { positive: true }), currency: currency(raw.currency)
      };
      if (params.budgetDaily > 10000) throw invalid('Daily budget must not exceed 10,000.');
      break;
  }
  return { kind: value.kind, provider, params };
}

export function taskPayloadHash(task) {
  return createHash('sha256').update(canonicalJson({ kind: task.kind, provider: task.provider, params: task.params, profileSnapshot: task.profileSnapshot })).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function taskExplanation(task) {
  const explanations = {
    onboarding_plan: {
      what: `Prepare a local onboarding plan for ${task.profileSnapshot.brandName} using this saved intake.`,
      why: 'Make the next founder decisions explicit before account or store setup.',
      expectedImpact: 'A reviewable checklist; no store, subscription, or checkout will be created.',
      risks: ['The plan does not validate demand, legal claims, suppliers, or revenue.']
    },
    connector_sync: {
      what: `Read configured ${task.provider} account or catalogue data.`,
      why: 'Inspect provider evidence before planning changes.',
      expectedImpact: 'A stored read result when account credentials and access are valid.',
      risks: ['Missing credentials or provider access will block the read.', 'No provider data will be created or changed.']
    },
    supplier_reference: {
      what: `Prepare a local ${task.provider} supplier reference for ${task.params.url}.`,
      why: 'Record a source for independent supplier and fulfillment checks.',
      expectedImpact: 'A clearly unverified reference; no supplier import, order, or account registration.',
      risks: ['A reference does not verify supplier identity, stock, delivery, or product claims.']
    },
    ad_draft: {
      what: `Prepare a local ${task.provider} campaign draft with a ${task.params.currency} ${task.params.budgetDaily} proposed daily budget.`,
      why: 'Review copy, destination, and proposed budget before considering a live campaign.',
      expectedImpact: 'A local draft; nothing will be published and no budget will be spent.',
      risks: ['Claims, policy compliance, audience fit, and economics require separate review.']
    }
  };
  return { ...explanations[task.kind], requiresApproval: true };
}

export function curriculumFor(state) {
  const completedCount = LESSONS.filter(lesson => Object.hasOwn(state.completedLessons, lesson.id)).length;
  const unlockedControls = state.profile ? ['onboarding_plan', 'connector_sync', 'supplier_reference'] : [];
  if (Object.hasOwn(state.completedLessons, 'approval_safety')) unlockedControls.push('ad_draft');
  return {
    level: completedCount, completedCount, unlockedControls,
    lessons: LESSONS.map(lesson => ({
      ...structuredClone(lesson),
      status: Object.hasOwn(state.completedLessons, lesson.id) ? 'completed' :
        state.profile && lesson.prerequisites.every(id => Object.hasOwn(state.completedLessons, id)) ? 'available' : 'locked',
      completedAt: state.completedLessons[lesson.id] ?? null
    }))
  };
}

export function completeLesson(state, lessonId, exercise, timestamp) {
  const lesson = LESSONS.find(item => item.id === lessonId);
  if (!lesson) throw new WorkspaceError(404, 'lesson_not_found', 'The lesson does not exist.');
  if (Object.hasOwn(state.completedLessons, lessonId)) return;
  if (!state.profile || !lesson.prerequisites.every(id => Object.hasOwn(state.completedLessons, id))) {
    throw new WorkspaceError(409, 'lesson_locked', 'Complete the founder intake and prerequisite lessons first.');
  }
  if (lessonId === 'margin_basics') {
    onlyKeys(exercise, ['retailPrice', 'totalCosts', 'margin'], 'margin exercise');
    const retail = amount(exercise.retailPrice, 'Selling price', { positive: true });
    const costs = amount(exercise.totalCosts, 'Total costs');
    const margin = amount(exercise.margin, 'Margin', { signed: true });
    if (Math.round(retail * 100) - Math.round(costs * 100) !== Math.round(margin * 100)) throw invalid('The contribution margin must equal selling price minus total costs.');
  } else if (lessonId === 'supplier_checks') {
    onlyKeys(exercise, ['evidenceNeeded'], 'supplier exercise');
    if (!Array.isArray(exercise.evidenceNeeded) || exercise.evidenceNeeded.length !== 2 ||
        !['demand', 'supplier_reliability'].every(item => exercise.evidenceNeeded.includes(item))) {
      throw invalid('Identify demand and supplier reliability as the missing evidence.');
    }
  } else {
    onlyKeys(exercise, ['acknowledgement'], 'approval exercise');
    if (exercise.acknowledgement !== 'approve_exact_payload') throw invalid('Acknowledge approval of the exact stored payload.');
  }
  state.completedLessons[lessonId] = timestamp;
}

export function publicTask(task) {
  const { claimToken, leaseExpiresAt, ...visible } = task;
  return structuredClone(visible);
}
