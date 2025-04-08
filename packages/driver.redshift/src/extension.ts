import { IExtension, IExtensionPlugin, IDriverExtensionApi } from '@sqltools/types';
import { ExtensionContext, extensions } from 'vscode';
import { DRIVER_ALIASES } from './constants';

const { publisher, name } = require('../package.json');
const driverName = 'Redshift';
const extensionId = `${publisher}.${name}`;

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
  };
}

export function deactivate() {}
