import { randomUUID } from 'node:crypto';

export interface IdGeneratorPort {
  next(): string;
}

export const randomIdGenerator: IdGeneratorPort = {
  next: randomUUID,
};
