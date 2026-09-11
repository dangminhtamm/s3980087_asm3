import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

import { vi } from 'vitest';

URL.createObjectURL = vi.fn(() => 'blob:cloudfleet-test');
URL.revokeObjectURL = vi.fn();
