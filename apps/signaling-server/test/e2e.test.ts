import { WebSocket } from 'ws'
import { startServer } from '../src/server';
import type { WebRtcMessage } from '@packages/types';
import { expect, describe, beforeAll, afterAll, afterEach, test } from '@jest/globals';

describe('WebSocket Server E2E Tests', () => {
  let clients: WebSocket[] = [];
  let serverControl: ReturnType<typeof startServer>;

  beforeAll(() => {
    serverControl = startServer();
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
    console.log(userId);
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

      client!.on('message', (data: string) => {
        const response = JSON.parse(data) as WebRtcMessage;
        expect(response).toHaveProperty('type', 'notification');
        expect(response).toHaveProperty('room', 'testRoom');
        expect(response).toHaveProperty('message', 'Welcome, you are the first user in this room');
      });
    });

  });

  test('2 Clients can join a room', async () => {
    await createClients(2);

    const message1 = {
      action: 'join',
      room: 'testRoom',
      type: 'connection',
      userId: createUserId(),
    };
    clients[0]!.send(JSON.stringify(message1))

    clients[0]!.on('message', (data: string) => {
      const response = JSON.parse(data);
      expect(response).toHaveProperty('type', 'notification');
    });

    const message2 = {
      action: 'join',
      room: 'testRoom',
      type: 'connection',
      userId: createUserId(),
    };
    clients[1]!.send(JSON.stringify(message2))

    clients[1]!.on('message', (data: string) => {
      const response = JSON.parse(data);
      expect(response).toHaveProperty('action', 'send');
      expect(response).toHaveProperty('room', 'testRoom');
      expect(response).toHaveProperty('userId', message1.userId);
      expect(response).toHaveProperty('type', 'initiateOffer');
    });

  });
});
