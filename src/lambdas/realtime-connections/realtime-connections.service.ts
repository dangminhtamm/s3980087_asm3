import type { RealtimeConnectionPort } from './ports.js';

export class RealtimeConnectionsService {
  constructor(
    private readonly connections: RealtimeConnectionPort,
    private readonly nowEpochSeconds: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  async connect(ticket: string | undefined, connectionId: string | undefined): Promise<boolean> {
    if (!ticket || !connectionId) return false;
    const identity = await this.connections.consumeTicket(ticket);
    const now = this.nowEpochSeconds();
    if (!identity || identity.expiresAt < now) return false;
    await this.connections.saveConnection(connectionId, identity, now + 2 * 60 * 60);
    return true;
  }

  async disconnect(connectionId: string | undefined): Promise<void> {
    if (connectionId) await this.connections.deleteConnection(connectionId);
  }
}
