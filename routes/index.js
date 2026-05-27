import { Router } from 'express';
import AuthController from '../controllers/AuthController.js';
import AppController from '../controllers/AppController.js';
import FilesController from '../controllers/FilesController.js';
import UsersController from '../controllers/UsersController.js';

const router = Router();

router.get('/status', AppController.getStatus);
router.get('/stats', AppController.getStats);
router.post('/users', UsersController.postNew);
router.post('/files', FilesController.postUpload);
router.get('/files/:id', FilesController.getShow);
router.get('/files/:id/data', FilesController.getFile);
router.get('/files', FilesController.getIndex);
router.put('/files/:id/publish', FilesController.putPublish);
router.put('/files/:id/unpublish', FilesController.putUnpublish);
router.get('/connect', AuthController.getConnect);
router.get('/disconnect', AuthController.getDisconnect);
router.get('/users/me', UsersController.getMe);

export default router;
