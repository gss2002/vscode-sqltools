import { IExtension, IExtensionPlugin, IDriverExtensionApi, IConnection } from '@sqltools/types';
import { ExtensionContext, extensions } from 'vscode';
import { DRIVER_ALIASES } from './constants';

const { publisher, name } = require('../package.json');
const driverName = 'Redshift';
const extensionId = `${publisher}.${name}`;

interface RedshiftConnection extends IConnection<any> {
  roleArn: string;
  clusterIdentifier: string;
  database: string;
  region?: string;
  username: string;
  dbGroup?: string;
  durationSeconds?: number;
  port?: number;
  ssl?: boolean;
}

export async function activate(extContext: ExtensionContext): Promise<IDriverExtensionApi> {
  const sqltools = extensions.getExtension<IExtension>('mtxr.sqltools');
  if (!sqltools) {
    throw new Error('SQLTools not installed');
  }
  await sqltools.activate();

  const api = sqltools.exports;

  const plugin: IExtensionPlugin = {
    extensionId,
    name: `${driverName} Plugin`,
    type: 'driver',
    async register(extension) {
      const icons = {
        active: extContext.asAbsolutePath('icons/active.png'),
        default: extContext.asAbsolutePath('icons/default.png'),
        inactive: extContext.asAbsolutePath('icons/inactive.png'),
      };
      console.log(`Registering icons for Redshift: ${JSON.stringify(icons)}`);
      extension.resourcesMap().set(`driver/${DRIVER_ALIASES[0].value}/icons`, icons);
      DRIVER_ALIASES.forEach(({ value }) => {
        extension.resourcesMap().set(`driver/${value}/extension-id`, extensionId);
        extension.resourcesMap().set(`driver/${value}/connection-schema`, extContext.asAbsolutePath('connection.schema.json'));
        extension.resourcesMap().set(`driver/${value}/ui-schema`, extContext.asAbsolutePath('ui.schema.json'));
      });
      await extension.client.sendRequest('ls/RegisterPlugin', { path: extContext.asAbsolutePath('out/ls/plugin.js') });
      console.log('Redshift driver plugin registered with language server');
    }
  };

  api.registerPlugin(plugin);
  console.log('Redshift Plugin (driver) registered with SQLTools API');

  return {
    driverName,
    driverAliases: DRIVER_ALIASES,
    parseBeforeSaveConnection: ({ connInfo }) => {
  console.log('Before saving, raw connInfo:', JSON.stringify(connInfo, null, 2));
  const cleanedConnInfo: RedshiftConnection = {
    ...connInfo,
    name: connInfo.name,
    driver: 'Redshift',
    roleArn: connInfo.roleArn,
    clusterIdentifier: connInfo.clusterIdentifier,
    database: connInfo.database,
    region: connInfo.region || 'us-east-1',
    username: connInfo.username,
    dbGroup: connInfo.dbGroup || undefined,
    durationSeconds: connInfo.durationSeconds ? Number(connInfo.durationSeconds) : undefined,
    port: connInfo.port ? Number(connInfo.port) : 5439,
    ssl: connInfo.ssl !== undefined ? Boolean(connInfo.ssl) : true,
    id: connInfo.id || `${connInfo.name}-${Date.now()}`,
    isConnected: connInfo.isConnected || false,
    isActive: connInfo.isActive || false
  };
  console.log('After cleaning, connInfo:', JSON.stringify(cleanedConnInfo, null, 2));
  return cleanedConnInfo;
  }
  };
}

export function deactivate() {}
