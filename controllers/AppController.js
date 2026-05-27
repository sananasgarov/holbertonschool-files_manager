import dbClient from '../utils/db.mjs';
import redisClient from '../utils/redis.mjs';

class AppController {
  static getStatus(request, response) {
    return response.status(200).json({
      redis: redisClient.isAlive(),
      db: dbClient.isAlive(),
    });
  }

  static async getStats(request, response) {
    return response.status(200).json({
      users: await dbClient.nbUsers(),
      files: await dbClient.nbFiles(),
    });
  }
}

export default AppController;
