import axios from 'axios';

export const getDeliveryErrorMessage = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const message = (error.response?.data as { error?: { message?: string } })?.error?.message;
    if (message) return message;
    if (!error.response) {
      return 'Network connection lost. Your proof is still on this device—retry when online.';
    }
  }
  return 'CloudFleet could not complete this step. Please try again.';
};
