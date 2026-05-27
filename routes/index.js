import { Router } from 'express';
import AuthController from '../controllers/AuthController';
import AppController from '../controllers/AppController';
import FilesController from '../controllers/FilesController';
import UsersController from '../controllers/UsersController';

const router = Router();

router.get('/status', AppController.getStatus);
router.get('/stats', AppController.getStats);
router.post('/users', UsersController.postNew);
router.post('/files', FilesController.postUpload);
router.get('/files', FilesController.getIndex);
router.get('/files/:id', FilesController.getShow);
router.get('/files/:id/data', FilesController.getFile);
router.put('/files/:id/publish', FilesController.putPublish);
router.put('/files/:id/unpublish', FilesController.putUnpublish);
router.get('/connect', AuthController.getConnect);
router.get('/disconnect', AuthController.getDisconnect);
router.get('/users/me', UsersController.getMe);

export default router;
