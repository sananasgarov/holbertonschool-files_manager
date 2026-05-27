import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import pkg from 'mongodb';
import mime from 'mime-types';
import dbClient from '../utils/db';
import fileQueue from '../utils/fileQueue';
import redisClient from '../utils/redis';

const { ObjectId } = pkg;

class FilesController {
  static async getAuthenticatedUserId(request, response) {
    const token = request.headers['x-token'];
    if (!token) {
      response.status(401).json({ error: 'Unauthorized' });
      return null;
    }

    const userId = await redisClient.get(`auth_${token}`);
    if (!userId) {
      response.status(401).json({ error: 'Unauthorized' });
      return null;
    }

    return userId;
  }
    static async getTokenUserId(request) {
      const token = request.headers['x-token'];
      if (!token) {
        return null;
      }

      return redisClient.get(`auth_${token}`);
    }

    static formatFile(file) {
      return {
        id: file._id.toString(),
        userId: file.userId.toString(),
        name: file.name,
        type: file.type,
        isPublic: Boolean(file.isPublic),
        parentId: file.parentId === '0' ? 0 : file.parentId.toString(),
      };
    }

    static async findOwnedFile(userId, fileId) {
      if (!ObjectId.isValid(fileId)) {
        return null;
      }

      const db = await dbClient.getDb();
      return db.collection('files').findOne({
        _id: new ObjectId(fileId),
        userId: new ObjectId(userId),
      });
    }

    static async postUpload(request, response) {
      const userId = await FilesController.getAuthenticatedUserId(request, response);
      if (!userId) {
        return null;
      }

      const {
        name,
        type,
        parentId = 0,
        isPublic = false,
        data,
      } = request.body || {};

      if (!name) {
        return response.status(400).json({ error: 'Missing name' });
      }

      const acceptedTypes = ['folder', 'file', 'image'];
      if (!type || !acceptedTypes.includes(type)) {
        return response.status(400).json({ error: 'Missing type' });
      }

      if (type !== 'folder' && !data) {
        return response.status(400).json({ error: 'Missing data' });
      }

      const db = await dbClient.getDb();
      const filesCollection = db.collection('files');
      let parentObjectId = parentId;

      if (parentId !== 0 && parentId !== '0') {
        let parentFile;
        try {
          parentFile = await filesCollection.findOne({ _id: new ObjectId(parentId) });
        } catch (error) {
          parentFile = null;
        }

        if (!parentFile) {
          return response.status(400).json({ error: 'Parent not found' });
        }

        if (parentFile.type !== 'folder') {
          return response.status(400).json({ error: 'Parent is not a folder' });
        }

        parentObjectId = parentFile._id;
      } else {
        parentObjectId = '0';
      }

      const fileDocument = {
        userId: new ObjectId(userId),
        name,
        type,
        isPublic,
        parentId: parentObjectId,
      };

      if (type === 'folder') {
        const result = await filesCollection.insertOne(fileDocument);
        return response.status(201).json({
          id: result.insertedId.toString(),
          userId,
          name,
          type,
          isPublic,
          parentId,
        });
      }

      const folderPath = process.env.FOLDER_PATH && process.env.FOLDER_PATH.length > 0
        ? process.env.FOLDER_PATH
        : '/tmp/files_manager';
      const localPath = path.join(folderPath, uuidv4());

      await fs.mkdir(folderPath, { recursive: true });
      await fs.writeFile(localPath, Buffer.from(data, 'base64'));

      fileDocument.localPath = localPath;
      const result = await filesCollection.insertOne(fileDocument);

      if (type === 'image') {
        await fileQueue.add({
          userId,
          fileId: result.insertedId.toString(),
        });
      }

      return response.status(201).json({
        id: result.insertedId.toString(),
        userId,
        name,
        type,
        isPublic,
        parentId,
      });
    }

    static async getShow(request, response) {
      const userId = await FilesController.getAuthenticatedUserId(request, response);
      if (!userId) {
        return null;
      }

      const file = await FilesController.findOwnedFile(userId, request.params.id);
      if (!file) {
        return response.status(404).json({ error: 'Not found' });
      }

      return response.status(200).json(FilesController.formatFile(file));
    }

    static async getFile(request, response) {
      try {
        const db = await dbClient.getDb();
        const filesCollection = db.collection('files');
        const file = await filesCollection.findOne({ _id: new ObjectId(request.params.id) });

        if (!file) {
          return response.status(404).json({ error: 'Not found' });
        }

        if (!file.isPublic) {
          const userId = await FilesController.getTokenUserId(request);
          if (!userId) {
            return response.status(404).json({ error: 'Not found' });
          }

          if (file.userId.toString() !== userId) {
            return response.status(404).json({ error: 'Not found' });
          }
        }

        if (file.type === 'folder') {
          return response.status(400).json({ error: "A folder doesn't have content" });
        }

        const { localPath: fileLocalPath, name: fileName } = file;

        if (!fileLocalPath) {
          return response.status(404).json({ error: 'Not found' });
        }

        const { size } = request.query || {};
        let localPath = fileLocalPath;
        if (file.type === 'image' && ['500', '250', '100'].includes(String(size))) {
          localPath = `${fileLocalPath}_${size}`;
        }

        let content;
        try {
          content = await fs.readFile(localPath);
        } catch (error) {
          return response.status(404).json({ error: 'Not found' });
        }

        const contentType = mime.lookup(fileName) || 'application/octet-stream';
        return response.status(200).set('Content-Type', contentType).send(content);
      } catch (error) {
        return response.status(404).json({ error: 'Not found' });
      }
    }

