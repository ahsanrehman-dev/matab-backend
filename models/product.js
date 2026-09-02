import mongoose from 'mongoose';

// ✅ Product Schema Definition
const ProductSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Product name is required'],
    trim: true,
    maxlength: [200, 'Product name cannot exceed 200 characters'],
    index: 'text' // Text index for search
  },
  description: {
    type: String,
    required: [true, 'Product description is required'],
    trim: true,
    maxlength: [2000, 'Description cannot exceed 2000 characters'],
    index: 'text' // Text index for search
  },
  images: [{
    type: String
  }],
  price: {
    type: Number,
    required: [true, 'Price is required'],
    min: [0, 'Price cannot be negative'],
    index: true
  },
  originalPrice: {
    type: Number,
    min: [0, 'Original price cannot be negative'],
    validate: {
      validator: function (v) {
        return !v || v >= this.price;
      },
      message: 'Original price must be greater than or equal to current price'
    }
  },
  quantity: {
    type: Number,
    required: [true, 'Quantity is required'],
    min: [0, 'Quantity cannot be negative'],
    default: 0
  },
  category: {
    type: String,
    required: [true, 'Category is required'],
    trim: true,
    index: true
  },
  brand: {
    type: String,
    trim: true,
    index: 'text'
  },
  specifications: [{
    key: { type: String, required: true, trim: true },
    value: { type: String, required: true, trim: true }
  }],
  managedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Admin reference is required'],
    index: true
  },
  status: {
    type: String,
    enum: ['active', 'revoked', 'pending', 'draft'],
    default: 'active',
    index: true
  },
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  ratings: {
    average: { type: Number, default: 0, min: 0, max: 5 },
    count: { type: Number, default: 0, min: 0 }
  },
  views: { type: Number, default: 0, min: 0 },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// ✅ Compound indexes
ProductSchema.index({ status: 1, category: 1 });
ProductSchema.index({ status: 1, price: 1 });
ProductSchema.index({ status: 1, createdAt: -1 });
ProductSchema.index({ managedBy: 1, status: 1 });
ProductSchema.index({ category: 1, price: 1 });
ProductSchema.index({ 'ratings.average': -1, status: 1 });

// ✅ Text search index
ProductSchema.index({
  name: 'text',
  description: 'text',
  brand: 'text',
  category: 'text'
}, {
  weights: {
    name: 10,
    brand: 5,
    category: 3,
    description: 1
  }
});

// ✅ Virtuals
ProductSchema.virtual('discountPercentage').get(function () {
  if (this.originalPrice && this.originalPrice > this.price) {
    return Math.round(((this.originalPrice - this.price) / this.originalPrice) * 100);
  }
  return 0;
});

ProductSchema.virtual('isAvailable').get(function () {
  return this.status === 'active' && this.quantity > 0;
});

ProductSchema.virtual('formattedPrice').get(function () {
  return `Rs ${this.price.toLocaleString()}`;
});

// ✅ Instance and static methods
ProductSchema.methods.incrementViews = function () {
  this.views += 1;
  return this.save();
};

ProductSchema.statics.getFeatured = function (limit = 10) {
  return this.find({
    status: 'active',
    quantity: { $gt: 0 },
    'ratings.average': { $gte: 4 }
  })
    .sort({ 'ratings.average': -1, views: -1 })
    .limit(limit)
    .populate('managedBy', 'username email');
};

ProductSchema.statics.getTrending = function (limit = 10) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  return this.find({
    status: 'active',
    quantity: { $gt: 0 },
    createdAt: { $gte: thirtyDaysAgo }
  })
    .sort({ views: -1, 'ratings.average': -1 })
    .limit(limit)
    .populate('managedBy', 'username email');
};

// ✅ Pre-save middleware
ProductSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

ProductSchema.pre('save', function (next) {
  if (this.images && this.images.length > 10) {
    return next(new Error('Cannot have more than 10 images'));
  }
  next();
});

ProductSchema.pre('save', function (next) {
  if (this.originalPrice && this.originalPrice < this.price) {
    this.originalPrice = this.price;
  }
  next();
});

// ✅ Drop old sku index if it exists (auto-fix)
ProductSchema.on('index', async (error) => {
  if (error && error.code === 11000) {
    console.warn('⚠️ Duplicate index detected, attempting to fix...');
  }
});

const Product = mongoose.model('Product', ProductSchema);

// ✅ Safe index cleanup (runs once)
(async () => {
  try {
    const indexes = await Product.collection.getIndexes({ full: true });
    const hasSkuIndex = indexes.some(idx => idx.name === 'sku_1');
    if (hasSkuIndex) {
      await Product.collection.dropIndex('sku_1');
      console.log('🧹 Removed old sku index (duplicate key issue fixed)');
    }
  } catch (err) {
    if (!err.message.includes('ns not found') && !err.message.includes('ns does not exist')) {
      console.error('⚠️ Error checking/dropping sku index:', err.message);
    }
  }
})();

export default Product;
