import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import pkg from 'mongodb';
import mime from 'mime-types';
import dbClient from '../utils/db';
import fileQueue from '../utils/fileQueue';
import redisClient from '../utils/redis';

const ObjectId = pkg.ObjectId || pkg.ObjectID;

class FilesController {
  static async getAuthenticatedUser(request, response) {
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

    if (!ObjectId.isValid(userId) || !dbClient.db) {
      response.status(401).json({ error: 'Unauthorized' });
      return null;
    }

    const user = await dbClient.db.collection('users').findOne({
      _id: new ObjectId(userId),
    });

    if (!user) {
      response.status(401).json({ error: 'Unauthorized' });
      return null;
    }

    return user;
  }

  static async getAuthenticatedUserId(request, response) {
    const user = await FilesController.getAuthenticatedUser(request, response);
    if (!user) {
      return null;
    }

    return user._id.toString();
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
      parentId: file.parentId === 0 || file.parentId === '0'
        ? 0
        : file.parentId.toString(),
    };
  }

  static getUserIdMatch(userId) {
    const userIdString = userId.toString();

    return ObjectId.isValid(userIdString)
      ? { $in: [new ObjectId(userIdString), userIdString] }
      : userIdString;
  }

  static getParentIdMatch(parentId) {
    if (
      parentId === undefined
      || parentId === null
      || parentId === ''
      || parentId === 0
      || parentId === '0'
    ) {
      return { $in: [0, '0'] };
    }

    return ObjectId.isValid(parentId)
      ? { $in: [new ObjectId(parentId), parentId] }
      : parentId;
  }

  static async findOwnedFile(userId, fileId) {
    if (!ObjectId.isValid(fileId)) {
      return null;
    }

    return dbClient.db.collection('files').findOne({
      _id: new ObjectId(fileId),
      userId: FilesController.getUserIdMatch(userId),
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

    const filesCollection = dbClient.db.collection('files');
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
      parentObjectId = 0;
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
    const user = await FilesController.getAuthenticatedUser(request, response);
    if (!user) {
      return null;
    }

    const file = await FilesController.findOwnedFile(user._id, request.params.id);
    if (!file) {
      return response.status(404).json({ error: 'Not found' });
    }

    return response.status(200).json(FilesController.formatFile(file));
  }

  static async getFile(request, response) {
    const filesCollection = dbClient.db.collection('files');
    let file;

    try {
      file = await filesCollection.findOne({ _id: new ObjectId(request.params.id) });
    } catch (error) {
      file = null;
    }

    if (!file) {
      return response.status(404).json({ error: 'Not found' });
    }

    if (file.type === 'folder') {
      return response.status(400).json({ error: "A folder doesn't have content" });
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

    if (!file.localPath) {
      return response.status(404).json({ error: 'Not found' });
    }

    const { size } = request.query || {};
    let { localPath } = file;
    if (file.type === 'image' && ['500', '250', '100'].includes(String(size))) {
      localPath = `${file.localPath}_${size}`;
    }

    let content;
    try {
      content = await fs.readFile(localPath);
    } catch (error) {
      return response.status(404).json({ error: 'Not found' });
    }

    const contentType = mime.lookup(file.name) || 'application/octet-stream';
    return response.status(200).set('Content-Type', contentType).send(content);
  }

  static async getIndex(request, response) {
    const user = await FilesController.getAuthenticatedUser(request, response);
    if (!user) {
      return null;
    }

    const { parentId = 0, page: pageRaw } = request.query || {};
    const pageNumber = Number(pageRaw);
    const page = Number.isNaN(pageNumber) ? 0 : pageNumber;
    if (!dbClient.db) {
      return response.status(200).json([]);
    }

    const filesCollection = dbClient.db.collection('files');

    const match = {
      userId: FilesController.getUserIdMatch(user._id),
      parentId: FilesController.getParentIdMatch(parentId),
    };

    let files = [];
    try {
      files = await filesCollection.aggregate([
        { $match: match },
        { $skip: page * 20 },
        { $limit: 20 },
      ]).toArray();
    } catch (error) {
      return response.status(200).json([]);
    }

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

    const updatedFile = await dbClient.db.collection('files').findOneAndUpdate(
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

    const updatedFile = await dbClient.db.collection('files').findOneAndUpdate(
      { _id: file._id },
      { $set: { isPublic: false } },
      { returnDocument: 'after' },
    );

    return response.status(200).json(FilesController.formatFile(updatedFile.value));
  }
}

export default FilesController;