    static async getIndex(request, response) {
      const userId = await FilesController.getAuthenticatedUserId(request, response);
      if (!userId) {
        return null;
      }

      const { parentId = '0', page: pageQuery } = request.query || {};
      const pageNumber = Number(pageQuery);
      const page = Number.isNaN(pageNumber) ? 0 : pageNumber;
      const db = await dbClient.getDb();
      const filesCollection = db.collection('files');

      const match = {
        userId: new ObjectId(userId),
        parentId,
      };

      if (parentId !== '0') {
        try {
          match.parentId = new ObjectId(parentId);
        } catch (error) {
          return response.status(200).json([]);
        }
      }

      const files = await filesCollection.aggregate([
        { $match: match },
        { $skip: page * 20 },
        { $limit: 20 },
      ]).toArray();

      return response.status(200).json(files.map(FilesController.formatFile));
    }

    static async putPublish(request, response) {
      const userId = await FilesController.getAuthenticatedUserId(request, response);
      if (!userId) {
        return null;
      }

      const file = await FilesController.findOwnedFile(userId, request.params.id);
      if (!file) {
        return response.status(404).json({ error: 'Not found' });
      }

      const db = await dbClient.getDb();
      const updatedFile = await db.collection('files').findOneAndUpdate(
        { _id: file._id },
        { $set: { isPublic: true } },
        { returnDocument: 'after' },
      );

      return response.status(200).json(FilesController.formatFile(updatedFile.value));
    }

