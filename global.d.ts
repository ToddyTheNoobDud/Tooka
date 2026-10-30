interface Map<K, V> {
  /**
   * If an entry with the given `key` already exists, its value is returned.
   * Otherwise, a new entry is added with the given `key` mapped to `defaultValue`,
   * and `defaultValue` is returned.
   */
  getOrInsert(key: K, defaultValue: V): V;

  /**
   * If an entry with the given `key` already exists, its value is returned.
   * Otherwise, `callback` is called with `key`, a new entry is added mapping `key`
   * to the callback's return value, and that value is returned.
   */
  getOrInsertComputed(key: K, callback: (key: K) => V): V;
}

interface WeakMap<K extends WeakKey, V> {
  getOrInsert(key: K, defaultValue: V): V;
  getOrInsertComputed(key: K, callback: (key: K) => V): V;
}
