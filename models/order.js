import mongoose from "mongoose";

const OrderItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Product",
    required: [true, "Product is required"],
  },
  quantity: {
    type: Number,
    required: [true, "Quantity is required"],
    min: [1, "Quantity must be at least 1"],
  },
  price: {
    type: Number,
    required: [true, "Price is required"],
    min: [0, "Price cannot be negative"],
  },
  total: {
    type: Number,
    required: [true, "Total is required"],
    min: [0, "Total cannot be negative"],
  },
});

const ShippingAddressSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: [true, "First name is required"],
    trim: true,
  },
  lastName: {
    type: String,
    required: [true, "Last name is required"],
    trim: true,
  },
  email: {
    type: String,
    required: [true, "Email is required"],
    trim: true,
    lowercase: true,
    match: [/^\S+@\S+\.\S+$/, "Please provide a valid email"],
  },
  phone: {
    type: String,
    required: [true, "Phone number is required"],
    trim: true,
  },
  street: {
    type: String,
    required: [true, "Street address is required"],
    trim: true,
  },
  city: {
    type: String,
    required: [true, "City is required"],
    trim: true,
  },
  state: {
    type: String,
    required: [true, "State/Province is required"],
    trim: true,
  },
  zipCode: {
    type: String,
    trim: true,
    default: "N/A",
  },
  country: {
    type: String,
    default: "Pakistan",
    trim: true,
  },
});

const OrderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User is required"],
      index: true,
    },
    items: {
      type: [OrderItemSchema],
      validate: {
        validator: function (items) {
          return items && items.length > 0;
        },
        message: "Order must contain at least one item",
      },
    },
    shippingAddress: {
      type: ShippingAddressSchema,
      required: [true, "Shipping address is required"],
    },
    status: {
      type: String,
      enum: [
        "pending",
        "confirmed",
        "processing",
        "shipped",
        "delivered",
        "cancelled",
        "refunded",
      ],
      default: "pending",
      index: true,
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed", "refunded"],
      default: "pending",
      index: true,
    },
    paymentMethod: {
      type: String,
      enum: ["cash_on_delivery", "credit_card", "bank_transfer", "wallet"],
      default: "cash_on_delivery",
    },
    subtotal: {
      type: Number,
      required: [true, "Subtotal is required"],
      min: [0, "Subtotal cannot be negative"],
    },
    shippingCost: {
      type: Number,
      default: 0,
      min: [0, "Shipping cost cannot be negative"],
    },
    tax: {
      type: Number,
      default: 0,
      min: [0, "Tax cannot be negative"],
    },
    total: {
      type: Number,
      required: [true, "Total is required"],
      min: [0, "Total cannot be negative"],
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [500, "Notes cannot exceed 500 characters"],
    },
    trackingNumber: {
      type: String,
      trim: true,
    },
    estimatedDelivery: {
      type: Date,
    },
    deliveredAt: {
      type: Date,
    },
    cancelledAt: {
      type: Date,
    },
    cancellationReason: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual for formatted order number
OrderSchema.virtual("formattedOrderNumber").get(function () {
  return `#${this.orderNumber}`;
});

// Virtual for full shipping name
OrderSchema.virtual("shippingAddress.fullName").get(function () {
  if (this.shippingAddress) {
    return `${this.shippingAddress.firstName} ${this.shippingAddress.lastName}`;
  }
  return "";
});

// Virtual for order status display
OrderSchema.virtual("statusDisplay").get(function () {
  const statusMap = {
    pending: "Pending Confirmation",
    confirmed: "Confirmed",
    processing: "Processing",
    shipped: "Shipped",
    delivered: "Delivered",
    cancelled: "Cancelled",
    refunded: "Refunded",
  };
  return statusMap[this.status] || this.status;
});

// Virtual for payment status display
OrderSchema.virtual("paymentStatusDisplay").get(function () {
  const statusMap = {
    pending: "Payment Pending",
    paid: "Paid",
    failed: "Payment Failed",
    refunded: "Refunded",
  };
  return statusMap[this.paymentStatus] || this.paymentStatus;
});

// Virtual for order age in days
OrderSchema.virtual("orderAge").get(function () {
  if (this.createdAt) {
    const now = new Date();
    const diffTime = Math.abs(now - this.createdAt);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  }
  return 0;
});