    static async putUnpublish(request, response) {
      const userId = await FilesController.getAuthenticatedUserId(request, response);
      if (!userId) {
        return null;
      }

      const file = await FilesController.findOwnedFile(userId, request.params.id);
      if (!file) {
        return response.status(404).json({ error: 'Not found' });
      }

      const db = await dbClient.getDb();
      const updatedFile = await db.collection('files').findOneAndUpdate(
        { _id: file._id },
        { $set: { isPublic: false } },
        { returnDocument: 'after' },
      );

      return response.status(200).json(FilesController.formatFile(updatedFile.value));
    }
  }

  export default FilesController;

  static async getTokenUserId(request) {
    const token = request.headers['x-token'];
    if (!token) {
      return null;
    }

    return redisClient.get(`auth_${token}`);
  }

  static formatFile(file) {
    return {
      id: file._id.toString(),
      userId: file.userId.toString(),
      name: file.name,
      type: file.type,
      isPublic: Boolean(file.isPublic),
      parentId: file.parentId === '0' ? 0 : file.parentId.toString(),
    };
  }

  static async findOwnedFile(userId, fileId) {
    if (!ObjectId.isValid(fileId)) {
      return null;
    }

    const db = await dbClient.getDb();
    return db.collection('files').findOne({
      _id: new ObjectId(fileId),
      userId: new ObjectId(userId),
    });
  }

  static async postUpload(request, response) {
    const userId = await FilesController.getAuthenticatedUserId(request, response);
    if (!userId) {
      return null;
    }

    const {
      name,
      type,
      parentId = 0,
      isPublic = false,
      data,
    } = request.body || {};

    if (!name) {
      return response.status(400).json({ error: 'Missing name' });
    }

    const acceptedTypes = ['folder', 'file', 'image'];
    if (!type || !acceptedTypes.includes(type)) {
      return response.status(400).json({ error: 'Missing type' });
    }

    if (type !== 'folder' && !data) {
      return response.status(400).json({ error: 'Missing data' });
    }

    const db = await dbClient.getDb();
    const filesCollection = db.collection('files');
    let parentObjectId = parentId;

    if (parentId !== 0 && parentId !== '0') {
      let parentFile;
      try {
        parentFile = await filesCollection.findOne({ _id: new ObjectId(parentId) });
      } catch (error) {
        parentFile = null;
      }

      if (!parentFile) {
        return response.status(400).json({ error: 'Parent not found' });
      }

      if (parentFile.type !== 'folder') {
        return response.status(400).json({ error: 'Parent is not a folder' });
      }

      parentObjectId = parentFile._id;
    } else {
      parentObjectId = '0';
    }

    const fileDocument = {
      userId: new ObjectId(userId),
      name,
      type,
      isPublic,
      parentId: parentObjectId,
    };

    if (type === 'folder') {
      const result = await filesCollection.insertOne(fileDocument);
      return response.status(201).json({
        id: result.insertedId.toString(),
        userId,
        name,
        type,
        isPublic,
        parentId,
      });
    }

    const folderPath = process.env.FOLDER_PATH && process.env.FOLDER_PATH.length > 0
      ? process.env.FOLDER_PATH
      : '/tmp/files_manager';
    const localPath = path.join(folderPath, uuidv4());

    await fs.mkdir(folderPath, { recursive: true });
    await fs.writeFile(localPath, Buffer.from(data, 'base64'));

    fileDocument.localPath = localPath;
    const result = await filesCollection.insertOne(fileDocument);

    if (type === 'image') {
      await fileQueue.add({
        userId,
        fileId: result.insertedId.toString(),
      });
    }

    return response.status(201).json({
      id: result.insertedId.toString(),
      userId,
      name,
      type,
      isPublic,
      parentId,
    });
  }

  static async getShow(request, response) {
    const userId = await FilesController.getAuthenticatedUserId(request, response);
    if (!userId) {
      return null;
    }

    const file = await FilesController.findOwnedFile(userId, request.params.id);
    if (!file) {
      return response.status(404).json({ error: 'Not found' });
    }

    return response.status(200).json(FilesController.formatFile(file));
  }

  static async getFile(request, response) {
    try {
      const db = await dbClient.getDb();
      const filesCollection = db.collection('files');
      const file = await filesCollection.findOne({ _id: new ObjectId(request.params.id) });
      if (!file) {
        return response.status(404).json({ error: 'Not found' });
      }

      if (!file.isPublic) {
        const userId = await FilesController.getTokenUserId(request);
        if (!userId) {
          return response.status(404).json({ error: 'Not found' });
        }

        if (file.userId.toString() !== userId) {
          return response.status(404).json({ error: 'Not found' });
        }
      }

      if (file.type === 'folder') {
        return response.status(400).json({ error: "A folder doesn't have content" });
      }

      const { localPath: fileLocalPath, name: fileName } = file;

      if (!fileLocalPath) {
        return response.status(404).json({ error: 'Not found' });
      }

      const { size } = request.query || {};
      let localPath = fileLocalPath;
      if (file.type === 'image' && ['500', '250', '100'].includes(String(size))) {
        localPath = `${fileLocalPath}_${size}`;
      }

      let content;
      try {
        content = await fs.readFile(localPath);
      } catch (error) {
        return response.status(404).json({ error: 'Not found' });
      }

      const contentType = mime.lookup(fileName) || 'application/octet-stream';
      return response.status(200).set('Content-Type', contentType).send(content);
    } catch (error) {
      return response.status(404).json({ error: 'Not found' });
    }
  }

  static async getIndex(request, response) {
    const userId = await FilesController.getAuthenticatedUserId(request, response);
    if (!userId) {
      return null;
    }

    const { parentId = '0', page: pageQuery } = request.query || {};
    const pageNumber = Number(pageQuery);
    const page = Number.isNaN(pageNumber) ? 0 : pageNumber;
    const db = await dbClient.getDb();
    const filesCollection = db.collection('files');

    const match = {
      userId: new ObjectId(userId),
      parentId,
    };

    if (parentId !== '0') {
      try {
        match.parentId = new ObjectId(parentId);
      } catch (error) {
        return response.status(200).json([]);
      }
    }

    const files = await filesCollection.aggregate([
      { $match: match },
      { $skip: page * 20 },
      { $limit: 20 },
    ]).toArray();

    return response.status(200).json(files.map(FilesController.formatFile));
  }

  static async putPublish(request, response) {
    const userId = await FilesController.getAuthenticatedUserId(request, response);
    if (!userId) {
      return null;
    }

    const file = await FilesController.findOwnedFile(userId, request.params.id);
    if (!file) {
      return response.status(404).json({ error: 'Not found' });
    }

    const db = await dbClient.getDb();
    const updatedFile = await db.collection('files').findOneAndUpdate(
      { _id: file._id },
      { $set: { isPublic: true } },
      { returnDocument: 'after' },
    );

    return response.status(200).json(FilesController.formatFile(updatedFile.value));
  }

  static async putUnpublish(request, response) {
    const userId = await FilesController.getAuthenticatedUserId(request, response);
    if (!userId) {
      return null;
    }

    const file = await FilesController.findOwnedFile(userId, request.params.id);
    if (!file) {
      return response.status(404).json({ error: 'Not found' });
    }

    const db = await dbClient.getDb();
    const updatedFile = await db.collection('files').findOneAndUpdate(
      { _id: file._id },
      { $set: { isPublic: false } },
      { returnDocument: 'after' },
    );

    return response.status(200).json(FilesController.formatFile(updatedFile.value));
  }
}

export default FilesController;

