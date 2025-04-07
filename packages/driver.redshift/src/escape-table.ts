import { NSDatabase } from '@sqltools/types';

export const redshiftCheckEscape = (w: string | { label: string }) =>
  /[^a-z0-9_]/.test((<any>w).label || w)
    ? `"${(<any>w).label || w}"`
    : (<any>w).label || w;

function escapeTableName(table: Partial<NSDatabase.ITable> | string) {
  let items: string[] = [];
  let tableObj = typeof table === 'string' ? <NSDatabase.ITable>{ label: table } : table;
  tableObj.database && items.push(redshiftCheckEscape(tableObj.database));
  tableObj.schema && items.push(redshiftCheckEscape(tableObj.schema));
  items.push(redshiftCheckEscape(tableObj.label));
  return items.join('.');
}

export default escapeTableName;
