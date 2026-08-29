/* StudyBot app-level accounts. No Supabase Auth is used. */

const DB_KEY = 'studybot-app-db-v1';
const SESSION_KEY = 'studybot-session-v1';
const LEGACY_DB_KEY = 'studybot-local-db-v2';

const DEFAULT_QUOTES = [
  ['Stand up. Open the book. The next 25 minutes are not optional.', null],
  ['Your exam date is fixed. Your excuses are not. Start the block now.', null],
  ['Nobody is coming to rescue this syllabus. Sit down and finish the next page.', null],
  ['You already know what to do. Stop shopping for a feeling and start the timer.', null],
  ['GATE and UPSC do not care that you are tired. Open the notes.', null],
  ['If you wait until you feel ready, you will lose the year. Begin in the next 10 seconds.', null],
];

const uuid = () => {
  try { return crypto.randomUUID(); } catch {
    return 'local-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }
};

function createStorage() {
  try {
    const key = '__studybot_storage_test__';
    window.localStorage.setItem(key, '1');
    window.localStorage.removeItem(key);
    return window.localStorage;
  } catch {
    const memory = new Map();
    return {
      getItem: k => (memory.has(k) ? memory.get(k) : null),
      setItem: (k, v) => memory.set(k, v),
      removeItem: k => memory.delete(k),
    };
  }
}

const storage = createStorage();
const normalizeIdentifier = value => String(value || '').trim().toLowerCase();

async function hashPasscode(value) {
  const input = String(value || '');
  if (globalThis.crypto?.subtle && typeof TextEncoder !== 'undefined') {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) hash = Math.imul(hash ^ input.charCodeAt(i), 16777619);
  return `fallback-${(hash >>> 0).toString(16)}`;
}

function defaultUser(id, identifier, passcodeHash) {
  return {
    id,
    identifier,
    identifierType: identifier.includes('@') ? 'email' : 'phone',
    passcodeHash,
    displayName: '',
    timezone: 'Asia/Kolkata',
    dayStart: '04:30',
    gateExamDate: '2027-02-07',
    upscExamDate: '2027-05-30',
    createdAt: new Date().toISOString(),
  };
}

function defaultAccount() {
  return {
    tasks: [],
    monthly_goals: [],
    study_sessions: [],
    ai_command_log: [],
    quotes: DEFAULT_QUOTES.map(([quote, author]) => ({ id: uuid(), quote, author, active: true })),
  };
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function readDb() {
  try {
    const raw = storage.getItem(DB_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { version: 1, users: parsed.users || {}, accounts: parsed.accounts || {} };
    }

    // Preserve the old local data as a one-time private migrated account.
    const legacyRaw = storage.getItem(LEGACY_DB_KEY);
    const legacy = legacyRaw ? JSON.parse(legacyRaw) : null;
    if (legacy && (legacy.tasks?.length || legacy.monthly_goals?.length || legacy.study_sessions?.length)) {
      const id = uuid();
      const users = { [id]: defaultUser(id, 'migrated-local', 'legacy') };
      const account = defaultAccount();
      account.tasks = (legacy.tasks || []).map(t => ({ ...t, user_id: id }));
      account.monthly_goals = (legacy.monthly_goals || []).map(g => ({ ...g, user_id: id }));
      account.study_sessions = (legacy.study_sessions || []).map(s => ({ ...s, user_id: id }));
      if (legacy.quotes?.length) account.quotes = legacy.quotes;
      return { version: 1, users, accounts: { [id]: account } };
    }
  } catch {
    // Use a clean database when local state is corrupt.
  }
  return { version: 1, users: {}, accounts: {} };
}

let db = readDb();
let sessionUserId = null;
try { sessionUserId = storage.getItem(SESSION_KEY); } catch { sessionUserId = null; }
const listeners = new Set();

const persist = () => {
  try { storage.setItem(DB_KEY, JSON.stringify(db)); } catch { /* ignore */ }
};
const currentUser = () => (sessionUserId ? db.users[sessionUserId] || null : null);
const currentAccount = () => (sessionUserId ? db.accounts[sessionUserId] || null : null);
const makeSession = user => user ? { user, access_token: `studybot-${user.id}` } : null;

function emit(event = 'SIGNED_IN') {
  const user = currentUser();
  for (const callback of listeners) callback(event, makeSession(user));
}

function matches(row, filters) {
  return filters.every(filter => {
    const value = row?.[filter.column];
    if (filter.op === 'eq') return String(value) === String(filter.value);
    if (filter.op === 'lt') return value < filter.value;
    if (filter.op === 'lte') return value <= filter.value;
    if (filter.op === 'gt') return value > filter.value;
    if (filter.op === 'gte') return value >= filter.value;
    return true;
  });
}

function profileRow(user) {
  return {
    id: user.id,
    display_name: user.displayName,
    timezone: user.timezone,
    gate_exam_date: user.gateExamDate,
    upsc_exam_date: user.upscExamDate,
    day_start: user.dayStart,
    created_at: user.createdAt,
  };
}

class LocalQuery {
  constructor(table) {
    this.table = table;
    this.operation = 'select';
    this.values = null;
    this.filters = [];
    this.ordering = null;
    this.returnRows = false;
    this.singleMode = false;
    this.maybeSingleMode = false;
  }
  select(columns = '*') { this.returnRows = true; this.columns = columns; return this; }
  insert(values) { this.operation = 'insert'; this.values = Array.isArray(values) ? values : [values]; return this; }
  update(values) { this.operation = 'update'; this.values = values || {}; return this; }
  delete() { this.operation = 'delete'; return this; }
  upsert(values) { this.operation = 'upsert'; this.values = Array.isArray(values) ? values : [values]; return this; }
  eq(column, value) { this.filters.push({ column, op: 'eq', value }); return this; }
  lt(column, value) { this.filters.push({ column, op: 'lt', value }); return this; }
  lte(column, value) { this.filters.push({ column, op: 'lte', value }); return this; }
  gt(column, value) { this.filters.push({ column, op: 'gt', value }); return this; }
  gte(column, value) { this.filters.push({ column, op: 'gte', value }); return this; }
  order(column, options = {}) { this.ordering = { column, ascending: options.ascending !== false }; return this; }
  single() { this.singleMode = true; return this; }
  maybeSingle() { this.maybeSingleMode = true; return this; }

  async execute() {
    if (!sessionUserId) return { data: null, error: { message: 'Not signed in' } };
    const user = currentUser();
    const account = currentAccount();
    if (!user || !account) return { data: null, error: { message: 'Account not found' } };

    if (this.table === 'profiles') {
      if (this.operation === 'select') {
        const rows = [profileRow(user)].filter(row => matches(row, this.filters));
        if (this.singleMode) return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: 'Profile not found' } };
        if (this.maybeSingleMode) return { data: rows[0] || null, error: null };
        return { data: rows, error: null };
      }
      const patch = this.values || this.values?.[0] || {};
      if (patch.day_start) user.dayStart = patch.day_start;
      if (patch.display_name != null) user.displayName = patch.display_name;
      if (patch.timezone) user.timezone = patch.timezone;
      if (patch.gate_exam_date) user.gateExamDate = patch.gate_exam_date;
      if (patch.upsc_exam_date) user.upscExamDate = patch.upsc_exam_date;
      persist();
      return { data: this.returnRows ? profileRow(user) : null, error: null };
    }

    const table = account[this.table];
    if (!Array.isArray(table)) return { data: null, error: { message: `Unknown local table: ${this.table}` } };

    if (this.operation === 'insert') {
      const now = new Date().toISOString();
      const rows = this.values.map(value => ({
        id: value.id || uuid(), created_at: value.created_at || now,
        user_id: value.user_id || sessionUserId, ...value,
      }));
      table.push(...rows);
      persist();
      return { data: this.returnRows ? clone(this.singleMode ? rows[0] : rows) : null, error: null };
    }

    if (this.operation === 'upsert') {
      const rows = [];
      for (const value of this.values) {
        const match = table.find(row => row.id === value.id);
        if (match) Object.assign(match, value);
        else {
          const row = { id: value.id || uuid(), created_at: value.created_at || new Date().toISOString(), user_id: value.user_id || sessionUserId, ...value };
          table.push(row);
          rows.push(row);
          continue;
        }
        rows.push(match);
      }
      persist();
      return { data: this.returnRows ? clone(this.singleMode ? rows[0] : rows) : null, error: null };
    }

    if (this.operation === 'update') {
      const matched = table.filter(row => matches(row, this.filters));
      matched.forEach(row => Object.assign(row, this.values));
      persist();
      return { data: this.returnRows ? clone(this.singleMode ? matched[0] : matched) : null, error: null };
    }

    if (this.operation === 'delete') {
      const matched = table.filter(row => matches(row, this.filters));
      account[this.table] = table.filter(row => !matches(row, this.filters));
      persist();
      return { data: this.returnRows ? clone(matched) : null, error: null };
    }

    let rows = table.filter(row => matches(row, this.filters)).map(clone);
    if (this.ordering) {
      const { column, ascending } = this.ordering;
      rows.sort((a, b) => {
        const av = a?.[column] ?? ''; const bv = b?.[column] ?? '';
        const result = String(av).localeCompare(String(bv), undefined, { numeric: true });
        return ascending ? result : -result;
      });
    }
    if (this.singleMode) {
      if (rows.length !== 1) return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } };
      return { data: rows[0], error: null };
    }
    if (this.maybeSingleMode) {
      if (rows.length > 1) return { data: null, error: { message: 'JSON object requested, multiple rows returned' } };
      return { data: rows[0] || null, error: null };
    }
    return { data: rows, error: null };
  }
  then(resolve, reject) { return this.execute().then(resolve, reject); }
  catch(reject) { return this.execute().catch(reject); }
}

