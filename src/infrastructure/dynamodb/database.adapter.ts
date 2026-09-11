import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import type { DatabasePort } from '../../ports/database.port.js';

export class DynamoDocumentDatabaseAdapter implements DatabasePort {
  public constructor(private readonly client: DynamoDBDocumentClient) {}

  public async send<TResult extends object>(command: object): Promise<TResult> {
    return (await this.client.send(command as never)) as TResult;
  }
}
