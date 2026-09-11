import { createHash } from 'node:crypto';

import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import { AppError } from '../errors/app-error.js';

const RETENTION_SECONDS = 24 * 60 * 60;

export interface IdempotencyRequest {
  key: string;
  identity: string;
  method: string;
  path: string;
  body: unknown;
}

export type IdempotencyStart =
  | { kind: 'STARTED'; recordKey: string; fingerprint: string }
  | { kind: 'REPLAY'; statusCode: number; body: unknown };

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};

const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

export const requestFingerprint = (request: IdempotencyRequest): string =>
  digest(`${request.method}\n${request.path}\n${canonicalJson(request.body)}`);

export class IdempotencyService {
  public constructor(
    private readonly database: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  public async begin(request: IdempotencyRequest): Promise<IdempotencyStart> {
    const recordKey = digest(`${request.identity}\n${request.key}`);
    const fingerprint = requestFingerprint(request);
    const now = new Date().toISOString();

    try {
      await this.database.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            PK: `IDEMPOTENCY#${recordKey}`,
            SK: 'REQUEST',
            fingerprint,
            status: 'IN_PROGRESS',
            createdAt: now,
            expiresAt: Math.floor(Date.now() / 1000) + RETENTION_SECONDS,
          },
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      );
      return { kind: 'STARTED', recordKey, fingerprint };
    } catch (error: unknown) {
      if (!(error instanceof ConditionalCheckFailedException)) throw error;
    }

    const existing = await this.database.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: `IDEMPOTENCY#${recordKey}`, SK: 'REQUEST' },
        ConsistentRead: true,
      }),
    );
    const item = existing.Item;
    if (!item) {
      throw new AppError(409, 'The idempotency record changed; retry shortly', 'IDEMPOTENCY_RETRY');
    }
    if (item.fingerprint !== fingerprint) {
      throw new AppError(
        409,
        'This Idempotency-Key was already used for a different request',
        'IDEMPOTENCY_KEY_REUSED',
      );
    }
    if (
      item.status === 'COMPLETED' &&
      typeof item.responseStatus === 'number' &&
      'responseBody' in item
    ) {
      return {
        kind: 'REPLAY',
        statusCode: item.responseStatus,
        body: item.responseBody,
      };
    }
    throw new AppError(
      409,
      'A request with this Idempotency-Key is already in progress',
      'IDEMPOTENCY_IN_PROGRESS',
    );
  }

  public async complete(
    recordKey: string,
    fingerprint: string,
    statusCode: number,
    body: unknown,
  ): Promise<void> {
    const serialized = JSON.stringify(body);
    if (Buffer.byteLength(serialized) > 300_000) {
      throw new Error('Idempotency response exceeds the safe DynamoDB item size');
    }
    await this.database.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: `IDEMPOTENCY#${recordKey}`, SK: 'REQUEST' },
        UpdateExpression:
          'SET #status = :completed, responseStatus = :responseStatus, responseBody = :responseBody, completedAt = :completedAt',
        ConditionExpression: 'fingerprint = :fingerprint AND #status = :inProgress',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':completed': 'COMPLETED',
          ':inProgress': 'IN_PROGRESS',
          ':fingerprint': fingerprint,
          ':responseStatus': statusCode,
          ':responseBody': body,
          ':completedAt': new Date().toISOString(),
        },
      }),
    );
  }

  public async abandon(recordKey: string, fingerprint: string): Promise<void> {
    await this.database.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { PK: `IDEMPOTENCY#${recordKey}`, SK: 'REQUEST' },
        ConditionExpression: 'fingerprint = :fingerprint AND #status = :inProgress',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':fingerprint': fingerprint,
          ':inProgress': 'IN_PROGRESS',
        },
      }),
    );
  }
}
