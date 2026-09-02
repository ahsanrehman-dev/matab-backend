import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
    createOrder,
    createGuestOrder,
    getUserOrders,
    getOrder,
    cancelOrder,
    getOrderStatusOptions,
    getOrderStats
} from '../controllers/orderController.js';

export const publicOrderRouter = express.Router();
publicOrderRouter.post('/guest', createGuestOrder);

const router = express.Router();

// All authenticated order routes require a token
router.use(protect);

// Order statistics
router.get('/stats', getOrderStats);

// Order status options
router.get('/status-options', getOrderStatusOptions);

// Get user's orders
router.get('/', getUserOrders);

// Get single order
router.get('/:id', getOrder);

// Create new order
router.post('/', createOrder);

// Cancel order
router.patch('/:id/cancel', cancelOrder);

export default router;
