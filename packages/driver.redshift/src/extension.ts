import * as vscode from 'vscode';
import { IExtension, IExtensionPlugin, IDriverExtensionApi, IDriverAlias } from '@sqltools/types';
import { ExtensionContext } from 'vscode';
import { DRIVER_ALIASES } from './constants';

const driverName = 'Redshift';
export async function activate(extContext: ExtensionContext): Promise<IDriverExtensionApi> {
  const sqltools = vscode.extensions.getExtension<IExtension>('mtxr.sqltools');
  if (!sqltools) {
    throw new Error('SQLTools not installed');
  }
  await sqltools.activate();

  const api = sqltools.exports;

  // Register resources using resourcesMap
  const resources = api.resourcesMap();
  DRIVER_ALIASES.forEach(({ value }) => {
    resources.set(
      `driver/${value}/extension-id`,
      extContext.asAbsolutePath('package.json')
    );
    resources.set(
      `driver/${value}/connection-schema`,
      extContext.asAbsolutePath('connection.schema.json')
    );
    resources.set(
      `driver/${value}/ui-schema`,
      extContext.asAbsolutePath('ui.schema.json')
    );
  });

  const plugin: IExtensionPlugin = {
    name: driverName,
    async register() {
      const resolveConnection = async (connInfo: any) => {
        if (!connInfo.roleArn) {
          const roleArn = await vscode.window.showInputBox({
            prompt: 'Enter the IAM Role ARN to assume',
            placeHolder: 'arn:aws:iam::123456789012:role/RedshiftRole',
            validateInput: (value) => {
              if (!value.startsWith('arn:aws:iam::')) {
                return 'Please enter a valid IAM Role ARN';
              }
              return null;
            },
          });

          if (!roleArn) {
            throw new Error('IAM Role ARN is required to connect to Redshift');
          }

          connInfo.roleArn = roleArn;
        }

        if (connInfo.usePassword === 'Ask on connect') {
          const password = await vscode.window.showInputBox({
            password: true,
            prompt: `Enter password for ${connInfo.name}`,
          });
          if (password === undefined) {
            throw new Error('Password prompt cancelled');
          }
          connInfo.password = password;
          connInfo.usePassword = 'Save as plaintext in settings';
        }
      };

      // Register the driver via the plugin
      return {
        type: 'driver',
        name: driverName,
        aliases: DRIVER_ALIASES.map(({ value }) => value),
        resolveConnection,
      };
    },
  };

  // Register the plugin with SQLTools
  api.registerPlugin(plugin);

  return {
    driverName,
    driverAliases: DRIVER_ALIASES as IDriverAlias[], // Add driverAliases
  };
}

export function deactivate() {}
