import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

function createSafeStorage() {
  try {
    const testKey = '__studybot_storage_test__';
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
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

const storage = createSafeStorage();
const LOCAL_DB_KEY = 'studybot-local-db-v2';
const LOCAL_USER_ID = '00000000-0000-4000-8000-000000000001';

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

function defaultDb() {
  return {
    profiles: [],
    tasks: [],
    monthly_goals: [],
    study_sessions: [],
    quotes: DEFAULT_QUOTES.map(([quote, author]) => ({ id: uuid(), quote, author, active: true })),
    ai_command_log: [],
  };
}

function readDb() {
  try {
    const raw = storage.getItem(LOCAL_DB_KEY);
    if (!raw) return defaultDb();
    const parsed = JSON.parse(raw);
    return { ...defaultDb(), ...parsed };
  } catch {
    return defaultDb();
  }
}

let localDb = readDb();
let localMode = false;

function persistDb() {
  try { storage.setItem(LOCAL_DB_KEY, JSON.stringify(localDb)); } catch { /* memory fallback */ }
}

const localUser = {
  id: LOCAL_USER_ID,
  aud: 'authenticated',
  role: 'authenticated',
  is_anonymous: true,
  app_metadata: { provider: 'anonymous', providers: ['anonymous'] },
  user_metadata: { studybot_local: true },
};

function localResult(data = null, error = null) {
  return { data, error };
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
    this.promise = null;
  }

  select(columns = '*') { this.returnRows = true; this.columns = columns; return this; }
  insert(values) { this.operation = 'insert'; this.values = Array.isArray(values) ? values : [values]; return this; }
  update(values) { this.operation = 'update'; this.values = values || {}; return this; }
  delete() { this.operation = 'delete'; return this; }
  eq(column, value) { this.filters.push({ column, op: 'eq', value }); return this; }
  lt(column, value) { this.filters.push({ column, op: 'lt', value }); return this; }
  lte(column, value) { this.filters.push({ column, op: 'lte', value }); return this; }
  gt(column, value) { this.filters.push({ column, op: 'gt', value }); return this; }
  gte(column, value) { this.filters.push({ column, op: 'gte', value }); return this; }
  order(column, options = {}) { this.ordering = { column, ascending: options.ascending !== false }; return this; }
  single() { this.singleMode = true; return this; }
  maybeSingle() { this.maybeSingleMode = true; return this; }

  async execute() {
    const table = localDb[this.table];
    if (!Array.isArray(table)) return localResult(null, { message: `Unknown local table: ${this.table}` });

    if (this.operation === 'insert') {
      const now = new Date().toISOString();
      const rows = this.values.map(value => ({
        id: value.id || uuid(),
        created_at: value.created_at || now,
        ...value,
      }));
      table.push(...rows);
      persistDb();
      const data = this.singleMode ? rows[0] : rows;
      return localResult(data);
    }

    if (this.operation === 'update') {
      const matched = table.filter(row => matches(row, this.filters));
      matched.forEach(row => Object.assign(row, this.values));
      persistDb();
      if (!this.returnRows) return localResult(null);
      const data = this.singleMode ? matched[0] : matched;
      return localResult(data);
    }

    if (this.operation === 'delete') {
      const matched = table.filter(row => matches(row, this.filters));
      localDb[this.table] = table.filter(row => !matches(row, this.filters));
      persistDb();
      return localResult(this.returnRows ? matched : null);
    }

    let rows = table.filter(row => matches(row, this.filters)).map(row => ({ ...row }));
    if (this.ordering) {
      const { column, ascending } = this.ordering;
      rows.sort((a, b) => {
        const av = a?.[column] ?? '';
        const bv = b?.[column] ?? '';
        const result = String(av).localeCompare(String(bv), undefined, { numeric: true });
        return ascending ? result : -result;
      });
    }

    if (this.singleMode) {
      if (rows.length !== 1) return localResult(null, { message: `JSON object requested, multiple (or no) rows returned` });
      return localResult(rows[0]);
    }
    if (this.maybeSingleMode) {
      if (rows.length > 1) return localResult(null, { message: `JSON object requested, multiple rows returned` });
      return localResult(rows[0] || null);
    }
    return localResult(rows);
  }

  then(resolve, reject) {
    if (!this.promise) this.promise = this.execute();
    return this.promise.then(resolve, reject);
  }
  catch(reject) {
    if (!this.promise) this.promise = this.execute();
    return this.promise.catch(reject);
  }
}

function createLocalFacade() {
  return {
    from: table => new LocalQuery(table),
    auth: {
      getSession: async () => localResult({ session: { user: localUser, access_token: 'local-studybot' } }),
      signInAnonymously: async () => {
        localMode = true;
        return localResult({ session: { user: localUser, access_token: 'local-studybot' }, user: localUser });
      },
      onAuthStateChange: callback => {
        setTimeout(() => callback?.('SIGNED_IN', { user: localUser }), 0);
        return { data: { subscription: { unsubscribe() {} } } };
      },
      signOut: async () => localResult(null),
    },
  };
}

const realClient = url && key
  ? createClient(url, key, {
    auth: {
      storage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  })
  : null;

const localFacade = createLocalFacade();

async function getSession() {
  if (localMode || !realClient) return localFacade.auth.getSession();
  return realClient.auth.getSession();
}

async function signInAnonymously() {
  if (localMode || !realClient) return localFacade.auth.signInAnonymously();
  try {
    const result = await realClient.auth.signInAnonymously();
    if (!result?.error && result?.data?.session) return result;
  } catch (error) {
    console.warn('Supabase anonymous session unavailable; using local StudyBot storage.', error);
  }
  localMode = true;
  return localFacade.auth.signInAnonymously();
}

export const supabase = {
  get __localMode() { return localMode; },
  from: table => (localMode || !realClient ? localFacade.from(table) : realClient.from(table)),
  auth: {
    getSession,
    signInAnonymously,
    onAuthStateChange: callback => {
      if (localMode || !realClient) return localFacade.auth.onAuthStateChange(callback);
      return realClient.auth.onAuthStateChange(callback);
    },
    signOut: async () => {
      if (localMode || !realClient) return localFacade.auth.signOut();
      return realClient.auth.signOut();
    },
  },
};
