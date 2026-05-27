import { promisify } from 'util';
import { createClient } from 'redis';

class RedisClient {
  constructor() {
    this.client = createClient();
    this.client.on('error', (error) => {
      console.log(`Redis client error: ${error}`);
    });

    if (typeof this.client.connect === 'function') {
      this.client.connect().catch((error) => {
        console.log(`Redis client error: ${error}`);
      });
    } else {
      this.getAsync = promisify(this.client.get).bind(this.client);
      this.setAsync = promisify(this.client.set).bind(this.client);
      this.delAsync = promisify(this.client.del).bind(this.client);
      this.setexAsync = promisify(this.client.setex).bind(this.client);
    }
  }

  isAlive() {
    if (typeof this.client.isOpen === 'boolean') {
      return this.client.isOpen;
    }

    return this.client.connected;
  }

  async get(key) {
    if (this.getAsync) {
      return this.getAsync(key);
    }

    return this.client.get(key);
  }

  async set(key, value, duration) {
    if (this.setexAsync) {
      await this.setexAsync(key, duration, value);
      return;
    }

    await this.setAsync(key, value, {
      EX: duration,
    });
  }

  async del(key) {
    if (this.delAsync) {
      await this.delAsync(key);
      return;
    }

    await this.client.del(key);
  }
}

const redisClient = new RedisClient();

export default redisClient;
