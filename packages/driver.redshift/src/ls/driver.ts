import BaseDriver from '@sqltools/base-driver';
import { IConnection, NSDatabase, ContextValue, MConnectionExplorer } from '@sqltools/types';
import {
  RedshiftClient,
  DescribeClustersCommand,
  GetClusterCredentialsWithIAMCommand,
} from '@aws-sdk/client-redshift';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { Pool, PoolClient } from 'pg';
import queries from './queries';
import generateId from '@sqltools/util/internal-id';
import zipObject from 'lodash/zipObject';

interface RedshiftConnection extends IConnection {
  roleArn: string;
  clusterIdentifier: string;
  database: string;
  region: string;
  dbUser: string;
  dbGroup?: string;
  durationSeconds?: number;
  port?: number;
}

interface QueryOptions {
  requestId?: string;
}

export default class RedshiftDriver extends BaseDriver<Pool, {}> {
  private pool: Pool | null = null;
  public queries = queries;

  constructor(credentials: RedshiftConnection) {
    super(credentials, () => Promise.resolve([]));
  }

  public async open(): Promise<Pool> {
    if (this.pool) {
      return this.pool;
    }
    if (!this.credentials) {
      throw new Error('Credentials not initialized');
    }
    const credentials = await this.getCredentials(this.credentials as RedshiftConnection);
    this.pool = new Pool({
      host: await this.getHost(this.credentials as RedshiftConnection),
      port: (this.credentials as RedshiftConnection).port || 5439,
      database: (this.credentials as RedshiftConnection).database,
      user: credentials.dbUser,
      password: credentials.dbPassword,
    });
    const cli = await this.pool.connect();
    cli.release();
    return this.pool;
  }

  public async close(): Promise<void> {
    if (!this.pool) return;
    await this.pool.end();
    this.pool = null;
  }

  public async query(query: string, opt: QueryOptions = {}): Promise<NSDatabase.IResult[]> {
    const messages = [];
    let cli: PoolClient;
    const { requestId } = opt;
    try {
      const pool = await this.open();
      cli = await pool.connect();
      cli.on('notice', notice => messages.push(this.prepareMessage(`${notice.name.toUpperCase()}: ${notice.message}`)));
      const result = await cli.query({ text: query, rowMode: 'array' });
      cli.release();
      const cols = result.fields.map(f => f.name);
      return [{
        requestId,
        resultId: generateId(),
        connId: this.getId(),
        cols,
        messages: messages.concat([this.prepareMessage(`${result.command} successfully executed. ${result.rowCount} rows affected.`)]),
        query,
        results: this.mapRows(result.rows, cols),
      }];
    } catch (error) {
      if (cli) cli.release();
      return [{
        connId: this.getId(),
        requestId,
        resultId: generateId(),
        cols: [],
        messages: messages.concat([this.prepareMessage(error.message || String(error))]),
        error: true,
        rawError: error,
        query,
        results: [],
      }];
    }
  }

  private mapRows(rows: any[], columns: string[]): any[] {
    return rows.map(r => zipObject(columns, r));
  }

  private async getColumns(parent: NSDatabase.ITable): Promise<NSDatabase.IColumn[]> {
    const results = await this.queryResults(this.queries.fetchColumns(parent));
    return results.map(col => ({
      ...col,
      iconName: col.isPk ? 'pk' : (col.isFk ? 'fk' : null),
      childType: ContextValue.NO_CHILD,
      table: parent,
    }));
  }

  public async testConnection(): Promise<void> {
    const pool = await this.open();
    const cli = await pool.connect();
    await cli.query('SELECT 1');
    cli.release();
  }

  public async getChildrenForItem({ item }: { item: MConnectionExplorer.IChildItem }): Promise<MConnectionExplorer.IChildItem[]> {
    switch (item.type) {
      case ContextValue.CONNECTION:
      case ContextValue.CONNECTED_CONNECTION:
        return [
          { 
            label: 'Schemas', 
            type: ContextValue.RESOURCE_GROUP, 
            iconId: 'folder', 
            childType: ContextValue.SCHEMA,
            schema: '',
            database: (this.credentials as RedshiftConnection).database 
          },
        ];
      case ContextValue.TABLE:
        return this.getColumns(item as NSDatabase.ITable);
      case ContextValue.RESOURCE_GROUP:
        if (item.childType === ContextValue.SCHEMA) {
          return this.queryResults(this.queries.fetchSchemas());
        }
        if (item.childType === ContextValue.TABLE) {
          return this.queryResults(this.queries.fetchTables(item as NSDatabase.ISchema));
        }
        return [];
      case ContextValue.SCHEMA:
        return [
          { 
            label: 'Tables', 
            type: ContextValue.RESOURCE_GROUP, 
            iconId: 'folder', 
            childType: ContextValue.TABLE,
            schema: item.label,
            database: (this.credentials as RedshiftConnection).database 
          },
        ];
    }
    return [];
  }

  public searchItems(itemType: ContextValue, search: string, extraParams: any = {}): Promise<NSDatabase.SearchableItem[]> {
    switch (itemType) {
      case ContextValue.TABLE:
        return this.queryResults(this.queries.searchTables({ search }));
      case ContextValue.COLUMN:
        return this.queryResults(this.queries.searchColumns({ search, ...extraParams }));
    }
    return Promise.resolve([]);
  }

  private async getCredentials(conn: RedshiftConnection): Promise<{ dbUser: string; dbPassword: string }> {
    const stsClient = new STSClient({ region: conn.region });
    const assumeRoleParams = {
      RoleArn: conn.roleArn,
      RoleSessionName: `RedshiftSession-${Date.now()}`,
      DurationSeconds: conn.durationSeconds || 3600,
    };
    const { Credentials } = await stsClient.send(new AssumeRoleCommand(assumeRoleParams));
    const redshiftClient = new RedshiftClient({
      region: conn.region,
      credentials: {
        accessKeyId: Credentials!.AccessKeyId!,
        secretAccessKey: Credentials!.SecretAccessKey!,
        sessionToken: Credentials!.SessionToken!,
      },
    });
    const params = {
      ClusterIdentifier: conn.clusterIdentifier,
      DbUser: conn.dbUser,
      DbName: conn.database,
      DbGroups: conn.dbGroup ? [conn.dbGroup] : undefined,
      AutoCreate: false,
      DurationSeconds: conn.durationSeconds || 3600,
    };
    const response = await redshiftClient.send(new GetClusterCredentialsWithIAMCommand(params));
    return {
      dbUser: response.DbUser!,
      dbPassword: response.DbPassword!,
    };
  }

  private async getHost(conn: RedshiftConnection): Promise<string> {
    const redshiftClient = new RedshiftClient({ region: conn.region });
    const { Clusters } = await redshiftClient.send(
      new DescribeClustersCommand({ ClusterIdentifier: conn.clusterIdentifier })
    );
    const cluster = Clusters![0];
    return cluster.Endpoint!.Address!;
  }
}
