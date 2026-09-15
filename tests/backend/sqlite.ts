import { DatabaseSync } from "node:sqlite";
import { LotusStore, type SqlDatabase } from "../../src/agent/store";

export function sqliteStore() {
  const sqlite = new DatabaseSync(":memory:");
  let savepoint = 0;
  const db: SqlDatabase = {
    query: <T>(statement: string, ...bindings: (string | number | null)[]) => sqlite.prepare(statement).all(...bindings) as T[],
    transaction: <T>(fn: () => T) => {
      const name = `lotus_test_${++savepoint}`;
      sqlite.exec(`SAVEPOINT ${name}`);
      try { const result = fn(); sqlite.exec(`RELEASE SAVEPOINT ${name}`); return result; }
      catch (error) { sqlite.exec(`ROLLBACK TO SAVEPOINT ${name}`); sqlite.exec(`RELEASE SAVEPOINT ${name}`); throw error; }
    },
  };
  return { store: new LotusStore(db), sqlite };
}
