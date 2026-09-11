export interface DatabasePort {
  send<TResult extends object = Record<string, unknown>>(command: object): Promise<TResult>;
}
