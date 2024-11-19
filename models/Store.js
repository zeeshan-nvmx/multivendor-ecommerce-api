const mongoose = require('mongoose')
const { Schema } = mongoose

const storeSchema = new Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  description: {
    type: String,
    trim: true,
  },
  logo: {
    type: String,
  },
  banner: {
    type: String,
  },
  address: {
    line1: String,
    line2: String,
    city: String,
    state: String,
    country: String,
    postal_code: String,
  },
  contact: {
    email: String,
    phone: String,
  },
  settings: {
    currency: {
      type: String,
      default: 'USD',
    },
    taxRate: {
      type: Number,
      default: 0,
    },
    shippingFee: {
      type: Number,
      default: 0,
    },
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  ownerId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
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

// Update the updatedAt timestamp before saving
storeSchema.pre('save', function (next) {
  this.updatedAt = new Date()
  next()
})

// Create slug from store name before saving
storeSchema.pre('save', function (next) {
  if (this.isModified('name')) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-zA-Z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
  }
  next()
})

const Store = mongoose.model('Store', storeSchema)

module.exports = Store
