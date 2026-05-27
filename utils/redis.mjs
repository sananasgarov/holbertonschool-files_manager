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

    if (this.client && typeof this.client.isOpen === 'boolean' && !this.client.isOpen) {
      return null;
    }

    try {
      return await this.client.get(key);
    } catch (error) {
      console.log(`Redis get error: ${error}`);
      return null;
    }
  }

  async set(key, value, duration) {
    if (this.setexAsync) {
      try {
        await this.setexAsync(key, duration, value);
      } catch (error) {
        console.log(`Redis set error: ${error}`);
      }
      return;
    }

    if (this.client && typeof this.client.isOpen === 'boolean' && !this.client.isOpen) {
      return;
    }

    try {
      await this.setAsync(key, value, {
        EX: duration,
      });
    } catch (error) {
      console.log(`Redis set error: ${error}`);
    }
  }

  async del(key) {
    if (this.delAsync) {
      try {
        await this.delAsync(key);
      } catch (error) {
        console.log(`Redis del error: ${error}`);
      }
      return;
    }

    if (this.client && typeof this.client.isOpen === 'boolean' && !this.client.isOpen) {
      return;
    }

    try {
      await this.client.del(key);
    } catch (error) {
      console.log(`Redis del error: ${error}`);
    }
  }
}

const redisClient = new RedisClient();

export default redisClient;
