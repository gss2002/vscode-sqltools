import BaseDriver from '@sqltools/base-driver';
import { IConnection } from '@sqltools/types';
import {
  RedshiftClient,
  DescribeClustersCommand,
  GetClusterCredentialsWithIAMCommand,
} from '@aws-sdk/client-redshift';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { Pool } from 'pg';
import queries from './queries';

// Define the connection interface
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

export default class RedshiftDriver extends BaseDriver<Pool, {}> {
  private pool: Pool | null = null;
  public queries = queries;

  constructor(credentials: RedshiftConnection) {
    super(credentials, () => Promise.resolve([])); // Pass credentials and empty workspace folders
  }

  public async open(): Promise<Pool> {
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
    return this.pool;
  }

  public async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  public async query(query: string): Promise<any> {
    if (!this.pool) {
      await this.open();
    }
    const result = await this.pool!.query(query);
    return result.rows;
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
