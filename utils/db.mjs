import pkg from 'mongodb';

const { MongoClient } = pkg;

class DBClient {
  constructor() {
    const host = process.env.DB_HOST || 'localhost';
    const port = process.env.DB_PORT || '27017';
    const database = process.env.DB_DATABASE || 'files_manager';

    this.connected = false;
    this.database = database;
    this.client = new MongoClient(`mongodb://${host}:${port}`);

    this.client.connect()
      .then(() => {
        this.connected = true;
      })
      .catch((error) => {
        this.connected = false;
        console.log(`MongoDB client error: ${error}`);
      });

    this.client.on('close', () => {
      this.connected = false;
    });
    this.client.on('error', (error) => {
      this.connected = false;
      console.log(`MongoDB client error: ${error}`);
    });
  }

  isAlive() {
    return this.connected;
  }

  get db() {
    if (!this.connected) {
      return null;
    }

    return this.client.db(this.database);
  }

  async nbUsers() {
    return this.db.collection('users').countDocuments();
  }

  async nbFiles() {
    return this.db.collection('files').countDocuments();
  }
}

const dbClient = new DBClient();

export default dbClient;
