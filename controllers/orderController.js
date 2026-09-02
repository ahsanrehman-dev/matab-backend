import Order from '../models/order.js';
import Cart from '../models/cart.js';
import Product from '../models/product.js';
import mongoose from 'mongoose';
import { AppError, catchAsync } from '../middleware/errorHandler.js';

// @desc    Create new order
// @route   POST /api/user/orders
// @access  Private
export const createOrder = catchAsync(async (req, res, next) => {
    const { shippingAddress, paymentMethod = 'cash_on_delivery', notes = '' } = req.body;

    // Validate shipping address (postal code is optional for COD in Pakistan)
    if (!shippingAddress || !shippingAddress.firstName || !shippingAddress.lastName ||
        !shippingAddress.street || !shippingAddress.city || !shippingAddress.state ||
        !shippingAddress.phone || !shippingAddress.email) {
        return next(new AppError('Complete shipping address is required', 400));
    }

    if (!shippingAddress.zipCode?.trim()) {
        shippingAddress.zipCode = 'N/A';
    }

    // Get user's cart
    const cart = await Cart.findOne({ user: req.user.id })
        .populate({
            path: 'items.product',
            select: 'name price status quantity images category brand'
        });

    if (!cart || cart.items.length === 0) {
        return next(new AppError('Cart is empty', 400));
    }

    // Validate all products are still available
    const unavailableProducts = [];
    for (const item of cart.items) {
        if (!item.product || item.product.status !== 'active') {
            unavailableProducts.push(item.product?.name || 'Unknown product');
            continue;
        }

        if (item.product.quantity < item.quantity) {
            unavailableProducts.push(`${item.product.name} (only ${item.product.quantity} available)`);
        }
    }

    if (unavailableProducts.length > 0) {
        return next(new AppError(
            `Some products are no longer available: ${unavailableProducts.join(', ')}`,
            400
        ));
    }

    // Calculate totals
    const subtotal = cart.items.reduce((total, item) => {
        return total + (item.product.price * item.quantity);
    }, 0);

    const shippingCost = subtotal > 5000 ? 0 : 200; // Free shipping over 5000 PKR
    const tax = Math.round(subtotal * 0.05); // 5% tax
    const total = subtotal + shippingCost + tax;

    // Create order
    const order = new Order({
        user: req.user.id,
        items: cart.items.map(item => ({
            product: item.product._id,
            quantity: item.quantity,
            price: item.product.price,
            total: item.product.price * item.quantity
        })),
        shippingAddress,
        paymentMethod,
        subtotal,
        shippingCost,
        tax,
        total,
        notes,
        status: 'pending',
        paymentStatus: paymentMethod === 'cash_on_delivery' ? 'pending' : 'pending'
    });

    await order.save();

    // Reduce product quantities
    for (const item of cart.items) {
        await Product.findByIdAndUpdate(
            item.product._id,
            { $inc: { quantity: -item.quantity } }
        );
    }

    // Clear cart after successful order
    await cart.clear();

    // Populate order with product details
    await order.populate({
        path: 'items.product',
        select: 'name price images category brand'
    });

    res.status(201).json({
        success: true,
        message: 'Order created successfully',
        order
    });
});

// @desc    Get user's orders
// @route   GET /api/user/orders
// @access  Private
export const getUserOrders = catchAsync(async (req, res, next) => {
    const { page = 1, limit = 10, status } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build filter
    const filter = { user: req.user.id };
    if (status) {
        filter.status = status;
    }

    const orders = await Order.find(filter)
        .populate({
            path: 'items.product',
            select: 'name price images category brand'
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit));

    const totalOrders = await Order.countDocuments(filter);

    res.status(200).json({
        success: true,
        orders,
        pagination: {
            currentPage: parseInt(page),
            totalPages: Math.ceil(totalOrders / parseInt(limit)),
            totalOrders,
            hasNext: parseInt(page) < Math.ceil(totalOrders / parseInt(limit)),
            hasPrev: parseInt(page) > 1
        }
    });
});

// @desc    Get single order
// @route   GET /api/user/orders/:id
// @access  Private
export const getOrder = catchAsync(async (req, res, next) => {
    const order = await Order.findOne({
        _id: req.params.id,
        user: req.user.id
    }).populate({
        path: 'items.product',
        select: 'name price images category brand'
    });

    if (!order) {
        return next(new AppError('Order not found', 404));
    }

    res.status(200).json({
        success: true,
        order
    });
});

// @desc    Cancel order
// @route   PATCH /api/user/orders/:id/cancel
// @access  Private
export const cancelOrder = catchAsync(async (req, res, next) => {
    const order = await Order.findOne({
        _id: req.params.id,
        user: req.user.id
    });

    if (!order) {
        return next(new AppError('Order not found', 404));
    }

    // Only allow cancellation if order is pending or confirmed
    if (!['pending', 'confirmed'].includes(order.status)) {
        return next(new AppError('Order cannot be cancelled at this stage', 400));
    }

    // Restore product quantities
    for (const item of order.items) {
        await Product.findByIdAndUpdate(
            item.product,
            { $inc: { quantity: item.quantity } }
        );
    }

    // Update order status
    order.status = 'cancelled';
    order.paymentStatus = 'refunded';
    await order.save();

    res.status(200).json({
        success: true,
        message: 'Order cancelled successfully',
        order
    });
});

// @desc    Get order status options
// @route   GET /api/user/orders/status-options
// @access  Private
export const getOrderStatusOptions = catchAsync(async (req, res, next) => {
    const statusOptions = [
        { value: 'pending', label: 'Pending Confirmation', description: 'Order is being processed' },
        { value: 'confirmed', label: 'Confirmed', description: 'Order has been confirmed' },
        { value: 'processing', label: 'Processing', description: 'Order is being prepared' },
        { value: 'shipped', label: 'Shipped', description: 'Order has been shipped' },
        { value: 'delivered', label: 'Delivered', description: 'Order has been delivered' },
        { value: 'cancelled', label: 'Cancelled', description: 'Order has been cancelled' }
    ];

    res.status(200).json({
        success: true,
        statusOptions
    });
});

// @desc    Get order statistics for user
// @route   GET /api/user/orders/stats
// @access  Private
export const getOrderStats = catchAsync(async (req, res, next) => {
    const userId = req.user.id;

    const stats = await Order.aggregate([
        { $match: { user: new mongoose.Types.ObjectId(userId) } },
        {
            $group: {
                _id: null,
                totalOrders: { $sum: 1 },
                totalSpent: { $sum: '$total' },
                pendingOrders: {
                    $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
                },
                deliveredOrders: {
                    $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] }
                },
                cancelledOrders: {
                    $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] }
                }
            }
        }
    ]);

    const result = stats[0] || {
        totalOrders: 0,
        totalSpent: 0,
        pendingOrders: 0,
        deliveredOrders: 0,
        cancelledOrders: 0
    };

    res.status(200).json({
        success: true,
        stats: result
    });
});