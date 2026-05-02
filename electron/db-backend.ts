import { initBetterSQLite, resetBetterSQLite } from './better-sqlite3-engine';
import { createSqliteDataStore } from '../src/db/sqlite-data-store';
import { createActionHandler } from '../src/db/worker/action-handler';

const dataStore = createSqliteDataStore(initBetterSQLite, resetBetterSQLite);
const handleAction = createActionHandler(dataStore);

export { handleAction };
