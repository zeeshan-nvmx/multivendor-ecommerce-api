const mongoose = require('mongoose')

const sizeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  quantity: {
    type: Number,
    required: true,
    default: 0,
  },
})

const colorSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  image: {
    original: {
      type: String,
    },
    thumbnail: {
      type: String,
    },
  },
  sizes: [sizeSchema],
})

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    required: true,
  },
  price: {
    type: Number,
    required: true,
  },
  sku: {
    type: String,
    required: true,
  },
  featured: {
    type: Boolean,
    default: false,
  },
  categories: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: true,
    },
  ],
  images: [
    {
      original: {
        type: String,
        required: true,
      },
      thumbnail: {
        type: String,
        required: true,
      },
    },
  ],
  colors: [colorSchema],
  // Add store reference
  storeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
})

// Remove global unique index on SKU
productSchema.index({ sku: 1, storeId: 1 }, { unique: true }) // SKU should be unique within a store
productSchema.index({ name: 'text', description: 'text', sku: 'text' })

// Update timestamp on save
productSchema.pre('save', function (next) {
  this.updatedAt = new Date()
  next()
})

const Product = mongoose.model('Product', productSchema)

module.exports = Product
