import * as vscode from 'vscode';
import { IExtension, IExtensionPlugin, IDriverExtensionApi, IDriverAlias } from '@sqltools/types';
import { ExtensionContext } from 'vscode';
import { DRIVER_ALIASES } from './constants';
import RedshiftDriver from './ls/plugin';

const driverName = 'Redshift';
let outputChannel: vscode.OutputChannel;

export async function activate(extContext: ExtensionContext): Promise<IDriverExtensionApi> {
  outputChannel = vscode.window.createOutputChannel('Redshift Driver');
  outputChannel.appendLine('Activating SQLTools Redshift Driver extension');

  const sqltools = vscode.extensions.getExtension<IExtension>('mtxr.sqltools');
  if (!sqltools) {
    outputChannel.appendLine('SQLTools extension not found');
    throw new Error('SQLTools not installed');
  }

  outputChannel.appendLine('SQLTools extension found, activating...');
  await sqltools.activate();

  const api = sqltools.exports;
  outputChannel.appendLine('SQLTools API obtained: ' + Object.keys(api).join(', '));

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
    outputChannel.appendLine(`Registered resource: driver/${value}`);
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

      const driverConfig = {
        type: 'driver',
        name: driverName,
        displayName: 'Amazon Redshift',
        description: 'Amazon Redshift driver with IAM authentication',
        aliases: [],
        resolveConnection,
        driver: (conn) => new RedshiftDriver(conn), // Pass connection info
      };

      outputChannel.appendLine('Registering Redshift driver with config:');
      outputChannel.appendLine(JSON.stringify(driverConfig, null, 2));

      return driverConfig;
    },
  };

  outputChannel.appendLine('Registering Redshift driver plugin with SQLTools');
  api.registerPlugin(plugin);

  outputChannel.appendLine('Redshift driver plugin registered successfully');

  const driverApi = {
    driverName,
    driverAliases: DRIVER_ALIASES as IDriverAlias[],
  };

  outputChannel.appendLine('Returning driver API:');
  outputChannel.appendLine(JSON.stringify(driverApi, null, 2));

  return driverApi;
}

export function deactivate() {
  outputChannel.appendLine('Deactivating SQLTools Redshift Driver extension');
  outputChannel.dispose();
}
