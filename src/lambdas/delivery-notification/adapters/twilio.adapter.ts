import { durationMsSince, emitMetrics } from '../../../observability/metrics.js';
import type { SmsPort } from '../ports.js';
import type { TwilioConfigurationPort } from './secrets-manager.adapter.js';

const TWILIO_TIMEOUT_MS = 8_000;

export class TwilioSmsAdapter implements SmsPort {
  constructor(
    private readonly configuration: TwilioConfigurationPort,
    private readonly request: typeof fetch = fetch,
  ) {}

  async send(customerPhone: string, message: string): Promise<string> {
    const startedAt = process.hrtime.bigint();
    emitMetrics([{ name: 'SmsAttemptCount', value: 1, unit: 'Count' }], { Provider: 'Twilio' });
    try {
      const config = await this.configuration.get();
      const response = await this.request(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ To: customerPhone, From: config.fromNumber, Body: message }),
          signal: AbortSignal.timeout(TWILIO_TIMEOUT_MS),
        },
      );
      if (!response.ok) throw new Error(`Twilio returned HTTP ${response.status}`);
      const payload = (await response.json()) as { sid?: unknown };
      emitMetrics(
        [
          { name: 'SmsProviderDuration', value: durationMsSince(startedAt), unit: 'Milliseconds' },
          { name: 'SmsSuccessCount', value: 1, unit: 'Count' },
        ],
        { Provider: 'Twilio', Outcome: 'success' },
      );
      emitMetrics([{ name: 'SmsSuccessRate', value: 100, unit: 'Percent' }], {
        Provider: 'Twilio',
      });
      return typeof payload.sid === 'string' ? payload.sid : 'accepted';
    } catch (error: unknown) {
      emitMetrics(
        [
          { name: 'SmsProviderDuration', value: durationMsSince(startedAt), unit: 'Milliseconds' },
          { name: 'SmsFailureCount', value: 1, unit: 'Count' },
        ],
        { Provider: 'Twilio', Outcome: 'error' },
        { errorName: error instanceof Error ? error.name : 'UnknownError' },
      );
      emitMetrics([{ name: 'SmsSuccessRate', value: 0, unit: 'Percent' }], { Provider: 'Twilio' });
      throw error;
    }
  }
}
