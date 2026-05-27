import crypto from 'crypto';
import pkg from 'mongodb';
import dbClient from '../utils/db';
import redisClient from '../utils/redis';

const { ObjectId } = pkg;

class UsersController {
  static async postNew(request, response) {
    const { email, password } = request.body || {};

    if (!email) {
      return response.status(400).json({ error: 'Missing email' });
    }

    if (!password) {
      return response.status(400).json({ error: 'Missing password' });
    }

    const db = await dbClient.getDb();
    const existingUser = await db.collection('users').findOne({ email });
    if (existingUser) {
      return response.status(400).json({ error: 'Already exist' });
    }

    const hashedPassword = crypto.createHash('sha1').update(password).digest('hex');
    const result = await db.collection('users').insertOne({
      email,
      password: hashedPassword,
    });

    return response.status(201).json({
      id: result.insertedId.toString(),
      email,
    });
  }

  static async getMe(request, response) {
    const token = request.headers['x-token'];

    if (!token) {
      return response.status(401).json({ error: 'Unauthorized' });
    }

    const userId = await redisClient.get(`auth_${token}`);
    if (!userId) {
      return response.status(401).json({ error: 'Unauthorized' });
    }

    const db = await dbClient.getDb();
    const user = await db.collection('users').findOne({ _id: new ObjectId(userId) });
    if (!user) {
      return response.status(401).json({ error: 'Unauthorized' });
    }

    return response.status(200).json({
      id: user._id.toString(),
      email: user.email,
    });
  }
}

export default UsersController;