async function signUpWithPasscode(identifier, passcode) {
  const normalized = normalizeIdentifier(identifier);
  const code = String(passcode || '');
  if (!normalized) return { data: null, error: { message: 'Email or phone is required.' } };
  if (code.length < 4) return { data: null, error: { message: 'Passcode must be at least 4 characters.' } };
  if (Object.values(db.users).some(user => user.identifier === normalized)) return { data: null, error: { message: 'An account with this email/phone already exists. Sign in instead.' } };

  const id = uuid();
  const user = defaultUser(id, normalized, await hashPasscode(code));
  db.users[id] = user;
  db.accounts[id] = defaultAccount();
  persist();
  sessionUserId = id;
  storage.setItem(SESSION_KEY, id);
  emit('SIGNED_IN');
  return { data: { user, session: makeSession(user) }, error: null };
}

async function signInWithPasscode(identifier, passcode) {
  const normalized = normalizeIdentifier(identifier);
  const user = Object.values(db.users).find(candidate => candidate.identifier === normalized);
  if (!user) return { data: null, error: { message: 'Account not found. Create an account first.' } };
  if ((await hashPasscode(passcode)) !== user.passcodeHash) return { data: null, error: { message: 'Incorrect passcode.' } };
  sessionUserId = user.id;
  if (!db.accounts[user.id]) db.accounts[user.id] = defaultAccount();
  storage.setItem(SESSION_KEY, user.id);
  emit('SIGNED_IN');
  return { data: { user, session: makeSession(user) }, error: null };
}

async function getSession() {
  const user = currentUser();
  return { data: { session: makeSession(user) }, error: null };
}

export const supabase = {
  get __localMode() { return true; },
  from: table => new LocalQuery(table),
  auth: {
    getSession,
    signUpWithPasscode,
    signInWithPasscode,
    onAuthStateChange: callback => {
      listeners.add(callback);
      queueMicrotask(() => callback?.(currentUser() ? 'SIGNED_IN' : 'SIGNED_OUT', makeSession(currentUser())));
      return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } };
    },
    signOut: async () => {
      sessionUserId = null;
      try { storage.removeItem(SESSION_KEY); } catch { /* ignore */ }
      emit('SIGNED_OUT');
      return { data: null, error: null };
    },
  },
};
