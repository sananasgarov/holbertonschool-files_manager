import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import dbClient from '../utils/db';
import redisClient from '../utils/redis';

class AuthController {
  static async getConnect(request, response) {
    const authorization = request.headers.authorization || '';
    if (!authorization.startsWith('Basic ')) {
      return response.status(401).json({ error: 'Unauthorized' });
    }

    const base64Credentials = authorization.slice(6);
    const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
    const separatorIndex = credentials.indexOf(':');

    if (separatorIndex === -1) {
      return response.status(401).json({ error: 'Unauthorized' });
    }

    const email = credentials.slice(0, separatorIndex);
    const password = credentials.slice(separatorIndex + 1);
    const hashedPassword = crypto.createHash('sha1').update(password).digest('hex');

    const db = await dbClient.getDb();
    const user = await db.collection('users').findOne({ email, password: hashedPassword });
    if (!user) {
      return response.status(401).json({ error: 'Unauthorized' });
    }

    const token = uuidv4();
    await redisClient.set(`auth_${token}`, user._id.toString(), 86400);

    return response.status(200).json({ token });
  }

  static async getDisconnect(request, response) {
    const token = request.headers['x-token'];

    if (!token) {
      return response.status(401).json({ error: 'Unauthorized' });
    }

    const userId = await redisClient.get(`auth_${token}`);
    if (!userId) {
      return response.status(401).json({ error: 'Unauthorized' });
    }

    await redisClient.del(`auth_${token}`);
    return response.status(204).end();
  }
}

export default AuthController;