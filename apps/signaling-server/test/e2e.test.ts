import { WebSocket } from 'ws'
import { startServer } from '../src/server';
import type { WebRtcMessage } from '@packages/types';
import { expect, describe, beforeAll, afterAll, afterEach, test } from '@jest/globals';

describe('WebSocket Server E2E Tests', () => {
  let clients: WebSocket[] = [];
  let serverControl: ReturnType<typeof startServer>;

  beforeAll(() => {
    serverControl = startServer(8081);
  });

  afterAll(() => {
    serverControl.stop();
  });

  afterEach(async () => {
    await Promise.all(clients.map(client => {
      return new Promise(resolve => {
        if (client.readyState === WebSocket.OPEN) {
          client.on('close', resolve);
          client.close();
        } else {
          resolve(undefined);
        }
      });
    }));
    clients = [];
  });

  const createClients = async (count: number): Promise<void> => {
    const connections: Promise<void>[] = [];

    for (let i = 0; i < count; i++) {
      const client = new WebSocket('ws://localhost:8080');
      const openPromise = new Promise<void>((resolve) => {
        client.on('open', resolve);
      });
      connections.push(openPromise);
      clients.push(client);
    }
    return Promise.all(connections).then(() => { });
  };

  test('Utility function createClients', async () => {
    await createClients(10);
    expect(clients.length).toBe(10);
    clients.forEach((client) => {
      expect(client.readyState).toBe(WebSocket.OPEN);
    });
  });

  const createUserId = () => {
    return Math.random().toString(36).substring(2, 12);
  }

  test('Utility function createUserId', () => {
    const userId = createUserId();
    expect(userId).toBeDefined();
    expect(typeof userId).toBe('string');
    expect(userId.length).toBe(10);
  });

  test('Client can join a room', async () => {
    await createClients(1)

    clients.forEach((client) => {
      const userId = createUserId();

      const message = {
        action: 'join',
        room: 'testRoom',
        type: 'connection',
        userId,
      };
      client!.send(JSON.stringify(message));

    });

  });

  test('2 Clients can join a room', async () => {
    await createClients(2);

    const userId1 = createUserId();
    const userId2 = createUserId();

    const client1 = clients[0];
    const client2 = clients[1];

    client1!.on('message', (data: string) => {
      const response = JSON.parse(data);
      expect(response).toHaveProperty('type', 'join');
    });

    client2!.on('message', (data: string) => {
      const response = JSON.parse(data);
      expect(response).toHaveProperty('room', 'testRoom');
      expect(response).toHaveProperty('userId', userId1);
      expect(response).toHaveProperty('type', 'leave');
    });

    client1!.send(JSON.stringify({
      room: 'testRoom',
      type: 'join',
      from: userId1,
    } satisfies WebRtcMessage))

    client2!.send(JSON.stringify({
      room: 'testRoom',
      type: 'join',
      from: userId2,
    } satisfies WebRtcMessage))

    client1!.send(JSON.stringify({
      room: 'testRoom',
      type: 'leave',
      from: userId1
    } satisfies WebRtcMessage));

  });
});
