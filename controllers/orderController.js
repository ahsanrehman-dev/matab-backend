import Order from '../models/order.js';
import Cart from '../models/cart.js';
import Product from '../models/product.js';
import mongoose from 'mongoose';
import { AppError, catchAsync } from '../middleware/errorHandler.js';

const getProductId = (item) =>
    item?.product?._id || item?.product || item?.productId || null;

const restoreStock = async (deducted) => {
    await Promise.all(
        deducted.map(({ productId, quantity }) =>
            Product.findByIdAndUpdate(productId, { $inc: { quantity } })
        )
    );
};

const reduceStock = async (items) => {
    const deducted = [];

    try {
        for (const item of items) {
            const productId = getProductId(item);
            const qty = Number(item.quantity);

            if (!productId || !Number.isFinite(qty) || qty < 1) {
                throw new AppError('Invalid order item', 400);
            }

            const updated = await Product.findOneAndUpdate(
                { _id: productId, quantity: { $gte: qty } },
                { $inc: { quantity: -qty } },
                { new: true }
            );

            if (!updated) {
                const product = await Product.findById(productId).select('name quantity');
                throw new AppError(
                    product
                        ? `${product.name} has only ${product.quantity} left in stock`
                        : 'A product in your order is no longer available',
                    400
                );
            }

            deducted.push({ productId, quantity: qty });
        }

        return deducted;
    } catch (error) {
        await restoreStock(deducted);
        throw error;
    }
};

const normalizeShippingAddress = (shippingAddress) => {
    if (!shippingAddress || !shippingAddress.firstName || !shippingAddress.lastName ||
        !shippingAddress.street || !shippingAddress.city || !shippingAddress.state ||
        !shippingAddress.phone || !shippingAddress.email) {
        return null;
    }

    if (!shippingAddress.zipCode?.trim()) {
        shippingAddress.zipCode = 'N/A';
    }

    return shippingAddress;
};

const calculateTotals = (items) => {
    const subtotal = items.reduce((total, item) => {
        return total + (item.price * item.quantity);
    }, 0);

    const shippingCost = subtotal > 5000 ? 0 : 200;
    const tax = Math.round(subtotal * 0.05);
    const total = subtotal + shippingCost + tax;

    return { subtotal, shippingCost, tax, total };
};

const saveOrderAndReduceStock = async ({ userId, isGuest, items, shippingAddress, paymentMethod, notes }) => {
    const totals = calculateTotals(items);
    const deducted = await reduceStock(items);

    try {
        const order = new Order({
            user: userId || undefined,
            isGuest: Boolean(isGuest),
            items: items.map((item) => ({
                product: getProductId(item),
                quantity: item.quantity,
                price: item.price,
                total: item.price * item.quantity
            })),
            shippingAddress,
            paymentMethod,
            ...totals,
            notes,
            status: 'pending',
            paymentStatus: 'pending'
        });

        await order.save();
        return order;
    } catch (error) {
        await restoreStock(deducted);
        throw error;
    }
};

const populateOrder = (order) =>
    order.populate({
        path: 'items.product',
        select: 'name price images category brand'
    });

// @desc    Create new order from the logged-in user's cart
// @route   POST /api/user/orders
// @access  Private
export const createOrder = catchAsync(async (req, res, next) => {
    const { shippingAddress, paymentMethod = 'cash_on_delivery', notes = '' } = req.body;

    const normalizedAddress = normalizeShippingAddress(shippingAddress);
    if (!normalizedAddress) {
        return next(new AppError('Complete shipping address is required', 400));
    }

    const userId = req.user._id;
    const cart = await Cart.findOne({ user: userId })
        .populate({
            path: 'items.product',
            select: 'name price status quantity images category brand'
        });

    if (!cart || cart.items.length === 0) {
        return next(new AppError('Cart is empty', 400));
    }

    const unavailableProducts = [];
    const orderItems = [];

    for (const item of cart.items) {
        if (!item.product || item.product.status !== 'active') {
            unavailableProducts.push(item.product?.name || 'Unknown product');
            continue;
        }

        if (item.product.quantity < item.quantity) {
            unavailableProducts.push(`${item.product.name} (only ${item.product.quantity} available)`);
            continue;
        }

        orderItems.push({
            product: item.product._id,
            quantity: item.quantity,
            price: item.product.price
        });
    }

    if (unavailableProducts.length > 0) {
        return next(new AppError(
            `Some products are no longer available: ${unavailableProducts.join(', ')}`,
            400
        ));
    }

    const order = await saveOrderAndReduceStock({
        userId,
        isGuest: false,
        items: orderItems,
        shippingAddress: normalizedAddress,
        paymentMethod,
        notes
    });

    await cart.clear();
    await populateOrder(order);

    res.status(201).json({
        success: true,
        message: 'Order created successfully',
        order
    });
});

// @desc    Create guest order and reduce stock
// @route   POST /api/orders/guest
// @access  Public
export const createGuestOrder = catchAsync(async (req, res, next) => {
    const { shippingAddress, paymentMethod = 'cash_on_delivery', notes = '', items } = req.body;

    const normalizedAddress = normalizeShippingAddress(shippingAddress);
    if (!normalizedAddress) {
        return next(new AppError('Complete shipping address is required', 400));
    }

    if (!Array.isArray(items) || items.length === 0) {
        return next(new AppError('Order items are required', 400));
    }

    if (items.length > 50) {
        return next(new AppError('Too many items in this order', 400));
    }

    const orderItems = [];

    for (const item of items) {
        const productId = getProductId(item);
        const quantity = Number(item.quantity);

        if (!mongoose.Types.ObjectId.isValid(productId) || !Number.isFinite(quantity) || quantity < 1 || quantity > 100) {
            return next(new AppError('Invalid order item', 400));
        }

        const product = await Product.findById(productId).select('name price status quantity');
        if (!product || product.status !== 'active') {
            return next(new AppError('A product in your order is no longer available', 400));
        }

        if (product.quantity < quantity) {
            return next(new AppError(
                `${product.name} (only ${product.quantity} available)`,
                400
            ));
        }

        orderItems.push({
            product: product._id,
            quantity,
            price: product.price
        });
    }

    const order = await saveOrderAndReduceStock({
        userId: undefined,
        isGuest: true,
        items: orderItems,
        shippingAddress: normalizedAddress,
        paymentMethod,
        notes
    });

    await populateOrder(order);

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
    const filter = { user: req.user._id };
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
        user: req.user._id
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
        user: req.user._id
    });

    if (!order) {
        return next(new AppError('Order not found', 404));
    }

    // Only allow cancellation if order is pending or confirmed
    if (!['pending', 'confirmed'].includes(order.status)) {
        return next(new AppError('Order cannot be cancelled at this stage', 400));
    }

    await restoreStock(
        order.items.map((item) => ({
            productId: getProductId(item),
            quantity: item.quantity
        }))
    );

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
    const userId = req.user._id;

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
