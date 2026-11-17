import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { protect, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { imageUpload } from '../middleware/upload.js';
import { requireDb } from '../middleware/errorHandler.js';
import { ROLES } from '../utils/constants.js';

import * as auth from '../controllers/authController.js';
import * as vehicles from '../controllers/vehicleController.js';
import * as voice from '../controllers/voiceController.js';
import * as service from '../controllers/serviceController.js';
import * as parts from '../controllers/partsController.js';
import * as analytics from '../controllers/analyticsController.js';
import * as alerts from '../controllers/alertController.js';
import * as customers from '../controllers/customerController.js';
import * as system from '../controllers/systemController.js';

const { MANAGER, LOT_ASSOCIATE, SERVICE_ADVISOR } = ROLES;
const ALL = [MANAGER, LOT_ASSOCIATE, SERVICE_ADVISOR];
const ops = [MANAGER, SERVICE_ADVISOR];

const router = Router();

router.get('/health', system.systemStatus);

/* ---------- Public ---------- */
const publicLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false });
router.get('/public/track/:code', publicLimiter, requireDb, customers.publicTrack);

/* ---------- Auth ---------- */
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 100, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: { message: 'Too many sign-in attempts. Try again in a few minutes.' } } });
const authRouter = Router();
authRouter.post('/login', authLimiter, validate(auth.loginSchema), auth.login);
authRouter.post('/demo', authLimiter, validate(auth.demoSchema), auth.demoLogin);
authRouter.post('/refresh', authLimiter, validate(auth.refreshSchema), auth.refresh);
authRouter.post('/logout', protect, auth.logout);
authRouter.get('/me', protect, auth.me);
router.use('/auth', requireDb, authRouter);

/* ---------- Everything below requires a session ---------- */
router.use(requireDb, protect);

router.get('/system/status', system.systemStatus);
router.post('/system/demo/reset', requireRole(MANAGER), system.resetDemo);
router.post('/uploads', requireRole(...ALL), imageUpload.array('photos', 6), system.upload);

// Vehicles
router.get('/vehicles', requireRole(...ALL), vehicles.listVehicles);
router.get('/vehicles/lot', requireRole(...ALL), vehicles.lotMap);
router.get('/vehicles/:id', requireRole(...ALL), vehicles.getVehicle);
router.patch('/vehicles/:id', requireRole(...ALL), validate(vehicles.patchSchema), vehicles.patchVehicle);
router.get('/vehicles/:id/activity', requireRole(...ALL), vehicles.vehicleActivity);
router.post('/vehicles/:id/photos', requireRole(...ALL), imageUpload.array('photos', 6), vehicles.uploadVehiclePhotos);

// Voice lot assistant
router.get('/voice/samples', requireRole(...ALL), voice.samples);
router.get('/voice/recent', requireRole(...ALL), voice.recent);
router.post('/voice/process', requireRole(LOT_ASSOCIATE, MANAGER), validate(voice.processSchema), voice.process);
router.post('/voice/preview', requireRole(LOT_ASSOCIATE, MANAGER), voice.preview);
router.post('/voice/confirm', requireRole(LOT_ASSOCIATE, MANAGER), validate(voice.confirmSchema), voice.confirm);

// Inspections
router.get('/inspections', requireRole(...ALL), service.listInspections);
router.post('/inspections', requireRole(...ALL), validate(service.inspectionSchema), service.postInspection);
router.post('/inspections/:id/convert', requireRole(...ops), service.convertInspection);
router.patch('/inspections/:id', requireRole(...ops), service.patchInspection);

// Service orchestration
router.get('/service/tasks', requireRole(...ops), service.listTasks);
router.post('/service/tasks', requireRole(...ops), validate(service.createTaskSchema), service.createTask);
router.get('/service/tasks/:id', requireRole(...ops), service.getTask);
router.patch('/service/tasks/:id', requireRole(...ops), validate(service.patchTaskSchema), service.patchTask);
router.post('/service/tasks/:id/parts', requireRole(...ops), validate(service.addPartSchema), service.addPart);
router.get('/service/board', requireRole(...ops), service.board);
router.get('/service/technicians', requireRole(...ops), service.technicians);
router.get('/service/bays', requireRole(...ops), service.bays);
router.get('/service/dispatch/recommendation', requireRole(...ops), service.recommendation);
router.post('/service/dispatch/apply', requireRole(...ops), service.applyDispatch);

// Parts
router.get('/parts', requireRole(...ops), parts.listParts);
router.get('/parts/transfers', requireRole(...ops), parts.listTransfers);
router.post('/parts/transfers/:id/receive', requireRole(...ops), parts.receive);
router.post('/parts/resolve', requireRole(...ops), validate(parts.resolveSchema), parts.resolveParts);
router.get('/parts/:partNumber/availability', requireRole(...ops), parts.partAvailability);

// Analytics
router.get('/analytics/dashboard', requireRole(...ops), analytics.dashboard);
router.get('/analytics/aging', requireRole(...ops), analytics.aging);
router.get('/analytics/aging/:vehicleId', requireRole(...ALL), analytics.agingExplain);
router.post('/analytics/aging/:vehicleId/playbook', requireRole(MANAGER), analytics.agingPlaybook);
router.get('/analytics/stores', requireRole(MANAGER), analytics.stores);
router.get('/analytics/sustainability', requireRole(MANAGER), analytics.sustainability);

// Alerts & AI actions
router.get('/alerts', requireRole(...ALL), alerts.listAlerts);
router.patch('/alerts/:id', requireRole(...ops), validate(alerts.alertPatchSchema), alerts.patchAlert);
router.get('/actions', requireRole(...ops), alerts.listActionsHandler);
router.post('/actions/:id/apply', requireRole(...ops), alerts.applyActionHandler);

// Customers
router.get('/customers', requireRole(...ops), customers.listCustomers);
router.get('/customers/:id/service-status', requireRole(...ops), customers.customerStatus);
router.patch('/customers/:id/service-status', requireRole(...ops), validate(customers.statusPatchSchema), customers.patchCustomerStatus);
router.post('/customers/:id/notify', requireRole(...ops), customers.notifyCustomer);

export default router;
