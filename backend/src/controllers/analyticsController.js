import * as analytics from '../services/analyticsService.js';
import { actorOf } from '../middleware/auth.js';

/* ---------------- Analytics ---------------- */

export const dashboard = async (_req, res) => res.json(await analytics.dashboard());
export const aging = async (_req, res) => res.json(await analytics.aging());
export const agingExplain = async (req, res) => res.json(await analytics.explainVehicleAging(req.params.vehicleId));
export const stores = async (_req, res) => res.json(await analytics.stores());
export const sustainability = async (_req, res) => res.json(await analytics.sustainability());
export const agingPlaybook = async (req, res) => res.json(await analytics.applyAgingPlaybook(req.params.vehicleId, actorOf(req)));
