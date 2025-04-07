import { IConnection } from '@sqltools/types';

export interface IRedshiftConnection extends IConnection {
  roleArn?: string; // Optional, as it can be provided via dialog
  clusterIdentifier: string;
  database: string;
  region: string;
  dbUser: string;
  dbGroup?: string;
  durationSeconds?: number;
}
