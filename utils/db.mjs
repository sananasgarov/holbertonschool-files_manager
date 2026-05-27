import pkg from 'mongodb';

const { MongoClient } = pkg;

class DBClient {
  constructor() {
    const host = process.env.DB_HOST || 'localhost';
    const port = process.env.DB_PORT || '27017';
    const database = process.env.DB_DATABASE || 'files_manager';

    this.connected = false;
    this.database = database;
    this.uri = `mongodb://${host}:${port}`;
    this.client = null;
    this.ready = this.connect();
  }

  async connect() {
    try {
      if (typeof MongoClient.connect === 'function') {
        this.client = await MongoClient.connect(this.uri, {
          useNewUrlParser: true,
          useUnifiedTopology: true,
          connectTimeoutMS: 2000,
          serverSelectionTimeoutMS: 2000,
        });
      } else {
        this.client = new MongoClient(this.uri);
        if (typeof this.client.connect === 'function') {
          await this.client.connect();
        }
      }

      this.connected = true;

      if (typeof this.client.on === 'function') {
        this.client.on('close', () => {
          this.connected = false;
        });

        this.client.on('error', (error) => {
          this.connected = false;
          console.log(`MongoDB client error: ${error}`);
        });
      }
    } catch (error) {
      this.connected = false;
      console.log(`MongoDB client error: ${error}`);
    }
  }

  isAlive() {
    return this.connected;
  }

  async getDb() {
    await this.ready;
    return this.client.db(this.database);
  }

  async nbUsers() {
    const db = await this.getDb();
    return db.collection('users').countDocuments();
  }

  async nbFiles() {
    const db = await this.getDb();
    return db.collection('files').countDocuments();
  }
}

const dbClient = new DBClient();

export default dbClient;
