import { cloudFleetApi } from '../../../shared/api/http-client';
import { fallbackOrThrow } from '../../../shared/api/fallback';
import type {
  AnalyticsOverviewData,
  AnalyticsRun,
  DataResult,
  OperationalIssue,
} from '../../../types/admin';
import type { ApiEnvelope } from '../../../types/order';

export const listOperationalIssues = async (limit = 100): Promise<OperationalIssue[]> => {
  const response = await cloudFleetApi.get<ApiEnvelope<OperationalIssue[]>>(
    '/api/operations/issues',
    { params: { limit } },
  );
  return response.data.data;
};
export const getAnalyticsOverview = async (params?: {
  from?: string;
  to?: string;
  region?: string;
}): Promise<DataResult<AnalyticsOverviewData>> => {
  try {
    const response = await cloudFleetApi.get<ApiEnvelope<AnalyticsOverviewData>>(
      '/api/analytics/overview',
      { params },
    );
    return { data: response.data.data, isFallback: false };
  } catch (error: unknown) {
    return fallbackOrThrow(error, async () =>
      (await import('../../dev/mock-data.adapter')).devMockData.analytics(params),
    );
  }
};
export const startAnalyticsRun = async (): Promise<AnalyticsRun> => {
  const response = await cloudFleetApi.post<ApiEnvelope<AnalyticsRun>>('/api/analytics/runs');
  return response.data.data;
};
export const getAnalyticsRun = async (runId: string): Promise<AnalyticsRun> => {
  const response = await cloudFleetApi.get<ApiEnvelope<AnalyticsRun>>(
    `/api/analytics/runs/${encodeURIComponent(runId)}`,
  );
  return response.data.data;
};
