import Queue from 'bull';

const fileQueue = new Queue('fileQueue', {
  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: process.env.REDIS_PORT || 6379,
  },
});

export default fileQueue;