// Instance method to update status
OrderSchema.methods.updateStatus = function (newStatus, notes = "") {
  this.status = newStatus;
  this.updatedAt = new Date();

  if (newStatus === "delivered") {
    this.deliveredAt = new Date();
    this.paymentStatus = "paid";
  }

  if (newStatus === "cancelled") {
    this.cancelledAt = new Date();
    if (notes) {
      this.cancellationReason = notes;
    }
  }

  if (notes && newStatus !== "cancelled") {
    this.notes = this.notes ? `${this.notes}\n${notes}` : notes;
  }

  return this.save();
};

// Instance method to update payment status
OrderSchema.methods.updatePaymentStatus = function (newStatus) {
  this.paymentStatus = newStatus;
  this.updatedAt = new Date();
  return this.save();
};

// Instance method to check if order can be cancelled
OrderSchema.methods.canBeCancelled = function () {
  return ["pending", "confirmed"].includes(this.status);
};

// Instance method to check if order can be modified
OrderSchema.methods.canBeModified = function () {
  return ["pending"].includes(this.status);
};

// Static method to generate order number
OrderSchema.statics.generateOrderNumber = async function () {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, "");

  const lastOrder = await this.findOne({
    orderNumber: new RegExp(`^${dateStr}`),
  }).sort({ orderNumber: -1 });

  let sequence = 1;
  if (lastOrder) {
    const lastSequence = parseInt(lastOrder.orderNumber.slice(-4));
    sequence = lastSequence + 1;
  }

  return `${dateStr}${sequence.toString().padStart(4, "0")}`;
};

// Static method to get orders by status
OrderSchema.statics.getByStatus = function (status, limit = 20, skip = 0) {
  return this.find({ status })
    .populate("user", "username email")
    .populate("items.product", "name price images")
    .sort({ createdAt: -1 })
    .limit(limit)
    .skip(skip);
};

// Static method to get user's order statistics
OrderSchema.statics.getUserStats = async function (userId) {
  const stats = await this.aggregate([
    { $match: { user: new mongoose.Types.ObjectId(userId) } },
    {
      $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        totalSpent: { $sum: "$total" },
        pendingOrders: {
          $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
        },
        confirmedOrders: {
          $sum: { $cond: [{ $eq: ["$status", "confirmed"] }, 1, 0] },
        },
        deliveredOrders: {
          $sum: { $cond: [{ $eq: ["$status", "delivered"] }, 1, 0] },
        },
        cancelledOrders: {
          $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] },
        },
      },
    },
  ]);

  return (
    stats[0] || {
      totalOrders: 0,
      totalSpent: 0,
      pendingOrders: 0,
      confirmedOrders: 0,
      deliveredOrders: 0,
      cancelledOrders: 0,
    }
  );
};

// Pre-save middleware to generate order number
OrderSchema.pre("save", async function (next) {
  try {
    // Generate order number only for new documents
    if (this.isNew && !this.orderNumber) {
      this.orderNumber = await this.constructor.generateOrderNumber();
    }

    // Set estimated delivery date if not set (2-3 working days)
    if (this.isNew && !this.estimatedDelivery) {
      const deliveryDate = new Date();
      deliveryDate.setDate(deliveryDate.getDate() + 3); // 3 working days
      this.estimatedDelivery = deliveryDate;
    }

    this.updatedAt = new Date();
    next();
  } catch (error) {
    next(error);
  }
});

// Pre-save middleware to validate order total
OrderSchema.pre("save", function (next) {
  try {
    const calculatedTotal = this.subtotal + this.shippingCost + this.tax;
    if (Math.abs(calculatedTotal - this.total) > 0.01) {
      return next(new Error("Order total does not match calculated total"));
    }
    next();
  } catch (error) {
    next(error);
  }
});

// Indexes for common queries
OrderSchema.index({ user: 1, createdAt: -1 });
OrderSchema.index({ status: 1, createdAt: -1 });
OrderSchema.index({ paymentStatus: 1, createdAt: -1 });
// OrderSchema.index({ orderNumber: 1 });
OrderSchema.index({ "shippingAddress.email": 1 });
OrderSchema.index({ "shippingAddress.phone": 1 });

export default mongoose.model("Order", OrderSchema);
