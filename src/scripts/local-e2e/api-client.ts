import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { ApiErrorEnvelope } from '../../../packages/contracts/index.js';

export class LocalApiClient {
  constructor(
    readonly baseUrl = process.env.LOCAL_API_BASE_URL?.trim() || 'http://localhost:3000',
  ) {}

  async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(['POST', 'PUT', 'PATCH', 'DELETE'].includes(init?.method ?? '')
          ? { 'Idempotency-Key': randomUUID() }
          : {}),
        ...init?.headers,
      },
    });
    if (!response.ok) {
      let providerMessage = '';
      try {
        const body = (await response.json()) as Partial<ApiErrorEnvelope>;
        providerMessage = body.error?.message ? `: ${body.error.message}` : '';
      } catch {
        // Status and path still identify non-JSON failures.
      }
      throw new Error(
        `${init?.method ?? 'GET'} ${path} returned ${response.status}${providerMessage}`,
      );
    }
    return (await response.json()) as T;
  }

  async assertReady(): Promise<void> {
    const health = await fetch(`${this.baseUrl}/health`);
    assert.equal(health.status, 200, 'Backend health check must return HTTP 200');
    const ready = await fetch(`${this.baseUrl}/ready`);
    assert.equal(ready.status, 200, 'Backend readiness check must return HTTP 200');
  }
}

export const logE2eStep = (message: string): void => console.info(`✓ ${message}`);
