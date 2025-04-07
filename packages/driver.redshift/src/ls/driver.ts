import BaseDriver from '@sqltools/base-driver';
import { NSDatabase, ContextValue, MConnectionExplorer } from '@sqltools/types';
import { Pool, PoolConfig } from 'pg';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { RedshiftClient, DescribeClustersCommand, GetClusterCredentialsCommand } from '@aws-sdk/client-redshift';
import { IRedshiftConnection } from '../types';
import * as vscode from 'vscode';
import queries from './queries';

export default class RedshiftDriver extends BaseDriver<Pool, {}> {
  private pool: Pool | null = null;
  public declare credentials: IRedshiftConnection;
  public queries = queries;

  public async open(): Promise<Pool> {
    if (this.pool) {
      return this.pool;
    }

    const { roleArn, clusterIdentifier, database, region, dbUser, dbGroup, durationSeconds } = this.credentials as IRedshiftConnection;

    // Prompt for Role ARN if not provided
    let finalRoleArn = roleArn;
    if (!finalRoleArn) {
      finalRoleArn = await vscode.window.showInputBox({
        prompt: 'Enter the IAM Role ARN to assume',
        placeHolder: 'arn:aws:iam::123456789012:role/RedshiftRole',
        validateInput: (value) => {
          if (!value.startsWith('arn:aws:iam::')) {
            return 'Please enter a valid IAM Role ARN';
          }
          return null;
        },
      });

      if (!finalRoleArn) {
        throw new Error('IAM Role ARN is required to connect to Redshift');
      }
    }

    try {
      // Step 1: Assume Role using STS
      const stsClient = new STSClient({ region });
      const assumeRoleResponse = await stsClient.send(
        new AssumeRoleCommand({
          RoleArn: finalRoleArn,
          RoleSessionName: 'RedshiftDriverSession',
          DurationSeconds: 3600 // 1 hour
        })
      );

      if (!assumeRoleResponse.Credentials) {
        throw new Error('Failed to obtain temporary credentials from STS');
      }

      const credentials = {
        accessKeyId: assumeRoleResponse.Credentials.AccessKeyId!,
        secretAccessKey: assumeRoleResponse.Credentials.SecretAccessKey!,
        sessionToken: assumeRoleResponse.Credentials.SessionToken!
      };

      // Step 2: Create Redshift Client with assumed credentials
      const redshiftClient = new RedshiftClient({ region, credentials });

      // Step 3: Get cluster endpoint
      const describeClustersResponse = await redshiftClient.send(
        new DescribeClustersCommand({ ClusterIdentifier: clusterIdentifier })
      );

      const cluster = describeClustersResponse.Clusters?.[0];
      if (!cluster || !cluster.Endpoint) {
        throw new Error('Cluster not found or endpoint unavailable');
      }

      const host = cluster.Endpoint.Address;
      const port = cluster.Endpoint.Port || 5439;

      // Step 4: Get temporary database credentials
      const getCredentialsResponse = await redshiftClient.send(
        new GetClusterCredentialsCommand({
          ClusterIdentifier: clusterIdentifier,
          DbName: database,
          DbUser: dbUser,
          DbGroups: dbGroup ? [dbGroup] : undefined,
          DurationSeconds: durationSeconds || 3600,
        })
      );

      if (!getCredentialsResponse.DbUser || !getCredentialsResponse.DbPassword) {
        throw new Error('Failed to obtain database credentials');
      }

      // Step 5: Connect to Redshift using pg
      const poolConfig: PoolConfig = {
        host,
        port,
        database,
        user: getCredentialsResponse.DbUser,
        password: getCredentialsResponse.DbPassword,
        ssl: { rejectUnauthorized: false }, // Adjust SSL settings as needed
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000
      };

      this.pool = new Pool(poolConfig);
      await this.pool.connect(); // Test connection

      // Log connection details for debugging
      console.log(`Connected to Redshift: host=${host}, port=${port}, user=${getCredentialsResponse.DbUser}`);

      return this.pool;
    } catch (error) {
      throw new Error(`Connection failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public async close(): Promise<void> {
    if (!this.pool) {
      return;
    }
    await this.pool.end();
    this.pool = null;
  }

  public async query(query: string): Promise<NSDatabase.IResult[]> {
    await this.open();
    if (!this.pool) {
      throw new Error('No active connection to Redshift');
    }

    try {
      const result = await this.pool.query(query);
      return [{
        connId: this.credentials.id,
        cols: result.fields.map(f => f.name),
        results: result.rows,
        query,
        messages: [],
        requestId: Date.now().toString(),
        resultId: Date.now().toString(),
      }];
    } catch (error) {
      throw new Error(`Query failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public async testConnection(): Promise<void> {
    await this.open();
    await this.close();
  }

  public async getChildrenForItem({ item }: { item: MConnectionExplorer.IChildItem }): Promise<MConnectionExplorer.IChildItem[]> {
    if (item.type === ContextValue.CONNECTION) {
      return [
        { 
          label: 'Tables', 
          type: ContextValue.RESOURCE_GROUP, 
          iconId: 'folder', 
          childType: ContextValue.TABLE,
          schema: '',
          database: this.credentials.database
        },
        { 
          label: 'Schemas', 
          type: ContextValue.RESOURCE_GROUP, 
          iconId: 'folder', 
          childType: ContextValue.SCHEMA,
          schema: '',
          database: this.credentials.database
        },
      ];
    }
    return [];
  }

  public async searchItems(): Promise<NSDatabase.SearchableItem[]> {
    return [];
  }

  public async describeTable(metadata: NSDatabase.ITable, _opt: any): Promise<NSDatabase.IResult[]> {
    const query = queries.describeTable({ ...metadata, type: ContextValue.TABLE, isView: false }).toString();
    const results = await this.query(query);
    return results;
  }

  public async showRecords(table: NSDatabase.ITable, opt: { limit: number; page?: number } & any): Promise<NSDatabase.IResult[]> {
    const limit = opt.limit || 50;
    const offset = opt.page ? (opt.page - 1) * limit : 0;
    const fetchQuery = queries.fetchRecords({ table, limit, offset }).toString();
    const countQuery = queries.countRecords({ table }).toString();
    const results = await this.query(`${fetchQuery}\n${countQuery}`);
    return results;
  }
}
