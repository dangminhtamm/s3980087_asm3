export interface RealtimeIdentity {
  subject: string;
  username: string;
  roles: string[];
  expiresAt: number;
}

export interface RealtimeConnectionPort {
  consumeTicket(ticket: string): Promise<RealtimeIdentity | null>;
  saveConnection(
    connectionId: string,
    identity: RealtimeIdentity,
    expiresAt: number,
  ): Promise<void>;
  deleteConnection(connectionId: string): Promise<void>;
}
