import fs from 'fs/promises';
import imageThumbnail from 'image-thumbnail';
import pkg from 'mongodb';
import dbClient from './utils/db.mjs';
import fileQueue from './utils/fileQueue.mjs';

const { ObjectId } = pkg;

fileQueue.process(async (job) => {
  const { userId, fileId } = job.data || {};

  if (!fileId) {
    throw new Error('Missing fileId');
  }

  if (!userId) {
    throw new Error('Missing userId');
  }

  const file = await dbClient.db.collection('files').findOne({
    _id: new ObjectId(fileId),
    userId: new ObjectId(userId),
  });

  if (!file) {
    throw new Error('File not found');
  }

  const buffer = await fs.readFile(file.localPath);
  await Promise.all([500, 250, 100].map(async (width) => {
    const thumbnail = await imageThumbnail(buffer, { width });
    await fs.writeFile(`${file.localPath}_${width}`, thumbnail);
  }));
});

console.log('Worker is running');