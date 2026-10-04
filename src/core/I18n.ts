type Dict = Record<string, unknown>;

/** Text lookup over deep-merged JSON dictionaries; later dictionaries override earlier ones. */
export class I18n {
  private readonly dict: Dict;

  constructor(...dicts: object[]) {
    this.dict = dicts.reduce<Dict>((acc, d) => merge(acc, d as Dict), {});
  }

  /** `t('ui.stars', { n: 2 })` fills `{n}`; a missing or non-text key returns the key itself. */
  t(key: string, vars?: Record<string, string | number>): string {
    const value = this.get(key);
    if (typeof value !== 'string') return key;
    if (!vars) return value;
    return value.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
  }

  get<T = unknown>(key: string): T {
    let node: unknown = this.dict;
    for (const part of key.split('.')) {
      node = typeof node === 'object' && node !== null ? (node as Dict)[part] : undefined;
    }
    return node as T;
  }
}

function isPlainObject(v: unknown): v is Dict {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function merge(base: Dict, extra: Dict): Dict {
  const out: Dict = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    const prev = out[key];
    out[key] = isPlainObject(prev) && isPlainObject(value) ? merge(prev, value) : value;
  }
  return out;
}
